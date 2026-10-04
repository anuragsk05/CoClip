/**
 * An AI agent attached to a shared project.
 *
 * The agent is a collaborator, not a service: it opens the same
 * {@link CollabSession} a human editor opens, sends the same commands, and is
 * subject to the same reducer validation. The only thing that marks it out is
 * that it declares itself an agent, so its edits are attributable in history
 * and its presence is distinguishable in the UI.
 */

import { CollabSession, memoryTokenStore } from "@opencut/collab-client";
import type {
	Collaborator,
	EditorCommand,
	ProjectSnapshot,
	RemoteEdit,
	TokenStore,
} from "@opencut/collab-client";

import { TOOLS, TOOLS_BY_NAME, type Tool } from "./tools";
import { describeProject, toProjectView, type ProjectView } from "./view";

export interface AgentOptions {
	uri: string;
	database: string;
	projectId: string;
	name?: string;
	color?: string;
	/** Defaults to an in-memory store so each process is its own identity. */
	tokenStore?: TokenStore;
}

export interface ToolResult {
	tool: string;
	ok: boolean;
	/** What the agent should be told happened, in its own vocabulary. */
	detail: string;
}

export class CollabAgent {
	#session: CollabSession;

	private constructor(session: CollabSession) {
		this.#session = session;
	}

	static async open(options: AgentOptions): Promise<CollabAgent> {
		const session = await CollabSession.open({
			uri: options.uri,
			database: options.database,
			projectId: options.projectId,
			asAgent: true,
			// Media bytes can be hundreds of megabytes. The model only reads
			// asset names, and downloading them on a serverless function times out.
			includeMediaBytes: false,
			connectTimeoutMs: 15_000,
			profile: {
				name: options.name ?? "AI Agent",
				color: options.color ?? "#8b5cf6",
			},
			tokenStore: options.tokenStore ?? memoryTokenStore(),
		});
		return new CollabAgent(session);
	}

	get session(): CollabSession {
		return this.#session;
	}

	/** The tool definitions to hand to a model. */
	get tools(): Tool[] {
		return TOOLS;
	}

	snapshot(): ProjectSnapshot {
		return this.#session.snapshot();
	}

	view(): ProjectView {
		return toProjectView({ snapshot: this.#session.snapshot() });
	}

	/** The current timeline rendered for a prompt. */
	describe(): string {
		return describeProject(this.view());
	}

	collaborators(): Collaborator[] {
		return this.#session.collaborators();
	}

	onEdit(listener: (edit: RemoteEdit) => void): () => void {
		return this.#session.onEdit(listener);
	}

	/**
	 * Runs one tool call.
	 *
	 * Failures are returned rather than thrown. A model recovers from being told
	 * an edit was rejected; it cannot recover from an exception, and a rejected
	 * edit is a normal outcome when the model is reasoning about a timeline it
	 * only partly understands.
	 */
	async call({
		name,
		args,
	}: {
		name: string;
		args: Record<string, unknown>;
	}): Promise<ToolResult> {
		const tool = TOOLS_BY_NAME.get(name);
		if (!tool) {
			return { tool: name, ok: false, detail: `no such tool \`${name}\`` };
		}

		let command: EditorCommand;
		try {
			command = tool.toCommand(args);
		} catch (error) {
			return { tool: name, ok: false, detail: describeError(error) };
		}

		const resolved = this.#resolve(command);
		if (typeof resolved === "string") {
			return { tool: name, ok: false, detail: resolved };
		}

		try {
			await this.#session.dispatch(resolved);
		} catch (error) {
			return { tool: name, ok: false, detail: describeError(error) };
		}

		return { tool: name, ok: true, detail: summarise(resolved) };
	}

	close(): void {
		this.#session.close();
	}

	/**
	 * Fills in what the tool arguments left out, from current project state.
	 *
	 * Returns a message instead of a command when the project cannot support the
	 * edit — a clip id the model invented, say. Catching that here means the
	 * model gets a useful sentence rather than an opaque reducer rejection.
	 */
	#resolve(command: EditorCommand): EditorCommand | string {
		if (command.kind !== "moveClip" || command.targetTrackId !== "") {
			return command;
		}
		const clip = this.#session
			.snapshot()
			.clips.find((candidate) => candidate.id === command.clipId);
		if (!clip) {
			return `clip \`${command.clipId}\` is not in this project`;
		}
		return { ...command, targetTrackId: clip.trackId };
	}
}

function describeError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function summarise(command: EditorCommand): string {
	switch (command.kind) {
		case "moveClip":
			return `moved ${command.clipId} to ${command.startTime} ticks on ${command.targetTrackId}`;
		case "trimClip":
			return `trimmed ${command.clipId}`;
		case "splitClip":
			return `split ${command.clipId} keeping ${command.retain}`;
		case "deleteClip":
			return `deleted ${command.clipId}`;
		case "setVolume":
			return `set ${command.clipId} to ${command.volumeDb}dB`;
		case "addEffect":
			return `added ${command.effectType} to ${command.clipId}`;
		default:
			return `applied ${command.kind}`;
	}
}
