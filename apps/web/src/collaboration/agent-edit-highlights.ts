import type { ProjectSnapshot, RemoteEdit } from "@opencut/collab-client";

/** Resolve history targets to visible clips, including effect and track edits. */
export function agentEditedClipIds({
	edit,
	snapshot,
}: {
	edit: RemoteEdit;
	snapshot: ProjectSnapshot;
}): string[] {
	if (edit.actorKind !== "agent") return [];
	const ids = new Set<string>();
	if (snapshot.clips.some((clip) => clip.id === edit.targetId))
		ids.add(edit.targetId);
	for (const key of ["clipId", "rightClipId"]) {
		const id = edit.payload[key];
		if (typeof id === "string") ids.add(id);
	}
	const effect = snapshot.effects.find((effect) => effect.id === edit.targetId);
	if (effect) ids.add(effect.clipId);
	if (["setTrackMuted", "setTrackHidden", "reorderTrack"].includes(edit.op)) {
		for (const clip of snapshot.clips) {
			if (clip.trackId === edit.targetId) ids.add(clip.id);
		}
	}
	return [...ids].filter((id) => snapshot.clips.some((clip) => clip.id === id));
}

/** Ephemeral display state only; shared history remains the source of edits. */
export class AgentEditHighlights {
	#labels = new Map<string, string>();
	#timers = new Map<string, ReturnType<typeof setTimeout>>();
	#listeners = new Set<() => void>();
	constructor(private durationMs = 5000) {}

	subscribe = (listener: () => void): (() => void) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};

	label = (clipId: string): string | undefined => this.#labels.get(clipId);

	show({
		edit,
		snapshot,
	}: {
		edit: RemoteEdit;
		snapshot: ProjectSnapshot;
	}): void {
		const ids = agentEditedClipIds({ edit, snapshot });
		for (const id of ids) {
			clearTimeout(this.#timers.get(id));
			this.#labels.set(id, edit.summary);
			this.#timers.set(
				id,
				setTimeout(() => {
					this.#labels.delete(id);
					this.#timers.delete(id);
					this.#emit();
				}, this.durationMs),
			);
		}
		if (ids.length) this.#emit();
	}

	clear(): void {
		for (const timer of this.#timers.values()) clearTimeout(timer);
		this.#timers.clear();
		this.#labels.clear();
		this.#emit();
	}

	#emit(): void {
		for (const listener of this.#listeners) listener();
	}
}
