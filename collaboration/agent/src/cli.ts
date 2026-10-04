/**
 * Demo entry point: attach the agent to a live project and run one prompt.
 *
 *   OPENAI_API_KEY=... bun src/cli.ts --project <id> "cut the first 3 seconds off clip 2"
 *   OPENAI_API_KEY=... bun src/cli.ts --project <id> --goal "tighten the pacing"
 */

import { CollabAgent } from "./agent";
import { runAgent, type AgentMode } from "./model";

const URI = process.env.SPACETIME_URI ?? "ws://localhost:3000";
const DATABASE = process.env.SPACETIME_DATABASE ?? "opencut-collab";

const args = process.argv.slice(2);
const mode: AgentMode = args.includes("--goal") ? "goal" : "chat";
const projectFlag = args.indexOf("--project");
const projectId =
	projectFlag >= 0 ? args[projectFlag + 1] : process.env.COLLAB_PROJECT_ID;
const prompt = args
	.filter(
		(arg, index) =>
			arg !== "--goal" &&
			arg !== "--project" &&
			index !== projectFlag + 1,
	)
	.join(" ")
	.trim();

if (!projectId || !prompt) {
	console.error(
		"usage: bun src/cli.ts --project <id> [--goal] \"<prompt>\"",
	);
	process.exit(1);
}

const agent = await CollabAgent.open({
	uri: URI,
	database: DATABASE,
	projectId,
});

try {
	const { reply } = await runAgent({
		agent,
		prompt,
		mode,
		onEvent: (event) => {
			if (event.type === "tool") {
				console.log(`→ ${event.name}`, event.args);
			} else if (event.type === "result") {
				console.log(
					`  ${event.result.ok ? "ok" : "rejected"}: ${event.result.detail}`,
				);
			}
		},
	});
	console.log(reply);
} finally {
	agent.close();
}
