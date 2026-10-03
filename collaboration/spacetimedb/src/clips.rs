//! Clip reducers.
//!
//! Timeline geometry is resolved by the shared `timeline` crate rather than
//! being re-derived here, so a split performed by a reducer lands on exactly
//! the same ticks as a split performed locally by the editor.

use spacetimedb::{ReducerContext, SpacetimeType, Table};
use time::MediaTime;
use timeline::{ClipSpan, RetainSide, Retime};

use crate::edit::Edit;
use crate::schema::{
    Clip, ClipEffect, ClipKind, EditOp, SplitSide, TrackKind, clip, clip_effect,
};
use crate::tracks::require_track;

#[derive(SpacetimeType)]
pub struct ClipInput {
    pub id: String,
    pub track_id: String,
    pub kind: ClipKind,
    pub name: String,
    pub start_time: i64,
    pub duration: i64,
    pub trim_start: i64,
    pub trim_end: i64,
    pub source_duration: Option<i64>,
    pub media_id: Option<String>,
    pub rate: f64,
    pub volume_db: f32,
    pub muted: bool,
    pub hidden: bool,
    pub data: String,
}

#[spacetimedb::reducer]
pub fn add_clip(ctx: &ReducerContext, project_id: String, input: ClipInput) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    if ctx.db.clip().id().find(input.id.clone()).is_some() {
        return Err(format!("clip `{}` already exists", input.id));
    }
    let track = require_track(ctx, &project_id, &input.track_id)?;
    require_compatible(input.kind, track.kind)?;

    if input.duration <= 0 {
        return Err("clip duration must be positive".to_string());
    }
    if input.start_time < 0 {
        return Err("clip cannot start before zero".to_string());
    }

    let clip_id = input.id.clone();
    let name = input.name.clone();
    ctx.db.clip().insert(Clip {
        id: input.id,
        project_id: project_id.clone(),
        track_id: input.track_id,
        kind: input.kind,
        name: input.name,
        start_time: input.start_time,
        duration: input.duration,
        trim_start: input.trim_start,
        trim_end: input.trim_end,
        source_duration: input.source_duration,
        media_id: input.media_id,
        rate: input.rate,
        volume_db: input.volume_db,
        muted: input.muted,
        hidden: input.hidden,
        data: input.data,
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
    });

    edit.record(
        ctx,
        EditOp::AddClip,
        &clip_id,
        format!("Added `{name}`"),
        format!(
            "{{\"startTime\":{},\"duration\":{}}}",
            input.start_time, input.duration
        ),
    );
    Ok(())
}

/// Moves a clip to a new start time, optionally onto a different track.
#[spacetimedb::reducer]
pub fn move_clip(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    target_track_id: String,
    start_time: i64,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;
    let target = require_track(ctx, &project_id, &target_track_id)?;
    require_compatible(existing.kind, target.kind)?;

    let moved = span_of(&existing)
        .moved_to(MediaTime::from_ticks(start_time))
        .map_err(|error| error.to_string())?;
    let name = existing.name.clone();

    ctx.db.clip().id().update(Clip {
        track_id: target_track_id.clone(),
        ..with_span(existing, moved, &edit, ctx)
    });
    edit.record(
        ctx,
        EditOp::MoveClip,
        &clip_id,
        format!("Moved `{name}`"),
        format!(
            "{{\"targetTrackId\":{target_track_id:?},\"startTime\":{}}}",
            moved.start_time.as_ticks()
        ),
    );
    Ok(())
}

/// Retargets a clip's source window.
///
/// `start_time` and `duration` are optional because trimming the head moves
/// both while trimming the tail moves neither.
#[spacetimedb::reducer]
pub fn trim_clip(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    trim_start: i64,
    trim_end: i64,
    start_time: Option<i64>,
    duration: Option<i64>,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;

    let trimmed = span_of(&existing)
        .trimmed(
            MediaTime::from_ticks(trim_start),
            MediaTime::from_ticks(trim_end),
            start_time.map(MediaTime::from_ticks),
            duration.map(MediaTime::from_ticks),
            existing.source_duration.map(MediaTime::from_ticks),
            Retime::new(existing.rate),
        )
        .map_err(|error| error.to_string())?;
    let name = existing.name.clone();

    ctx.db
        .clip()
        .id()
        .update(with_span(existing, trimmed, &edit, ctx));
    edit.record(
        ctx,
        EditOp::TrimClip,
        &clip_id,
        format!("Trimmed `{name}`"),
        format!("{{\"trimStart\":{trim_start},\"trimEnd\":{trim_end}}}"),
    );
    Ok(())
}

