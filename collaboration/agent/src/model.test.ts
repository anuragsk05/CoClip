import { afterEach, expect, test } from "bun:test";

import type { CollabAgent, ToolResult } from "./agent";
import { runAgent } from "./model";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("sends a tool result back to Gemini before the final reply", async () => {
	const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
	globalThis.fetch = (async (url, init) => {
		const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
		requests.push({ url: String(url), body });
		const payload =
			requests.length === 1
				? {
						candidates: [
							{
								content: {
									role: "model",
									parts: [
										{
											functionCall: {
												name: "set_volume",
												args: { clipId: "clip-1", volumeDb: -6 },
											},
										},
									],
								},
							},
						],
					}
				: {
						candidates: [
							{
								content: {
									role: "model",
									parts: [{ text: "Lowered the clip volume." }],
								},
							},
						],
					};
		return Response.json(payload);
	}) as typeof fetch;

	const toolResult: ToolResult = {
		tool: "set_volume",
		ok: true,
		detail: "set clip-1 to -6dB",
	};
	const agent = {
		call: async () => toolResult,
		describe: () => "Timeline: clip-1",
	} as unknown as CollabAgent;

	const outcome = await runAgent({
		agent,
		prompt: "Lower the volume.",
		apiKey: "test-key",
		model: "gemini-3.5-flash-lite",
	});

	expect(outcome.reply).toBe("Lowered the clip volume.");
	expect(outcome.events).toEqual([
		{
			type: "tool",
			name: "set_volume",
			args: { clipId: "clip-1", volumeDb: -6 },
		},
		{ type: "result", result: toolResult },
		{ type: "reply", text: "Lowered the clip volume." },
	]);
	expect(requests[0]?.url).toContain("gemini-3.5-flash-lite");
	expect(requests[1]?.body.contents).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				parts: expect.arrayContaining([
					expect.objectContaining({
						functionResponse: expect.objectContaining({
							name: "set_volume",
						}),
					}),
				]),
			}),
		]),
	);
});
