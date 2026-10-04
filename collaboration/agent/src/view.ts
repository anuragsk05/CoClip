/**
 * The project as the agent reads it.
 *
 * A {@link ProjectSnapshot} is shaped for an editor: flat rows, tick counts,
 * opaque `data` blobs. A model needs the opposite — nesting that shows what is
 * next to what, seconds instead of ticks, and nothing it cannot act on. This
 * module is read-only; every mutation goes through a tool.
 */

import type {
	CollabAsset,
	ProjectSnapshot,
	TrackGroup,
} from "@opencut/collab-client";
import { secondsFromTicks } from "@opencut/collab-client";

export interface ClipView {
	id: string;
	name: string;
	kind: string;
	/** Seconds on the timeline. */
	start: number;
	end: number;
	duration: number;
	/** Seconds into the source media that this clip begins at. */
	sourceOffset: number;
	trimEnd: number;
	sourceDuration: number | null;
	mediaId: string | null;
	rate: number;
	volumeDb: number;
	muted: boolean;
	hidden: boolean;
	effects: {
		id: string;
		type: string;
		enabled: boolean;
		params: Record<string, unknown>;
	}[];
}

export interface TrackView {
	id: string;
	name: string;
	group: TrackGroup;
	kind: string;
	muted: boolean;
	hidden: boolean;
	clips: ClipView[];
}

export interface AssetView {
	id: string;
	name: string;
	mimeType: string;
	duration: number | null;
}

export interface ProjectView {
	projectId: string;
	name: string;
	revision: number;
	/** Seconds from zero to the end of the last clip. */
	duration: number;
	canvas: { width: number; height: number; fps: number } | null;
	tracks: TrackView[];
	assets: AssetView[];
}

const GROUP_ORDER: TrackGroup[] = ["overlay", "main", "audio"];

export function toProjectView({
	snapshot,
	sceneId,
}: {
	snapshot: ProjectSnapshot;
	sceneId?: string;
}): ProjectView {
	const scene =
		sceneId ?? snapshot.scenes.find((candidate) => candidate.isMain)?.id;

	const effectsByClip = new Map<string, ProjectSnapshot["effects"]>();
	for (const effect of snapshot.effects) {
		const existing = effectsByClip.get(effect.clipId);
		if (existing) {
			existing.push(effect);
		} else {
			effectsByClip.set(effect.clipId, [effect]);
		}
	}

	const tracks = snapshot.tracks
		.filter((track) => scene === undefined || track.sceneId === scene)
		.sort(
			(a, b) =>
				GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) ||
				a.position - b.position,
		)
		.map((track): TrackView => {
			const clips = snapshot.clips
				.filter((clip) => clip.trackId === track.id)
				.sort((a, b) => a.startTime - b.startTime)
				.map((clip): ClipView => {
					const start = secondsFromTicks(clip.startTime);
					const duration = secondsFromTicks(clip.duration);
					return {
						id: clip.id,
						name: clip.name,
						kind: clip.kind,
						start,
						end: start + duration,
						duration,
						sourceOffset: secondsFromTicks(clip.trimStart),
						trimEnd: secondsFromTicks(clip.trimEnd),
						sourceDuration:
							clip.sourceDuration === null
								? null
								: secondsFromTicks(clip.sourceDuration),
						mediaId: clip.mediaId,
						rate: clip.rate,
						volumeDb: clip.volumeDb,
						muted: clip.muted,
						hidden: clip.hidden,
						effects: (effectsByClip.get(clip.id) ?? [])
							.sort((a, b) => a.position - b.position)
							.map((effect) => ({
								id: effect.id,
								type: effect.effectType,
								enabled: effect.enabled,
								params: effect.params,
							})),
					};
				});

			return {
				id: track.id,
				name: track.name,
				group: track.group,
				kind: track.kind,
				muted: track.muted,
				hidden: track.hidden,
				clips,
			};
		});

	const duration = tracks.reduce(
		(longest, track) =>
			track.clips.reduce((end, clip) => Math.max(end, clip.end), longest),
		0,
	);

	const metadata = snapshot.metadata;

	return {
		projectId: snapshot.projectId,
		name: snapshot.name,
		revision: snapshot.revision,
		duration,
		canvas: metadata
			? {
					width: metadata.canvasWidth,
					height: metadata.canvasHeight,
					fps: metadata.fpsNumerator / metadata.fpsDenominator,
				}
			: null,
		tracks,
		assets: snapshot.assets.map(toAssetView),
	};
}

function toAssetView(asset: CollabAsset): AssetView {
	return {
		id: asset.id,
		name: asset.name,
		mimeType: asset.mimeType,
		duration: asset.duration === null ? null : secondsFromTicks(asset.duration),
	};
}

/**
 * Renders the project as text for a prompt.
 *
 * Models follow a timeline far better as lines of text than as nested JSON, and
 * it costs a fraction of the tokens.
 */
export function describeProject(view: ProjectView): string {
	const lines: string[] = [
		`Project "${view.name}" (${view.projectId}) at revision ${view.revision}`,
		`Duration: ${format(view.duration)}`,
	];

	if (view.canvas) {
		lines.push(
			`Canvas: ${view.canvas.width}x${view.canvas.height} @ ${view.canvas.fps}fps`,
		);
	}

	for (const track of view.tracks) {
		const flags = [track.muted && "muted", track.hidden && "hidden"].filter(
			Boolean,
		);
		lines.push(
			"",
			`Track ${track.id} — ${track.name} [${track.group}/${track.kind}]${
				flags.length > 0 ? ` (${flags.join(", ")})` : ""
			}`,
		);

		if (track.clips.length === 0) {
			lines.push("  (empty)");
			continue;
		}

		for (const clip of track.clips) {
			const notes = [
				`trimStart=${clip.sourceOffset}s, trimEnd=${clip.trimEnd}s, sourceDuration=${clip.sourceDuration === null ? "unknown" : `${clip.sourceDuration}s`}`,
				clip.rate !== 1 && `${clip.rate}x`,
				clip.volumeDb !== 0 && `${clip.volumeDb}dB`,
				clip.muted && "muted",
				clip.hidden && "hidden",
				clip.effects.length > 0 &&
					`effects: ${clip.effects.map((effect) => `${effect.id}:${effect.type} ${effect.enabled ? "enabled" : "disabled"} params=${JSON.stringify(effect.params)}`).join(", ")}`,
			].filter(Boolean);

			lines.push(
				`  ${clip.id} — "${clip.name}" [${clip.kind}] ` +
					`${format(clip.start)}–${format(clip.end)}` +
					(notes.length > 0 ? ` (${notes.join(", ")})` : ""),
			);
		}
	}

	if (view.assets.length > 0) {
		lines.push("", "Assets:");
		for (const asset of view.assets) {
			lines.push(
				`  ${asset.id} — "${asset.name}" (${asset.mimeType}` +
					`${asset.duration === null ? "" : `, ${format(asset.duration)}`})`,
			);
		}
	}

	return lines.join("\n");
}

function format(seconds: number): string {
	return `${seconds.toFixed(2)}s`;
}