/// Splits a clip at an absolute timeline time.
///
/// `right_clip_id` names the half that becomes a new row. It is required unless
/// only the left half is kept, because the editor chooses clip ids and the two
/// sides must agree on them.
#[spacetimedb::reducer]
pub fn split_clip(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    split_time: i64,
    retain: SplitSide,
    right_clip_id: Option<String>,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;

    let retain_side = match retain {
        SplitSide::Both => RetainSide::Both,
        SplitSide::Left => RetainSide::Left,
        SplitSide::Right => RetainSide::Right,
    };
    let split = span_of(&existing)
        .split_at(
            MediaTime::from_ticks(split_time),
            retain_side,
            Retime::new(existing.rate),
        )
        .map_err(|error| error.to_string())?;

    let right_id = match retain {
        SplitSide::Left => None,
        _ => Some(
            right_clip_id
                .filter(|id| !id.is_empty())
                .ok_or_else(|| "right_clip_id is required for this split".to_string())?,
        ),
    };
    if let Some(right_id) = &right_id {
        if ctx.db.clip().id().find(right_id.clone()).is_some() {
            return Err(format!("clip `{right_id}` already exists"));
        }
    }

    let base_name = existing.name.clone();

    if let Some(right_span) = split.right {
        let right_id = right_id
            .clone()
            .ok_or_else(|| "right_clip_id is required for this split".to_string())?;
        let right = Clip {
            id: right_id.clone(),
            name: format!("{base_name} (right)"),
            ..with_span(clone_clip(&existing), right_span, &edit, ctx)
        };
        ctx.db.clip().insert(right);
        copy_effects(ctx, &edit, &clip_id, &right_id);
    }

    match split.left {
        Some(left_span) => {
            ctx.db.clip().id().update(Clip {
                name: format!("{base_name} (left)"),
                ..with_span(existing, left_span, &edit, ctx)
            });
        }
        None => {
            // Only the right half survives, and it was inserted under a new id.
            delete_effects(ctx, &clip_id);
            ctx.db.clip().id().delete(clip_id.clone());
        }
    }

    edit.record(
        ctx,
        EditOp::SplitClip,
        &clip_id,
        format!("Split `{base_name}`"),
        format!(
            "{{\"splitTime\":{split_time},\"rightClipId\":{:?}}}",
            right_id.unwrap_or_default()
        ),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn delete_clip(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;
    let name = existing.name.clone();

    delete_effects(ctx, &clip_id);
    ctx.db.clip().id().delete(clip_id.clone());

    edit.record(
        ctx,
        EditOp::DeleteClip,
        &clip_id,
        format!("Deleted `{name}`"),
        "{}".to_string(),
    );
    Ok(())
}

/// Sets a clip's gain in decibels.
#[spacetimedb::reducer]
pub fn set_volume(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    volume_db: f32,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;
    if !volume_db.is_finite() {
        return Err("volume must be a finite number of decibels".to_string());
    }
    let name = existing.name.clone();

    ctx.db.clip().id().update(Clip {
        volume_db,
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetVolume,
        &clip_id,
        format!("Set `{name}` volume to {volume_db:.1} dB"),
        format!("{{\"volumeDb\":{volume_db}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_clip_muted(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    muted: bool,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;
    let name = existing.name.clone();

    ctx.db.clip().id().update(Clip {
        muted,
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetClipMuted,
        &clip_id,
        match muted {
            true => format!("Muted `{name}`"),
            false => format!("Unmuted `{name}`"),
        },
        format!("{{\"muted\":{muted}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn set_clip_hidden(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    hidden: bool,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;
    let name = existing.name.clone();

    ctx.db.clip().id().update(Clip {
        hidden,
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::SetClipHidden,
        &clip_id,
        match hidden {
            true => format!("Hid `{name}`"),
            false => format!("Showed `{name}`"),
        },
        format!("{{\"hidden\":{hidden}}}"),
    );
    Ok(())
}

/// Replaces the editor-owned portion of a clip: name, params, animations, masks.
///
/// Geometry is deliberately excluded. Position and trim only change through
/// `move_clip`, `trim_clip`, and `split_clip`, which validate them.
#[spacetimedb::reducer]
pub fn update_clip_data(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    name: String,
    rate: f64,
    data: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_clip(ctx, &project_id, &clip_id)?;

    ctx.db.clip().id().update(Clip {
        name: name.clone(),
        rate: Retime::new(rate).rate(),
        data,
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::UpdateClipData,
        &clip_id,
        format!("Updated `{name}`"),
        "{}".to_string(),
    );
    Ok(())
}

pub fn require_clip(
    ctx: &ReducerContext,
    project_id: &str,
    clip_id: &str,
) -> Result<Clip, String> {
    let clip = ctx
        .db
        .clip()
        .id()
        .find(clip_id.to_string())
        .ok_or_else(|| format!("unknown clip `{clip_id}`"))?;
    if clip.project_id != project_id {
        return Err(format!(
            "clip `{clip_id}` does not belong to project `{project_id}`"
        ));
    }
    Ok(clip)
}

fn span_of(clip: &Clip) -> ClipSpan {
    ClipSpan::new(
        MediaTime::from_ticks(clip.start_time),
        MediaTime::from_ticks(clip.duration),
        MediaTime::from_ticks(clip.trim_start),
        MediaTime::from_ticks(clip.trim_end),
    )
}

fn with_span(clip: Clip, span: ClipSpan, edit: &Edit, ctx: &ReducerContext) -> Clip {
    Clip {
        start_time: span.start_time.as_ticks(),
        duration: span.duration.as_ticks(),
        trim_start: span.trim_start.as_ticks(),
        trim_end: span.trim_end.as_ticks(),
        revision: edit.revision,
        updated_at: ctx.timestamp,
        updated_by: edit.actor,
        origin: edit.origin,
        ..clip
    }
}

fn clone_clip(clip: &Clip) -> Clip {
    Clip {
        id: clip.id.clone(),
        project_id: clip.project_id.clone(),
        track_id: clip.track_id.clone(),
        kind: clip.kind,
        name: clip.name.clone(),
        start_time: clip.start_time,
        duration: clip.duration,
        trim_start: clip.trim_start,
        trim_end: clip.trim_end,
        source_duration: clip.source_duration,
        media_id: clip.media_id.clone(),
        rate: clip.rate,
        volume_db: clip.volume_db,
        muted: clip.muted,
        hidden: clip.hidden,
        data: clip.data.clone(),
        revision: clip.revision,
        updated_at: clip.updated_at,
        updated_by: clip.updated_by,
        origin: clip.origin,
    }
}

/// Copies a clip's effect chain onto another clip.
///
/// Effect ids are primary keys here, so the copies are keyed by the target clip
/// and their position in the chain. That is stable across replays.
fn copy_effects(ctx: &ReducerContext, edit: &Edit, from_clip_id: &str, to_clip_id: &str) {
    let effects: Vec<ClipEffect> = ctx
        .db
        .clip_effect()
        .clip_id()
        .filter(&from_clip_id.to_string())
        .collect();

    for effect in effects {
        ctx.db.clip_effect().insert(ClipEffect {
            id: format!("{to_clip_id}:{}", effect.position),
            clip_id: to_clip_id.to_string(),
            project_id: effect.project_id,
            effect_type: effect.effect_type,
            position: effect.position,
            enabled: effect.enabled,
            params: effect.params,
            revision: edit.revision,
        });
    }
}

fn delete_effects(ctx: &ReducerContext, clip_id: &str) {
    let effect_ids: Vec<String> = ctx
        .db
        .clip_effect()
        .clip_id()
        .filter(&clip_id.to_string())
        .map(|effect| effect.id)
        .collect();
    for effect_id in effect_ids {
        ctx.db.clip_effect().id().delete(effect_id);
    }
}

/// Mirrors the editor's own track/element compatibility rules.
fn require_compatible(clip: ClipKind, track: TrackKind) -> Result<(), String> {
    let compatible = match track {
        TrackKind::Video => matches!(clip, ClipKind::Video | ClipKind::Image),
        TrackKind::Text => clip == ClipKind::Text,
        TrackKind::Audio => clip == ClipKind::Audio,
        TrackKind::Graphic => matches!(clip, ClipKind::Sticker | ClipKind::Graphic),
        TrackKind::Effect => clip == ClipKind::Effect,
    };
    match compatible {
        true => Ok(()),
        false => Err(format!("{clip:?} clips cannot sit on a {track:?} track")),
    }
}
