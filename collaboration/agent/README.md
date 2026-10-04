# AI agent adapter

The agent is a collaborator, not a service. It opens the same
`CollabSession` a human editor opens and calls the same reducers.

Do not create a privileged AI-only mutation API. Tools map directly to
`move_clip`, `trim_clip`, `split_clip`, `delete_clip`, `set_volume`,
`add_effect`, and the rest of the catalog in `src/tools.ts`.

The default model is Gemini 3.5 Flash-Lite (`gemini-3.5-flash-lite`) via
`@google/genai`. Set `GEMINI_API_KEY`. Optionally set `GEMINI_MODEL`.
