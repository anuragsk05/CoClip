import { expect, test } from "bun:test";

import { ticksFromSeconds } from "@opencut/collab-client";

import { TOOLS_BY_NAME } from "./tools";
import { describeProject, toProjectView } from "./view";

test("move_clip converts seconds to ticks and leaves the track blank", () => {
	const command = TOOLS_BY_NAME.get("move_clip")?.toCommand({
		clipId: "clip-1",
		startTime: 1.5,
	});

	expect(command).toEqual({
		kind: "moveClip",
		clipId: "clip-1",
		targetTrackId: "",
		startTime: ticksFromSeconds(1.5),
	});
});

test("split_clip defaults to keeping both halves", () => {
	const command = TOOLS_BY_NAME.get("split_clip")?.toCommand({
		clipId: "clip-1",
		splitTime: 2,
	});

	expect(command).toEqual({
		kind: "splitClip",
		clipId: "clip-1",
		splitTime: ticksFromSeconds(2),
		retain: "both",
	});
});

test("rejects a malformed volume", () => {
	expect(() =>
		TOOLS_BY_NAME.get("set_volume")?.toCommand({
			clipId: "clip-1",
			volumeDb: "quiet",
		}),
	).toThrow("`volumeDb` must be a finite number");
});

test("unknown tools are not in the catalog", () => {
	expect(TOOLS_BY_NAME.has("overwrite_timeline")).toBe(false);
});

test("describeProject lists clips in seconds", () => {
	const view = toProjectView({
		snapshot: {
			projectId: "p1",
			name: "Demo",
			revision: 3,
			metadata: null,
			scenes: [{ id: "s1", name: "Main", isMain: true, position: 0 }],
			tracks: [
				{
					id: "main",
					sceneId: "s1",
					group: "main",
					kind: "video",
					name: "Main",
					position: 0,
					muted: false,
					hidden: false,
				},
			],
			clips: [
				{
					id: "clip-1",
					trackId: "main",
					kind: "video",
					name: "Shot A",
					startTime: 0,
					duration: 480_000,
					trimStart: 0,
					trimEnd: 0,
					sourceDuration: null,
					mediaId: null,
					rate: 1,
					volumeDb: 0,
					muted: false,
					hidden: false,
					data: {},
					revision: 1,
				},
			],
			effects: [],
			assets: [],
		},
	});

	expect(view.duration).toBe(4);
	expect(describeProject(view)).toContain("0.00s–4.00s");
	expect(describeProject(view)).toContain("clip-1");
});
