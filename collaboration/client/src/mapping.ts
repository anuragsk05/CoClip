/**
 * Translation between generated row types and the adapter's vocabulary.
 *
 * Two mismatches are handled here. SpacetimeDB sends 64-bit integers as
 * `bigint` while the editor works in `number`, and it represents enums as
 * `{ tag }` objects while the adapter uses string literals.
 */

import type {
	Asset,
	Clip,
	ClipEffect,
	ClipKind as ClipKindRow,
	Collaborator as CollaboratorRow,
	EditHistory,
	Presence,
	Project,
	ProjectMetadata,
	Scene,
	Track,
	TrackGroup as TrackGroupRow,
	TrackKind as TrackKindRow,
} from "./module_bindings/types";
import type {
	ActorKind,
	AssetStorage,
	ClipKind,
	MemberRole,
	CollabAsset,
	CollabClip,
	CollabEffect,
	CollabMetadata,
	CollabScene,
	CollabTrack,
	Collaborator,
	RemoteEdit,
	RetainSide,
	TrackGroup,
	TrackKind,
} from "./types";

export function toTicks(value: bigint): number {
	return Number(value);
}

export function fromTicks(value: number): bigint {
	return BigInt(Math.round(value));
}

/** Parses a JSON column, falling back to an empty object. */
export function parseJson(raw: string): Record<string, unknown> {
	if (raw === "") {
		return {};
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: {};
	} catch {
		return {};
	}
}

export function stringifyJson(value: Record<string, unknown>): string {
	return JSON.stringify(value);
}

export function trackGroupToRow(group: TrackGroup): TrackGroupRow {
	switch (group) {
		case "overlay":
			return { tag: "Overlay" };
		case "main":
			return { tag: "Main" };
		case "audio":
			return { tag: "Audio" };
	}
}

export function trackKindToRow(kind: TrackKind): TrackKindRow {
	switch (kind) {
		case "video":
			return { tag: "Video" };
		case "text":
			return { tag: "Text" };
		case "audio":
			return { tag: "Audio" };
		case "graphic":
			return { tag: "Graphic" };
		case "effect":
			return { tag: "Effect" };
	}
}

export function clipKindToRow(kind: ClipKind): ClipKindRow {
	switch (kind) {
		case "video":
			return { tag: "Video" };
		case "image":
			return { tag: "Image" };
		case "text":
			return { tag: "Text" };
		case "audio":
			return { tag: "Audio" };
		case "sticker":
			return { tag: "Sticker" };
		case "graphic":
			return { tag: "Graphic" };
		case "effect":
			return { tag: "Effect" };
	}
}

export function assetStorageToRow(
	storage: AssetStorage,
): Asset["storage"] {
	switch (storage) {
		case "local":
			return { tag: "Local" };
		case "s3":
			return { tag: "S3" };
		case "r2":
			return { tag: "R2" };
		case "spacetime":
			return { tag: "Spacetime" };
	}
}

export function retainSideToRow(retain: RetainSide): {
	tag: "Both" | "Left" | "Right";
} {
	switch (retain) {
		case "both":
			return { tag: "Both" };
		case "left":
			return { tag: "Left" };
		case "right":
			return { tag: "Right" };
	}
}

export function lower<T extends string>(tag: string): T {
	return tag.toLowerCase() as T;
}

export function toTrack(row: Track): CollabTrack {
	return {
		id: row.id,
		sceneId: row.sceneId,
		group: lower<TrackGroup>(row.group.tag),
		kind: lower<TrackKind>(row.kind.tag),
		name: row.name,
		position: row.position,
		muted: row.muted,
		hidden: row.hidden,
	};
}

export function toClip(row: Clip): CollabClip {
	return {
		id: row.id,
		trackId: row.trackId,
		kind: lower<ClipKind>(row.kind.tag),
		name: row.name,
		startTime: toTicks(row.startTime),
		duration: toTicks(row.duration),
		trimStart: toTicks(row.trimStart),
		trimEnd: toTicks(row.trimEnd),
		sourceDuration:
			row.sourceDuration === undefined ? null : toTicks(row.sourceDuration),
		mediaId: row.mediaId ?? null,
		rate: row.rate,
		volumeDb: row.volumeDb,
		muted: row.muted,
		hidden: row.hidden,
		data: parseJson(row.data),
		revision: Number(row.revision),
	};
}

export function toEffect(row: ClipEffect): CollabEffect {
	return {
		id: row.id,
		clipId: row.clipId,
		effectType: row.effectType,
		position: row.position,
		enabled: row.enabled,
		params: parseJson(row.params),
	};
}

export function toAsset(row: Asset): CollabAsset {
	return {
		id: row.id,
		name: row.name,
		storage: lower<AssetStorage>(row.storage.tag),
		location: row.location,
		mimeType: row.mimeType,
		byteSize: row.byteSize === undefined ? null : Number(row.byteSize),
		width: row.width ?? null,
		height: row.height ?? null,
		duration: row.duration === undefined ? null : toTicks(row.duration),
	};
}

export function toScene(row: Scene): CollabScene {
	return {
		id: row.id,
		name: row.name,
		isMain: row.isMain,
		position: row.position,
	};
}

export function toMetadata(row: ProjectMetadata): CollabMetadata {
	return {
		canvasWidth: row.canvasWidth,
		canvasHeight: row.canvasHeight,
		fpsNumerator: row.fpsNumerator,
		fpsDenominator: row.fpsDenominator,
		background: row.background,
		extra: parseJson(row.extra),
	};
}

export function projectRevision(row: Project): number {
	return Number(row.revision);
}

export function toCollaborator({
	row,
	presence,
	isSelf,
}: {
	row: CollaboratorRow;
	presence?: Presence | null;
	isSelf: boolean;
}): Collaborator {
	return {
		identity: row.identity.toHexString(),
		connectionId: row.connectionId.toHexString(),
		name: row.displayName || "Editor",
		color: row.color || "#64748b",
		kind: lower<ActorKind>(row.kind.tag),
		role: lower<MemberRole>(row.role.tag),
		isSelf,
		canWrite: row.canWrite,
		atCapacity: row.atCapacity,
		sceneId: presence?.sceneId ?? "",
		playhead: presence ? toTicks(presence.playhead) : 0,
		selection: presence?.selection ?? [],
		isPlaying: presence?.isPlaying ?? false,
		cursor: presence
			? { x: presence.cursorX, y: presence.cursorY }
			: { x: -1, y: -1 },
	};
}

export function toRemoteEdit({
	row,
	isRemote,
}: {
	row: EditHistory;
	isRemote: boolean;
}): RemoteEdit {
	return {
		revision: Number(row.revision),
		op: uncapitalize(row.op.tag),
		targetId: row.targetId,
		actor: row.actor.toHexString(),
		actorKind: lower<ActorKind>(row.actorKind.tag),
		summary: row.summary,
		payload: parseJson(row.payload),
		at: row.at.toDate(),
		isRemote,
	};
}

function uncapitalize(value: string): string {
	return value.charAt(0).toLowerCase() + value.slice(1);
}
