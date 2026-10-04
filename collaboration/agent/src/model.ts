/**
 * OpenAI Responses API loop over {@link CollabAgent}.
 *
 * The model only sees clip ids, seconds, and tool names. Every mutation still
 * goes through `agent.call`, which maps to one reducer. There is no path for
 * the model to write the database itself.
 */

import type { CollabAgent, ToolResult } from "./agent";
import { TOOLS } from "./tools";

/** The current flagship model; override with OPENAI_MODEL when needed. */
export const DEFAULT_MODEL = "gpt-6-astra";

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

interface ResponseFunctionCall extends Record<string, unknown> {
	type: "function_call";
	call_id: string;
	name: string;
	arguments: string;
}

interface OpenAIResponse {
	output: Array<Record<string, unknown>>;
	output_text?: string;
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
	const model = options.model ?? process.env.OPENAI_MODEL ?? DEFAULT_MODEL;
	const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
	if (!apiKey) {
		throw new Error("OPENAI_API_KEY is not set");
	}

	const events: AgentEvent[] = [];
	const emit = (event: AgentEvent) => {
		events.push(event);
		options.onEvent?.(event);
	};
	const input: Array<Record<string, unknown>> = [
		{
			role: "user",
			content: composeUserTurn({
				agent: options.agent,
				prompt: options.prompt,
				mode,
			}),
		},
	];

	for (let step = 0; step < maxSteps; step += 1) {
		const response = await createResponse({ apiKey, model, mode, input });
		const calls = response.output.filter(isFunctionCall);
		if (calls.length === 0) {
			const reply = response.output_text?.trim() || "Done.";
			emit({ type: "reply", text: reply });
			return { reply, events };
		}

		// Responses may contain reasoning and function-call items. Returning the
		// complete output preserves the model's context for the next round.
		input.push(...response.output);
		for (const call of calls) {
			const args = parseToolArguments(call.arguments);
			emit({ type: "tool", name: call.name, args });
			const result = await options.agent.call({ name: call.name, args });
			emit({ type: "result", result });

			input.push({
				type: "function_call_output",
				call_id: call.call_id,
				output: JSON.stringify({
					ok: result.ok,
					detail: result.detail,
					timeline: options.agent.describe(),
				}),
			});
		}
	}

	const reply = `Stopped after ${maxSteps} steps.`;
	emit({ type: "reply", text: reply });
	return { reply, events };
}

async function createResponse({
	apiKey,
	model,
	mode,
	input,
}: {
	apiKey: string;
	model: string;
	mode: AgentMode;
	input: Array<Record<string, unknown>>;
}): Promise<OpenAIResponse> {
	return withRetry(async () => {
		const response = await fetch("https://api.openai.com/v1/responses", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				instructions: SYSTEM,
				input,
				tools: toFunctionTools(),
				reasoning: { effort: mode === "goal" ? "medium" : "low" },
				// Timeline state can contain private project details. The server owns
				// the turn history, so no OpenAI-side response storage is required.
				store: false,
			}),
		});

		if (!response.ok) {
			throw new OpenAIRequestError({
				status: response.status,
				message: await responseMessage(response),
			});
		}

		const payload: unknown = await response.json();
		if (!isOpenAIResponse(payload)) {
			throw new Error("OpenAI returned an invalid Responses payload");
		}
		return payload;
	});
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

function toFunctionTools(): Array<Record<string, unknown>> {
	return TOOLS.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters,
		strict: false,
	}));
}

function isFunctionCall(
	item: Record<string, unknown>,
): item is ResponseFunctionCall {
	return (
		item.type === "function_call" &&
		typeof item.call_id === "string" &&
		typeof item.name === "string" &&
		typeof item.arguments === "string"
	);
}

function parseToolArguments(raw: string): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			!Array.isArray(parsed)
		) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// The existing tool validator will turn this into an actionable result.
	}
	return {};
}

function isOpenAIResponse(value: unknown): value is OpenAIResponse {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as OpenAIResponse).output)
	);
}

class OpenAIRequestError extends Error {
	readonly status: number;

	constructor({ status, message }: { status: number; message: string }) {
		super(`OpenAI request failed (${status}): ${message}`);
		this.status = status;
	}
}

const RETRY_ATTEMPTS = 4;

async function withRetry<T>(request: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
		try {
			return await request();
		} catch (error) {
			lastError = error;
			if (!isRetryable(error) || attempt === RETRY_ATTEMPTS - 1) {
				throw error;
			}
			await delay(1000 * 2 ** attempt);
		}
	}
	throw lastError;
}

function isRetryable(error: unknown): boolean {
	return (
		error instanceof OpenAIRequestError &&
		(error.status === 408 ||
			error.status === 409 ||
			error.status === 429 ||
			error.status >= 500)
	);
}

async function responseMessage(response: Response): Promise<string> {
	try {
		const message = (await response.text()).trim();
		return message || response.statusText;
	} catch {
		return response.statusText;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
