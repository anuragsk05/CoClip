/**
 * Flattens the editor's scene tracks into the adapter's flat vocabulary.
 *
 * The editor nests elements inside tracks and effects inside elements, while
 * the shared project stores all three as separate rows. Element fields that the
 * server does not reason about ride along in `data` so they survive the round
 * trip without the schema having to know about them.
 */

import type {
	CollabClip,
	CollabEffect,
	CollabTrack,
	ClipKind,
	TrackGroup,
	TrackKind,
} from "@opencut/collab-client";

import { hasMediaId } from "@/timeline/element-utils";
import type { SceneTracks, TimelineElement, TimelineTrack } from "@/timeline";

export interface FlatProject {
	tracks: CollabTrack[];
	clips: CollabClip[];
	effects: CollabEffect[];
}

/**
 * Element fields the schema owns as typed columns.
 *
 * These are stripped from `data` so there is exactly one source of truth for
 * each: a clip's start time lives in the `start_time` column, never in JSON.
 */
const TYPED_ELEMENT_FIELDS = [
	"id",
	"type",
	"name",
	"startTime",
	"duration",
	"trimStart",
	"trimEnd",
	"sourceDuration",
	"mediaId",
	"effects",
	"retime",
	"hidden",
	// Decoded audio is recreated on load and must never be serialised.
	"buffer",
] as const;

/**
 * Parameters the schema owns as typed columns, for the same reason.
 *
 * The editor keeps volume and mute inside `params`; the schema gives each a
 * column so `set_volume` and `set_clip_muted` have something to write. Leaving
 * copies in `data` would make a volume change look like a data change too.
 */
const TYPED_PARAM_FIELDS = ["volume", "muted"] as const;

export function flattenScene({
	tracks,
	sceneId,
}: {
	tracks: SceneTracks;
	sceneId: string;
}): FlatProject {
	const flat: FlatProject = { tracks: [], clips: [], effects: [] };

	const addTrack = ({
		track,
		group,
		position,
	}: {
		track: TimelineTrack;
		group: TrackGroup;
		position: number;
	}) => {
		flat.tracks.push({
			id: track.id,
			sceneId,
			group,
			kind: track.type as TrackKind,
			name: track.name,
			position,
			muted: "muted" in track ? track.muted : false,
			hidden: "hidden" in track ? track.hidden : false,
		});

		for (const element of track.elements) {
			flat.clips.push(toClip({ element, trackId: track.id }));
			flat.effects.push(...toEffects({ element }));
		}
	};

	tracks.overlay.forEach((track, position) => {
		addTrack({ track, group: "overlay", position });
	});
	addTrack({ track: tracks.main, group: "main", position: 0 });
	tracks.audio.forEach((track, position) => {
		addTrack({ track, group: "audio", position });
	});

	return flat;
}

function toClip({
	element,
	trackId,
}: {
	element: TimelineElement;
	trackId: string;
}): CollabClip {
	const params = element.params as Record<string, unknown>;
	return {
		id: element.id,
		trackId,
		kind: element.type as ClipKind,
		name: element.name,
		startTime: element.startTime,
		duration: element.duration,
		trimStart: element.trimStart,
		trimEnd: element.trimEnd,
		sourceDuration: element.sourceDuration ?? null,
		mediaId: hasMediaId(element) ? element.mediaId : null,
		rate: "retime" in element ? (element.retime?.rate ?? 1) : 1,
		volumeDb: typeof params.volume === "number" ? params.volume : 0,
		muted: params.muted === true,
		hidden: "hidden" in element ? element.hidden === true : false,
		data: toData(element),
		revision: 0,
	};
}

function toData(element: TimelineElement): Record<string, unknown> {
	const data: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(element)) {
		if ((TYPED_ELEMENT_FIELDS as readonly string[]).includes(key)) {
			continue;
		}
		if (key === "params") {
			data.params = withoutTypedParams(value as Record<string, unknown>);
			continue;
		}
		data[key] = value;
	}
	return data;
}

function withoutTypedParams(
	params: Record<string, unknown>,
): Record<string, unknown> {
	const remaining: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(params)) {
		if ((TYPED_PARAM_FIELDS as readonly string[]).includes(key)) {
			continue;
		}
		remaining[key] = value;
	}
	return remaining;
}

function toEffects({
	element,
}: {
	element: TimelineElement;
}): CollabEffect[] {
	if (!("effects" in element) || element.effects === undefined) {
		return [];
	}
	return element.effects.map((effect, position) => ({
		id: effect.id,
		clipId: element.id,
		effectType: effect.type,
		position,
		enabled: effect.enabled,
		params: effect.params as Record<string, unknown>,
	}));
}
