/**
 * The adapter's own vocabulary.
 *
 * These types deliberately do not come from any editor. The adapter sits
 * between an editor and SpacetimeDB, so it must not depend on either side's
 * internal shapes: the editor's framework is a replaceable detail, and the
 * generated bindings change whenever the module's schema does.
 *
 * Times are `MediaTime` tick counts as plain numbers. The wire format uses
 * `bigint` for 64-bit integers; conversion happens at the boundary.
 */

/**
 * Ticks per second. Mirrors `TICKS_PER_SECOND` in
 * `rust/crates/time/src/media_time.rs`, which is what the reducers validate
 * against.
 *
 * The adapter cannot import the editor's wasm build, so the value is restated
 * here; it is part of the wire format and changing it would be a schema change.
 */
export const TICKS_PER_SECOND = 120_000;

/** Converts seconds to the tick counts every time field on the wire uses. */
export function ticksFromSeconds(seconds: number): number {
	return Math.round(seconds * TICKS_PER_SECOND);
}

export function secondsFromTicks(ticks: number): number {
	return ticks / TICKS_PER_SECOND;
}

export type TrackGroup = "overlay" | "main" | "audio";
export type TrackKind = "video" | "text" | "audio" | "graphic" | "effect";
export type ClipKind =
	| "video"
	| "image"
	| "text"
	| "audio"
	| "sticker"
	| "graphic"
	| "effect";
export type AssetStorage = "local" | "s3" | "r2" | "spacetime";
export type RetainSide = "both" | "left" | "right";
export type ActorKind = "human" | "agent";
export type MemberRole = "owner" | "editor" | "agent" | "viewer";

export interface CollabTrack {
	id: string;
	sceneId: string;
	group: TrackGroup;
	kind: TrackKind;
	name: string;
	position: number;
	muted: boolean;
	hidden: boolean;
}

export interface CollabClip {
	id: string;
	trackId: string;
	kind: ClipKind;
	name: string;
	startTime: number;
	duration: number;
	trimStart: number;
	trimEnd: number;
	sourceDuration: number | null;
	mediaId: string | null;
	rate: number;
	volumeDb: number;
	muted: boolean;
	hidden: boolean;
	/** Editor-owned element fields that the server does not interpret. */
	data: Record<string, unknown>;
	/** Project revision at which this clip last changed. */
	revision: number;
}

export interface CollabEffect {
	id: string;
	clipId: string;
	effectType: string;
	position: number;
	enabled: boolean;
	params: Record<string, unknown>;
}

export interface CollabAsset {
	id: string;
	name: string;
	storage: AssetStorage;
	location: string;
	mimeType: string;
	byteSize: number | null;
	width: number | null;
	height: number | null;
	duration: number | null;
}

export interface CollabScene {
	id: string;
	name: string;
	isMain: boolean;
	position: number;
}

export interface CollabMetadata {
	canvasWidth: number;
	canvasHeight: number;
	fpsNumerator: number;
	fpsDenominator: number;
	background: string;
	extra: Record<string, unknown>;
}

/** The shared project as the adapter currently sees it. */
export interface ProjectSnapshot {
	projectId: string;
	name: string;
	revision: number;
	metadata: CollabMetadata | null;
	scenes: CollabScene[];
	tracks: CollabTrack[];
	clips: CollabClip[];
	effects: CollabEffect[];
	assets: CollabAsset[];
}

export interface Collaborator {
	identity: string;
	connectionId: string;
	name: string;
	color: string;
	kind: ActorKind;
	role: MemberRole;
	isSelf: boolean;
	/** This window may change the timeline. */
	canWrite: boolean;
	/** A write link was refused because four editors are already active. */
	atCapacity: boolean;
	sceneId: string;
	playhead: number;
	selection: string[];
	isPlaying: boolean;
	cursor: { x: number; y: number };
}

export interface RemoteEdit {
	revision: number;
	op: string;
	targetId: string;
	actor: string;
	actorKind: ActorKind;
	summary: string;
	payload: Record<string, unknown>;
	at: Date;
	/** False when this edit originated from this connection. */
	isRemote: boolean;
}

export interface PresenceUpdate {
	sceneId: string;
	playhead: number;
	selection: string[];
	isPlaying: boolean;
	cursor: { x: number; y: number };
}

/**
 * An editor action, in the adapter's vocabulary.
 *
 * Each variant maps to exactly one reducer. The editor translates its own
 * commands into these, and the adapter translates these into reducer calls —
 * so neither side needs to know the other's shape.
 */
export type EditorCommand =
	| { kind: "renameProject"; name: string }
	| { kind: "setMetadata"; metadata: CollabMetadata }
	| { kind: "addScene"; sceneId: string; name: string; position: number }
	| {
			kind: "addTrack";
			trackId: string;
			sceneId: string;
			group: TrackGroup;
			trackKind: TrackKind;
			name: string;
			position: number;
	  }
	| { kind: "reorderTrack"; trackId: string; position: number }
	| { kind: "setTrackMuted"; trackId: string; muted: boolean }
	| { kind: "setTrackHidden"; trackId: string; hidden: boolean }
	| { kind: "deleteTrack"; trackId: string }
	| { kind: "addClip"; clip: NewClip }
	| {
			kind: "moveClip";
			clipId: string;
			targetTrackId: string;
			startTime: number;
	  }
	| {
			kind: "trimClip";
			clipId: string;
			trimStart: number;
			trimEnd: number;
			startTime?: number;
			duration?: number;
	  }
	| {
			kind: "splitClip";
			clipId: string;
			splitTime: number;
			retain: RetainSide;
			rightClipId?: string;
	  }
	| { kind: "deleteClip"; clipId: string }
	| { kind: "setVolume"; clipId: string; volumeDb: number }
	| { kind: "setClipMuted"; clipId: string; muted: boolean }
	| { kind: "setClipHidden"; clipId: string; hidden: boolean }
	| {
			kind: "updateClipData";
			clipId: string;
			name: string;
			rate: number;
			data: Record<string, unknown>;
	  }
	| {
			kind: "addEffect";
			clipId: string;
			effectId: string;
			effectType: string;
			params: Record<string, unknown>;
	  }
	| { kind: "removeEffect"; effectId: string }
	| { kind: "toggleEffect"; effectId: string; enabled: boolean }
	| {
			kind: "updateEffectParams";
			effectId: string;
			params: Record<string, unknown>;
	  }
	| { kind: "reorderEffect"; effectId: string; toIndex: number }
	| { kind: "registerAsset"; asset: CollabAsset }
	| { kind: "removeAsset"; assetId: string };

export type NewClip = Omit<CollabClip, "revision">;

export interface ChatMessage {
	id: string;
	author: string;
	authorName: string;
	text: string;
	sentAt: Date;
}
