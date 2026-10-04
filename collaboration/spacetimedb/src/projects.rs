//! Project lifecycle, membership, and the caller's own profile.

use std::collections::HashSet;
use std::time::Duration;

use spacetimedb::{ConnectionId, Identity, ReducerContext, SpacetimeType, Table};

use crate::edit::{
    Edit, ensure_user, find_project, grant_membership, membership, require_can_write,
};
use crate::schema::{
    ActorKind, Collaborator, EditOp, LiveSession, MemberRole, Project, ProjectMetadata, Scene,
    ShareInvite, TrackGroup, TrackKind, asset, asset_chunk, clip, clip_effect, collaborator,
    chat_message, edit_history, live_session, presence as presence_table, project, project_member,
    project_metadata, scene, share_invite, track, user,
};
use crate::tracks::insert_track;

#[derive(SpacetimeType)]
pub struct MetadataInput {
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub fps_numerator: u32,
    pub fps_denominator: u32,
    pub background: String,
    pub extra: String,
}

/// Creates a project together with the main scene and main video track.
///
/// All three ids come from the caller so that the editor's existing local ids
/// survive the round trip; a project without a main track is not loadable.
#[spacetimedb::reducer]
pub fn create_project(
    ctx: &ReducerContext,
    project_id: String,
    name: String,
    scene_id: String,
    main_track_id: String,
    metadata: MetadataInput,
) -> Result<(), String> {
    if project_id.is_empty() {
        return Err("project id is required".to_string());
    }
    if ctx.db.project().id().find(project_id.clone()).is_some() {
        return Err(format!("project `{project_id}` already exists"));
    }

    ensure_user(ctx);

    ctx.db.project().insert(Project {
        id: project_id.clone(),
        name: name.clone(),
        owner: ctx.sender(),
        revision: 0,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    ctx.db.project_metadata().insert(ProjectMetadata {
        project_id: project_id.clone(),
        canvas_width: metadata.canvas_width,
        canvas_height: metadata.canvas_height,
        fps_numerator: metadata.fps_numerator,
        fps_denominator: metadata.fps_denominator,
        background: metadata.background,
        extra: metadata.extra,
    });
    ctx.db.scene().insert(Scene {
        id: scene_id.clone(),
        project_id: project_id.clone(),
        name: "Main".to_string(),
        is_main: true,
        position: 0,
    });
    grant_membership(ctx, &project_id, ctx.sender(), MemberRole::Owner);

    let edit = Edit::open(ctx, &project_id)?;
    insert_track(
        ctx,
        &edit,
        main_track_id.clone(),
        scene_id,
        TrackGroup::Main,
        TrackKind::Video,
        "Main".to_string(),
        0,
    );
    edit.record(
        ctx,
        EditOp::CreateProject,
        &project_id,
        format!("Created project `{name}`"),
        format!("{{\"name\":{name:?},\"mainTrackId\":{main_track_id:?}}}"),
    );
    Ok(())
}

/// At most this many people may edit a project at the same time.
///
/// The owner always keeps a seat. A write link past the cap joins as view-only
/// until someone leaves.
const MAX_ACTIVE_EDITORS: usize = 4;

const PRESENCE_COLORS: [&str; 8] = [
    "#f97316", "#38bdf8", "#e879f9", "#facc15", "#34d399", "#a78bfa", "#fb7185", "#22d3ee",
];

/// Joins an existing project.
///
/// A write invite grants Editor until four editors are active. A view invite,
/// or no token, grants Viewer. Agents keep the Agent role. An existing member
/// is not downgraded; a viewer who later opens a write link is upgraded when
/// a seat is free.
#[spacetimedb::reducer]
pub fn join_project(
    ctx: &ReducerContext,
    project_id: String,
    invite_token: String,
    display_name: String,
) -> Result<(), String> {
    let project = find_project(ctx, &project_id)?;
    if project.owner != ctx.sender() && !actor_is_agent(ctx) && !live_session_active(ctx, &project_id)
    {
        return Err("the host has not started a CoClip session".to_string());
    }
    let name = remember_display_name(ctx, &display_name);
    let color = assign_presence_color(ctx, &project_id);

    let wants_write = match actor_is_agent(ctx) {
        true => true,
        false => connection_can_write(ctx, &project_id, &invite_token)?,
    };
    let at_capacity = wants_write && !write_seat_available(ctx, &project_id);
    let can_write = wants_write && !at_capacity;

    let role = session_role(ctx, &project_id, can_write, &invite_token)?;
    grant_membership(ctx, &project_id, ctx.sender(), role);
    write_collaborator(ctx, &project_id, can_write, &name, &color, role, at_capacity)?;
    // A second window of the same identity is the same person. Give every
    // person in the project one colour that no one else is using.
    paint_distinct_colors(ctx, &project_id);
    Ok(())
}

/// Creates a view-only or write invite. The client supplies the token so the
/// same link can be copied again without a return value from the reducer.
#[spacetimedb::reducer]
pub fn create_share_invite(
    ctx: &ReducerContext,
    project_id: String,
    token: String,
    can_write: bool,
) -> Result<(), String> {
    require_can_write(ctx, &project_id)?;
    validate_invite_token(&token)?;

    if let Some(existing) = ctx.db.share_invite().token().find(token.clone()) {
        if existing.project_id != project_id || existing.can_write != can_write {
            return Err("share token already exists".to_string());
        }
        return Ok(());
    }

    ctx.db.share_invite().insert(ShareInvite {
        token,
        project_id,
        can_write,
        created_by: ctx.sender(),
        created_at: ctx.timestamp,
    });
    Ok(())
}

/// Opens the project to other people. Only the host can start it.
#[spacetimedb::reducer]
pub fn start_live_session(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    let project = require_host(ctx, &project_id)?;
    let row = LiveSession {
        project_id: project_id.clone(),
        host: project.owner,
        active: true,
        started_at: ctx.timestamp,
    };
    match ctx
        .db
        .live_session()
        .project_id()
        .find(project_id.clone())
        .is_some()
    {
        true => {
            ctx.db.live_session().project_id().update(row);
        }
        false => {
            ctx.db.live_session().insert(row);
        }
    }
    Ok(())
}

/// Ends the live session and drops everyone except the host.
#[spacetimedb::reducer]
pub fn stop_live_session(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    let project = require_host(ctx, &project_id)?;
    let Some(existing) = ctx.db.live_session().project_id().find(project_id.clone()) else {
        return Err("there is no CoClip session to stop".to_string());
    };
    ctx.db.live_session().project_id().update(LiveSession {
        active: false,
        ..existing
    });
    drop_guests(ctx, &project_id, project.owner);
    Ok(())
}

/// Removes one person from the live session. Their link can be used again
/// while the session is still running.
#[spacetimedb::reducer]
pub fn remove_participant(
    ctx: &ReducerContext,
    project_id: String,
    identity: String,
) -> Result<(), String> {
    let project = require_host(ctx, &project_id)?;
    let identity = parse_identity(&identity)?;
    if identity == project.owner {
        return Err("the host cannot be removed".to_string());
    }
    drop_identity(ctx, &project_id, identity);
    Ok(())
}

/// Drops the caller from the live session. The host ends the session instead.
#[spacetimedb::reducer]
pub fn leave_session(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    let project = find_project(ctx, &project_id)?;
    if project.owner == ctx.sender() {
        return Err("the host stops a session instead of leaving".to_string());
    }
    if !live_session_active(ctx, &project_id) {
        return Err("there is no CoClip session to leave".to_string());
    }
    drop_identity(ctx, &project_id, ctx.sender());
    Ok(())
}

fn require_host(ctx: &ReducerContext, project_id: &str) -> Result<Project, String> {
    let project = find_project(ctx, project_id)?;
    if project.owner != ctx.sender() {
        return Err("only the host can do that".to_string());
    }
    Ok(project)
}

fn live_session_active(ctx: &ReducerContext, project_id: &str) -> bool {
    ctx.db
        .live_session()
        .project_id()
        .find(project_id.to_string())
        .is_some_and(|session| session.active)
}

fn drop_guests(ctx: &ReducerContext, project_id: &str, host: Identity) {
    let guests: Vec<Identity> = ctx
        .db
        .collaborator()
        .iter()
        .filter(|row| row.project_id == project_id && row.identity != host && row.kind != ActorKind::Agent)
        .map(|row| row.identity)
        .collect();
    let mut seen = HashSet::new();
    for identity in guests {
        if seen.insert(identity) {
            drop_identity(ctx, project_id, identity);
        }
    }
}

fn drop_identity(ctx: &ReducerContext, project_id: &str, identity: Identity) {
    let connections: Vec<ConnectionId> = ctx
        .db
        .collaborator()
        .iter()
        .filter(|row| row.project_id == project_id && row.identity == identity)
        .map(|row| row.connection_id)
        .collect();
    for connection_id in connections {
        ctx.db.collaborator().connection_id().delete(connection_id);
        ctx.db.presence().connection_id().delete(connection_id);
    }
}

fn parse_identity(hex: &str) -> Result<Identity, String> {
    let hex = hex.trim().trim_start_matches("0x");
    Identity::from_hex(hex).map_err(|error| format!("unknown participant: {error}"))
}

/// The role stored on this window's collaborator row.
///
/// An owner stays the owner, and an existing editor stays an editor. A write
/// invite upgrades a viewer. A view link is view-only for this window only.
fn session_role(
    ctx: &ReducerContext,
    project_id: &str,
    can_write: bool,
    invite_token: &str,
) -> Result<MemberRole, String> {
    if actor_is_agent(ctx) {
        return Ok(MemberRole::Agent);
    }
    if let Some(existing) = membership(ctx, project_id, &ctx.sender()) {
        match existing.role {
            MemberRole::Owner | MemberRole::Agent => return Ok(existing.role),
            MemberRole::Editor if can_write => return Ok(MemberRole::Editor),
            MemberRole::Editor | MemberRole::Viewer => {}
        }
    }
    if can_write {
        return role_from_invite(ctx, project_id, invite_token);
    }
    Ok(MemberRole::Viewer)
}

fn role_from_invite(
    ctx: &ReducerContext,
    project_id: &str,
    invite_token: &str,
) -> Result<MemberRole, String> {
    if invite_token.is_empty() {
        return Ok(MemberRole::Viewer);
    }
    let invite = ctx
        .db
        .share_invite()
        .token()
        .find(invite_token.to_string())
        .ok_or_else(|| "unknown share link".to_string())?;
    if invite.project_id != project_id {
        return Err("share link does not match this project".to_string());
    }
    Ok(match invite.can_write {
        true => MemberRole::Editor,
        false => MemberRole::Viewer,
    })
}

/// Empty token: an existing editor keeps write access (opening their own
/// project). A view or write token applies only to this connection.
fn connection_can_write(
    ctx: &ReducerContext,
    project_id: &str,
    invite_token: &str,
) -> Result<bool, String> {
    if actor_is_agent(ctx) {
        return Ok(true);
    }
    if invite_token.is_empty() {
        let role = crate::edit::membership(ctx, project_id, &ctx.sender()).map(|member| member.role);
        return Ok(matches!(
            role,
            Some(MemberRole::Owner | MemberRole::Editor | MemberRole::Agent)
        ));
    }
    let invite = ctx
        .db
        .share_invite()
        .token()
        .find(invite_token.to_string())
        .ok_or_else(|| "unknown share link".to_string())?;
    if invite.project_id != project_id {
        return Err("share link does not match this project".to_string());
    }
    Ok(invite.can_write)
}

fn write_seat_available(ctx: &ReducerContext, project_id: &str) -> bool {
    write_seat_available_for(ctx, project_id, ctx.sender())
}

/// True when `identity` can take or already holds one of the four edit seats.
///
/// Seats are counted from the collaborator table. The owner keeps a seat even
/// while offline, and an agent never takes one.
fn write_seat_available_for(ctx: &ReducerContext, project_id: &str, identity: Identity) -> bool {
    if identity_is_agent(ctx, identity) {
        return true;
    }
    let seats = editor_seats(ctx, project_id);
    if seats.contains(&identity) {
        return true;
    }
    seats.len() < MAX_ACTIVE_EDITORS
}

fn editor_seats(ctx: &ReducerContext, project_id: &str) -> HashSet<Identity> {
    let mut seats = HashSet::new();
    if let Some(project) = ctx.db.project().id().find(project_id.to_string()) {
        seats.insert(project.owner);
    }
    for row in ctx.db.collaborator().iter() {
        if row.project_id != project_id || !row.can_write || row.kind == ActorKind::Agent {
            continue;
        }
        seats.insert(row.identity);
    }
    seats
}

fn identity_is_agent(ctx: &ReducerContext, identity: Identity) -> bool {
    ctx.db
        .user()
        .identity()
        .find(identity)
        .map(|row| row.kind == ActorKind::Agent)
        .unwrap_or(false)
}

/// Saves the name typed for this join and returns it.
fn remember_display_name(ctx: &ReducerContext, display_name: &str) -> String {
    let name = sanitize_name(display_name);
    let existing = ensure_user(ctx);
    let name = if name.is_empty() {
        existing.name.clone()
    } else {
        name
    };
    ctx.db.user().identity().update(crate::schema::User {
        name: name.clone(),
        ..existing
    });
    name
}

fn sanitize_name(name: &str) -> String {
    name.trim().chars().take(40).collect()
}

/// Picks a palette colour no other person currently in this project is using.
///
/// Colour follows the Spacetime identity, which is the saved login token. The
/// machine's address is only how the socket is reached, so two people on the
/// same network still get two colours.
fn assign_presence_color(ctx: &ReducerContext, project_id: &str) -> String {
    let me = ctx.sender();
    let used = colors_used_by_others(ctx, project_id, me);
    if let Some(row) = ctx.db.user().identity().find(me) {
        if PRESENCE_COLORS.contains(&row.color.as_str()) && !used.contains(&row.color) {
            return row.color;
        }
    }
    PRESENCE_COLORS
        .iter()
        .copied()
        .find(|color| !used.contains(*color))
        .unwrap_or(PRESENCE_COLORS[0])
        .to_string()
}

fn colors_used_by_others(
    ctx: &ReducerContext,
    project_id: &str,
    except: Identity,
) -> HashSet<String> {
    let mut used = HashSet::new();
    for row in ctx.db.collaborator().iter() {
        if row.project_id != project_id || row.identity == except || row.color.is_empty() {
            continue;
        }
        used.insert(row.color);
    }
    used
}

/// Gives each person in the project one palette colour, shared by their cursor
/// and their icon, and different from everyone else who is here.
fn paint_distinct_colors(ctx: &ReducerContext, project_id: &str) {
    let mut people: Vec<Identity> = Vec::new();
    for row in ctx.db.collaborator().iter() {
        if row.project_id != project_id || people.contains(&row.identity) {
            continue;
        }
        people.push(row.identity);
    }
    people.sort_by(|left, right| left.to_hex().to_string().cmp(&right.to_hex().to_string()));

    let mut used: HashSet<String> = HashSet::new();
    for identity in people {
        let current = ctx
            .db
            .collaborator()
            .iter()
            .find(|row| row.project_id == project_id && row.identity == identity)
            .map(|row| row.color)
            .unwrap_or_default();
        let color = match PRESENCE_COLORS.contains(&current.as_str()) && !used.contains(&current) {
            true => current,
            false => PRESENCE_COLORS
                .iter()
                .copied()
                .find(|color| !used.contains(*color))
                .unwrap_or(PRESENCE_COLORS[0])
                .to_string(),
        };
        used.insert(color.clone());
        if let Some(existing) = ctx.db.user().identity().find(identity) {
            if existing.color != color {
                ctx.db.user().identity().update(crate::schema::User {
                    color: color.clone(),
                    ..existing
                });
            }
        }
        let connections: Vec<ConnectionId> = ctx
            .db
            .collaborator()
            .iter()
            .filter(|row| row.project_id == project_id && row.identity == identity)
            .map(|row| row.connection_id)
            .collect();
        for connection_id in connections {
            let Some(existing) = ctx.db.collaborator().connection_id().find(connection_id) else {
                continue;
            };
            if existing.color == color {
                continue;
            }
            ctx.db.collaborator().connection_id().update(Collaborator {
                color: color.clone(),
                ..existing
            });
        }
    }
}

fn write_collaborator(
    ctx: &ReducerContext,
    project_id: &str,
    can_write: bool,
    display_name: &str,
    color: &str,
    role: MemberRole,
    at_capacity: bool,
) -> Result<(), String> {
    let connection_id = ctx
        .connection_id()
        .ok_or_else(|| "join requires a client connection".to_string())?;
    let row = Collaborator {
        connection_id,
        project_id: project_id.to_string(),
        identity: ctx.sender(),
        display_name: display_name.to_string(),
        color: color.to_string(),
        kind: match actor_is_agent(ctx) {
            true => ActorKind::Agent,
            false => ActorKind::Human,
        },
        role,
        can_write,
        at_capacity,
        last_seen: ctx.timestamp,
    };
    match ctx
        .db
        .collaborator()
        .connection_id()
        .find(connection_id)
        .is_some()
    {
        true => {
            ctx.db.collaborator().connection_id().update(row);
        }
        false => {
            ctx.db.collaborator().insert(row);
        }
    }
    Ok(())
}

/// Drops collaborators this project has not heard from recently, and their cursors.
///
/// A live window touches `last_seen` from presence. A connection that died
/// without a disconnect still has a row until someone opens the participant list.
#[spacetimedb::reducer]
pub fn refresh_participants(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    find_project(ctx, &project_id)?;
    if membership(ctx, &project_id, &ctx.sender()).is_none() {
        return Err(format!("not a member of project `{project_id}`"));
    }

    let stale: Vec<ConnectionId> = ctx
        .db
        .collaborator()
        .iter()
        .filter(|row| {
            row.project_id == project_id && collaborator_is_stale(ctx.timestamp, row.last_seen)
        })
        .map(|row| row.connection_id)
        .collect();

    for connection_id in stale {
        ctx.db.collaborator().connection_id().delete(connection_id);
        ctx.db.presence().connection_id().delete(connection_id);
    }
    paint_distinct_colors(ctx, &project_id);
    Ok(())
}

/// Switches one window between editing and view-only.
///
/// Only the host may change it. Promoting someone fails once four people
/// already hold an edit seat.
#[spacetimedb::reducer]
pub fn set_participant_access(
    ctx: &ReducerContext,
    project_id: String,
    connection_id: String,
    can_write: bool,
) -> Result<(), String> {
    let project = find_project(ctx, &project_id)?;
    ensure_can_manage_participants(ctx, &project)?;

    let connection_id = parse_connection_id(&connection_id)?;
    let Some(existing) = ctx.db.collaborator().connection_id().find(connection_id) else {
        return Err("that person is no longer in this session".to_string());
    };
    if existing.project_id != project_id {
        return Err("that person is not in this project".to_string());
    }
    if existing.kind == ActorKind::Agent {
        return Err("an agent always edits".to_string());
    }

    let identity = existing.identity;
    let connections: Vec<ConnectionId> = ctx
        .db
        .collaborator()
        .iter()
        .filter(|row| row.project_id == project_id && row.identity == identity)
        .map(|row| row.connection_id)
        .collect();
    if connections.iter().all(|connection_id| {
        ctx.db
            .collaborator()
            .connection_id()
            .find(*connection_id)
            .is_some_and(|row| row.can_write == can_write)
    }) {
        return Ok(());
    }
    if can_write && !write_seat_available_for(ctx, &project_id, identity) {
        return Err("this project already has 4 editors".to_string());
    }

    let membership_role = membership(ctx, &project_id, &identity).map(|member| member.role);
    let role = if membership_role == Some(MemberRole::Owner) {
        MemberRole::Owner
    } else if can_write && existing.role == MemberRole::Viewer {
        grant_membership(ctx, &project_id, identity, MemberRole::Editor);
        MemberRole::Editor
    } else {
        existing.role
    };
    for connection_id in connections {
        let Some(row) = ctx.db.collaborator().connection_id().find(connection_id) else {
            continue;
        };
        ctx.db.collaborator().connection_id().update(Collaborator {
            can_write,
            at_capacity: false,
            role,
            last_seen: ctx.timestamp,
            ..row
        });
    }
    Ok(())
}

fn ensure_can_manage_participants(ctx: &ReducerContext, project: &Project) -> Result<(), String> {
    if project.owner == ctx.sender() {
        return Ok(());
    }
    Err("only the host can change access".to_string())
}

fn parse_connection_id(hex: &str) -> Result<ConnectionId, String> {
    let hex = hex.trim().trim_start_matches("0x");
    ConnectionId::from_hex(hex).map_err(|error| format!("unknown connection: {error}"))
}

const COLLABORATOR_STALE_AFTER: Duration = Duration::from_secs(20);
const COLLABORATOR_TOUCH_AFTER: Duration = Duration::from_secs(4);

fn collaborator_is_stale(now: spacetimedb::Timestamp, last_seen: spacetimedb::Timestamp) -> bool {
    match now.duration_since(last_seen) {
        Some(age) => age > COLLABORATOR_STALE_AFTER,
        None => false,
    }
}

/// Keeps a connected window from looking stale while it publishes presence.
///
/// Cursor updates arrive many times a second, so this only writes when the
/// stored timestamp is already a few seconds old.
pub fn note_collaborator_seen(ctx: &ReducerContext) {
    let Some(connection_id) = ctx.connection_id() else {
        return;
    };
    let Some(existing) = ctx.db.collaborator().connection_id().find(connection_id) else {
        return;
    };
    if let Some(age) = ctx.timestamp.duration_since(existing.last_seen) {
        if age < COLLABORATOR_TOUCH_AFTER {
            return;
        }
    }
    ctx.db.collaborator().connection_id().update(Collaborator {
        last_seen: ctx.timestamp,
        ..existing
    });
}

fn validate_invite_token(token: &str) -> Result<(), String> {
    if token.len() < 8 || token.len() > 128 {
        return Err("share token must be 8 to 128 characters".to_string());
    }
    if !token
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("share token has unused characters".to_string());
    }
    Ok(())
}

/// Deletes one project and every row stored for it, including shared media bytes.
///
/// Only the host can do this. A guest removing the project from their own
/// browser does not wipe the shared session.
#[spacetimedb::reducer]
pub fn delete_project(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    require_host(ctx, &project_id)?;
    delete_project_rows(ctx, &project_id);
    Ok(())
}

fn delete_project_rows(ctx: &ReducerContext, project_id: &str) {
    let project_id = project_id.to_string();
    let message_ids: Vec<u64> = ctx.db.chat_message().project_id().filter(&project_id).map(|row| row.id).collect();
    for id in message_ids { ctx.db.chat_message().id().delete(id); }

    let chunk_ids: Vec<String> = ctx
        .db
        .asset_chunk()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in chunk_ids {
        ctx.db.asset_chunk().id().delete(id);
    }

    let asset_ids: Vec<String> = ctx
        .db
        .asset()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in asset_ids {
        ctx.db.asset().id().delete(id);
    }

    let effect_ids: Vec<String> = ctx
        .db
        .clip_effect()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in effect_ids {
        ctx.db.clip_effect().id().delete(id);
    }

    let clip_ids: Vec<String> = ctx
        .db
        .clip()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in clip_ids {
        ctx.db.clip().id().delete(id);
    }

    let track_ids: Vec<String> = ctx
        .db
        .track()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in track_ids {
        ctx.db.track().id().delete(id);
    }

    let scene_ids: Vec<String> = ctx
        .db
        .scene()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id.clone())
        .collect();
    for id in scene_ids {
        ctx.db.scene().id().delete(id);
    }

    let presence_ids: Vec<ConnectionId> = ctx
        .db
        .presence()
        .project_id()
        .filter(&project_id)
        .map(|row| row.connection_id)
        .collect();
    for id in presence_ids {
        ctx.db.presence().connection_id().delete(id);
    }

    let collaborator_ids: Vec<ConnectionId> = ctx
        .db
        .collaborator()
        .project_id()
        .filter(&project_id)
        .map(|row| row.connection_id)
        .collect();
    for id in collaborator_ids {
        ctx.db.collaborator().connection_id().delete(id);
    }

    let invite_tokens: Vec<String> = ctx
        .db
        .share_invite()
        .project_id()
        .filter(&project_id)
        .map(|row| row.token.clone())
        .collect();
    for token in invite_tokens {
        ctx.db.share_invite().token().delete(token);
    }

    let member_ids: Vec<u64> = ctx
        .db
        .project_member()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id)
        .collect();
    for id in member_ids {
        ctx.db.project_member().id().delete(id);
    }

    let history_ids: Vec<u64> = ctx
        .db
        .edit_history()
        .project_id()
        .filter(&project_id)
        .map(|row| row.id)
        .collect();
    for id in history_ids {
        ctx.db.edit_history().id().delete(id);
    }

    ctx.db.live_session().project_id().delete(project_id.clone());
    ctx.db.project_metadata().project_id().delete(project_id.clone());
    ctx.db.project().id().delete(project_id);
}

