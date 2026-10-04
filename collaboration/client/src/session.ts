/**
 * The collaboration adapter.
 *
 * One `CollabSession` is one editor attached to one shared project. It is the
 * only path between an editor and SpacetimeDB: editor commands go in through
 * {@link CollabSession.dispatch}, and shared state comes back out through
 * {@link CollabSession.onSnapshot}.
 */

import { connect, type ConnectOptions } from "./connection";
import type { MediaChunk } from "./media-bytes";
import {
	assetStorageToRow,
	clipKindToRow,
	fromTicks,
	lower,
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
	MemberRole,
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
	/** Share-invite token from the live link. Empty or omitted is view-only. */
	inviteToken?: string;
}

export interface SnapshotChange {
	snapshot: ProjectSnapshot;
	/** True when at least one change in this batch came from another connection. */
	hasRemoteChanges: boolean;
}

type Listener<T> = (value: T) => void;

const PROJECT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export type SessionDeparture = "removed" | "ended" | "left";

export class CollabSession {
	readonly projectId: string;

	#connection: DbConnection;
	#snapshotListeners = new Set<Listener<SnapshotChange>>();
	#editListeners = new Set<Listener<RemoteEdit>>();
	#collaboratorListeners = new Set<Listener<Collaborator[]>>();
	#accessListeners = new Set<Listener<boolean>>();
	#liveListeners = new Set<Listener<boolean>>();
	#departureListeners = new Set<Listener<SessionDeparture>>();
	#chunkListeners = new Set<Listener<void>>();

	/** Set while remote state is being written into the editor. */
	#applyingRemote = false;
	/** Coalesces a burst of row callbacks into one snapshot emission. */
	#emitScheduled = false;
	#pendingRemoteChange = false;
	/** Revision already present when this session subscribed. */
	#baselineRevision = 0;
	#closed = false;
	#inviteToken = "";
	#displayName = "";
	/** True after this connection has joined the project. */
	#joined = false;
	#departure: SessionDeparture | null = null;
	/** Set before `leave_session` so a deleted row is not reported as a removal. */
	#leftVoluntarily = false;

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
		session.#inviteToken = options.inviteToken ?? "";
		session.#displayName = options.profile?.name?.trim() ?? "";

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

