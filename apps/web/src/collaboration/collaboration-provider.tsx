"use client";

/**
 * Mounts the collaboration session for the loaded project.
 *
 * The session has to be opened once per project, but its presence state is read
 * by chrome elsewhere in the editor, so it is shared through context rather than
 * opened again per consumer.
 */

import { createContext, useContext, useMemo } from "react";

import { useEditor } from "@/editor/use-editor";

import type { CollaborationState } from "./use-collaboration";
import { useCollaboration, usePresencePublisher } from "./use-collaboration";

const DISCONNECTED: CollaborationState = {
	status: "disabled",
	collaborators: [],
	recentEdits: [],
	error: null,
	session: null,
};

const CollaborationContext = createContext<CollaborationState>(DISCONNECTED);

/**
 * Reads the active collaboration session.
 *
 * Outside the provider this reports a disabled session, so chrome can render
 * unconditionally without each caller testing whether collaboration is on.
 */
export function useCollaborationState(): CollaborationState {
	return useContext(CollaborationContext);
}

export function CollaborationProvider({
	projectId,
	children,
}: {
	projectId: string;
	children: React.ReactNode;
}) {
	const state = useCollaboration({ projectId });

	return (
		<CollaborationContext.Provider value={state}>
			<PresencePublisher />
			{children}
		</CollaborationContext.Provider>
	);
}

function PresencePublisher() {
	const { session } = useCollaborationState();
	const sceneId = useEditor(
		(editor) => editor.scenes.getActiveSceneOrNull()?.id ?? null,
	);
	const playhead = useEditor((editor) => editor.playback.getCurrentTime());
	const isPlaying = useEditor((editor) => editor.playback.getIsPlaying());
	const selectedElements = useEditor((editor) =>
		editor.selection.getSelectedElements(),
	);

	const selection = useMemo(
		() => selectedElements.map((element) => element.elementId),
		[selectedElements],
	);

	usePresencePublisher({
		session,
		sceneId,
		playhead,
		selection,
		isPlaying,
	});

	return null;
}
