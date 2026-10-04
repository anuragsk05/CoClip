//! Asset reducers.
//!
//! Video and audio bytes are stored in [`AssetChunk`] rows so every editor in
//! the session can play the same file. Images can still be a local, S3, or R2
//! reference.

use spacetimedb::{ReducerContext, SpacetimeType, Table};

use crate::edit::{require_can_write, Edit};
use crate::schema::{Asset, AssetChunk, AssetStorage, EditOp, asset, asset_chunk, clip};

/// Largest slice accepted by [`put_asset_chunk`].
pub const MAX_CHUNK_BYTES: usize = 256 * 1024;
/// A single shared file cannot grow past this, counting every chunk.
const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;

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
    delete_asset_chunks(ctx, &asset_id);
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

/// Writes one slice of a shared video or audio file.
///
/// The asset row must already say the bytes live in Spacetime. Rewriting a
/// chunk does not bump the project revision: playback bytes are not an edit.
#[spacetimedb::reducer]
pub fn put_asset_chunk(
    ctx: &ReducerContext,
    project_id: String,
    asset_id: String,
    chunk_index: u32,
    chunk_count: u32,
    bytes: Vec<u8>,
) -> Result<(), String> {
    require_can_write(ctx, &project_id)?;
    let asset = ctx
        .db
        .asset()
        .id()
        .find(asset_id.clone())
        .ok_or_else(|| format!("unknown asset `{asset_id}`"))?;
    if asset.project_id != project_id {
        return Err(format!("asset `{asset_id}` belongs to another project"));
    }
    if asset.storage != AssetStorage::Spacetime {
        return Err("this asset is not stored in the session".to_string());
    }
    if chunk_count == 0 {
        return Err("a shared file needs at least one chunk".to_string());
    }
    let max_chunks = MAX_ASSET_BYTES.div_ceil(MAX_CHUNK_BYTES as u64);
    if u64::from(chunk_count) > max_chunks {
        return Err("that file is larger than 512 MB".to_string());
    }
    if chunk_index >= chunk_count {
        return Err("chunk index is past the end of the file".to_string());
    }
    if bytes.len() > MAX_CHUNK_BYTES {
        return Err("a media chunk is larger than 256 KB".to_string());
    }
    if bytes.is_empty() && chunk_count != 1 {
        return Err("only an empty file can have an empty chunk".to_string());
    }

    let id = format!("{asset_id}:{chunk_index}");
    delete_stale_chunks(ctx, &project_id, &asset_id, chunk_count, &id);

    let row = AssetChunk {
        id: id.clone(),
        project_id,
        asset_id,
        chunk_index,
        chunk_count,
        bytes,
    };
    match ctx.db.asset_chunk().id().find(id) {
        Some(existing) if existing.bytes == row.bytes && existing.chunk_count == row.chunk_count => {
            Ok(())
        }
        Some(_) => {
            ctx.db.asset_chunk().id().update(row);
            Ok(())
        }
        None => {
            ctx.db.asset_chunk().insert(row);
            Ok(())
        }
    }
}

fn delete_asset_chunks(ctx: &ReducerContext, asset_id: &str) {
    let ids: Vec<String> = ctx
        .db
        .asset_chunk()
        .asset_id()
        .filter(&asset_id.to_string())
        .map(|row| row.id.clone())
        .collect();
    for id in ids {
        ctx.db.asset_chunk().id().delete(id);
    }
}

fn delete_stale_chunks(
    ctx: &ReducerContext,
    project_id: &str,
    asset_id: &str,
    chunk_count: u32,
    keep_id: &str,
) {
    let ids: Vec<String> = ctx
        .db
        .asset_chunk()
        .asset_id()
        .filter(&asset_id.to_string())
        .filter(|row| {
            row.id != keep_id
                && row.project_id == project_id
                && (row.chunk_index >= chunk_count || row.chunk_count != chunk_count)
        })
        .map(|row| row.id.clone())
        .collect();
    for id in ids {
        ctx.db.asset_chunk().id().delete(id);
    }
}