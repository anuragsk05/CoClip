import { NextResponse } from "next/server";

import {
	CollabAgent,
	runAgent,
	parsePromptContext,
} from "@opencut/collab-agent";
import type { AgentMode, PromptContext } from "@opencut/collab-agent";

export const runtime = "nodejs";
// Hobby projects on Fluid Compute allow 300s. Sixty seconds is what the
// function was dying at while it downloaded every media file.
export const maxDuration = 300;

const PROJECT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(request: Request) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "GEMINI_API_KEY is not set on the server" },
			{ status: 503 },
		);
	}

	const uri =
		process.env.SPACETIME_URI ??
		process.env.NEXT_PUBLIC_COLLAB_URI ??
		"ws://localhost:3000";
	const database =
		process.env.SPACETIME_DATABASE ??
		process.env.NEXT_PUBLIC_COLLAB_DATABASE ??
		"opencut-collab";

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "Expected JSON" }, { status: 400 });
	}

	const parsed = parseBody(body);
	if (typeof parsed === "string") {
		return NextResponse.json({ error: parsed }, { status: 400 });
	}

	let agent: CollabAgent | undefined;
	try {
		agent = await CollabAgent.open({
			uri,
			database,
			projectId: parsed.projectId,
			name: "AI Agent",
		});
		const outcome = await runAgent({
			agent,
			prompt: parsed.prompt,
			mode: parsed.mode,
			context: parsed.context,
			apiKey,
		});
		return NextResponse.json(outcome);
	} catch (error) {
		return NextResponse.json(
			{ error: agentErrorMessage(error) },
			{ status: 502 },
		);
	} finally {
		agent?.close();
	}
}

function agentErrorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	if (
		message.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") ||
		message.includes("UNAUTHENTICATED") ||
		message.includes("API_KEY_INVALID")
	) {
		return "Gemini rejected the API key. Create a new key in AI Studio, put the full key in GEMINI_API_KEY, and restart the dev server.";
	}

	try {
		const parsed = JSON.parse(message) as {
			error?: { message?: string };
		};
		if (parsed.error?.message) {
			return parsed.error.message;
		}
	} catch {
		// The thrown message was already plain text.
	}

	return message;
}

function parseBody(
	body: unknown,
):
	| {
			projectId: string;
			prompt: string;
			mode: AgentMode;
			context?: PromptContext;
	  }
	| string {
	if (typeof body !== "object" || body === null) {
		return "Body must be an object";
	}
	const record = body as Record<string, unknown>;
	const projectId = record.projectId;
	const prompt = record.prompt;
	const mode = record.mode === "goal" ? "goal" : "chat";

	if (typeof projectId !== "string" || !PROJECT_ID.test(projectId)) {
		return "projectId is required";
	}
	if (typeof prompt !== "string" || prompt.trim().length === 0) {
		return "prompt is required";
	}

	const context = parsePromptContext(record.context);
	if (typeof context === "string") return context;
	return { projectId, prompt: prompt.trim(), mode, context };
}
