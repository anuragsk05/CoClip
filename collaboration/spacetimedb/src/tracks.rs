//! Track reducers.

use spacetimedb::{ReducerContext, Table};

use crate::edit::Edit;
use crate::schema::{EditOp, Track, TrackGroup, TrackKind, clip, clip_effect, track};

#[spacetimedb::reducer]
pub fn add_track(
    ctx: &ReducerContext,
    project_id: String,
    track_id: String,
    scene_id: String,
    group: TrackGroup,
    kind: TrackKind,
    name: String,
    position: u32,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    if ctx.db.track().id().find(track_id.clone()).is_some() {
        return Err(format!("track `{track_id}` already exists"));
    }
    if group == TrackGroup::Main && main_track(ctx, &scene_id).is_some() {
        return Err("scene already has a main track".to_string());
    }

    insert_track(
        ctx,
        &edit,
        track_id.clone(),
        scene_id,
        group,
        kind,
        name.clone(),
        position,
    );
    edit.record(
        ctx,
        EditOp::AddTrack,
        &track_id,
        format!("Added track `{name}`"),
        format!("{{\"position\":{position}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn reorder_track(
    ctx: &ReducerContext,
    project_id: String,
    track_id: String,
    position: u32,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_track(ctx, &project_id, &track_id)?;

    ctx.db.track().id().update(Track {
        position,
        revision: edit.revision,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::ReorderTrack,
        &track_id,
        format!("Moved track to position {position}"),
        format!("{{\"position\":{position}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_track_muted(
    ctx: &ReducerContext,
    project_id: String,
    track_id: String,
    muted: bool,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_track(ctx, &project_id, &track_id)?;
    let name = existing.name.clone();

    ctx.db.track().id().update(Track {
        muted,
        revision: edit.revision,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetTrackMuted,
        &track_id,
        match muted {
            true => format!("Muted track `{name}`"),
            false => format!("Unmuted track `{name}`"),
        },
        format!("{{\"muted\":{muted}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_track_hidden(
    ctx: &ReducerContext,
    project_id: String,
    track_id: String,
    hidden: bool,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_track(ctx, &project_id, &track_id)?;
    let name = existing.name.clone();

    ctx.db.track().id().update(Track {
        hidden,
        revision: edit.revision,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetTrackHidden,
        &track_id,
        match hidden {
            true => format!("Hid track `{name}`"),
            false => format!("Showed track `{name}`"),
        },
        format!("{{\"hidden\":{hidden}}}"),
    );
    Ok(())
}

/// Deletes a track along with its clips and their effects.
///
/// The main track is permanent: the editor requires exactly one for every
/// scene, so removing it would leave the project unloadable.
#[spacetimedb::reducer]
pub fn delete_track(
    ctx: &ReducerContext,
    project_id: String,
    track_id: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_track(ctx, &project_id, &track_id)?;
    if existing.group == TrackGroup::Main {
        return Err("the main track cannot be deleted".to_string());
    }
    let name = existing.name.clone();

    let clip_ids: Vec<String> = ctx
        .db
        .clip()
        .track_id()
        .filter(&track_id)
        .map(|clip| clip.id)
        .collect();
    for clip_id in &clip_ids {
        for effect in ctx.db.clip_effect().clip_id().filter(clip_id).collect::<Vec<_>>() {
            ctx.db.clip_effect().id().delete(effect.id);
        }
        ctx.db.clip().id().delete(clip_id.clone());
    }
    ctx.db.track().id().delete(track_id.clone());

    edit.record(
        ctx,
        EditOp::DeleteTrack,
        &track_id,
        format!("Deleted track `{name}`"),
        format!("{{\"clipCount\":{}}}", clip_ids.len()),
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn insert_track(
    ctx: &ReducerContext,
    edit: &Edit,
    track_id: String,
    scene_id: String,
    group: TrackGroup,
    kind: TrackKind,
    name: String,
    position: u32,
) {
    ctx.db.track().insert(Track {
        id: track_id,
        project_id: edit.project_id.clone(),
        scene_id,
        group,
        kind,
        name,
        position,
        muted: false,
        hidden: false,
        revision: edit.revision,
    });
}

pub fn require_track(
    ctx: &ReducerContext,
    project_id: &str,
    track_id: &str,
) -> Result<Track, String> {
    let track = ctx
        .db
        .track()
        .id()
        .find(track_id.to_string())
        .ok_or_else(|| format!("unknown track `{track_id}`"))?;
    if track.project_id != project_id {
        return Err(format!(
            "track `{track_id}` does not belong to project `{project_id}`"
        ));
    }
    Ok(track)
}

fn main_track(ctx: &ReducerContext, scene_id: &str) -> Option<Track> {
    ctx.db
        .track()
        .scene_id()
        .filter(&scene_id.to_string())
        .find(|track| track.group == TrackGroup::Main)
}
