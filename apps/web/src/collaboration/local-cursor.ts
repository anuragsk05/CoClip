"use client";

/**
 * This browser's pointer, as a fraction of the editor shell.
 *
 * Coordinates stay outside React so a pointer move does not re-render the
 * timeline. `{-1, -1}` means the pointer is outside the editor and remote
 * cursors should hide.
 */

export interface LocalCursor {
	x: number;
	y: number;
}

const HIDDEN: LocalCursor = { x: -1, y: -1 };

let cursor: LocalCursor = HIDDEN;
const listeners = new Set<() => void>();

export function getLocalCursor(): LocalCursor {
	return cursor;
}

export function getServerLocalCursor(): LocalCursor {
	return HIDDEN;
}

export function subscribeLocalCursor(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

export function setLocalCursor(next: LocalCursor): void {
	if (
		Math.abs(next.x - cursor.x) < 0.001 &&
		Math.abs(next.y - cursor.y) < 0.001
	) {
		return;
	}
	cursor = next;
	for (const listener of listeners) {
		listener();
	}
}

/** True when a collaborator has a pointer inside the shared editor. */
export function isLiveCursor(point: { x: number; y: number }): boolean {
	return point.x >= 0 && point.y >= 0 && point.x <= 1 && point.y <= 1;
}
