import { NextResponse } from "next/server";

import { CollabAgent, runAgent } from "@opencut/collab-agent";
import type { AgentMode } from "@opencut/collab-agent";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROJECT_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export async function POST(request: Request) {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return NextResponse.json(
			{ error: "OPENAI_API_KEY is not set on the server" },
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

	const agent = await CollabAgent.open({
		uri,
		database,
		projectId: parsed.projectId,
		name: "AI Agent",
	});

	try {
		const outcome = await runAgent({
			agent,
			prompt: parsed.prompt,
			mode: parsed.mode,
			apiKey,
		});
		return NextResponse.json(outcome);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return NextResponse.json({ error: message }, { status: 502 });
	} finally {
		agent.close();
	}
}

function parseBody(body: unknown):
	| { projectId: string; prompt: string; mode: AgentMode }
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

	return { projectId, prompt: prompt.trim(), mode };
}