	/** This connection's role on the project, if membership has been granted. */
	get role(): MemberRole | null {
		const identity = this.identity;
		if (!identity) {
			return null;
		}
		const member = this.#rows(this.#connection.db.projectMember).find(
			(row) => row.identity.toHexString() === identity,
		);
		return member ? lower<MemberRole>(member.role.tag) : null;
	}

	/**
	 * Whether this window may change the timeline.
	 *
	 * A view-only link is false even when this person is an editor elsewhere.
	 * Until the server row arrives, a share link stays view-only.
	 */
	get canWrite(): boolean {
		if (this.#departure) {
			return false;
		}
		const access = this.#ownAccess();
		if (access) {
			return access.canWrite;
		}
		if (this.#joined && !this.isHost && !this.sessionLive) {
			return false;
		}
		return this.#inviteToken.length === 0;
	}

	/** True when this identity owns the project. */
	get isHost(): boolean {
		const owner = this.#project()?.owner.toHexString();
		return owner != null && owner !== "" && owner === this.identity;
	}

	/** True while the host has a CoClip session open for other people. */
	get sessionLive(): boolean {
		return (
			this.#connection.db.liveSession.projectId.find(this.projectId)?.active === true
		);
	}

	get departure(): SessionDeparture | null {
		return this.#departure;
	}

	/** True when a write link was turned into view-only because four editors are in. */
	get atCapacity(): boolean {
		return this.#ownAccess()?.atCapacity === true;
	}

	/**
	 * Reuses an existing invite for this access level, or publishes a new one.
	 *
	 * The token is generated here so the share URL can be copied without a
	 * reducer return value.
	 */
	async ensureShareInvite(canWrite: boolean): Promise<string> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		const existing = this.#rows(this.#connection.db.shareInvite).find(
			(row) => row.canWrite === canWrite,
		);
		if (existing) {
			return existing.token;
		}
		const token = crypto.randomUUID();
		await this.#connection.reducers.createShareInvite({
			projectId: this.projectId,
			token,
			canWrite,
		});
		return token;
	}

	/** Lets other people join this project. Only the host can start it. */
	async startLiveSession(): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		await this.#connection.reducers.startLiveSession({
			projectId: this.projectId,
		});
	}

	/** Ends the live session and removes everyone except the host. */
	async stopLiveSession(): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		await this.#connection.reducers.stopLiveSession({
			projectId: this.projectId,
		});
	}

	/** Removes one person from the live session. Only the host can do this. */
	async removeParticipant(identity: string): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		await this.#connection.reducers.removeParticipant({
			projectId: this.projectId,
			identity,
		});
	}

	/**
	 * Writes one slice of a shared video or audio file.
	 *
	 * The asset must already be registered with storage `spacetime`.
	 */
	async putAssetChunk(options: {
		assetId: string;
		chunkIndex: number;
		chunkCount: number;
		bytes: Uint8Array;
	}): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		await this.#connection.reducers.putAssetChunk({
			projectId: this.projectId,
			assetId: options.assetId,
			chunkIndex: options.chunkIndex,
			chunkCount: options.chunkCount,
			bytes: options.bytes,
		});
	}

	/** Slices of one shared file currently in the local cache. */
	assetChunks(assetId: string): MediaChunk[] {
		return this.#rows(this.#connection.db.assetChunk)
			.filter((row) => row.assetId === assetId)
			.map((row) => ({
				index: row.chunkIndex,
				count: row.chunkCount,
				bytes: row.bytes,
			}));
	}

	onAssetChunks(listener: Listener<void>): () => void {
		this.#chunkListeners.add(listener);
		return () => this.#chunkListeners.delete(listener);
	}

	/** Drops this person from the live session. The host stops the session instead. */
	async leaveSession(): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		this.#leftVoluntarily = true;
		try {
			await this.#connection.reducers.leaveSession({
				projectId: this.projectId,
			});
		} catch (error) {
			this.#leftVoluntarily = false;
			throw error;
		}
	}

	/**
	 * Sends an editor action to the shared project.
	 *
	 * Dropped while remote state is being applied: an edit that arrived from
	 * another editor must not be echoed back as a local one.
	 */
	async dispatch(command: EditorCommand): Promise<void> {
		if (this.#applyingRemote || this.#closed || !this.canWrite) {
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
		const stored = this.#rows(this.#connection.db.collaborator);
		const grouped = new Map<string, typeof stored>();
		for (const row of stored) {
			const identity = row.identity.toHexString();
			const rows = grouped.get(identity);
			if (rows) {
				rows.push(row);
			} else {
				grouped.set(identity, [row]);
			}
		}

		const people: Collaborator[] = [];
		for (const rows of grouped.values()) {
			const mine = rows.find((row) => row.connectionId.toHexString() === self);
			const newest = [...rows].sort(
				(left, right) => right.lastSeen.toDate().getTime() - left.lastSeen.toDate().getTime(),
			)[0];
			if (!newest) {
				continue;
			}
			let presence = null;
			for (const row of rows) {
				const next = this.#connection.db.presence.connectionId.find(row.connectionId);
				if (!next) {
					continue;
				}
				if (
					!presence ||
					next.updatedAt.toDate().getTime() >= presence.updatedAt.toDate().getTime()
				) {
					presence = next;
				}
			}
			const person = toCollaborator({
				row: newest,
				presence,
				isSelf: mine != null,
			});
			person.canWrite = rows.some((row) => row.canWrite);
			person.atCapacity = !person.canWrite && rows.some((row) => row.atCapacity);
			person.connectionId = (mine ?? newest).connectionId.toHexString();
			people.push(person);
		}
		return people;
	}

	/**
	 * Drops collaborators the server has not heard from recently.
	 *
	 * Opening the participant list calls this so a disconnected window does not
	 * keep a cursor or an edit seat.
	 */
	async refreshParticipants(): Promise<void> {
		if (this.#closed) {
			return;
		}
		await this.#connection.reducers.refreshParticipants({
			projectId: this.projectId,
		});
	}

	/**
	 * Switches one window between editing and view-only.
	 *
	 * The server refuses a promotion once four people already hold an edit seat.
	 */
	async setParticipantAccess(connectionId: string, canWrite: boolean): Promise<void> {
		if (this.#closed) {
			throw new Error("session is closed");
		}
		await this.#connection.reducers.setParticipantAccess({
			projectId: this.projectId,
			connectionId,
			canWrite,
		});
	}

	/**
	 * How many edit seats are taken, including the owner's reserved seat.
	 *
	 * Agents are not counted. Matches the server cap of four.
	 */
	editorCount(): number {
		const owner = this.#project()?.owner.toHexString();
		const seats = new Set<string>();
		if (owner) {
			seats.add(owner);
		}
		for (const row of this.#rows(this.#connection.db.collaborator)) {
			if (!row.canWrite || lower(row.kind.tag) === "agent") {
				continue;
			}
			seats.add(row.identity.toHexString());
		}
		return seats.size;
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

	onWriteAccess(listener: Listener<boolean>): () => void {
		this.#accessListeners.add(listener);
		return () => this.#accessListeners.delete(listener);
	}

	onLiveSession(listener: Listener<boolean>): () => void {
		this.#liveListeners.add(listener);
		return () => this.#liveListeners.delete(listener);
	}

	onDeparture(listener: Listener<SessionDeparture>): () => void {
		this.#departureListeners.add(listener);
		return () => this.#departureListeners.delete(listener);
	}

	close(): void {
		if (this.#closed) {
			return;
		}
		this.#closed = true;
		this.#snapshotListeners.clear();
		this.#editListeners.clear();
		this.#collaboratorListeners.clear();
		this.#accessListeners.clear();
		this.#liveListeners.clear();
		this.#departureListeners.clear();
		this.#chunkListeners.clear();
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
					scoped("asset_chunk"),
					scoped("presence"),
					scoped("edit_history"),
					scoped("share_invite"),
					scoped("collaborator"),
					scoped("live_session"),
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
		this.#watchAccess();
		this.#watchLiveSession();
		this.#watchAssetChunks();
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
			await this.#joinProject();
			return;
		}

		this.#connection.db.project.onInsert((_ctx, row) => {
			if (row.id !== this.projectId || this.#closed) {
				return;
			}
			void this.#joinProject().catch(() => {});
		});
	}

	async #joinProject(): Promise<void> {
		await this.#connection.reducers.joinProject({
			projectId: this.projectId,
			inviteToken: this.#inviteToken,
			displayName: this.#displayName,
		});
		this.#joined = true;
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
		db.collaborator.onInsert(emit);
		db.collaborator.onUpdate(emit);
		db.collaborator.onDelete((_ctx, row) => {
			if (row.connectionId.toHexString() === this.connectionId) {
				this.#noteOwnRowGone();
			}
			emit();
		});
	}

	#watchLiveSession(): void {
		const emit = () => {
			if (this.#joined && !this.isHost && !this.sessionLive) {
				this.#depart("ended");
			}
			for (const listener of this.#liveListeners) {
				listener(this.sessionLive);
			}
		};
		const { liveSession } = this.#connection.db;
		liveSession.onInsert(emit);
		liveSession.onUpdate(emit);
		liveSession.onDelete(emit);
	}

	#noteOwnRowGone(): void {
		if (!this.#joined || this.isHost) {
			return;
		}
		if (this.#leftVoluntarily) {
			this.#depart("left");
			return;
		}
		this.#depart(this.sessionLive ? "removed" : "ended");
	}

	#depart(reason: SessionDeparture): void {
		if (this.#departure === "ended" || this.#departure === "left") {
			return;
		}
		if (this.#departure === reason) {
			return;
		}
		this.#departure = reason;
		for (const listener of this.#departureListeners) {
			listener(reason);
		}
		for (const listener of this.#accessListeners) {
			listener(this.canWrite);
		}
	}

	#watchAssetChunks(): void {
		const emit = () => {
			for (const listener of this.#chunkListeners) {
				listener();
			}
		};
		const { assetChunk } = this.#connection.db;
		assetChunk.onInsert(emit);
		assetChunk.onUpdate(emit);
		assetChunk.onDelete(emit);
	}

	#watchAccess(): void {
		const emit = () => {
			const canWrite = this.canWrite;
			for (const listener of this.#accessListeners) {
				listener(canWrite);
			}
		};
		this.#connection.db.collaborator.onInsert(emit);
		this.#connection.db.collaborator.onUpdate(emit);
		this.#connection.db.collaborator.onDelete(emit);
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

	#ownAccess() {
		const connectionId = this.#connection.connectionId;
		return this.#connection.db.collaborator.connectionId.find(connectionId);
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
