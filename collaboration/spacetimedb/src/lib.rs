//! Canonical shared state for collaborative editing.
//!
//! The editor keeps its timeline UI, preview, and playback. This module owns
//! the project itself: tracks, clips, effects, asset references, presence, and
//! edit history. Human editors and AI agents reach it through one reducer
//! surface — there is no privileged agent API.

mod assets;
mod chat;
mod clips;
mod edit;
mod effects;
mod presence;
mod projects;
mod schema;
mod tracks;

use spacetimedb::{ReducerContext, Table};

// The generated table accessor traits share their names with this module's
// submodules, so they are aliased here and used only for their methods.
use schema::{User, collaborator, presence as presence_table, user};

#[spacetimedb::reducer(init)]
pub fn init(_ctx: &ReducerContext) {
    log::info!("opencut collaboration module published");
}

#[spacetimedb::reducer(client_connected)]
pub fn client_connected(ctx: &ReducerContext) {
    if let Some(existing) = ctx.db.user().identity().find(ctx.sender()) {
        ctx.db.user().identity().update(User {
            online: true,
            last_seen: ctx.timestamp,
            ..existing
        });
    }
}

#[spacetimedb::reducer(client_disconnected)]
pub fn client_disconnected(ctx: &ReducerContext) {
    if let Some(connection_id) = ctx.connection_id() {
        ctx.db.presence().connection_id().delete(connection_id);
        ctx.db.collaborator().connection_id().delete(connection_id);
    }

    // A user may have several editors open, so they only go offline once the
    // last of them is gone.
    let still_connected = ctx
        .db
        .presence()
        .iter()
        .any(|row| row.identity == ctx.sender());
    if still_connected {
        return;
    }

    if let Some(existing) = ctx.db.user().identity().find(ctx.sender()) {
        ctx.db.user().identity().update(User {
            online: false,
            last_seen: ctx.timestamp,
            ..existing
        });
    }
}
