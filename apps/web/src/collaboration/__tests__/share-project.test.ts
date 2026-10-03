import { describe, expect, test } from "bun:test";

import type { ProjectSnapshot } from "@opencut/collab-client";

import { resolveCollaborationUri } from "../config";
import { projectFromSnapshot } from "../join";

const snapshot: ProjectSnapshot = {
	projectId: "project-1",
	name: "Lion King",
	revision: 3,
	metadata: {
		canvasWidth: 1920,
		canvasHeight: 1080,
		fpsNumerator: 30,
		fpsDenominator: 1,
		background: "#000000",
		extra: {},
	},
	scenes: [
		{ id: "scene-1", name: "Main scene", isMain: true, position: 0 },
	],
	tracks: [
		{
			id: "track-1",
			sceneId: "scene-1",
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
			trackId: "track-1",
			kind: "video",
			name: "Lion King_1.mp4",
			startTime: 0,
			duration: 1_200_000,
			trimStart: 0,
			trimEnd: 0,
			sourceDuration: 2_400_000,
			mediaId: "media-1",
			rate: 1,
			volumeDb: 0,
			muted: false,
			hidden: false,
			data: {},
			revision: 3,
		},
	],
	effects: [],
	assets: [],
};

describe("projectFromSnapshot", () => {
	test("keeps the shared project id, scene id, and clip", () => {
		const project = projectFromSnapshot(snapshot);

		expect(project.metadata.id).toBe("project-1");
		expect(project.metadata.name).toBe("Lion King");
		expect(project.currentSceneId).toBe("scene-1");
		expect(project.scenes[0]?.tracks.main.id).toBe("track-1");
		expect(project.scenes[0]?.tracks.main.elements[0]?.id).toBe("clip-1");
		expect(project.settings.canvasSize).toEqual({ width: 1920, height: 1080 });
	});
});

describe("resolveCollaborationUri", () => {
	test("points a guest on another machine at the host", () => {
		expect(
			resolveCollaborationUri("ws://localhost:3000", "192.168.1.20"),
		).toBe("ws://192.168.1.20:3000");
	});

	test("leaves a same-computer link on localhost", () => {
		expect(resolveCollaborationUri("ws://localhost:3000", "localhost")).toBe(
			"ws://localhost:3000",
		);
	});
});
