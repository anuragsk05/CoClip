//! Shared project state.
//!
//! Timeline positions are stored as raw `MediaTime` tick counts (`i64`) so the
//! wire format stays a plain integer on both sides. Reducers lift them into
//! `MediaTime` before doing any arithmetic.
//!
//! Fields that only the editor interprets — element params, animations, masks,
//! effect parameter values — are carried as JSON in `data` / `params`. The
//! columns that reducers reason about are typed.

use spacetimedb::{ConnectionId, Identity, SpacetimeType, Timestamp};

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrackGroup {
    /// Layers composited above the main track, ordered front to back.
    Overlay,
    /// The single always-present primary video track.
    Main,
    Audio,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum TrackKind {
    Video,
    Text,
    Audio,
    Graphic,
    Effect,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ClipKind {
    Video,
    Image,
    Text,
    Audio,
    Sticker,
    Graphic,
    Effect,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssetStorage {
    Local,
    S3,
    R2,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActorKind {
    Human,
    Agent,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum MemberRole {
    Owner,
    Editor,
    Agent,
}

#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum SplitSide {
    Both,
    Left,
    Right,
}

/// The editing operation an [`EditHistory`] row records.
#[derive(SpacetimeType, Clone, Copy, Debug, PartialEq, Eq)]
pub enum EditOp {
    CreateProject,
    RenameProject,
    SetProjectMetadata,
    AddTrack,
    ReorderTrack,
    SetTrackMuted,
    SetTrackHidden,
    DeleteTrack,
    AddClip,
    MoveClip,
    TrimClip,
    SplitClip,
    DeleteClip,
    SetVolume,
    SetClipMuted,
    SetClipHidden,
    UpdateClipData,
    AddEffect,
    RemoveEffect,
    ToggleEffect,
    UpdateEffectParams,
    ReorderEffect,
    RegisterAsset,
    RemoveAsset,
}

#[spacetimedb::table(accessor = user, public)]
pub struct User {
    #[primary_key]
    pub identity: Identity,
    pub name: String,
    /// Presence colour, as a CSS hex string.
    pub color: String,
    pub kind: ActorKind,
    pub online: bool,
    pub last_seen: Timestamp,
}

#[spacetimedb::table(accessor = project, public)]
pub struct Project {
    #[primary_key]
    pub id: String,
    pub name: String,
    pub owner: Identity,
    /// Monotonic logical clock, bumped once per mutating reducer.
    ///
    /// Auto-increment keys are not usable for ordering, so every edit stamps
    /// the row it touches with this instead. It gives clients a total order
    /// over a project's edits and a cheap way to discard stale writes.
    pub revision: u64,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = project_metadata, public)]
pub struct ProjectMetadata {
    #[primary_key]
    pub project_id: String,
    pub canvas_width: u32,
    pub canvas_height: u32,
    pub fps_numerator: u32,
    pub fps_denominator: u32,
    pub background: String,
    /// Editor-only settings, as JSON.
    pub extra: String,
}

#[spacetimedb::table(accessor = project_member, public,
    index(accessor = by_project_identity, btree(columns = [project_id, identity])))]
pub struct ProjectMember {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub project_id: String,
    pub identity: Identity,
    pub role: MemberRole,
    pub joined_at: Timestamp,
}

#[spacetimedb::table(accessor = scene, public)]
pub struct Scene {
    #[primary_key]
    pub id: String,
    #[index(btree)]
    pub project_id: String,
    pub name: String,
    pub is_main: bool,
    pub position: u32,
}

#[spacetimedb::table(accessor = track, public)]
pub struct Track {
    #[primary_key]
    pub id: String,
    #[index(btree)]
    pub project_id: String,
    #[index(btree)]
    pub scene_id: String,
    pub group: TrackGroup,
    pub kind: TrackKind,
    pub name: String,
    /// Order within the track's group.
    pub position: u32,
    pub muted: bool,
    pub hidden: bool,
    pub revision: u64,
}

/// A clip on a track.
///
/// `id` is the editor's own element id and is the primary key, so clip ids must
/// be unique across every project in the database. The editor generates UUIDs,
/// which satisfies that; ids derived from a position or an index would not.
#[spacetimedb::table(accessor = clip, public)]
pub struct Clip {
    #[primary_key]
    pub id: String,
    #[index(btree)]
    pub project_id: String,
    #[index(btree)]
    pub track_id: String,
    pub kind: ClipKind,
    pub name: String,
    /// Position on the timeline, in `MediaTime` ticks.
    pub start_time: i64,
    /// Visible length on the timeline, in `MediaTime` ticks.
    pub duration: i64,
    /// Source ticks hidden at the head of the media.
    pub trim_start: i64,
    /// Source ticks hidden at the tail of the media.
    pub trim_end: i64,
    pub source_duration: Option<i64>,
    /// Reference into [`Asset`]; `None` for generated clips such as text.
    pub media_id: Option<String>,
    /// Playback rate: source ticks consumed per timeline tick.
    pub rate: f64,
    pub volume_db: f32,
    pub muted: bool,
    pub hidden: bool,
    /// Editor-only element fields, as JSON.
    pub data: String,
    pub revision: u64,
    pub updated_at: Timestamp,
    pub updated_by: Identity,
    /// Connection that caused the change.
    ///
    /// Clients compare this against their own connection to drop the echo of
    /// their own edit. Identity is not enough: one user may have several
    /// editors open, and each needs to see the others' changes.
    pub origin: Option<ConnectionId>,
}

#[spacetimedb::table(accessor = clip_effect, public)]
pub struct ClipEffect {
    #[primary_key]
    pub id: String,
    #[index(btree)]
    pub clip_id: String,
    #[index(btree)]
    pub project_id: String,
    pub effect_type: String,
    /// Order in the clip's effect chain.
    pub position: u32,
    pub enabled: bool,
    /// Effect parameter values, as JSON.
    pub params: String,
    pub revision: u64,
}

/// A reference to media held elsewhere.
///
/// The bytes stay in local storage, S3, or R2. Only the reference is shared.
#[spacetimedb::table(accessor = asset, public)]
pub struct Asset {
    #[primary_key]
    pub id: String,
    #[index(btree)]
    pub project_id: String,
    pub name: String,
    pub storage: AssetStorage,
    /// Object key for remote storage, or an opaque handle for local media.
    pub location: String,
    pub mime_type: String,
    pub byte_size: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub duration: Option<i64>,
    pub created_at: Timestamp,
}

/// Ephemeral per-connection state: playhead, selection, cursor.
///
/// Keyed by connection rather than identity so that two editors belonging to
/// the same user appear as two collaborators.
#[spacetimedb::table(accessor = presence, public)]
pub struct Presence {
    #[primary_key]
    pub connection_id: ConnectionId,
    #[index(btree)]
    pub project_id: String,
    pub identity: Identity,
    pub scene_id: String,
    pub playhead: i64,
    pub selection: Vec<String>,
    pub is_playing: bool,
    pub cursor_x: f32,
    pub cursor_y: f32,
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = edit_history, public)]
pub struct EditHistory {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub project_id: String,
    /// The project revision this edit produced. Use this to order history.
    pub revision: u64,
    pub op: EditOp,
    pub target_id: String,
    pub actor: Identity,
    pub actor_kind: ActorKind,
    pub origin: Option<ConnectionId>,
    pub summary: String,
    /// Operation arguments, as JSON.
    pub payload: String,
    pub at: Timestamp,
}
