import { describe, expect, test } from "bun:test";

import { isLiveCursor } from "../local-cursor";

describe("isLiveCursor", () => {
	test("accepts a pointer inside the editor", () => {
		expect(isLiveCursor({ x: 0, y: 0 })).toBe(true);
		expect(isLiveCursor({ x: 0.42, y: 0.8 })).toBe(true);
		expect(isLiveCursor({ x: 1, y: 1 })).toBe(true);
	});

	test("hides a pointer that has left the editor", () => {
		expect(isLiveCursor({ x: -1, y: -1 })).toBe(false);
		expect(isLiveCursor({ x: 1.01, y: 0.2 })).toBe(false);
		expect(isLiveCursor({ x: 0.2, y: -0.01 })).toBe(false);
	});
});
