/**
 * The collaboration adapter.
 *
 * One `CollabSession` is one editor attached to one shared project. It is the
 * only path between an editor and SpacetimeDB: editor commands go in through
 * {@link CollabSession.dispatch}, and shared state comes back out through
 * {@link CollabSession.onSnapshot}.
 */

import { connect, type ConnectOptions } from "./connection";
import {
	assetStorageToRow,
	clipKindToRow,
	fromTicks,
	projectRevision,
	retainSideToRow,
	stringifyJson,
	toAsset,
	toClip,
	toCollaborator,
	toEffect,
	toMetadata,
	toRemoteEdit,
	toScene,
	toTrack,
	trackGroupToRow,
	trackKindToRow,
} from "./mapping";
import type { DbConnection } from "./module_bindings";
import type {
	Collaborator,
	EditorCommand,
	PresenceUpdate,
	ProjectSnapshot,
	RemoteEdit,
} from "./types";

export interface SessionOptions extends ConnectOptions {
	projectId: string;
	/** Display name and colour published with this session's presence. */
	profile?: { name: string; color: string };
	/** Marks this session as an AI agent in presence and edit history. */
	asAgent?: boolean;
}

export interface SnapshotChange {
	snapshot: ProjectSnapshot;
	/** True when at least one change in this batch came from another connection. */
	hasRemoteChanges: boolean;
}

