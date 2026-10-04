/**
 * Gemini loop over {@link CollabAgent}.
 *
 * The model only sees clip ids, seconds, and tool names. Every mutation still
 * goes through `agent.call`, which maps to one reducer. There is no path for
 * the model to write the database itself.
 *
 * Default model is Gemini 3.5 Flash-Lite. It is free on the Developer API
 * free tier and is the high-volume model, so a testing session of many short
 * prompts fits before the daily quota resets. Override with GEMINI_MODEL.
 */

import {
	ApiError,
	FunctionCallingConfigMode,
	GoogleGenAI,
	ThinkingLevel,
	type Content,
	type FunctionDeclaration,
} from "@google/genai";

import type { CollabAgent, ToolResult } from "./agent";
import { EDITING_INSTRUCTIONS } from "./instructions";
import { parseConversation, type ConversationTurn } from "./conversation";
import { TOOLS } from "./tools";
import { parsePromptContext, type PromptContext } from "./prompt-context";

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export type AgentMode = "chat" | "goal";

export type AgentEvent =
	| { type: "tool"; name: string; args: Record<string, unknown> }
	| { type: "result"; result: ToolResult }
	| { type: "reply"; text: string };

export interface RunOptions {
	agent: CollabAgent;
	prompt: string;
	context?: PromptContext;
	history?: ConversationTurn[];
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
- Interpret “this clip” or “these clips” using the selected clip ids in the request context.
- Selection is context, not permission to ignore an explicit request about other clips.
- With no selection, ask for clarification when the target is ambiguous.
- Prefer the smallest edit that satisfies the request.
- If a tool comes back rejected, read the reason and try a different edit or
  explain why you stopped.
- After you are done, reply in one or two short sentences saying what changed.`;

export async function runAgent(options: RunOptions): Promise<RunOutcome> {
	const history = parseConversation(options.history);
	if (typeof history === "string") throw new Error(history);
	const context = parsePromptContext(options.context);
	if (typeof context === "string") throw new Error(context);
	if (context) {
		if (
			!options.agent
				.snapshot()
				.scenes.some((scene) => scene.id === context.sceneId)
		) {
			throw new Error(
				"The selected scene no longer exists. Reopen the agent and try again.",
			);
		}
		const clipIds = new Set(
			options.agent
				.view(context.sceneId)
				.tracks.flatMap((track) => track.clips.map((clip) => clip.id)),
		);
		if (context.selectedClipIds.some((id) => !clipIds.has(id))) {
			throw new Error(
				"A selected clip is no longer in this scene. Select your clips again and retry.",
			);
		}
	}
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
		...history.map(
			(turn): Content => ({
				role: turn.role === "agent" ? "model" : "user",
				parts: [{ text: turn.text }],
			}),
		),
		{
			role: "user",
			parts: [
				{
					text: composeUserTurn({
						agent: options.agent,
						prompt: options.prompt,
						mode,
						context,
					}),
				},
			],
		},
	];

	for (let step = 0; step < maxSteps; step += 1) {
		const response = await generateContent(ai, {
			model,
			contents,
			config: {
				systemInstruction: `${SYSTEM}\n${EDITING_INSTRUCTIONS}`,
				tools: [{ functionDeclarations: toDeclarations() }],
				toolConfig: {
					functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO },
				},
				thinkingConfig: {
					// Low thinking keeps each prompt inside the free daily token budget.
					thinkingLevel: ThinkingLevel.LOW,
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
						timeline: options.agent.describe(context?.sceneId),
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
	context,
}: {
	agent: CollabAgent;
	prompt: string;
	mode: AgentMode;
	context?: PromptContext;
}): string {
	const heading =
		mode === "goal"
			? "Goal — keep editing until this is done, then stop."
			: "Request — do only what is asked.";

	const selection = context
		? `\n\nRequest context (captured when submitted):\n${JSON.stringify(context)}\nPlayhead is in seconds on this scene's timeline. Selected ids identify what “this” refers to; an empty list means no clips are selected.`
		: "";
	return `${heading}\n\n${prompt}${selection}\n\nCurrent timeline:\n${agent.describe(context?.sceneId)}`;
}

function toDeclarations(): FunctionDeclaration[] {
	return TOOLS.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parametersJsonSchema: tool.parameters,
	}));
}

const OVERLOAD_ATTEMPTS = 4;

async function generateContent(
	ai: GoogleGenAI,
	request: Parameters<GoogleGenAI["models"]["generateContent"]>[0],
) {
	let lastError: unknown;
	for (let attempt = 0; attempt < OVERLOAD_ATTEMPTS; attempt += 1) {
		try {
			return await ai.models.generateContent(request);
		} catch (error) {
			lastError = error;
			if (!isModelOverloaded(error) || attempt === OVERLOAD_ATTEMPTS - 1) {
				throw error;
			}
			await delay(1000 * 2 ** attempt);
		}
	}
	throw lastError;
}

function isModelOverloaded(error: unknown): boolean {
	if (error instanceof ApiError && error.status === 503) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("UNAVAILABLE") || message.includes("high demand");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
