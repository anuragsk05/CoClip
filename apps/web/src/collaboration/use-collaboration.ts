"use client";

/**
 * React access to the collaboration session.
 *
 * The session and bridge are plain objects with no React dependency; this hook
 * only owns their lifetime and re-renders on presence changes.
 */

import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { CollabSession } from "@opencut/collab-client";
import type {
	Collaborator,
	RemoteEdit,
	SessionDeparture,
} from "@opencut/collab-client";

import { EditorCore } from "@/core";

import { CollaborationBridge } from "./bridge";
import { collaborationConfig, isCollaborationEnabled } from "./config";
import { readShareToken } from "./share-access";
import {
	getLocalCursor,
	getServerLocalCursor,
	subscribeLocalCursor,
} from "./local-cursor";

export type CollaborationStatus =
	| "disabled"
	| "connecting"
	| "connected"
	| "error";

export interface CollaborationState {
	status: CollaborationStatus;
	collaborators: Collaborator[];
	recentEdits: RemoteEdit[];
	error: Error | null;
	session: CollabSession | null;
	/** False when this browser joined through a view-only share link. */
	canWrite: boolean;
	/** True when a write link was refused because four editors are already in. */
	atCapacity: boolean;
	/** This browser owns the project. */
	isHost: boolean;
	/** The host has started a CoClip session other people can join. */
	sessionLive: boolean;
	/** Set when the host ends the session or removes this person. */
	departure: SessionDeparture | null;
}

const MAX_RECENT_EDITS = 50;

export function useCollaboration({
	projectId,
	enabled = true,
}: {
	projectId: string;
	enabled?: boolean;
}): CollaborationState {
	const [status, setStatus] = useState<CollaborationStatus>(
		isCollaborationEnabled() ? "connecting" : "disabled",
	);
	const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
	const [recentEdits, setRecentEdits] = useState<RemoteEdit[]>([]);
	const [error, setError] = useState<Error | null>(null);
	// State, not a ref: consumers render presence from the session, so they have
	// to re-render when it arrives.
	const [activeSession, setActiveSession] = useState<CollabSession | null>(null);
	const [canWrite, setCanWrite] = useState(() => readShareToken() == null);
	const [atCapacity, setAtCapacity] = useState(false);
	const [isHost, setIsHost] = useState(false);
	const [sessionLive, setSessionLive] = useState(false);
	const [departure, setDeparture] = useState<SessionDeparture | null>(null);

	useEffect(() => {
		if (!enabled || !isCollaborationEnabled()) {
			setStatus("disabled");
			return;
		}

		let cancelled = false;
		let session: CollabSession | null = null;
		let bridge: CollaborationBridge | null = null;

		const start = async () => {
			const config = collaborationConfig();
			try {
				session = await CollabSession.open({
					uri: config.uri,
					database: config.database,
					projectId,
					profile: config.profile,
					inviteToken: readShareToken() ?? undefined,
					onDisconnect: () => {
						if (!cancelled) {
							setStatus("error");
						}
					},
				});

				// The editor may have unmounted while connecting.
				if (cancelled) {
					session.close();
					return;
				}

				bridge = await CollaborationBridge.attach({
					editor: EditorCore.getInstance(),
					session,
					onError: (bridgeError) => setError(bridgeError),
				});

				setActiveSession(session);
				setCollaborators(session.collaborators());
				setCanWrite(session.canWrite);
				setAtCapacity(session.atCapacity);
				setIsHost(session.isHost);
				setSessionLive(session.sessionLive);
				setDeparture(session.departure);
				setStatus("connected");

				const live = session;
				live.onCollaborators((next) => {
					setCollaborators(next);
					setCanWrite(live.canWrite);
					setAtCapacity(live.atCapacity);
					setIsHost(live.isHost);
				});
				live.onWriteAccess((next) => {
					setCanWrite(next);
					setAtCapacity(live.atCapacity);
				});
				live.onLiveSession((active) => {
					setSessionLive(active);
					setCanWrite(live.canWrite);
					setDeparture(live.departure);
				});
				live.onDeparture((reason) => {
					setDeparture(reason);
					setCanWrite(live.canWrite);
				});
				live.onEdit((edit) => {
					setRecentEdits((edits) =>
						[edit, ...edits].slice(0, MAX_RECENT_EDITS),
					);
				});
			} catch (startError) {
				if (cancelled) {
					return;
				}
				setError(
					startError instanceof Error
						? startError
						: new Error(String(startError)),
				);
				setStatus("error");
			}
		};

		void start();

		return () => {
			cancelled = true;
			bridge?.detach();
			session?.close();
			setActiveSession(null);
		};
	}, [projectId, enabled]);

	return {
		status,
		collaborators,
		recentEdits,
		error,
		session: activeSession,
		canWrite,
		atCapacity,
		isHost,
		sessionLive,
		departure,
	};
}

/**
 * Publishes this editor's playhead, selection, and pointer.
 *
 * Presence is throttled because the playhead changes every frame during
 * playback. The pointer is included on the same cadence so a moving cursor
 * stays current without a second reducer.
 */
export function usePresencePublisher({
	session,
	sceneId,
	playhead,
	selection,
	isPlaying,
	intervalMs = 40,
}: {
	session: CollabSession | null;
	sceneId: string | null;
	playhead: number;
	selection: string[];
	isPlaying: boolean;
	intervalMs?: number;
}): void {
	const lastSentAt = useRef(0);
	const pending = useRef<number | null>(null);
	const cursor = useSyncExternalStore(
		subscribeLocalCursor,
		getLocalCursor,
		getServerLocalCursor,
	);

	const publish = useCallback(() => {
		if (!session || !sceneId || session.departure) {
			return;
		}
		session.publishPresence({
			sceneId,
			playhead,
			selection,
			isPlaying,
			cursor: getLocalCursor(),
		});
	}, [session, sceneId, playhead, selection, isPlaying, cursor]);

	useEffect(() => {
		if (!session || !sceneId) {
			return;
		}

		const elapsed = Date.now() - lastSentAt.current;
		if (elapsed >= intervalMs) {
			lastSentAt.current = Date.now();
			publish();
			return;
		}

		pending.current = window.setTimeout(() => {
			lastSentAt.current = Date.now();
			publish();
		}, intervalMs - elapsed);

		return () => {
			if (pending.current !== null) {
				window.clearTimeout(pending.current);
				pending.current = null;
			}
		};
	}, [publish, session, sceneId, intervalMs]);

	// A quiet window still has to be heard from, or a participant refresh
	// treats it as disconnected and drops its edit seat.
	useEffect(() => {
		if (!session || !sceneId) {
			return;
		}
		const heartbeat = window.setInterval(() => {
			publish();
		}, 5_000);
		return () => {
			window.clearInterval(heartbeat);
		};
	}, [publish, session, sceneId]);
}
