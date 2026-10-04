/** Request-time editor context; timing is seconds, like the agent tools. */
export interface PromptContext {
	sceneId: string;
	selectedClipIds: string[];
	playheadSeconds: number;
}

export function parsePromptContext(
	value: unknown,
): PromptContext | undefined | string {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return "context must be an object";
	}
	const context = value as Record<string, unknown>;
	const validId = (id: unknown): id is string =>
		typeof id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(id);
	if (!validId(context.sceneId)) return "context.sceneId is required";
	if (
		!Array.isArray(context.selectedClipIds) ||
		context.selectedClipIds.length > 1000 ||
		!context.selectedClipIds.every(validId)
	) {
		return "context.selectedClipIds must be an array of clip ids (maximum 1000)";
	}
	if (
		typeof context.playheadSeconds !== "number" ||
		!Number.isFinite(context.playheadSeconds) ||
		context.playheadSeconds < 0
	) {
		return "context.playheadSeconds must be a finite, non-negative number";
	}
	return {
		sceneId: context.sceneId,
		selectedClipIds: [...new Set(context.selectedClipIds)],
		playheadSeconds: context.playheadSeconds,
	};
}
