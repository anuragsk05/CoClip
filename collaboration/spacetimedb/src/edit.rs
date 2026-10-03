//! The common preamble and postscript of every mutating reducer.
//!
//! [`Edit::open`] authorises the caller and advances the project revision.
//! [`Edit::record`] appends to the edit history. Reducers are transactional, so
//! a reducer that opens an edit and then returns `Err` rolls the revision bump
//! back with everything else.

use spacetimedb::{ConnectionId, Identity, ReducerContext, Table};

use crate::schema::{
    ActorKind, EditHistory, EditOp, MemberRole, Project, ProjectMember, User, edit_history,
    project, project_member, user,
};

pub struct Edit {
    pub project_id: String,
    pub actor: Identity,
    pub actor_kind: ActorKind,
    pub origin: Option<ConnectionId>,
    /// The revision this edit produces. Stamp it onto every row written.
    pub revision: u64,
}

impl Edit {
    pub fn open(ctx: &ReducerContext, project_id: &str) -> Result<Self, String> {
        let project = require_membership(ctx, project_id)?;
        let revision = project.revision + 1;

        ctx.db.project().id().update(Project {
            revision,
            updated_at: ctx.timestamp,
            ..project
        });

        Ok(Self {
            project_id: project_id.to_string(),
            actor: ctx.sender(),
            actor_kind: actor_kind(ctx),
            origin: ctx.connection_id(),
            revision,
        })
    }

    pub fn record(
        &self,
        ctx: &ReducerContext,
        op: EditOp,
        target_id: &str,
        summary: String,
        payload: String,
    ) {
        ctx.db.edit_history().insert(EditHistory {
            id: 0,
            project_id: self.project_id.clone(),
            revision: self.revision,
            op,
            target_id: target_id.to_string(),
            actor: self.actor,
            actor_kind: self.actor_kind,
            origin: self.origin,
            summary,
            payload,
            at: ctx.timestamp,
        });
    }
}

pub fn find_project(ctx: &ReducerContext, project_id: &str) -> Result<Project, String> {
    ctx.db
        .project()
        .id()
        .find(project_id.to_string())
        .ok_or_else(|| format!("unknown project `{project_id}`"))
}

pub fn membership(
    ctx: &ReducerContext,
    project_id: &str,
    identity: &Identity,
) -> Option<ProjectMember> {
    ctx.db
        .project_member()
        .by_project_identity()
        .filter((&project_id.to_string(), identity))
        .next()
}

fn require_membership(ctx: &ReducerContext, project_id: &str) -> Result<Project, String> {
    let project = find_project(ctx, project_id)?;
    if membership(ctx, project_id, &ctx.sender()).is_none() {
        return Err(format!("not a member of project `{project_id}`"));
    }
    Ok(project)
}

pub fn actor_kind(ctx: &ReducerContext) -> ActorKind {
    ctx.db
        .user()
        .identity()
        .find(ctx.sender())
        .map(|user| user.kind)
        .unwrap_or(ActorKind::Human)
}

/// Grants `identity` a role on a project, leaving an existing role untouched.
pub fn grant_membership(
    ctx: &ReducerContext,
    project_id: &str,
    identity: Identity,
    role: MemberRole,
) {
    if membership(ctx, project_id, &identity).is_some() {
        return;
    }
    ctx.db.project_member().insert(ProjectMember {
        id: 0,
        project_id: project_id.to_string(),
        identity,
        role,
        joined_at: ctx.timestamp,
    });
}

/// Creates the caller's user row on first contact.
pub fn ensure_user(ctx: &ReducerContext) -> User {
    if let Some(existing) = ctx.db.user().identity().find(ctx.sender()) {
        return existing;
    }
    ctx.db.user().insert(User {
        identity: ctx.sender(),
        name: default_name(&ctx.sender()),
        color: default_color(&ctx.sender()),
        kind: ActorKind::Human,
        online: true,
        last_seen: ctx.timestamp,
    })
}

/// A stable, readable stand-in until the client supplies a real name.
fn default_name(identity: &Identity) -> String {
    let hex = identity.to_hex();
    let suffix: String = hex.chars().rev().take(4).collect();
    format!("Editor {suffix}")
}

/// Derives a presence colour from the identity so a collaborator keeps the same
/// colour across sessions without the server storing a palette cursor.
fn default_color(identity: &Identity) -> String {
    const PALETTE: [&str; 8] = [
        "#f97316", "#ec4899", "#8b5cf6", "#3b82f6", "#06b6d4", "#10b981", "#eab308", "#ef4444",
    ];
    let hex = identity.to_hex();
    let seed = hex
        .bytes()
        .fold(0u32, |acc, byte| acc.wrapping_mul(31).wrapping_add(byte as u32));
    PALETTE[(seed as usize) % PALETTE.len()].to_string()
}
