/**
 * Attaches a collaboration session to the editor.
 *
 * Outbound: the editor replaces its scene tracks through one method, so the
 * bridge wraps that method, diffs the scene, and sends the resulting commands.
 * Every mutation path goes through it — commands, preview commits, ripple
 * adjustments, undo, and redo — so none of them need to know about the bridge.
 *
 * Inbound: shared snapshots are written back with the same method, wrapped in
 * `applyRemote` so the write is not mistaken for a local edit.
 */

import type {
	CollabAsset,
	CollabMetadata,
	CollabSession,
	ProjectSnapshot,
} from "@opencut/collab-client";

import type { EditorCore } from "@/core";
import { playableMimeType } from "@/media/media-utils";
import type { MediaAsset } from "@/media/types";
import type { TProject } from "@/project/types";
import type { SceneTracks } from "@/timeline";
import { mediaTimeFromSeconds } from "@/wasm";

import { diffProjects } from "./diff";
import { flattenScene } from "./flatten";
import { rebuildScene } from "./rebuild";
import { uploadSharedMedia, watchSharedMedia } from "./shared-media";

export interface BridgeOptions {
	editor: EditorCore;
	session: CollabSession;
	onError?: (error: Error) => void;
}

export class CollaborationBridge {
	#editor: EditorCore;
	#session: CollabSession;
	#onError: (error: Error) => void;
	#teardown: Array<() => void> = [];
	#detached = false;

	private constructor(options: BridgeOptions) {
		this.#editor = options.editor;
		this.#session = options.session;
		this.#onError = options.onError ?? (() => {});
	}

	/**
	 * Starts mirroring. Creates the shared project when it does not exist yet,
	 * otherwise adopts the shared state as the truth for this editor.
	 */
	static async attach(options: BridgeOptions): Promise<CollaborationBridge> {
		const bridge = new CollaborationBridge(options);
		const { editor, session } = options;

		if (session.isProjectLoaded) {
			bridge.#applySnapshot(session.snapshot());
		} else {
			await bridge.#publishLocalProject();
		}

		bridge.#interceptSceneWrites();
		bridge.#followSharedState();
		bridge.#followSharedMedia();
		if (session.canWrite) {
			bridge.#followLocalSettings();
			bridge.#followLocalMedia();
			void bridge.#publishAssets();
		}

		return bridge;
	}

	detach(): void {
		if (this.#detached) {
			return;
		}
		this.#detached = true;
		for (const teardown of this.#teardown.reverse()) {
			teardown();
		}
		this.#teardown = [];
	}

	/**
	 * Wraps the editor's scene-write method.
	 *
	 * This is the one place all timeline state lands, which makes it the only
	 * interception point the bridge needs. Live drag previews deliberately do
	 * not pass through it, so dragging a clip publishes once on release rather
	 * than on every pointer move.
	 */
	#interceptSceneWrites(): void {
		const timeline = this.#editor.timeline;
		const original = timeline.updateTracks.bind(timeline);

