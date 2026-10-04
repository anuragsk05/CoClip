# OpenCut collaboration

SpacetimeDB-backed multiplayer for the editor. Media is cached locally and shared through database chunks; the
editor keeps its existing UI; every mutation goes through one adapter into
one set of reducers. Humans and the AI agent share that surface.

See [architecture.md](architecture.md) for the diagram.

## What is here

| Path | Role |
| --- | --- |
| `spacetimedb/` | Rust module: tables + reducers. Geometry comes from `rust/crates/timeline`. |
| `client/` | Collaboration adapter. The only path into SpacetimeDB. |
| `agent/` | AI collaborator. Same adapter, same reducers, Gemini 3.5 Flash-Lite. |

## Local setup

You need the [SpacetimeDB CLI](https://spacetimedb.com/install) and a Gemini
API key from [Google AI Studio](https://aistudio.google.com/apikey).

```bash
# 1. Start a local database
spacetime start

# 2. Publish the module (from this folder)
spacetime publish --server http://localhost:3000 --module-path ./spacetimedb opencut-collab

# 3. Point the web app at it
#    apps/web/.env.local
NEXT_PUBLIC_COLLAB_URI=ws://localhost:3000
NEXT_PUBLIC_COLLAB_DATABASE=opencut-collab
GEMINI_API_KEY=your-key
```

From the repository root, run `cd apps/web` and `bun run dev --port 3001`. Open
http://localhost:3001 (SpacetimeDB uses port 3000). Open the same project in two
browsers: edits, presence, and the Agent button in the header all share the
project. Without `NEXT_PUBLIC_COLLAB_URI` the editor is unchanged.

Regenerate TypeScript bindings after a schema change:

```bash
cd collaboration/client
bun run generate
```

## Agent

The configured default model is `gemini-3.5-flash-lite`. Override it with
`GEMINI_MODEL`. The agent reads textual timeline metadata, including clip ids,
asset names, and timing; it does not inspect video frames or listen to audio.
Chat allows up to six model round-trips; Goal allows up to twelve.

It has two modes:

- **Chat** — one request, e.g. “cut the first 3 seconds off the first clip”.
- **Goal** — several edits toward a brief, e.g. “tighten the pacing”.

Every tool maps to one reducer (`move_clip`, `trim_clip`, `split_clip`,
`delete_clip`, `set_volume`, `add_effect`, …). There is no AI-only write path.

From the CLI:

```bash
cd collaboration/agent
GEMINI_API_KEY=... bun src/cli.ts --project <project-id> "mute the B-roll"
GEMINI_API_KEY=... bun src/cli.ts --project <project-id> --goal "tighten the pacing"
```

## Known limits

- Video, audio, and image bytes are shared through SpacetimeDB in 256 KiB
  chunks and saved into browser storage on receiving clients. The browser
  upload limit is 512 MiB per file. Large uploads add database/subscription load.
- Clip and track ids are globally unique (the editor already generates UUIDs).
- `edit_history` is subscribed in full per project.
- Tables are `public`; project scoping is done by subscription SQL, not
  visibility filters.

## Sessions and UI

Hosts can start/end live sessions, create view/edit invites, remove participants,
and change access. Reducers enforce write permissions. There is a limit of four
active human editors. Presence includes cursors, selection, playhead, and playback.
The agent prompt UI is compact until a request is submitted; replies and tool
activity then appear in a conversation that grows up to a scrollable maximum.
See [local UI testing](../docs/agent-ui-development.md).

## Team chat and agent memory

The web header includes project chat for active collaborators, including viewers.
Rust `chat.rs` validates writes and retains the latest 200 messages per project,
without changing edit revisions. Publish the updated module before running the
updated client. Chat follows the existing public-table read model.

Agent prompts carry up to five recent completed exchanges from the local agent
panel. Current scene/selection/state take precedence. Team chat is not passed
to the model. The bundled playbook in `agent/src/instructions.ts` is explicitly
loaded by the model loop. See [testing instructions](../docs/agent-ui-development.md).