type Listener<T> = (value: T) => void;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export class CollabSession {
	readonly projectId: string;

	#connection: DbConnection;
	#snapshotListeners = new Set<Listener<SnapshotChange>>();
	#editListeners = new Set<Listener<RemoteEdit>>();
	#collaboratorListeners = new Set<Listener<Collaborator[]>>();

	/** Set while remote state is being written into the editor. */
	#applyingRemote = false;
	/** Coalesces a burst of row callbacks into one snapshot emission. */
	#emitScheduled = false;
	#pendingRemoteChange = false;
	/** Revision already present when this session subscribed. */
	#baselineRevision = 0;
	#closed = false;

	private constructor(connection: DbConnection, projectId: string) {
		this.#connection = connection;
		this.projectId = projectId;
	}

	static async open(options: SessionOptions): Promise<CollabSession> {
		if (!PROJECT_ID_PATTERN.test(options.projectId)) {
			throw new Error(`unusable project id \`${options.projectId}\``);
		}

		const connection = await connect(options);
		const session = new CollabSession(connection, options.projectId);

		if (options.asAgent) {
			await connection.reducers.declareAgent({
				name: options.profile?.name ?? "AI Agent",
			});
		} else if (options.profile) {
			await connection.reducers.setUserProfile(options.profile);
		}

		await session.#subscribe();
		await session.#joinWhenProjectExists();
		return session;
	}

	get identity(): string {
		return this.#connection.identity?.toHexString() ?? "";
	}

	get connectionId(): string {
		return this.#connection.connectionId.toHexString();
	}

	/** True once the project exists in the local cache. */
	get isProjectLoaded(): boolean {
		return this.#project() != null;
	}

	/**
	 * Sends an editor action to the shared project.
	 *
	 * Dropped while remote state is being applied: an edit that arrived from
	 * another editor must not be echoed back as a local one.
	 */
	async dispatch(command: EditorCommand): Promise<void> {
		if (this.#applyingRemote || this.#closed) {
			return;
		}
		const { reducers } = this.#connection;
		const projectId = this.projectId;

		switch (command.kind) {
			case "renameProject":
				return reducers.renameProject({ projectId, name: command.name });
			case "setMetadata":
				return reducers.setProjectMetadata({
					projectId,
					metadata: {
						canvasWidth: command.metadata.canvasWidth,
						canvasHeight: command.metadata.canvasHeight,
						fpsNumerator: command.metadata.fpsNumerator,
						fpsDenominator: command.metadata.fpsDenominator,
						background: command.metadata.background,
						extra: stringifyJson(command.metadata.extra),
					},
				});
			case "addScene":
				return reducers.addScene({
					projectId,
					sceneId: command.sceneId,
					name: command.name,
					position: command.position,
				});
			case "addTrack":
				return reducers.addTrack({
					projectId,
					trackId: command.trackId,
					sceneId: command.sceneId,
					group: trackGroupToRow(command.group),
					kind: trackKindToRow(command.trackKind),
					name: command.name,
					position: command.position,
				});
			case "reorderTrack":
				return reducers.reorderTrack({
					projectId,
					trackId: command.trackId,
					position: command.position,
				});
			case "setTrackMuted":
				return reducers.setTrackMuted({
					projectId,
					trackId: command.trackId,
					muted: command.muted,
				});
			case "setTrackHidden":
				return reducers.setTrackHidden({
					projectId,
					trackId: command.trackId,
					hidden: command.hidden,
				});
			case "deleteTrack":
				return reducers.deleteTrack({ projectId, trackId: command.trackId });
			case "addClip":
				return reducers.addClip({
					projectId,
					input: {
						id: command.clip.id,
						trackId: command.clip.trackId,
						kind: clipKindToRow(command.clip.kind),
						name: command.clip.name,
						startTime: fromTicks(command.clip.startTime),
						duration: fromTicks(command.clip.duration),
						trimStart: fromTicks(command.clip.trimStart),
						trimEnd: fromTicks(command.clip.trimEnd),
						sourceDuration:
							command.clip.sourceDuration === null
								? undefined
								: fromTicks(command.clip.sourceDuration),
						mediaId: command.clip.mediaId ?? undefined,
						rate: command.clip.rate,
						volumeDb: command.clip.volumeDb,
						muted: command.clip.muted,
						hidden: command.clip.hidden,
						data: stringifyJson(command.clip.data),
					},
				});
			case "moveClip":
				return reducers.moveClip({
					projectId,
					clipId: command.clipId,
					targetTrackId: command.targetTrackId,
					startTime: fromTicks(command.startTime),
				});
			case "trimClip":
				return reducers.trimClip({
					projectId,
					clipId: command.clipId,
					trimStart: fromTicks(command.trimStart),
					trimEnd: fromTicks(command.trimEnd),
					startTime:
						command.startTime === undefined
							? undefined
							: fromTicks(command.startTime),
					duration:
						command.duration === undefined
							? undefined
							: fromTicks(command.duration),
				});
			case "splitClip":
				return reducers.splitClip({
					projectId,
					clipId: command.clipId,
					splitTime: fromTicks(command.splitTime),
					retain: retainSideToRow(command.retain),
					rightClipId: command.rightClipId,
				});
			case "deleteClip":
				return reducers.deleteClip({ projectId, clipId: command.clipId });
			case "setVolume":
				return reducers.setVolume({
					projectId,
					clipId: command.clipId,
					volumeDb: command.volumeDb,
				});
			case "setClipMuted":
				return reducers.setClipMuted({
					projectId,
					clipId: command.clipId,
					muted: command.muted,
				});
			case "setClipHidden":
				return reducers.setClipHidden({
					projectId,
					clipId: command.clipId,
					hidden: command.hidden,
				});
			case "updateClipData":
				return reducers.updateClipData({
					projectId,
					clipId: command.clipId,
					name: command.name,
					rate: command.rate,
					data: stringifyJson(command.data),
				});
			case "addEffect":
				return reducers.addEffect({
					projectId,
					clipId: command.clipId,
					effectId: command.effectId,
					effectType: command.effectType,
					params: stringifyJson(command.params),
				});
			case "removeEffect":
				return reducers.removeEffect({
					projectId,
					effectId: command.effectId,
				});
			case "toggleEffect":
				return reducers.toggleEffect({
					projectId,
					effectId: command.effectId,
					enabled: command.enabled,
				});
			case "updateEffectParams":
				return reducers.updateEffectParams({
					projectId,
					effectId: command.effectId,
					params: stringifyJson(command.params),
				});
			case "reorderEffect":
				return reducers.reorderEffect({
					projectId,
					effectId: command.effectId,
					toIndex: command.toIndex,
				});
			case "registerAsset":
				return reducers.registerAsset({
					projectId,
					input: {
						id: command.asset.id,
						name: command.asset.name,
						storage: assetStorageToRow(command.asset.storage),
						location: command.asset.location,
						mimeType: command.asset.mimeType,
						byteSize:
							command.asset.byteSize === null
								? undefined
								: BigInt(command.asset.byteSize),
						width: command.asset.width ?? undefined,
						height: command.asset.height ?? undefined,
						duration:
							command.asset.duration === null
								? undefined
								: fromTicks(command.asset.duration),
					},
				});
			case "removeAsset":
				return reducers.removeAsset({ projectId, assetId: command.assetId });
		}
	}

	/**
	 * Creates the shared project. Call this when a project is not yet shared.
	 */
	async createProject(options: {
		name: string;
		sceneId: string;
		mainTrackId: string;
		metadata: ProjectSnapshot["metadata"];
	}): Promise<void> {
		const metadata = options.metadata;
		await this.#connection.reducers.createProject({
			projectId: this.projectId,
			name: options.name,
			sceneId: options.sceneId,
			mainTrackId: options.mainTrackId,
			metadata: {
				canvasWidth: metadata?.canvasWidth ?? 1920,
				canvasHeight: metadata?.canvasHeight ?? 1080,
				fpsNumerator: metadata?.fpsNumerator ?? 30,
				fpsDenominator: metadata?.fpsDenominator ?? 1,
				background: metadata?.background ?? "#000000",
				extra: stringifyJson(metadata?.extra ?? {}),
			},
		});
	}

	/**
	 * Runs `apply` with outbound dispatch disabled.
	 *
	 * Writing remote state into the editor makes the editor emit its own
	 * commands. Without this guard those commands would be sent straight back
	 * to the server, and two editors would keep re-applying each other's work.
	 */
	applyRemote<T>(apply: () => T): T {
		const previous = this.#applyingRemote;
		this.#applyingRemote = true;
		try {
			return apply();
		} finally {
			this.#applyingRemote = previous;
		}
	}

	get isApplyingRemote(): boolean {
		return this.#applyingRemote;
	}

	publishPresence(update: PresenceUpdate): void {
		if (this.#closed) {
			return;
		}
		void this.#connection.reducers
			.updatePresence({
				projectId: this.projectId,
				sceneId: update.sceneId,
				playhead: fromTicks(update.playhead),
				selection: update.selection,
				isPlaying: update.isPlaying,
				cursorX: update.cursor.x,
				cursorY: update.cursor.y,
			})
			// Presence is ephemeral; a dropped update is corrected by the next one.
			.catch(() => {});
	}

	snapshot(): ProjectSnapshot {
		const project = this.#project();
		const metadata = this.#connection.db.projectMetadata.projectId.find(
			this.projectId,
		);

		return {
			projectId: this.projectId,
			name: project?.name ?? "",
			revision: project ? projectRevision(project) : 0,
			metadata: metadata ? toMetadata(metadata) : null,
			scenes: this.#rows(this.#connection.db.scene)
				.map(toScene)
				.sort((a, b) => a.position - b.position),
			tracks: this.#rows(this.#connection.db.track)
				.map(toTrack)
				.sort((a, b) => a.position - b.position),
			clips: this.#rows(this.#connection.db.clip)
				.map(toClip)
				.sort((a, b) => a.startTime - b.startTime),
			effects: this.#rows(this.#connection.db.clipEffect)
				.map(toEffect)
				.sort((a, b) => a.position - b.position),
			assets: this.#rows(this.#connection.db.asset).map(toAsset),
		};
	}

	collaborators(): Collaborator[] {
		const self = this.connectionId;
		return this.#rows(this.#connection.db.presence)
			.filter((presence) => presence.projectId === this.projectId)
			.map((presence) =>
				toCollaborator({
					presence,
					user: this.#connection.db.user.identity.find(presence.identity),
					isSelf: presence.connectionId.toHexString() === self,
				}),
			);
	}

	onSnapshot(listener: Listener<SnapshotChange>): () => void {
		this.#snapshotListeners.add(listener);
		return () => this.#snapshotListeners.delete(listener);
	}

	onEdit(listener: Listener<RemoteEdit>): () => void {
		this.#editListeners.add(listener);
		return () => this.#editListeners.delete(listener);
	}

	onCollaborators(listener: Listener<Collaborator[]>): () => void {
		this.#collaboratorListeners.add(listener);
		return () => this.#collaboratorListeners.delete(listener);
	}

	close(): void {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		this.#snapshotListeners.clear();
		this.#editListeners.clear();
		this.#collaboratorListeners.clear();
		this.#connection.disconnect();
	}

	async #subscribe(): Promise<void> {
		const scoped = (table: string, column = "project_id") =>
			`SELECT * FROM ${table} WHERE ${column} = '${this.projectId}'`;

		await new Promise<void>((resolve, reject) => {
			this.#connection
				.subscriptionBuilder()
				.onApplied(() => resolve())
				.onError((_ctx) => reject(new Error("project subscription failed")))
				.subscribe([
					scoped("project", "id"),
					scoped("project_metadata"),
					scoped("project_member"),
					scoped("scene"),
					scoped("track"),
					scoped("clip"),
					scoped("clip_effect"),
					scoped("asset"),
					scoped("presence"),
					scoped("edit_history"),
					// Collaborator names and colours are not project-scoped.
					"SELECT * FROM user",
				]);
		});

		// History rows already present are this project's past, not news. Anything
		// at or below this revision is skipped so a joining editor does not replay
		// every edit ever made as if it just happened.
		const project = this.#project();
		this.#baselineRevision = project ? projectRevision(project) : 0;

		this.#watchProjectState();
		this.#watchPresence();
		this.#watchHistory();
	}

	/**
	 * Becomes a member of the project, now or as soon as it is created.
	 *
	 * An editor can attach to a project id before the project has been shared —
	 * that is the case where this session is the one about to create it. Joining
	 * is idempotent, so joining again when the row appears costs nothing.
	 */
	async #joinWhenProjectExists(): Promise<void> {
		if (this.#project() != null) {
			await this.#connection.reducers.joinProject({
				projectId: this.projectId,
			});
			return;
		}

		this.#connection.db.project.onInsert((_ctx, row) => {
			if (row.id !== this.projectId || this.#closed) {
				return;
			}
			void this.#connection.reducers
				.joinProject({ projectId: this.projectId })
				.catch(() => {});
		});
	}

	#watchProjectState(): void {
		const { db } = this.#connection;

		const onClipChange = (row: { origin?: { toHexString(): string } }) => {
			const origin = row.origin?.toHexString();
			this.#queueEmit(origin !== this.connectionId);
		};

		db.clip.onInsert((_ctx, row) => onClipChange(row));
		db.clip.onUpdate((_ctx, _old, row) => onClipChange(row));
		db.clip.onDelete((_ctx, row) => onClipChange(row));

		// Tracks, scenes, effects, and assets carry no origin, so a change to them
		// is treated as remote. The guard in `dispatch` is what actually prevents
		// the echo; this flag only tells the editor whether a repaint is needed.
		for (const table of [db.track, db.scene, db.clipEffect, db.asset]) {
			table.onInsert(() => this.#queueEmit(true));
			table.onDelete(() => this.#queueEmit(true));
		}
		db.track.onUpdate(() => this.#queueEmit(true));
		db.clipEffect.onUpdate(() => this.#queueEmit(true));
		db.asset.onUpdate(() => this.#queueEmit(true));
		db.project.onUpdate(() => this.#queueEmit(true));
		db.projectMetadata.onUpdate(() => this.#queueEmit(true));
		db.project.onInsert(() => this.#queueEmit(true));
		db.projectMetadata.onInsert(() => this.#queueEmit(true));
	}

	#watchPresence(): void {
		const { db } = this.#connection;
		const emit = () => {
			const collaborators = this.collaborators();
			for (const listener of this.#collaboratorListeners) {
				listener(collaborators);
			}
		};
		db.presence.onInsert(emit);
		db.presence.onUpdate(emit);
		db.presence.onDelete(emit);
		db.user.onInsert(emit);
		db.user.onUpdate(emit);
	}

	#watchHistory(): void {
		this.#connection.db.editHistory.onInsert((_ctx, row) => {
			if (Number(row.revision) <= this.#baselineRevision) {
				return;
			}
			const isRemote = row.origin?.toHexString() !== this.connectionId;
			const edit = toRemoteEdit({ row, isRemote });
			for (const listener of this.#editListeners) {
				listener(edit);
			}
		});
	}

	/**
	 * Defers emission to the end of the current task.
	 *
	 * One reducer can touch many rows — a split writes two clips and copies an
	 * effect chain — and each row fires its own callback. Emitting per callback
	 * would hand the editor a snapshot of a half-applied transaction.
	 */
	#queueEmit(isRemote: boolean): void {
		this.#pendingRemoteChange ||= isRemote;
		if (this.#emitScheduled) {
			return;
		}
		this.#emitScheduled = true;
		queueMicrotask(() => {
			this.#emitScheduled = false;
			const hasRemoteChanges = this.#pendingRemoteChange;
			this.#pendingRemoteChange = false;
			if (this.#closed) {
				return;
			}
			const change: SnapshotChange = {
				snapshot: this.snapshot(),
				hasRemoteChanges,
			};
			for (const listener of this.#snapshotListeners) {
				listener(change);
			}
		});
	}

	#project() {
		return this.#connection.db.project.id.find(this.projectId);
	}

	/** Collects a table's rows, filtered to this project where applicable. */
	#rows<T extends { projectId?: string }>(table: {
		iter(): IteratorObject<T, undefined>;
	}): T[] {
		return Array.from(table.iter()).filter(
			(row) => row.projectId === undefined || row.projectId === this.projectId,
		);
	}
}
