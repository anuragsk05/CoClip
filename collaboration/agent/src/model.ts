/**
 * Gemini loop over {@link CollabAgent}.
 *
 * The model only sees clip ids, seconds, and tool names. Every mutation still
 * goes through `agent.call`, which maps to one reducer. There is no path for
 * the model to write the database itself.
 *
 * Default model is Gemini 3.8 Flash: it is free on the Gemini Developer API
 * free tier, which is what an MVP demo can actually spend.
 */

import {
	FunctionCallingConfigMode,
	GoogleGenAI,
	ThinkingLevel,
	type Content,
	type FunctionDeclaration,
} from "@google/genai";

import type { CollabAgent, ToolResult } from "./agent";
import { TOOLS } from "./tools";

export const DEFAULT_MODEL = "gemini-3.8-flash";

export type AgentMode = "chat" | "goal";

export type AgentEvent =
	| { type: "tool"; name: string; args: Record<string, unknown> }
	| { type: "result"; result: ToolResult }
	| { type: "reply"; text: string };

export interface RunOptions {
	agent: CollabAgent;
	prompt: string;
	mode?: AgentMode;
	apiKey?: string;
	model?: string;
	/** Hard cap on model round-trips. Chat stays short; a goal may take more. */
	maxSteps?: number;
	onEvent?: (event: AgentEvent) => void;
}

export interface RunOutcome {
	reply: string;
	events: AgentEvent[];
}

const SYSTEM = `You are a collaborator on a shared video-editing project.

You edit through tools only. Each tool is one timeline operation (move, trim,
split, delete, volume, effects). There is no privileged AI API — a human
editor can do everything you can.

Rules:
- Use the clip and track ids from the project listing. Never invent ids.
- Times are seconds on the timeline, not ticks and not frames.
- Prefer the smallest edit that satisfies the request.
- If a tool comes back rejected, read the reason and try a different edit or
  explain why you stopped.
- After you are done, reply in one or two short sentences saying what changed.`;

export async function runAgent(options: RunOptions): Promise<RunOutcome> {
	const mode = options.mode ?? "chat";
	const maxSteps = options.maxSteps ?? (mode === "goal" ? 12 : 6);
	const model = options.model ?? process.env.GEMINI_MODEL ?? DEFAULT_MODEL;
	const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error("GEMINI_API_KEY is not set");
	}

	const ai = new GoogleGenAI({ apiKey });
	const events: AgentEvent[] = [];
	const emit = (event: AgentEvent) => {
		events.push(event);
		options.onEvent?.(event);
	};

	const contents: Content[] = [
		{
			role: "user",
			parts: [{ text: composeUserTurn({ agent: options.agent, prompt: options.prompt, mode }) }],
		},
	];

	for (let step = 0; step < maxSteps; step += 1) {
		const response = await ai.models.generateContent({
			model,
			contents,
			config: {
				systemInstruction: SYSTEM,
				tools: [{ functionDeclarations: toDeclarations() }],
				toolConfig: {
					functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
				},
				thinkingConfig: {
					thinkingLevel:
						mode === "goal" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL,
				},
			},
		});

		const modelContent = response.candidates?.[0]?.content;
		if (modelContent) {
			contents.push(modelContent);
		}

		const calls = response.functionCalls ?? [];
		if (calls.length === 0) {
			const reply = response.text?.trim() || "Done.";
			emit({ type: "reply", text: reply });
			return { reply, events };
		}

		const results: ToolResult[] = [];
		for (const call of calls) {
			const name = call.name ?? "";
			const args = call.args ?? {};
			emit({ type: "tool", name, args });
			const result = await options.agent.call({ name, args });
			emit({ type: "result", result });
			results.push(result);
		}

		contents.push({
			role: "user",
			parts: calls.map((call, index) => ({
				functionResponse: {
					id: call.id,
					name: call.name,
					response: {
						ok: results[index]?.ok ?? false,
						detail: results[index]?.detail ?? "no result",
						timeline: options.agent.describe(),
					},
				},
			})),
		});
	}

	const reply = `Stopped after ${maxSteps} steps.`;
	emit({ type: "reply", text: reply });
	return { reply, events };
}

function composeUserTurn({
	agent,
	prompt,
	mode,
}: {
	agent: CollabAgent;
	prompt: string;
	mode: AgentMode;
}): string {
	const heading =
		mode === "goal"
			? "Goal — keep editing until this is done, then stop."
			: "Request — do only what is asked.";

	return `${heading}\n\n${prompt}\n\nCurrent timeline:\n${agent.describe()}`;
}

function toDeclarations(): FunctionDeclaration[] {
	return TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parametersJsonSchema: tool.parameters,
	}));
}
