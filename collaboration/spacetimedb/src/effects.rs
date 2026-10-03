//! Clip effect-chain reducers.

use spacetimedb::{ReducerContext, Table};

use crate::clips::require_clip;
use crate::edit::Edit;
use crate::schema::{ClipEffect, EditOp, clip_effect};

#[spacetimedb::reducer]
pub fn add_effect(
    ctx: &ReducerContext,
    project_id: String,
    clip_id: String,
    effect_id: String,
    effect_type: String,
    params: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    require_clip(ctx, &project_id, &clip_id)?;
    if ctx.db.clip_effect().id().find(effect_id.clone()).is_some() {
        return Err(format!("effect `{effect_id}` already exists"));
    }

    let position = chain(ctx, &clip_id).len() as u32;
    ctx.db.clip_effect().insert(ClipEffect {
        id: effect_id.clone(),
        clip_id: clip_id.clone(),
        project_id: project_id.clone(),
        effect_type: effect_type.clone(),
        position,
        enabled: true,
        params,
        revision: edit.revision,
    });

    edit.record(
        ctx,
        EditOp::AddEffect,
        &effect_id,
        format!("Added `{effect_type}` effect"),
        format!("{{\"clipId\":{clip_id:?},\"position\":{position}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn remove_effect(
    ctx: &ReducerContext,
    project_id: String,
    effect_id: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_effect(ctx, &project_id, &effect_id)?;
    let clip_id = existing.clip_id.clone();
    let effect_type = existing.effect_type.clone();

    ctx.db.clip_effect().id().delete(effect_id.clone());
    renumber(ctx, &edit, &clip_id);

    edit.record(
        ctx,
        EditOp::RemoveEffect,
        &effect_id,
        format!("Removed `{effect_type}` effect"),
        format!("{{\"clipId\":{clip_id:?}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn toggle_effect(
    ctx: &ReducerContext,
    project_id: String,
    effect_id: String,
    enabled: bool,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_effect(ctx, &project_id, &effect_id)?;
    let effect_type = existing.effect_type.clone();

    ctx.db.clip_effect().id().update(ClipEffect {
        enabled,
        revision: edit.revision,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::ToggleEffect,
        &effect_id,
        match enabled {
            true => format!("Enabled `{effect_type}` effect"),
            false => format!("Disabled `{effect_type}` effect"),
        },
        format!("{{\"enabled\":{enabled}}}"),
    );
    Ok(())
}

#[spacetimedb::reducer]
pub fn update_effect_params(
    ctx: &ReducerContext,
    project_id: String,
    effect_id: String,
    params: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_effect(ctx, &project_id, &effect_id)?;
    let effect_type = existing.effect_type.clone();

    ctx.db.clip_effect().id().update(ClipEffect {
        params,
        revision: edit.revision,
        ..existing
    });
    edit.record(
        ctx,
        EditOp::UpdateEffectParams,
        &effect_id,
        format!("Adjusted `{effect_type}` effect"),
        "{}".to_string(),
    );
    Ok(())
}

/// Moves an effect within its clip's chain.
#[spacetimedb::reducer]
pub fn reorder_effect(
    ctx: &ReducerContext,
    project_id: String,
    effect_id: String,
    to_index: u32,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = require_effect(ctx, &project_id, &effect_id)?;
    let clip_id = existing.clip_id.clone();

    let mut ordered = chain(ctx, &clip_id);
    let from = ordered
        .iter()
        .position(|effect| effect.id == effect_id)
        .ok_or_else(|| format!("effect `{effect_id}` is not in its clip's chain"))?;
    let to = (to_index as usize).min(ordered.len().saturating_sub(1));

    let moved = ordered.remove(from);
    ordered.insert(to, moved);
    write_positions(ctx, &edit, ordered);

    edit.record(
        ctx,
        EditOp::ReorderEffect,
        &effect_id,
        format!("Reordered effect to position {to}"),
        format!("{{\"clipId\":{clip_id:?},\"fromIndex\":{from},\"toIndex\":{to}}}"),
    );
    Ok(())
}

fn require_effect(
    ctx: &ReducerContext,
    project_id: &str,
    effect_id: &str,
) -> Result<ClipEffect, String> {
    let effect = ctx
        .db
        .clip_effect()
        .id()
        .find(effect_id.to_string())
        .ok_or_else(|| format!("unknown effect `{effect_id}`"))?;
    if effect.project_id != project_id {
        return Err(format!(
            "effect `{effect_id}` does not belong to project `{project_id}`"
        ));
    }
    Ok(effect)
}

/// A clip's effects in chain order.
fn chain(ctx: &ReducerContext, clip_id: &str) -> Vec<ClipEffect> {
    let mut effects: Vec<ClipEffect> = ctx
        .db
        .clip_effect()
        .clip_id()
        .filter(&clip_id.to_string())
        .collect();
    effects.sort_by_key(|effect| effect.position);
    effects
}

/// Closes the gap left by a removed effect.
fn renumber(ctx: &ReducerContext, edit: &Edit, clip_id: &str) {
    write_positions(ctx, edit, chain(ctx, clip_id));
}

fn write_positions(ctx: &ReducerContext, edit: &Edit, ordered: Vec<ClipEffect>) {
    for (index, effect) in ordered.into_iter().enumerate() {
        let position = index as u32;
        if effect.position == position {
            continue;
        }
        ctx.db.clip_effect().id().update(ClipEffect {
            position,
            revision: edit.revision,
            ..effect
        });
    }
}