#[spacetimedb::reducer]
pub fn rename_project(
    ctx: &ReducerContext,
    project_id: String,
    name: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let project = find_project(ctx, &project_id)?;

    ctx.db.project().id().update(Project {
        name: name.clone(),
        ..project
    });
    edit.record(
        ctx,
        EditOp::RenameProject,
        &project_id,
        format!("Renamed project to `{name}`"),
        format!("{{\"name\":{name:?}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_project_metadata(
    ctx: &ReducerContext,
    project_id: String,
    metadata: MetadataInput,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = ctx
        .db
        .project_metadata()
        .project_id()
        .find(project_id.clone())
        .ok_or_else(|| format!("project `{project_id}` has no metadata"))?;

    ctx.db.project_metadata().project_id().update(ProjectMetadata {
        canvas_width: metadata.canvas_width,
        canvas_height: metadata.canvas_height,
        fps_numerator: metadata.fps_numerator,
        fps_denominator: metadata.fps_denominator,
        background: metadata.background,
        extra: metadata.extra,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetProjectMetadata,
        &project_id,
        "Updated project settings".to_string(),
        "{}".to_string(),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn add_scene(
    ctx: &ReducerContext,
    project_id: String,
    scene_id: String,
    name: String,
    position: u32,
) -> Result<(), String> {
    Edit::open(ctx, &project_id)?;
    if ctx.db.scene().id().find(scene_id.clone()).is_some() {
        return Err(format!("scene `{scene_id}` already exists"));
    }

    ctx.db.scene().insert(Scene {
        id: scene_id,
        project_id,
        name,
        is_main: false,
        position,
    });
    Ok(())
}

/// Sets the caller's display name.
///
/// Colour is assigned in [`join_project`] so two people cannot pick the same one.
/// The `color` argument is kept so older clients still call this reducer.
#[spacetimedb::reducer]
pub fn set_user_profile(ctx: &ReducerContext, name: String, color: String) -> Result<(), String> {
    let _ = color;
    let existing = ensure_user(ctx);
    let name = sanitize_name(&name);
    if name.is_empty() {
        return Ok(());
    }
    ctx.db.user().identity().update(crate::schema::User {
        name,
        ..existing
    });
    Ok(())
}

/// Marks the caller as an AI agent.
///
/// This only labels the actor for presence and history. Agents call exactly the
/// same reducers as human editors.
#[spacetimedb::reducer]
pub fn declare_agent(ctx: &ReducerContext, name: String) -> Result<(), String> {
    let existing = ensure_user(ctx);
    ctx.db.user().identity().update(crate::schema::User {
        name,
        kind: ActorKind::Agent,
        ..existing
    });
    Ok(())
}

fn actor_is_agent(ctx: &ReducerContext) -> bool {
    ctx.db
        .user()
        .identity()
        .find(ctx.sender())
        .map(|user| user.kind == ActorKind::Agent)
        .unwrap_or(false)
}