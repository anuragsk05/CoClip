# OpenCut collaboration

SpacetimeDB-backed multiplayer for the editor. Media stays in storage; the
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
spacetime publish --project-path ./spacetimedb opencut-collab

# 3. Point the web app at it
#    apps/web/.env.local
NEXT_PUBLIC_COLLAB_URI=ws://localhost:3000
NEXT_PUBLIC_COLLAB_DATABASE=opencut-collab
GEMINI_API_KEY=your-key
```

Then `bun run dev:web` from the repo root. Open the same project in two
browsers: edits, presence, and the Agent button in the header all share the
project. Without `NEXT_PUBLIC_COLLAB_URI` the editor is unchanged.

Regenerate TypeScript bindings after a schema change:

```bash
cd collaboration/client
bun run generate
```

## Agent

The model is **Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`). It is free
on the Gemini Developer API free tier and is the high-volume model, so a run
of short prompts lasts longer than Gemini 3.8 Flash. Override it with
`GEMINI_MODEL`.

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

- Media bytes are still local. Clips register as `storage: "local"` with
  `location: asset.id`. Cross-machine playback needs an S3/R2 upload that
  re-registers the same asset.
- Clip and track ids are globally unique (the editor already generates UUIDs).
- `edit_history` is subscribed in full per project.
- Tables are `public`; project scoping is done by subscription SQL, not
  visibility filters.
