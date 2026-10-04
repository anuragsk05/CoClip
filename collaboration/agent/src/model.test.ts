import { afterEach, expect, test } from "bun:test";

import type { CollabAgent, ToolResult } from "./agent";
import { runAgent } from "./model";

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

test("returns function output to OpenAI before requesting a final reply", async () => {
	const requests: Array<Record<string, unknown>> = [];
	globalThis.fetch = (async (_url, init) => {
		const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
		requests.push(request);
		return Response.json(
			requests.length === 1
				? {
						output: [
							{
								type: "function_call",
								call_id: "call-1",
								name: "set_volume",
								arguments: '{"clipId":"clip-1","volumeDb":-6}',
							},
						],
					}
				: { output: [], output_text: "Lowered the clip volume." },
		);
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
		model: "test-model",
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
	expect(requests[0]).toMatchObject({
		model: "test-model",
		store: false,
		reasoning: { effort: "low" },
	});
	expect(requests[1]?.input).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ type: "function_call", call_id: "call-1" }),
			expect.objectContaining({
				type: "function_call_output",
				call_id: "call-1",
			}),
		]),
	);
});
