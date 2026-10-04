import { expect, test } from "bun:test";
import { parsePromptContext } from "./prompt-context";

test("context is optional for existing callers and empty selection is valid", () => {
	expect(parsePromptContext(undefined)).toBeUndefined();
	expect(
		parsePromptContext({
			sceneId: "scene-2",
			selectedClipIds: [],
			playheadSeconds: 0,
		}),
	).toEqual({
		sceneId: "scene-2",
		selectedClipIds: [],
		playheadSeconds: 0,
	});
});

test("rejects malformed context and normalizes duplicate selection ids", () => {
	const valid = {
		sceneId: "scene-2",
		selectedClipIds: ["clip-1", "clip-1"],
		playheadSeconds: 1.25,
	};
	expect(parsePromptContext(valid)).toEqual({
		...valid,
		selectedClipIds: ["clip-1"],
	});
	for (const value of [
		null,
		[],
		"context",
		{ ...valid, sceneId: "" },
		{ ...valid, selectedClipIds: [3] },
		{ ...valid, selectedClipIds: Array(1001).fill("clip-1") },
		{ ...valid, playheadSeconds: -1 },
		{ ...valid, playheadSeconds: NaN },
		{ ...valid, playheadSeconds: Infinity },
		{ ...valid, playheadSeconds: "1" },
	]) {
		expect(typeof parsePromptContext(value)).toBe("string");
	}
});
