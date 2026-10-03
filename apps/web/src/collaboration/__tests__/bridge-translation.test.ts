import { describe, expect, test } from "bun:test";

import type { ProjectSnapshot } from "@opencut/collab-client";
import type { AudioTrack, SceneTracks, VideoElement, VideoTrack } from "@/timeline";
import { mediaTime, ZERO_MEDIA_TIME } from "@/wasm";

import { diffProjects } from "../diff";
import { flattenScene } from "../flatten";
import { rebuildScene } from "../rebuild";

const SCENE_ID = "scene-1";

function buildVideoElement(
	overrides: Partial<VideoElement> = {},
): VideoElement {
	return {
		id: "clip-1",
		type: "video",
		name: "Shot A",
		startTime: ZERO_MEDIA_TIME,
		duration: mediaTime({ ticks: 480_000 }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: "media-1",
		params: { opacity: 1, volume: -3 },
		...overrides,
	};
}

function buildMainTrack(elements: VideoElement[]): VideoTrack {
	return {
		id: "main-track",
		type: "video",
		name: "Main",
		muted: false,
		hidden: false,
		elements,
	};
}

function buildTracks(overrides: Partial<SceneTracks> = {}): SceneTracks {
	return {
		overlay: [],
		main: buildMainTrack([buildVideoElement()]),
		audio: [],
		...overrides,
	};
}

/** Builds the snapshot the server would hold for these tracks. */
function snapshotOf(tracks: SceneTracks): ProjectSnapshot {
	const flat = flattenScene({ tracks, sceneId: SCENE_ID });
	return {
		projectId: "project-1",
		name: "Test",
		revision: 1,
		metadata: null,
		scenes: [{ id: SCENE_ID, name: "Main", isMain: true, position: 0 }],
		...flat,
		assets: [],
	};
}

describe("flatten", () => {
	test("splits nested tracks and elements into flat rows", () => {
		const flat = flattenScene({ tracks: buildTracks(), sceneId: SCENE_ID });

		expect(flat.tracks).toHaveLength(1);
		expect(flat.tracks[0]).toMatchObject({
			id: "main-track",
			group: "main",
			kind: "video",
			position: 0,
		});
		expect(flat.clips).toHaveLength(1);
		expect(flat.clips[0]).toMatchObject({
			id: "clip-1",
			trackId: "main-track",
			kind: "video",
			startTime: 0,
			duration: 480_000,
			mediaId: "media-1",
		});
	});

	test("lifts volume out of params into its own column", () => {
		const flat = flattenScene({ tracks: buildTracks(), sceneId: SCENE_ID });
		expect(flat.clips[0]?.volumeDb).toBe(-3);
	});

	test("keeps geometry out of the opaque data blob", () => {
		const flat = flattenScene({ tracks: buildTracks(), sceneId: SCENE_ID });
		const data = flat.clips[0]?.data ?? {};

		for (const field of ["startTime", "duration", "trimStart", "trimEnd"]) {
			expect(data).not.toHaveProperty(field);
		}
		// Editor-only fields still ride along.
		expect(data).toHaveProperty("params");
	});

	test("numbers tracks by their position within each group", () => {
		const audio: AudioTrack[] = [
			{ id: "audio-1", type: "audio", name: "A1", muted: false, elements: [] },
			{ id: "audio-2", type: "audio", name: "A2", muted: true, elements: [] },
		];
		const flat = flattenScene({
			tracks: buildTracks({ audio }),
			sceneId: SCENE_ID,
		});

		const audioRows = flat.tracks.filter((track) => track.group === "audio");
		expect(audioRows.map((track) => track.position)).toEqual([0, 1]);
		expect(audioRows[1]?.muted).toBe(true);
	});
});

describe("round trip", () => {
	test("rebuilding a flattened scene preserves the clip", () => {
		const tracks = buildTracks();
		const rebuilt = rebuildScene({
			snapshot: snapshotOf(tracks),
			sceneId: SCENE_ID,
		});

		const original = tracks.main.elements[0];
		const result = rebuilt.main.elements[0];

		expect(rebuilt.main.id).toBe("main-track");
		expect(result?.id).toBe(original?.id);
		expect(result?.name).toBe(original?.name);
		expect(result?.startTime).toBe(original?.startTime);
		expect(result?.duration).toBe(original?.duration);
		expect(result?.trimStart).toBe(original?.trimStart);
		expect(result?.trimEnd).toBe(original?.trimEnd);
		expect(result?.params.volume).toBe(-3);
	});

	test("a round trip produces no commands to send", () => {
		const tracks = buildTracks();
		const rebuilt = rebuildScene({
			snapshot: snapshotOf(tracks),
			sceneId: SCENE_ID,
		});

		const commands = diffProjects({
			before: flattenScene({ tracks, sceneId: SCENE_ID }),
			after: flattenScene({ tracks: rebuilt, sceneId: SCENE_ID }),
		});

		expect(commands).toEqual([]);
	});

	test("preserves a retimed clip's rate", () => {
		const tracks = buildTracks({
			main: buildMainTrack([buildVideoElement({ retime: { rate: 2 } })]),
		});
		const rebuilt = rebuildScene({
			snapshot: snapshotOf(tracks),
			sceneId: SCENE_ID,
		});

		const element = rebuilt.main.elements[0];
		expect(element && "retime" in element ? element.retime?.rate : undefined).toBe(2);
	});
});

describe("diff", () => {
	const before = flattenScene({ tracks: buildTracks(), sceneId: SCENE_ID });

	test("reports a start-time change as a move", () => {
		const after = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({ startTime: mediaTime({ ticks: 120_000 }) }),
				]),
			}),
			sceneId: SCENE_ID,
		});

		expect(diffProjects({ before, after })).toEqual([
			{
				kind: "moveClip",
				clipId: "clip-1",
				targetTrackId: "main-track",
				startTime: 120_000,
			},
		]);
	});

	test("reports a trim change as a trim, not a move", () => {
		const after = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({
						trimStart: mediaTime({ ticks: 60_000 }),
						duration: mediaTime({ ticks: 420_000 }),
					}),
				]),
			}),
			sceneId: SCENE_ID,
		});

		expect(diffProjects({ before, after })).toEqual([
			{
				kind: "trimClip",
				clipId: "clip-1",
				trimStart: 60_000,
				trimEnd: 0,
				startTime: 0,
				duration: 420_000,
			},
		]);
	});

	test("reports a volume change on its own", () => {
		const after = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({ params: { opacity: 1, volume: -12 } }),
				]),
			}),
			sceneId: SCENE_ID,
		});

		expect(diffProjects({ before, after })).toEqual([
			{ kind: "setVolume", clipId: "clip-1", volumeDb: -12 },
		]);
	});

	test("reports an added clip and a removed clip", () => {
		const added = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement(),
					buildVideoElement({ id: "clip-2", startTime: mediaTime({ ticks: 600_000 }) }),
				]),
			}),
			sceneId: SCENE_ID,
		});

		const addCommands = diffProjects({ before, after: added });
		expect(addCommands).toHaveLength(1);
		expect(addCommands[0]?.kind).toBe("addClip");

		expect(diffProjects({ before: added, after: before })).toEqual([
			{ kind: "deleteClip", clipId: "clip-2" },
		]);
	});

	test("reports an added track before the clip that needs it", () => {
		const after = flattenScene({
			tracks: buildTracks({
				audio: [
					{
						id: "audio-1",
						type: "audio",
						name: "A1",
						muted: false,
						elements: [],
					},
				],
			}),
			sceneId: SCENE_ID,
		});

		const commands = diffProjects({ before, after });
		expect(commands).toEqual([
			{
				kind: "addTrack",
				trackId: "audio-1",
				sceneId: SCENE_ID,
				group: "audio",
				trackKind: "audio",
				name: "A1",
				position: 0,
			},
		]);
	});

	test("never asks to delete the main track", () => {
		const emptied = flattenScene({
			tracks: { overlay: [], main: buildMainTrack([]), audio: [] },
			sceneId: SCENE_ID,
		});
		const commands = diffProjects({ before, after: emptied });

		expect(commands).toEqual([{ kind: "deleteClip", clipId: "clip-1" }]);
	});

	test("skips effect removals for a clip that is being deleted", () => {
		const withEffect = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({
						effects: [
							{ id: "effect-1", type: "blur", enabled: true, params: {} },
						],
					}),
				]),
			}),
			sceneId: SCENE_ID,
		});
		const withoutClip = flattenScene({
			tracks: { overlay: [], main: buildMainTrack([]), audio: [] },
			sceneId: SCENE_ID,
		});

		const commands = diffProjects({ before: withEffect, after: withoutClip });
		expect(commands).toEqual([{ kind: "deleteClip", clipId: "clip-1" }]);
	});

	test("reports an effect parameter change", () => {
		const withEffect = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({
						effects: [
							{ id: "effect-1", type: "blur", enabled: true, params: { radius: 4 } },
						],
					}),
				]),
			}),
			sceneId: SCENE_ID,
		});
		const adjusted = flattenScene({
			tracks: buildTracks({
				main: buildMainTrack([
					buildVideoElement({
						effects: [
							{ id: "effect-1", type: "blur", enabled: true, params: { radius: 9 } },
						],
					}),
				]),
			}),
			sceneId: SCENE_ID,
		});

		expect(diffProjects({ before: withEffect, after: adjusted })).toEqual([
			{
				kind: "updateEffectParams",
				effectId: "effect-1",
				params: { radius: 9 },
			},
		]);
	});
});
