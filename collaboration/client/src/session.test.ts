/**
 * Integration tests for the adapter against a live SpacetimeDB module.
 *
 * Requires `spacetime start` and a published `opencut-collab` module. Run with
 * `bun test` from `collaboration/client`.
 */

import { afterAll, expect, test } from "bun:test";

import { memoryTokenStore, type TokenStore } from "./connection";
import { assembleMediaChunks } from "./media-bytes";
import { CollabSession } from "./session";
import type { Collaborator, NewClip, ProjectSnapshot, RemoteEdit } from "./types";

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
	inviteToken?: string;
	tokenStore?: TokenStore;
}): Promise<CollabSession> {
	const session = await CollabSession.open({
		uri: URI,
		database: DATABASE,
		projectId: options.projectId,
		// A fresh token per session makes each one a distinct collaborator,
		// which is what two people in two browsers actually look like.
		tokenStore: options.tokenStore ?? memoryTokenStore(),
		profile: { name: options.name, color: "#f97316" },
		asAgent: options.asAgent,
		inviteToken: options.inviteToken,
	});
	opened.push(session);
	return session;
}

function waitForAccess(session: CollabSession, canWrite: boolean): Promise<void> {
	if (session.canWrite === canWrite) {
		return Promise.resolve();
	}
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			stop();
			reject(new Error(`timed out waiting for canWrite=${canWrite}`));
		}, 3000);
		const stop = session.onWriteAccess((next) => {
			if (next !== canWrite) {
				return;
			}
			clearTimeout(timeout);
			stop();
			resolve();
		});
	});
}

