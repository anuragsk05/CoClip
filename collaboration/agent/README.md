# AI agent adapter

The agent is a collaborator, not a service. It opens the same
`CollabSession` a human editor opens and calls the same reducers.

Do not create a privileged AI-only mutation API. Tools map directly to
`move_clip`, `trim_clip`, `split_clip`, `delete_clip`, `set_volume`,
`add_effect`, and the rest of the catalog in `src/tools.ts`.

The agent uses the OpenAI Responses API. Its default model is `gpt-6-astra`;
set `OPENAI_API_KEY`, and optionally `OPENAI_MODEL` to use a different model.
