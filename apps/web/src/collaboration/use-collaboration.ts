"use client";

/**
 * React access to the collaboration session.
 *
 * The session and bridge are plain objects with no React dependency; this hook
 * only owns their lifetime and re-renders on presence changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { CollabSession } from "@opencut/collab-client";
import type { Collaborator, RemoteEdit } from "@opencut/collab-client";

import { EditorCore } from "@/core";

import { CollaborationBridge } from "./bridge";
import { collaborationConfig, isCollaborationEnabled } from "./config";

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
				setStatus("connected");

				session.onCollaborators(setCollaborators);
				session.onEdit((edit) => {
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

	return { status, collaborators, recentEdits, error, session: activeSession };
}

/**
 * Publishes this editor's playhead and selection.
 *
 * Presence is throttled because the playhead changes every frame during
 * playback, and a collaborator's cursor does not need that resolution.
 */
export function usePresencePublisher({
	session,
	sceneId,
	playhead,
	selection,
	isPlaying,
	intervalMs = 100,
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

	const publish = useCallback(() => {
		if (!session || !sceneId) {
			return;
		}
		session.publishPresence({
			sceneId,
			playhead,
			selection,
			isPlaying,
			cursor: { x: 0, y: 0 },
		});
	}, [session, sceneId, playhead, selection, isPlaying]);

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
}
