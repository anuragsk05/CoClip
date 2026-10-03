/**
 * Integration tests for the adapter against a live SpacetimeDB module.
 *
 * Requires `spacetime start` and a published `opencut-collab` module. Run with
 * `bun test` from `collaboration/client`.
 */

import { afterAll, expect, test } from "bun:test";

import { memoryTokenStore } from "./connection";
import { CollabSession } from "./session";
import type { NewClip, ProjectSnapshot, RemoteEdit } from "./types";

const URI = process.env.SPACETIME_URI ?? "ws://localhost:3000";
const DATABASE = process.env.SPACETIME_DATABASE ?? "opencut-collab";

const TICKS_PER_SECOND = 120_000;
const seconds = (value: number) => value * TICKS_PER_SECOND;

const opened: CollabSession[] = [];

afterAll(() => {
	for (const session of opened) {
		session.close();
	}
});

async function openSession(options: {
	projectId: string;
	name: string;
	asAgent?: boolean;
}): Promise<CollabSession> {
	const session = await CollabSession.open({
		uri: URI,
		database: DATABASE,
		projectId: options.projectId,
		// A fresh token per session makes each one a distinct collaborator,
		// which is what two people in two browsers actually look like.
		tokenStore: memoryTokenStore(),
		profile: { name: options.name, color: "#f97316" },
		asAgent: options.asAgent,
	});
	opened.push(session);
	return session;
}

/** Resolves once a snapshot satisfies `predicate`, or rejects on timeout. */
function waitForSnapshot(
	session: CollabSession,
	predicate: (snapshot: ProjectSnapshot) => boolean,
	label: string,
): Promise<ProjectSnapshot> {
	const current = session.snapshot();
	if (predicate(current)) {
		return Promise.resolve(current);
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsubscribe();
			reject(new Error(`timed out waiting for ${label}`));
		}, 5_000);

		const unsubscribe = session.onSnapshot(({ snapshot }) => {
			if (!predicate(snapshot)) {
				return;
			}
			clearTimeout(timer);
			unsubscribe();
			resolve(snapshot);
		});
	});
}

function clipOf(snapshot: ProjectSnapshot, clipId: string) {
	return snapshot.clips.find((clip) => clip.id === clipId);
}

function newClip(overrides: Partial<NewClip> & { id: string; trackId: string }): NewClip {
	return {
		kind: "video",
		name: "Shot",
		startTime: 0,
		duration: seconds(4),
		trimStart: 0,
		trimEnd: 0,
		sourceDuration: seconds(10),
		mediaId: null,
		rate: 1,
		volumeDb: 0,
		muted: false,
		hidden: false,
		data: {},
		...overrides,
	};
}

test("mirrors a clip move between two editors", async () => {
	const projectId = `test-move-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;

	const editorA = await openSession({ projectId, name: "Editor A" });
	await editorA.createProject({
		name: "Move Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});

	const editorB = await openSession({ projectId, name: "Editor B" });
	await waitForSnapshot(
		editorB,
		(snapshot) => snapshot.tracks.length === 1,
		"editor B to see the project",
	);

	await editorA.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId, name: "Opening" }),
	});
	await editorA.dispatch({
		kind: "moveClip",
		clipId: clipA,
		targetTrackId: trackId,
		startTime: seconds(2),
	});

	const seenByB = await waitForSnapshot(
		editorB,
		(snapshot) => clipOf(snapshot, clipA)?.startTime === seconds(2),
		"the move to reach editor B",
	);

	const clip = clipOf(seenByB, clipA);
	expect(clip?.name).toBe("Opening");
	expect(clip?.startTime).toBe(seconds(2));
	expect(clip?.duration).toBe(seconds(4));
});

test("applies a split from one editor in the other", async () => {
	const projectId = `test-split-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;
	const clipB = `${projectId}-clip-b`;

	const editorA = await openSession({ projectId, name: "Editor A" });
	await editorA.createProject({
		name: "Split Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});
	await editorA.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId, startTime: 0, duration: seconds(4) }),
	});

	const editorB = await openSession({ projectId, name: "Editor B" });
	await waitForSnapshot(
		editorB,
		(snapshot) => snapshot.clips.length === 1,
		"editor B to see the clip",
	);

	await editorB.dispatch({
		kind: "splitClip",
		clipId: clipA,
		splitTime: seconds(1.5),
		retain: "both",
		rightClipId: clipB,
	});

	const seenByA = await waitForSnapshot(
		editorA,
		(snapshot) => snapshot.clips.length === 2,
		"the split to reach editor A",
	);

	const left = clipOf(seenByA, clipA);
	const right = clipOf(seenByA, clipB);

	expect(left?.startTime).toBe(0);
	expect(left?.duration).toBe(seconds(1.5));
	expect(left?.trimEnd).toBe(seconds(2.5));
	expect(right?.startTime).toBe(seconds(1.5));
	expect(right?.duration).toBe(seconds(2.5));
	expect(right?.trimStart).toBe(seconds(1.5));
	// The halves adjoin exactly, with no gap or overlap.
	expect(left!.startTime + left!.duration).toBe(right!.startTime);
});

test("suppresses dispatch while remote state is being applied", async () => {
	const projectId = `test-echo-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;

	const editor = await openSession({ projectId, name: "Editor" });
	await editor.createProject({
		name: "Echo Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});
	await editor.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId }),
	});
	await waitForSnapshot(
		editor,
		(snapshot) => snapshot.clips.length === 1,
		"the clip to exist",
	);

	const before = editor.snapshot().revision;
	await editor.applyRemote(() =>
		editor.dispatch({
			kind: "moveClip",
			clipId: clipA,
			targetTrackId: trackId,
			startTime: seconds(3),
		}),
	);

	expect(editor.snapshot().revision).toBe(before);
	expect(clipOf(editor.snapshot(), clipA)?.startTime).toBe(0);
});

test("reports an agent's edits as agent-authored history", async () => {
	const projectId = `test-agent-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;

	const editor = await openSession({ projectId, name: "Editor" });
	await editor.createProject({
		name: "Agent Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});

	const edits: RemoteEdit[] = [];
	editor.onEdit((edit) => edits.push(edit));

	const agent = await openSession({
		projectId,
		name: "Trim Bot",
		asAgent: true,
	});
	await agent.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId, name: "B-roll" }),
	});

	await waitForSnapshot(
		editor,
		(snapshot) => snapshot.clips.length === 1,
		"the agent's clip to reach the editor",
	);

	const addClip = edits.find((edit) => edit.op === "addClip");
	expect(addClip).toBeDefined();
	expect(addClip?.actorKind).toBe("agent");
	expect(addClip?.isRemote).toBe(true);
	expect(addClip?.summary).toBe("Added `B-roll`");
});

test("rejects a clip placed on an incompatible track", async () => {
	const projectId = `test-reject-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;

	const editor = await openSession({ projectId, name: "Editor" });
	await editor.createProject({
		name: "Reject Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});

	// The main track is a video track, so an audio clip does not belong on it.
	await expect(
		editor.dispatch({
			kind: "addClip",
			clip: newClip({ id: `${projectId}-clip-bad`, trackId, kind: "audio" }),
		}),
	).rejects.toThrow();

	expect(editor.snapshot().clips).toHaveLength(0);
});
