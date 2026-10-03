//! Project lifecycle, membership, and the caller's own profile.

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use crate::edit::{Edit, ensure_user, find_project, grant_membership};
use crate::schema::{
    ActorKind, EditOp, MemberRole, Project, ProjectMetadata, Scene, TrackGroup, TrackKind,
    project, project_metadata, scene, user,
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

/// Joins an existing project as an editor.
///
/// Open by design: anyone holding a project id can collaborate on it. Access
/// control belongs in front of this reducer, not inside it.
#[spacetimedb::reducer]
pub fn join_project(ctx: &ReducerContext, project_id: String) -> Result<(), String> {
    find_project(ctx, &project_id)?;
    ensure_user(ctx);

    let role = match actor_is_agent(ctx) {
        true => MemberRole::Agent,
        false => MemberRole::Editor,
    };
    grant_membership(ctx, &project_id, ctx.sender(), role);
    Ok(())
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

/// Sets the caller's display name and presence colour.
#[spacetimedb::reducer]
pub fn set_user_profile(ctx: &ReducerContext, name: String, color: String) -> Result<(), String> {
    let existing = ensure_user(ctx);
    ctx.db.user().identity().update(crate::schema::User {
        name,
        color,
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