//! Presence reducers.
//!
//! Presence is ephemeral: it does not advance the project revision and is not
//! written to the edit history. A playhead scrub is not an edit, and letting it
//! bump the revision would drown the durable history in cursor traffic.

use spacetimedb::{ConnectionId, ReducerContext, Table};

use crate::edit::{ensure_user, membership};
use crate::schema::{Presence, presence};

#[spacetimedb::reducer]
pub fn update_presence(
    ctx: &ReducerContext,
    project_id: String,
    scene_id: String,
    playhead: i64,
    selection: Vec<String>,
    is_playing: bool,
    cursor_x: f32,
    cursor_y: f32,
) -> Result<(), String> {
    let connection_id = require_connection(ctx)?;
    require_member(ctx, &project_id)?;
    ensure_user(ctx);

    write(
        ctx,
        Presence {
            connection_id,
            project_id,
            identity: ctx.sender(),
            scene_id,
            playhead,
            selection,
            is_playing,
            cursor_x,
            cursor_y,
            updated_at: ctx.timestamp,
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_playhead(
    ctx: &ReducerContext,
    project_id: String,
    playhead: i64,
    is_playing: bool,
) -> Result<(), String> {
    let connection_id = require_connection(ctx)?;
    require_member(ctx, &project_id)?;

    let existing = current(ctx, connection_id, &project_id, &ctx.sender());
    write(
        ctx,
        Presence {
            playhead,
            is_playing,
            updated_at: ctx.timestamp,
            ..existing
        },
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_selection(
    ctx: &ReducerContext,
    project_id: String,
    selection: Vec<String>,
) -> Result<(), String> {
    let connection_id = require_connection(ctx)?;
    require_member(ctx, &project_id)?;

    let existing = current(ctx, connection_id, &project_id, &ctx.sender());
    write(
        ctx,
        Presence {
            selection,
            updated_at: ctx.timestamp,
            ..existing
        },
    );
    Ok(())
}

/// Drops the caller's presence, for a client leaving a project without
/// disconnecting.
#[spacetimedb::reducer]
pub fn clear_presence(ctx: &ReducerContext) -> Result<(), String> {
    let connection_id = require_connection(ctx)?;
    ctx.db.presence().connection_id().delete(connection_id);
    Ok(())
}

pub fn write(ctx: &ReducerContext, row: Presence) {
    match ctx
        .db
        .presence()
        .connection_id()
        .find(row.connection_id)
        .is_some()
    {
        true => {
            ctx.db.presence().connection_id().update(row);
        }
        false => {
            ctx.db.presence().insert(row);
        }
    }
}

fn current(
    ctx: &ReducerContext,
    connection_id: ConnectionId,
    project_id: &str,
    identity: &spacetimedb::Identity,
) -> Presence {
    ctx.db
        .presence()
        .connection_id()
        .find(connection_id)
        .unwrap_or(Presence {
            connection_id,
            project_id: project_id.to_string(),
            identity: *identity,
            scene_id: String::new(),
            playhead: 0,
            selection: Vec::new(),
            is_playing: false,
            cursor_x: 0.0,
            cursor_y: 0.0,
            updated_at: ctx.timestamp,
        })
}

fn require_connection(ctx: &ReducerContext) -> Result<ConnectionId, String> {
    ctx.connection_id()
        .ok_or_else(|| "presence requires a client connection".to_string())
}

fn require_member(ctx: &ReducerContext, project_id: &str) -> Result<(), String> {
    match membership(ctx, project_id, &ctx.sender()).is_some() {
        true => Ok(()),
        false => Err(format!("not a member of project `{project_id}`")),
    }
}
