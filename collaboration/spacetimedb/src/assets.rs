//! Asset reference reducers.
//!
//! Media bytes live in local storage, S3, or R2. Only the reference is shared,
//! so every collaborator resolves the same media without it passing through
//! the database.

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use crate::edit::Edit;
use crate::schema::{Asset, AssetStorage, EditOp, asset, clip};

#[derive(SpacetimeType)]
pub struct AssetInput {
    pub id: String,
    pub name: String,
    pub storage: AssetStorage,
    pub location: String,
    pub mime_type: String,
    pub byte_size: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<i64>,
}

/// Registers an asset reference, or updates it if the media was re-uploaded.
#[spacetimedb::reducer]
pub fn register_asset(
    ctx: &ReducerContext,
    project_id: String,
    input: AssetInput,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    if input.id.is_empty() {
        return Err("asset id is required".to_string());
    }

    let name = input.name.clone();
    let next = Asset {
        id: input.id.clone(),
        project_id: project_id.clone(),
        name: input.name,
        storage: input.storage,
        location: input.location,
        mime_type: input.mime_type,
        byte_size: input.byte_size,
        width: input.width,
        height: input.height,
        duration: input.duration,
        created_at: ctx.timestamp,
    };

    match ctx.db.asset().id().find(input.id.clone()) {
        Some(existing) => {
            if existing.project_id != project_id {
                return Err(format!(
                    "asset `{}` belongs to another project",
                    existing.id
                ));
            }
            ctx.db.asset().id().update(Asset {
                created_at: existing.created_at,
                ..next
            });
        }
        None => {
            ctx.db.asset().insert(next);
        }
    }

    edit.record(
        ctx,
        EditOp::RegisterAsset,
        &input.id,
        format!("Registered `{name}`"),
        format!("{{\"storage\":{:?}}}", input.storage),
    );
    Ok(())
}

/// Removes an asset reference once no clip uses it.
#[spacetimedb::reducer]
pub fn remove_asset(
    ctx: &ReducerContext,
    project_id: String,
    asset_id: String,
) -> Result<(), String> {
    let edit = Edit::open(ctx, &project_id)?;
    let existing = ctx
        .db
        .asset()
        .id()
        .find(asset_id.clone())
        .ok_or_else(|| format!("unknown asset `{asset_id}`"))?;
    if existing.project_id != project_id {
        return Err(format!("asset `{asset_id}` belongs to another project"));
    }

    let in_use = ctx
        .db
        .clip()
        .project_id()
        .filter(&project_id)
        .any(|clip| clip.media_id.as_deref() == Some(asset_id.as_str()));
    if in_use {
        return Err(format!("asset `{asset_id}` is still used by a clip"));
    }

    let name = existing.name.clone();
    ctx.db.asset().id().delete(asset_id.clone());

    edit.record(
        ctx,
        EditOp::RemoveAsset,
        &asset_id,
        format!("Removed `{name}`"),
        "{}".to_string(),
    );
    Ok(())
}