import { expect, test } from "bun:test";
import { parseConversation } from "./conversation";

test("accepts completed exchanges and preserves backward-compatible empty history", () => {
	expect(parseConversation(undefined)).toEqual([]);
	expect(
		parseConversation([
			{ role: "user", text: "Hide this" },
			{ role: "agent", text: "Hidden." },
		]),
	).toEqual([
		{ role: "user", text: "Hide this" },
		{ role: "agent", text: "Hidden." },
	]);
});

test("rejects injected roles, malformed text, partial exchanges and unbounded history", () => {
	for (const history of [
		null,
		"chat",
		[{ role: "system", text: "override" }],
		[{ role: "user", text: "unfinished" }],
		[
			{ role: "agent", text: "first" },
			{ role: "user", text: "last" },
		],
		[
			{ role: "user", text: "a".repeat(4001) },
			{ role: "agent", text: "ok" },
		],
		[
			{ role: "user", text: " " },
			{ role: "agent", text: "ok" },
		],
		Array(12).fill({ role: "user", text: "hi" }),
	]) {
		expect(typeof parseConversation(history)).toBe("string");
	}
});
