"use client";

import { create } from "zustand";
import { useEffect } from "react";

interface LoadingTask {
	id: string;
	message?: string;
	startedAt: number;
}

interface TabBufferingState {
	tasks: Map<string, LoadingTask>;
	isLoading: boolean;
	activeMessage: string | null;
	start: (id: string, message?: string) => void;
	stop: (id: string) => void;
	withLoading: <T>(
		id: string,
		promise: Promise<T>,
		message?: string,
	) => Promise<T>;
}

const TASK_TIMEOUT_MS = 30000; // Auto-expire tasks after 30 seconds to prevent stuck state

export const useTabBufferingStore = create<TabBufferingState>((set, get) => ({
	tasks: new Map(),
	isLoading: false,
	activeMessage: null,

	start: (id: string, message?: string) => {
		const nextTasks = new Map(get().tasks);
		nextTasks.set(id, { id, message, startedAt: Date.now() });

		const messages = Array.from(nextTasks.values())
			.map((t) => t.message)
			.filter((msg): msg is string => Boolean(msg));
		const lastMessage =
			messages.length > 0 ? messages[messages.length - 1] ?? null : (message ?? null);

		set({
			tasks: nextTasks,
			isLoading: nextTasks.size > 0,
			activeMessage: lastMessage,
		});

		// Auto-cleanup stale tasks after timeout
		setTimeout(() => {
			const current = get().tasks.get(id);
			if (current && Date.now() - current.startedAt >= TASK_TIMEOUT_MS) {
				get().stop(id);
			}
		}, TASK_TIMEOUT_MS);
	},

	stop: (id: string) => {
		const nextTasks = new Map(get().tasks);
		nextTasks.delete(id);

		const messages = Array.from(nextTasks.values())
			.map((t) => t.message)
			.filter((msg): msg is string => Boolean(msg));
		const lastMessage =
			messages.length > 0 ? messages[messages.length - 1] ?? null : null;

		set({
			tasks: nextTasks,
			isLoading: nextTasks.size > 0,
			activeMessage: lastMessage,
		});
	},

	withLoading: async <T>(
		id: string,
		promise: Promise<T>,
		message?: string,
	): Promise<T> => {
		get().start(id, message);
		try {
			return await promise;
		} finally {
			get().stop(id);
		}
	},
}));

export const tabBuffering = {
	start: (id: string, message?: string) =>
		useTabBufferingStore.getState().start(id, message),
	stop: (id: string) => useTabBufferingStore.getState().stop(id),
	withLoading: <T>(id: string, promise: Promise<T>, message?: string) =>
		useTabBufferingStore.getState().withLoading(id, promise, message),
};

/**
 * React hook to bind a component or state's loading status to the tab buffering animation.
 */
export function useRegisterTabLoading(
	isLoading: boolean,
	id: string,
	message?: string,
) {
	useEffect(() => {
		if (isLoading) {
			tabBuffering.start(id, message);
			return () => {
				tabBuffering.stop(id);
			};
		}
	}, [isLoading, id, message]);
}

/**
 * React hook to read the tab buffering state and manually trigger tasks.
 */
export function useTabBuffering() {
	const isLoading = useTabBufferingStore((state) => state.isLoading);
	const activeMessage = useTabBufferingStore((state) => state.activeMessage);
	const start = useTabBufferingStore((state) => state.start);
	const stop = useTabBufferingStore((state) => state.stop);

	return {
		isLoading,
		activeMessage,
		start,
		stop,
	};
}
