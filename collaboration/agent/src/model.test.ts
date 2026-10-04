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

for (const mode of ["chat", "goal"] as const) {
	test(`${mode} sends selected clips, active scene, and playhead and keeps that scene after tools`, async () => {
		const requests: Record<string, unknown>[] = [];
		const describedScenes: Array<string | undefined> = [];
		const calls: unknown[] = [];
		globalThis.fetch = (async (_url, init) => {
			requests.push(JSON.parse(String(init?.body)));
			return Response.json({
				candidates: [
					{
						content: {
							role: "model",
							parts:
								requests.length === 1
									? [
											{
												functionCall: {
													name: "set_clip_muted",
													args: { clipId: "clip-selected", muted: true },
												},
											},
										]
									: [{ text: "Muted your selected clip." }],
						},
					},
				],
			});
		}) as typeof fetch;
		const agent = {
			snapshot: () => ({ scenes: [{ id: "scene-second" }] }),
			view: (sceneId: string) => {
				expect(sceneId).toBe("scene-second");
				return {
					tracks: [{ clips: [{ id: "clip-selected" }, { id: "clip-other" }] }],
				};
			},
			describe: (sceneId?: string) => {
				describedScenes.push(sceneId);
				return "Second scene timeline";
			},
			call: async (call: unknown) => {
				calls.push(call);
				return {
					tool: "set_clip_muted",
					ok: true,
					detail: "Muted clip-selected",
				};
			},
		} as unknown as CollabAgent;
		const outcome = await runAgent({
			agent,
			mode,
			prompt: "Mute this clip",
			apiKey: "test-key",
			context: {
				sceneId: "scene-second",
				selectedClipIds: ["clip-selected"],
				playheadSeconds: 12.5,
			},
		});
		const firstRequest = JSON.stringify(requests[0]);
		expect(firstRequest).toContain(
			'\\"selectedClipIds\\":[\\"clip-selected\\"]',
		);
		expect(firstRequest).toContain('\\"playheadSeconds\\":12.5');
		expect(firstRequest).toContain("Second scene timeline");
		expect(describedScenes).toEqual(["scene-second", "scene-second"]);
		expect(calls).toEqual([
			{
				name: "set_clip_muted",
				args: { clipId: "clip-selected", muted: true },
			},
		]);
		expect(outcome.reply).toBe("Muted your selected clip.");
	});
}

test("rejects stale selection before asking the model or editing", async () => {
	globalThis.fetch = (() => {
		throw new Error("Must not call model");
	}) as unknown as typeof fetch;
	const agent = {
		snapshot: () => ({ scenes: [{ id: "scene-1" }] }),
		view: () => ({ tracks: [{ clips: [{ id: "other-clip" }] }] }),
	} as unknown as CollabAgent;
	await expect(
		runAgent({
			agent,
			prompt: "Delete this",
			apiKey: "test-key",
			context: {
				sceneId: "scene-1",
				selectedClipIds: ["deleted-clip"],
				playheadSeconds: 0,
			},
		}),
	).rejects.toThrow("selected clip is no longer");
	await expect(
		runAgent({
			agent,
			prompt: "Delete this",
			apiKey: "test-key",
			context: {
				sceneId: "deleted-scene",
				selectedClipIds: [],
				playheadSeconds: 0,
			},
		}),
	).rejects.toThrow("selected scene no longer");
});

test("includes follow-up memory and editing playbook without replaying old operations", async () => {
	let request: Record<string, unknown> = {};
	let toolCalls = 0;
	globalThis.fetch = (async (_url, init) => {
		request = JSON.parse(String(init?.body));
		return Response.json({
			candidates: [
				{
					content: {
						role: "model",
						parts: [{ text: "Which clip should I change?" }],
					},
				},
			],
		});
	}) as typeof fetch;
	const agent = {
		describe: () => "Current timeline: photo-b is visible",
		call: async () => {
			toolCalls++;
		},
	} as unknown as CollabAgent;
	await runAgent({
		agent,
		apiKey: "test-key",
		prompt: "Do the same again",
		history: [
			{ role: "user", text: "Hide photo-a" },
			{ role: "agent", text: "Hidden photo-a." },
		],
	});
	const contents = request.contents as Array<{
		role: string;
		parts: Array<{ text: string }>;
	}>;
	expect(contents[0]).toEqual({
		role: "user",
		parts: [{ text: "Hide photo-a" }],
	});
	expect(contents[1]).toEqual({
		role: "model",
		parts: [{ text: "Hidden photo-a." }],
	});
	expect(contents[2]?.parts[0]?.text).toContain(
		"Current timeline: photo-b is visible",
	);
	expect(JSON.stringify(request)).toContain("Earlier chat is background");
	expect(JSON.stringify(request)).toContain(
		"setting trimStart/trimEnd alone does not change duration",
	);
	expect(toolCalls).toBe(0);
});