function waitForCollaborator(
	session: CollabSession,
	predicate: (collaborator: Collaborator) => boolean,
): Promise<Collaborator> {
	return new Promise((resolve, reject) => {
		const existing = session.collaborators().find(predicate);
		if (existing) {
			resolve(existing);
			return;
		}
		const timeout = setTimeout(() => {
			stop();
			reject(new Error("timed out waiting for a collaborator"));
		}, 3000);
		const stop = session.onCollaborators((collaborators) => {
			const found = collaborators.find(predicate);
			if (!found) {
				return;
			}
			clearTimeout(timeout);
			stop();
			resolve(found);
		});
	});
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

	await editorA.startLiveSession();
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

	await editorA.startLiveSession();
	const editorB = await openSession({
		projectId,
		name: "Editor B",
		inviteToken: await editorA.ensureShareInvite(true),
	});
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

test("a view-only invite cannot change the timeline", async () => {
	const projectId = `test-view-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;

	const owner = await openSession({ projectId, name: "Owner" });
	await owner.createProject({
		name: "View Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});
	await owner.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId, name: "Locked" }),
	});

	await owner.startLiveSession();
	const viewer = await openSession({
		projectId,
		name: "Viewer",
		inviteToken: await owner.ensureShareInvite(false),
	});
	await waitForSnapshot(
		viewer,
		(snapshot) => snapshot.clips.length === 1,
		"the viewer to see the clip",
	);

	expect(viewer.role).toBe("viewer");
	expect(viewer.canWrite).toBe(false);

	const before = owner.snapshot().revision;
	await viewer.dispatch({
		kind: "moveClip",
		clipId: clipA,
		targetTrackId: trackId,
		startTime: seconds(3),
	});
	expect(owner.snapshot().revision).toBe(before);
	expect(clipOf(owner.snapshot(), clipA)?.startTime).toBe(0);

	const editor = await openSession({
		projectId,
		name: "Editor",
		inviteToken: await owner.ensureShareInvite(true),
	});
	expect(editor.canWrite).toBe(true);
	expect(editor.role).toBe("editor");
});

test("a view link stays view-only for the project owner", async () => {
	const projectId = `test-owner-view-${crypto.randomUUID()}`;
	const trackId = `${projectId}-main`;
	const clipA = `${projectId}-clip-a`;
	const identity = memoryTokenStore();

	const owner = await openSession({
		projectId,
		name: "Owner",
		tokenStore: identity,
	});
	await owner.createProject({
		name: "Owner View Test",
		sceneId: `${projectId}-scene`,
		mainTrackId: trackId,
		metadata: null,
	});
	await owner.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipA, trackId, name: "Locked" }),
	});

	const viewing = await openSession({
		projectId,
		name: "Owner",
		tokenStore: identity,
		inviteToken: await owner.ensureShareInvite(false),
	});
	await waitForSnapshot(
		viewing,
		(snapshot) => snapshot.clips.length === 1,
		"the view link to see the clip",
	);

	expect(viewing.role).toBe("owner");
	expect(viewing.canWrite).toBe(false);

	const before = owner.snapshot().revision;
	await viewing.dispatch({
		kind: "moveClip",
		clipId: clipA,
		targetTrackId: trackId,
		startTime: seconds(3),
	});
	expect(owner.snapshot().revision).toBe(before);
	expect(clipOf(owner.snapshot(), clipA)?.startTime).toBe(0);

	const editing = await openSession({
		projectId,
		name: "Owner",
		tokenStore: identity,
		inviteToken: await owner.ensureShareInvite(true),
	});
	expect(editing.canWrite).toBe(true);
	await editing.dispatch({
		kind: "moveClip",
		clipId: clipA,
		targetTrackId: trackId,
		startTime: seconds(2),
	});
	await waitForSnapshot(
		owner,
		(snapshot) => clipOf(snapshot, clipA)?.startTime === seconds(2),
		"the edit link to move the clip",
	);
});

test("two windows of one browser are one participant", async () => {
	const projectId = `test-names-${crypto.randomUUID()}`;
	const identity = memoryTokenStore();

	const ada = await openSession({
		projectId,
		name: "Ada",
		tokenStore: identity,
	});
	await ada.createProject({
		name: "Names",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	ada.publishPresence({
		sceneId: `${projectId}-scene`,
		playhead: 0,
		selection: [],
		isPlaying: false,
		cursor: { x: 0.2, y: 0.2 },
	});

	const kai = await openSession({
		projectId,
		name: "Kai",
		tokenStore: identity,
		inviteToken: await ada.ensureShareInvite(false),
	});
	kai.publishPresence({
		sceneId: `${projectId}-scene`,
		playhead: 0,
		selection: [],
		isPlaying: false,
		cursor: { x: 0.8, y: 0.8 },
	});

	// Both windows share one saved identity, so they are one person. A second
	// browser is required to show up as someone else.
	await ada.startLiveSession();
	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: await ada.ensureShareInvite(false),
	});
	const shared = await waitForCollaborator(
		guest,
		(collaborator) => collaborator.identity === ada.identity,
	);
	const names = guest
		.collaborators()
		.filter((collaborator) => collaborator.identity === ada.identity);
	expect(names).toHaveLength(1);
	expect(shared.color).not.toBe(
		guest.collaborators().find((collaborator) => collaborator.isSelf)?.color,
	);
	expect(kai.identity).toBe(ada.identity);
});

test("an editor can switch a window between edit and view", async () => {
	const projectId = `test-access-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Owner" });
	await owner.createProject({
		name: "Access",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	const clipId = `${projectId}-clip`;
	const trackId = `${projectId}-main`;
	await owner.dispatch({
		kind: "addClip",
		clip: newClip({ id: clipId, trackId }),
	});

	await owner.startLiveSession();
	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: await owner.ensureShareInvite(true),
	});
	expect(guest.canWrite).toBe(true);
	const guestRow = await waitForCollaborator(
		owner,
		(collaborator) => collaborator.name === "Guest",
	);

	await expect(guest.setParticipantAccess(owner.connectionId, false)).rejects.toThrow(
		/only the host/,
	);

	await owner.setParticipantAccess(guest.connectionId, false);
	await waitForAccess(guest, false);
	expect(guest.canWrite).toBe(false);

	const before = owner.snapshot().revision;
	await guest.dispatch({
		kind: "moveClip",
		clipId,
		targetTrackId: trackId,
		startTime: seconds(3),
	});
	expect(owner.snapshot().revision).toBe(before);

	await owner.setParticipantAccess(guestRow.connectionId, true);
	await waitForAccess(guest, true);
	expect(guest.canWrite).toBe(true);
	await guest.dispatch({
		kind: "moveClip",
		clipId,
		targetTrackId: trackId,
		startTime: seconds(1),
	});
	await waitForSnapshot(
		owner,
		(snapshot) => clipOf(snapshot, clipId)?.startTime === seconds(1),
		"the restored editor to move the clip",
	);
});

test("a full session refuses another editor from the participant list", async () => {
	const projectId = `test-promote-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Owner" });
	await owner.createProject({
		name: "Promote",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await owner.startLiveSession();
	const writeToken = await owner.ensureShareInvite(true);
	for (const name of ["One", "Two", "Three"]) {
		const editor = await openSession({ projectId, name, inviteToken: writeToken });
		expect(editor.canWrite).toBe(true);
	}
	const viewer = await openSession({
		projectId,
		name: "Watcher",
		inviteToken: await owner.ensureShareInvite(false),
	});
	expect(viewer.canWrite).toBe(false);
	await expect(viewer.setParticipantAccess(owner.connectionId, false)).rejects.toThrow();

	const watcher = await waitForCollaborator(
		owner,
		(collaborator) => collaborator.name === "Watcher",
	);
	await expect(
		owner.setParticipantAccess(watcher.connectionId, true),
	).rejects.toThrow(/4 editors/);
	expect(viewer.canWrite).toBe(false);
});

test("a fifth editor joins as view-only", async () => {
	const projectId = `test-cap-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Owner" });
	await owner.createProject({
		name: "Cap",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await owner.startLiveSession();
	const writeToken = await owner.ensureShareInvite(true);

	const editors = [];
	for (const name of ["One", "Two", "Three"]) {
		const editor = await openSession({
			projectId,
			name,
			inviteToken: writeToken,
		});
		expect(editor.canWrite).toBe(true);
		expect(editor.atCapacity).toBe(false);
		editor.publishPresence({
			sceneId: `${projectId}-scene`,
			playhead: 0,
			selection: [],
			isPlaying: false,
			cursor: { x: 0.3, y: 0.3 },
		});
		editors.push(editor);
	}

	const colors = new Set<string>();
	for (const name of ["One", "Two", "Three"]) {
		const person = await waitForCollaborator(
			owner,
			(collaborator) => collaborator.name === name,
		);
		colors.add(person.color);
	}
	expect(colors.size).toBe(3);

	const blocked = await openSession({
		projectId,
		name: "Four",
		inviteToken: writeToken,
	});
	expect(blocked.canWrite).toBe(false);
	expect(blocked.atCapacity).toBe(true);

	editors[0]?.close();
	await new Promise((resolve) => setTimeout(resolve, 150));

	const next = await openSession({
		projectId,
		name: "Five",
		inviteToken: writeToken,
	});
	expect(next.canWrite).toBe(true);
	expect(next.atCapacity).toBe(false);
});

test("the host starts a session, removes a guest, and can stop it", async () => {
	const projectId = `test-live-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Host" });
	await owner.createProject({
		name: "Live",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	const token = await owner.ensureShareInvite(true);
	await expect(
		openSession({ projectId, name: "Early", inviteToken: token }),
	).rejects.toThrow(/has not started/);

	await owner.startLiveSession();
	expect(owner.sessionLive).toBe(true);
	expect(owner.isHost).toBe(true);
	expect(owner.collaborators().find((person) => person.isSelf)?.role).toBe("owner");

	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: token,
	});
	expect(guest.isHost).toBe(false);
	await waitForCollaborator(owner, (person) => person.name === "Guest");
	await expect(guest.startLiveSession()).rejects.toThrow(/only the host/);

	await owner.removeParticipant(guest.identity);
	await waitForAccess(guest, false);
	expect(owner.collaborators().some((person) => person.name === "Guest")).toBe(false);

	const rejoined = await openSession({
		projectId,
		name: "Guest",
		inviteToken: token,
	});
	await waitForCollaborator(owner, (person) => person.identity === rejoined.identity);

	await owner.stopLiveSession();
	expect(owner.sessionLive).toBe(false);
	expect(owner.canWrite).toBe(true);
	expect(owner.collaborators().some((person) => person.identity === rejoined.identity)).toBe(
		false,
	);
	await expect(
		openSession({ projectId, name: "Late", inviteToken: token }),
	).rejects.toThrow(/has not started/);
});

test("a guest can leave a live session", async () => {
	const projectId = `test-leave-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Host" });
	await owner.createProject({
		name: "Leave",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await owner.startLiveSession();
	const token = await owner.ensureShareInvite(true);
	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: token,
	});
	await waitForCollaborator(owner, (person) => person.name === "Guest");
	await expect(owner.leaveSession()).rejects.toThrow(/stops a session/);

	const left = new Promise<string>((resolve) => {
		guest.onDeparture(resolve);
	});
	await guest.leaveSession();
	expect(await left).toBe("left");
	expect(guest.canWrite).toBe(false);
	await new Promise<void>((resolve, reject) => {
		if (!owner.collaborators().some((person) => person.name === "Guest")) {
			resolve();
			return;
		}
		const timeout = setTimeout(() => {
			stop();
			reject(new Error("the guest was still listed after leaving"));
		}, 3000);
		const stop = owner.onCollaborators((people) => {
			if (people.some((person) => person.name === "Guest")) {
				return;
			}
			clearTimeout(timeout);
			stop();
			resolve();
		});
	});
	expect(owner.canWrite).toBe(true);
	expect(owner.sessionLive).toBe(true);
});

test("video and audio bytes reach the other editor", async () => {
	const projectId = `test-media-${crypto.randomUUID()}`;
	const owner = await openSession({ projectId, name: "Host" });
	await owner.createProject({
		name: "Media",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await owner.startLiveSession();
	const token = await owner.ensureShareInvite(true);
	const assetId = `${projectId}-tone`;
	const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);

	await owner.dispatch({
		kind: "registerAsset",
		asset: {
			id: assetId,
			name: "tone.wav",
			storage: "spacetime",
			location: "chunks",
			mimeType: "audio/wav",
			byteSize: payload.byteLength,
			width: null,
			height: null,
			duration: null,
		},
	});
	await owner.putAssetChunk({
		assetId,
		chunkIndex: 0,
		chunkCount: 2,
		bytes: payload.slice(0, 4),
	});

	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: token,
	});
	expect(guest.assetChunks(assetId)).toHaveLength(1);

	await owner.putAssetChunk({
		assetId,
		chunkIndex: 1,
		chunkCount: 2,
		bytes: payload.slice(4),
	});
	await new Promise<void>((resolve, reject) => {
		if (assembleMediaChunks(guest.assetChunks(assetId))?.byteLength === payload.byteLength) {
			resolve();
			return;
		}
		const timeout = setTimeout(() => {
			stop();
			reject(new Error("the shared file did not arrive"));
		}, 3000);
		const stop = guest.onAssetChunks(() => {
			const file = assembleMediaChunks(guest.assetChunks(assetId));
			if (file?.byteLength !== payload.byteLength) {
				return;
			}
			clearTimeout(timeout);
			stop();
			resolve();
		});
	});

	expect(Array.from(assembleMediaChunks(guest.assetChunks(assetId)) ?? [])).toEqual(
		Array.from(payload),
	);
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

test("shared chat reaches a viewer, permits viewer replies, and preserves timeline revision", async () => {
	const projectId = `test-chat-${crypto.randomUUID()}`;
	const host = await openSession({ projectId, name: "Chat Host" });
	await host.createProject({
		name: "Chat",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await expect(host.sendChatMessage("before session")).rejects.toThrow();
	await host.startLiveSession();
	const inviteToken = await host.ensureShareInvite(false);
	const viewer = await openSession({
		projectId,
		name: "Chat Viewer",
		inviteToken,
	});
	const messageCounts: number[] = [];
	const stopChat = viewer.onChatMessages((messages) => messageCounts.push(messages.length));
	expect(messageCounts).toEqual([0]);
	const revision = host.snapshot().revision;
	await host.sendChatMessage("  Hello team  ");
	await waitUntil(() => viewer.chatMessages().length === 1);
	expect(viewer.chatMessages()[0]?.text).toBe("Hello team");
	expect(viewer.chatMessages()[0]?.author).toBe(host.identity);
	expect(viewer.chatMessages()[0]?.authorName).toBe("Chat Host");
	await viewer.sendChatMessage("Hello back");
	await waitUntil(() => host.chatMessages().length === 2);
	expect(host.chatMessages()[1]?.authorName).toBe("Chat Viewer");
	expect(host.snapshot().revision).toBe(revision);
	expect(messageCounts).toContain(1);
	stopChat();
	await expect(viewer.sendChatMessage(" ")).rejects.toThrow();
	await expect(viewer.sendChatMessage("x".repeat(2001))).rejects.toThrow();
	await host.removeParticipant(viewer.identity);
	await expect(viewer.sendChatMessage("removed guest")).rejects.toThrow();
	await host.stopLiveSession();
	await expect(host.sendChatMessage("ended session")).rejects.toThrow();
});

test("chat retains only the last 200 messages, restores history on join, and scopes projects", async () => {
	const projectId = `test-chat-history-${crypto.randomUUID()}`;
	const host = await openSession({ projectId, name: "Host" });
	await host.createProject({
		name: "Chat",
		sceneId: `${projectId}-scene`,
		mainTrackId: `${projectId}-main`,
		metadata: null,
	});
	await host.startLiveSession();
	for (let i = 0; i < 202; i++) await host.sendChatMessage(`Message ${i}`);
	await waitUntil(() => host.chatMessages().at(-1)?.text === "Message 201");
	expect(host.chatMessages()).toHaveLength(200);
	expect(host.chatMessages()[0]?.text).toBe("Message 2");
	const guest = await openSession({
		projectId,
		name: "Guest",
		inviteToken: await host.ensureShareInvite(false),
	});
	expect(guest.chatMessages()).toHaveLength(200);
	const stranger = await openSession({
		projectId: `other-${crypto.randomUUID()}`,
		name: "Other",
	});
	expect(stranger.chatMessages()).toHaveLength(0);
	await expect(stranger.sendChatMessage("not joined")).rejects.toThrow();
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 3000;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Timed out waiting for chat");
		await Bun.sleep(10);
	}
}
