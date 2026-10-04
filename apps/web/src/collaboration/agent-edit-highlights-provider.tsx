"use client";

import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useSyncExternalStore,
} from "react";
import type { CollabSession } from "@opencut/collab-client";
import { AgentEditHighlights } from "./agent-edit-highlights";

const HighlightsContext = createContext<AgentEditHighlights | null>(null);
const subscribeNone = () => () => {};
const noHighlight = () => undefined;

export function useAgentEditHighlight(clipId: string): string | undefined {
	const highlights = useContext(HighlightsContext);
	return useSyncExternalStore(
		highlights?.subscribe ?? subscribeNone,
		() => highlights?.label(clipId),
		noHighlight,
	);
}

export function AgentEditHighlightsProvider({
	session,
	children,
}: {
	session: CollabSession | null;
	children: React.ReactNode;
}) {
	const highlights = useMemo(() => new AgentEditHighlights(), []);
	useEffect(() => {
		if (!session) return;
		let active = true;
		const stop = session.onEdit((edit) => {
			// Wait for all rows of this transaction (split/effect changes) to arrive.
			queueMicrotask(() => {
				if (active) highlights.show({ edit, snapshot: session.snapshot() });
			});
		});
		return () => {
			active = false;
			stop();
			highlights.clear();
		};
	}, [session, highlights]);
	return (
		<HighlightsContext.Provider value={highlights}>
			{children}
		</HighlightsContext.Provider>
	);
}