		const originalCommit = timeline.commitPreview.bind(timeline);
		timeline.commitPreview = (): void => {
			if (!this.#session.canWrite) {
				timeline.discardPreview();
				return;
			}
			originalCommit();
		};
		this.#teardown.push(() => {
			timeline.commitPreview = originalCommit;
		});

		timeline.updateTracks = (next: SceneTracks): void => {
			if (
				!this.#session.canWrite &&
				!this.#session.isApplyingRemote
			) {
				return;
			}
			const before = this.#editor.scenes.getActiveSceneOrNull()?.tracks ?? null;
			original(next);

			if (this.#detached || this.#session.isApplyingRemote || !before) {
				return;
			}
			void this.#publishSceneChange({ before, after: next });
		};

		this.#teardown.push(() => {
			timeline.updateTracks = original;
		});
	}

	async #publishSceneChange({
		before,
		after,
	}: {
		before: SceneTracks;
		after: SceneTracks;
	}): Promise<void> {
		const sceneId = this.#editor.scenes.getActiveSceneOrNull()?.id;
		if (!sceneId) {
			return;
		}

		const commands = diffProjects({
			before: flattenScene({ tracks: before, sceneId }),
			after: flattenScene({ tracks: after, sceneId }),
		});

		for (const command of commands) {
			try {
				await this.#session.dispatch(command);
			} catch (error) {
				// One rejected command must not abandon the rest of the batch; the
				// server is canonical, and the next snapshot corrects this editor.
				this.#onError(asError(error));
			}
		}
	}

	#followSharedState(): void {
		this.#teardown.push(
			this.#session.onSnapshot(({ snapshot, hasRemoteChanges }) => {
				if (!hasRemoteChanges || this.#detached) {
					return;
				}
				this.#applySnapshot(snapshot);
			}),
		);
	}

	#applySnapshot(snapshot: ProjectSnapshot): void {
		const sceneId = this.#editor.scenes.getActiveSceneOrNull()?.id;
		if (!sceneId) {
			return;
		}
		const tracks = rebuildScene({ snapshot, sceneId });
		this.#session.applyRemote(() => {
			this.#editor.timeline.updateTracks(tracks);
		});
	}

	#followLocalSettings(): void {
		let published = this.#currentMetadata();

		this.#teardown.push(
			this.#editor.project.subscribe(() => {
				if (
					this.#detached ||
					this.#session.isApplyingRemote ||
					!this.#session.canWrite
				) {
					return;
				}
				const next = this.#currentMetadata();
				if (!next || sameJson(published, next)) {
					return;
				}
				published = next;
				void this.#session
					.dispatch({ kind: "setMetadata", metadata: next })
					.catch((error: unknown) => this.#onError(asError(error)));
			}),
		);
	}

	#followLocalMedia(): void {
		let publishedIds = new Set<string>();

		this.#teardown.push(
			this.#editor.media.subscribe(() => {
				if (
					this.#detached ||
					this.#session.isApplyingRemote ||
					!this.#session.canWrite
				) {
					return;
				}
				const assets = this.#editor.media.getAssets();
				const ids = new Set(assets.map((asset) => asset.id));
				if (sameSet(publishedIds, ids)) {
					return;
				}
				publishedIds = ids;
				void this.#publishAssets();
			}),
		);
	}

	/** Saves video and audio that other editors have uploaded into this session. */
	#followSharedMedia(): void {
		const projectId = this.#editor.project.getActiveOrNull()?.metadata.id;
		if (!projectId) {
			return;
		}
		this.#teardown.push(
			watchSharedMedia({
				editor: this.#editor,
				session: this.#session,
				projectId,
			}),
		);
	}

	/**
	 * Registers each asset, then uploads video and audio bytes into the session.
	 */
	async #publishAssets(): Promise<void> {
		const assets = this.#editor.media.getAssets();
		for (const asset of assets) {
			try {
				await this.#session.dispatch({
					kind: "registerAsset",
					asset: toCollabAsset(asset),
				});
			} catch (error) {
				this.#onError(asError(error));
			}
		}
		try {
			await uploadSharedMedia(this.#session, assets);
		} catch (error) {
			this.#onError(asError(error));
		}
	}

	/** Publishes this editor's local project as the shared one. */
	async #publishLocalProject(): Promise<void> {
		const project = this.#editor.project.getActiveOrNull();
		const scene = this.#editor.scenes.getActiveSceneOrNull();
		if (!project || !scene) {
			throw new Error("cannot share a project before it has loaded");
		}

		await this.#session.createProject({
			name: project.metadata.name,
			sceneId: scene.id,
			mainTrackId: scene.tracks.main.id,
			metadata: this.#currentMetadata(),
		});

		// The shared project starts with only its main track, so the rest of the
		// local scene is published as a diff against that.
		const empty = flattenScene({
			tracks: { overlay: [], main: scene.tracks.main, audio: [] },
			sceneId: scene.id,
		});
		const local = flattenScene({ tracks: scene.tracks, sceneId: scene.id });
		for (const command of diffProjects({ before: empty, after: local })) {
			try {
				await this.#session.dispatch(command);
			} catch (error) {
				this.#onError(asError(error));
			}
		}
	}

	#currentMetadata(): CollabMetadata | null {
		const project = this.#editor.project.getActiveOrNull();
		return project ? toCollabMetadata(project) : null;
	}
}

function toCollabMetadata(project: TProject): CollabMetadata {
	const { settings } = project;
	return {
		canvasWidth: settings.canvasSize.width,
		canvasHeight: settings.canvasSize.height,
		fpsNumerator: settings.fps.numerator,
		fpsDenominator: settings.fps.denominator,
		background:
			settings.background.type === "color"
				? settings.background.color
				: `blur:${settings.background.blurIntensity}`,
		extra: {
			canvasSizeMode: settings.canvasSizeMode,
			backgroundType: settings.background.type,
		},
	};
}

function toCollabAsset(asset: MediaAsset): CollabAsset {
	return {
		id: asset.id,
		name: asset.name,
		storage: asset.type === "video" || asset.type === "audio" ? "spacetime" : "local",
		// Video and audio bytes are uploaded as chunks. Anything else stays a
		// local id, which only this browser can resolve.
		location: asset.type === "video" || asset.type === "audio" ? "chunks" : asset.id,
		mimeType: playableMimeType({
			name: asset.name,
			mimeType: asset.file?.type ?? "",
		}),
		byteSize: asset.file?.size ?? null,
		width: asset.width ?? null,
		height: asset.height ?? null,
		// Assets carry seconds; the shared schema stores `MediaTime` ticks.
		duration:
			asset.duration == null
				? null
				: mediaTimeFromSeconds({ seconds: asset.duration }),
	};
}

function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) {
		return false;
	}
	for (const value of a) {
		if (!b.has(value)) {
			return false;
		}
	}
	return true;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
