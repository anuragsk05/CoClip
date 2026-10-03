/**
 * Rebuilds the editor's scene tracks from a shared project snapshot.
 *
 * The inverse of `flattenScene`. Typed columns win over anything left in
 * `data`, so geometry the reducers validated is what the editor renders.
 */

import type {
	CollabClip,
	CollabEffect,
	CollabTrack,
	ProjectSnapshot,
} from "@opencut/collab-client";

import type { Effect } from "@/effects/types";
import type { ParamValues } from "@/params";
import { buildEmptyTrack } from "@/timeline/placement";
import type {
	AudioTrack,
	OverlayTrack,
	SceneTracks,
	TimelineElement,
	TimelineTrack,
	TrackType,
	VideoTrack,
} from "@/timeline";
import { mediaTime } from "@/wasm";

export function rebuildScene({
	snapshot,
	sceneId,
}: {
	snapshot: ProjectSnapshot;
	sceneId: string;
}): SceneTracks {
	const forScene = snapshot.tracks.filter((track) => track.sceneId === sceneId);
	const clipsByTrack = groupBy(snapshot.clips, (clip) => clip.trackId);
	const effectsByClip = groupBy(snapshot.effects, (effect) => effect.clipId);

	const build = (track: CollabTrack): TimelineTrack =>
		rebuildTrack({
			track,
			clips: clipsByTrack.get(track.id) ?? [],
			effectsByClip,
		});

	const inGroup = (group: CollabTrack["group"]) =>
		forScene
			.filter((track) => track.group === group)
			.sort((a, b) => a.position - b.position);

	const mainTrack = inGroup("main")[0];

	return {
		overlay: inGroup("overlay").map(build) as OverlayTrack[],
		// A scene without a main track is not loadable, so fall back to an empty
		// one rather than refusing to render the rest of the project.
		main: (mainTrack
			? build(mainTrack)
			: buildEmptyTrack({ id: `${sceneId}-main`, type: "video" })) as VideoTrack,
		audio: inGroup("audio").map(build) as AudioTrack[],
	};
}

function rebuildTrack({
	track,
	clips,
	effectsByClip,
}: {
	track: CollabTrack;
	clips: CollabClip[];
	effectsByClip: Map<string, CollabEffect[]>;
}): TimelineTrack {
	const base = buildEmptyTrack({
		id: track.id,
		type: track.kind as TrackType,
		name: track.name,
	});

	const elements = clips
		.slice()
		.sort((a, b) => a.startTime - b.startTime)
		.map((clip) =>
			rebuildElement({
				clip,
				effects: effectsByClip.get(clip.id) ?? [],
			}),
		);

	const rebuilt: TimelineTrack = { ...base, elements } as TimelineTrack;
	if ("muted" in rebuilt) {
		rebuilt.muted = track.muted;
	}
	if ("hidden" in rebuilt) {
		rebuilt.hidden = track.hidden;
	}
	return rebuilt;
}

function rebuildElement({
	clip,
	effects,
}: {
	clip: CollabClip;
	effects: CollabEffect[];
}): TimelineElement {
	const data = { ...clip.data };
	const params = {
		...((data.params as Record<string, unknown>) ?? {}),
		volume: clip.volumeDb,
		muted: clip.muted,
	};
	delete data.params;

	const element: Record<string, unknown> = {
		...data,
		id: clip.id,
		type: clip.kind,
		name: clip.name,
		startTime: mediaTime({ ticks: clip.startTime }),
		duration: mediaTime({ ticks: clip.duration }),
		trimStart: mediaTime({ ticks: clip.trimStart }),
		trimEnd: mediaTime({ ticks: clip.trimEnd }),
		params,
		hidden: clip.hidden,
	};

	if (clip.sourceDuration !== null) {
		element.sourceDuration = mediaTime({ ticks: clip.sourceDuration });
	}
	if (clip.mediaId !== null) {
		element.mediaId = clip.mediaId;
	}
	// Normal speed is the absence of a retime config, matching how the editor
	// distinguishes an un-retimed clip from one explicitly set to 1x.
	if (clip.rate !== 1) {
		element.retime = { rate: clip.rate };
	}
	if (effects.length > 0) {
		element.effects = effects
			.slice()
			.sort((a, b) => a.position - b.position)
			.map(
				(effect): Effect => ({
					id: effect.id,
					type: effect.effectType,
					enabled: effect.enabled,
					params: toParamValues(effect.params),
				}),
			);
	}

	return element as unknown as TimelineElement;
}

/**
 * Narrows decoded JSON to the editor's parameter type.
 *
 * Parameters are primitives. Anything else in the stored JSON is a value the
 * editor cannot apply, so it is dropped rather than handed on as a parameter.
 */
function toParamValues(raw: Record<string, unknown>): ParamValues {
	const params: ParamValues = {};
	for (const [key, value] of Object.entries(raw)) {
		if (
			typeof value === "number" ||
			typeof value === "string" ||
			typeof value === "boolean"
		) {
			params[key] = value;
		}
	}
	return params;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
	const grouped = new Map<string, T[]>();
	for (const item of items) {
		const group = grouped.get(key(item));
		if (group) {
			group.push(item);
			continue;
		}
		grouped.set(key(item), [item]);
	}
	return grouped;
}
