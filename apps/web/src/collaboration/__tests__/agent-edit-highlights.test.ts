import { expect, test } from "bun:test";
import type {
	CollabClip,
	ProjectSnapshot,
	RemoteEdit,
} from "@opencut/collab-client";
import {
	AgentEditHighlights,
	agentEditedClipIds,
} from "../agent-edit-highlights";

function clip(id: string, trackId = "track-1"): CollabClip {
	return {
		id,
		trackId,
		kind: "image",
		name: id,
		startTime: 0,
		duration: 120000,
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
	};
}
const snapshot: ProjectSnapshot = {
	projectId: "project",
	name: "Test",
	revision: 1,
	metadata: null,
	scenes: [],
	tracks: [],
	assets: [],
	clips: [clip("left"), clip("right"), clip("other", "track-2")],
	effects: [
		{
			id: "effect",
			clipId: "left",
			effectType: "blur",
			position: 0,
			enabled: true,
			params: {},
		},
	],
};
function edit(overrides: Partial<RemoteEdit> = {}): RemoteEdit {
	return {
		revision: 1,
		op: "setClipHidden",
		targetId: "left",
		actor: "agent",
		actorKind: "agent",
		summary: "Hid photo",
		payload: {},
		at: new Date(),
		isRemote: true,
		...overrides,
	};
}

test("highlights agent edits from shared history, and ignores human edits", () => {
	expect(agentEditedClipIds({ edit: edit(), snapshot: snapshot })).toEqual([
		"left",
	]);
	expect(
		agentEditedClipIds({ edit: edit({ isRemote: false }), snapshot: snapshot }),
	).toEqual(["left"]);
	expect(
		agentEditedClipIds({
			edit: edit({ actorKind: "human" }),
			snapshot: snapshot,
		}),
	).toEqual([]);
});

test("maps split, effect, and track edits to their clips", () => {
	expect(
		agentEditedClipIds({
			edit: edit({ op: "splitClip", payload: { rightClipId: "right" } }),
			snapshot: snapshot,
		}),
	).toEqual(["left", "right"]);
	expect(
		agentEditedClipIds({
			edit: edit({ op: "updateEffectParams", targetId: "effect" }),
			snapshot: snapshot,
		}),
	).toEqual(["left"]);
	expect(
		agentEditedClipIds({
			edit: edit({
				op: "removeEffect",
				targetId: "removed-effect",
				payload: { clipId: "left" },
			}),
			snapshot: snapshot,
		}),
	).toEqual(["left"]);
	expect(
		agentEditedClipIds({
			edit: edit({ op: "setTrackHidden", targetId: "track-1" }),
			snapshot: snapshot,
		}),
	).toEqual(["left", "right"]);
});

test("does not highlight deleted clips or unrelated project operations", () => {
	expect(
		agentEditedClipIds({
			edit: edit({ op: "deleteClip", targetId: "deleted" }),
			snapshot: snapshot,
		}),
	).toEqual([]);
	expect(
		agentEditedClipIds({
			edit: edit({ op: "renameProject", targetId: "project" }),
			snapshot: snapshot,
		}),
	).toEqual([]);
	expect(
		agentEditedClipIds({
			edit: edit({ targetId: "unknown", payload: { rightClipId: 123 } }),
			snapshot: snapshot,
		}),
	).toEqual([]);
});

test("highlights expire and repeated edits refresh the label and lifetime", async () => {
	const highlights = new AgentEditHighlights(100);
	let changes = 0;
	const stop = highlights.subscribe(() => changes++);
	try {
		highlights.show({ edit: edit(), snapshot: snapshot });
		expect(highlights.label("left")).toBe("Hid photo");
		await Bun.sleep(60);
		highlights.show({
			edit: edit({ summary: "Showed photo" }),
			snapshot: snapshot,
		});
		await Bun.sleep(60);
		expect(highlights.label("left")).toBe("Showed photo");
		await Bun.sleep(60);
		expect(highlights.label("left")).toBeUndefined();
		expect(changes).toBe(3);
	} finally {
		stop();
		highlights.clear();
	}
});

test("cleanup cancels expiry callbacks and unsubscribing stops notifications", async () => {
	const highlights = new AgentEditHighlights(20);
	let changes = 0;
	const stop = highlights.subscribe(() => changes++);
	highlights.show({ edit: edit(), snapshot: snapshot });
	highlights.clear();
	expect(highlights.label("left")).toBeUndefined();
	await Bun.sleep(40);
	expect(changes).toBe(2);
	stop();
	highlights.show({ edit: edit(), snapshot: snapshot });
	highlights.clear();
	expect(changes).toBe(2);
});
