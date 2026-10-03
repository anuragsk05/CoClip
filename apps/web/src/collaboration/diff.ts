/**
 * Derives editor commands from a scene mutation.
 *
 * The editor funnels every timeline change through one call that replaces the
 * whole scene, so the bridge compares the scene before and after rather than
 * inspecting command objects. That keeps the bridge working for commands it has
 * never heard of — including undo, redo, and ripple adjustments — and it does
 * not depend on any command's internals.
 *
 * Where a change is recognisable as a specific intent, the matching reducer is
 * used: a clip whose only difference is its start time becomes `moveClip`, not
 * a wholesale overwrite.
 */

import type { EditorCommand } from "@opencut/collab-client";
import type {
	CollabClip,
	CollabEffect,
	CollabTrack,
} from "@opencut/collab-client";

import type { FlatProject } from "./flatten";

export function diffProjects({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	// Ordered so that every command's dependencies already exist when it runs:
	// a clip needs its track, and a track can only be dropped once nothing on
	// it is still referenced.
	return [
		...addedTracks({ before, after }),
		...addedClips({ before, after }),
		...changedClips({ before, after }),
		...effectCommands({ before, after }),
		...removedClips({ before, after }),
		...changedTracks({ before, after }),
		...removedTracks({ before, after }),
	];
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
	return new Map(items.map((item) => [item.id, item]));
}

function addedTracks({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const existing = byId(before.tracks);
	return after.tracks
		.filter((track) => !existing.has(track.id))
		.map((track) => ({
			kind: "addTrack" as const,
			trackId: track.id,
			sceneId: track.sceneId,
			group: track.group,
			trackKind: track.kind,
			name: track.name,
			position: track.position,
		}));
}

function removedTracks({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const surviving = byId(after.tracks);
	return before.tracks
		.filter((track) => !surviving.has(track.id))
		// The main track is permanent; the editor never removes it, and the
		// reducer would reject the attempt.
		.filter((track) => track.group !== "main")
		.map((track) => ({ kind: "deleteTrack" as const, trackId: track.id }));
}

function changedTracks({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const previous = byId(before.tracks);
	const commands: EditorCommand[] = [];

	for (const track of after.tracks) {
		const was = previous.get(track.id);
		if (!was) {
			continue;
		}
		if (was.position !== track.position) {
			commands.push({
				kind: "reorderTrack",
				trackId: track.id,
				position: track.position,
			});
		}
		if (was.muted !== track.muted) {
			commands.push({
				kind: "setTrackMuted",
				trackId: track.id,
				muted: track.muted,
			});
		}
		if (was.hidden !== track.hidden) {
			commands.push({
				kind: "setTrackHidden",
				trackId: track.id,
				hidden: track.hidden,
			});
		}
	}

	return commands;
}

function addedClips({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const existing = byId(before.clips);
	return after.clips
		.filter((clip) => !existing.has(clip.id))
		.map((clip) => ({ kind: "addClip" as const, clip: stripRevision(clip) }));
}

function removedClips({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const surviving = byId(after.clips);
	return before.clips
		.filter((clip) => !surviving.has(clip.id))
		.map((clip) => ({ kind: "deleteClip" as const, clipId: clip.id }));
}

function changedClips({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const previous = byId(before.clips);
	const commands: EditorCommand[] = [];

	for (const clip of after.clips) {
		const was = previous.get(clip.id);
		if (!was) {
			continue;
		}

		const relocated = was.trackId !== clip.trackId;
		const restarted = was.startTime !== clip.startTime;
		const retrimmed =
			was.trimStart !== clip.trimStart ||
			was.trimEnd !== clip.trimEnd ||
			was.duration !== clip.duration;

		if (relocated || restarted) {
			commands.push({
				kind: "moveClip",
				clipId: clip.id,
				targetTrackId: clip.trackId,
				startTime: clip.startTime,
			});
		}
		if (retrimmed) {
			commands.push({
				kind: "trimClip",
				clipId: clip.id,
				trimStart: clip.trimStart,
				trimEnd: clip.trimEnd,
				startTime: clip.startTime,
				duration: clip.duration,
			});
		}
		if (was.volumeDb !== clip.volumeDb) {
			commands.push({
				kind: "setVolume",
				clipId: clip.id,
				volumeDb: clip.volumeDb,
			});
		}
		if (was.muted !== clip.muted) {
			commands.push({
				kind: "setClipMuted",
				clipId: clip.id,
				muted: clip.muted,
			});
		}
		if (was.hidden !== clip.hidden) {
			commands.push({
				kind: "setClipHidden",
				clipId: clip.id,
				hidden: clip.hidden,
			});
		}
		if (
			was.name !== clip.name ||
			was.rate !== clip.rate ||
			!sameJson(was.data, clip.data)
		) {
			commands.push({
				kind: "updateClipData",
				clipId: clip.id,
				name: clip.name,
				rate: clip.rate,
				data: clip.data,
			});
		}
	}

	return commands;
}

function effectCommands({
	before,
	after,
}: {
	before: FlatProject;
	after: FlatProject;
}): EditorCommand[] {
	const previous = byId(before.effects);
	const surviving = byId(after.effects);
	const commands: EditorCommand[] = [];
	const liveClips = new Set(after.clips.map((clip) => clip.id));

	for (const effect of after.effects) {
		const was = previous.get(effect.id);
		if (!was) {
			commands.push({
				kind: "addEffect",
				clipId: effect.clipId,
				effectId: effect.id,
				effectType: effect.effectType,
				params: effect.params,
			});
			continue;
		}
		if (was.enabled !== effect.enabled) {
			commands.push({
				kind: "toggleEffect",
				effectId: effect.id,
				enabled: effect.enabled,
			});
		}
		if (!sameJson(was.params, effect.params)) {
			commands.push({
				kind: "updateEffectParams",
				effectId: effect.id,
				params: effect.params,
			});
		}
		if (was.position !== effect.position) {
			commands.push({
				kind: "reorderEffect",
				effectId: effect.id,
				toIndex: effect.position,
			});
		}
	}

	for (const effect of before.effects) {
		// Effects on a deleted clip are removed by the cascade, so asking for
		// them individually would fail on a clip that no longer exists.
		if (surviving.has(effect.id) || !liveClips.has(effect.clipId)) {
			continue;
		}
		commands.push({ kind: "removeEffect", effectId: effect.id });
	}

	return commands;
}

function stripRevision(clip: CollabClip) {
	const { revision: _revision, ...rest } = clip;
	return rest;
}

function sameJson(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export type { CollabClip, CollabEffect, CollabTrack };
