# Testing the agent UI locally

The prompt popover is `apps/web/src/collaboration/components/agent-panel.tsx`,
mounted in `apps/web/src/components/editor/editor-header.tsx`. Read the shared
`components/ui/popover.tsx`, `textarea.tsx`, `button.tsx`, and `scroll-area.tsx`
when adjusting their styles; they supply defaults.

Both Chat and Goal initially show just the header, prompt input, and submit
button. After submission, conversation content appears above the input, grows
with its content, and scrolls once it reaches its maximum height. New messages
scroll into view. Editing still uses `/api/collaboration/agent` and shared reducers.

## Start a local environment

Install Bun and the SpacetimeDB CLI, plus the Rust toolchain needed to build the
module. From the repository root, run `bun install`. Copy `apps/web/.env.example`
to `apps/web/.env.local` if it does not already exist, then add:

```dotenv
NEXT_PUBLIC_SITE_URL=http://localhost:3001
NEXT_PUBLIC_COLLAB_URI=ws://localhost:3000
NEXT_PUBLIC_COLLAB_DATABASE=opencut-collab
GEMINI_API_KEY=your-key
```

Keep the API key server-side. If `SPACETIME_URI` or `SPACETIME_DATABASE` is set,
ensure it also points at the local instance: the agent route prefers those values.
Use a local database so prompt testing edits local projects.

Start SpacetimeDB in one terminal:

```sh
spacetime start
```

Publish to that local instance from the repository root:

```sh
spacetime publish --server http://localhost:3000 --module-path collaboration/spacetimedb opencut-collab
```

Start the web app in another terminal:

```sh
cd apps/web
bun run dev --port 3001
```

Open http://localhost:3001, create/open a project, add a short clip, and open
**Agent** in the editor header. Port 3001 avoids the database's port 3000.
UI edits refresh automatically; restart Next.js after changing environment values.
Without collaboration configured, the Agent button is hidden. Without a Gemini
key, the UI opens but submitted prompts return a server configuration error.

## Manual checks before deployment

- Open Chat and Goal before submitting: neither has an empty conversation box.
- Submit a simple request such as muting a named clip: confirm the timeline/audio
  change and a readable reply. Try a Goal request too.
- Check the busy indicator and disabled input/send button during the request.
- Enter submits; Shift+Enter adds a newline.
- Send several requests or a long response: confirm scrolling shows the latest
  message and multiline text wraps inside the panel.
- Close/reopen the popover and check that messages remain visible.
- Open an edit invite in a second browser and confirm the agent edits sync.
  Open a view-only invite and confirm the Agent button is hidden.

From the repository root, run `bun run lint:web` and `bun run build:web` before
shipping. Local preview does not deploy anything.

## Selection-aware prompts

The panel shows the active scene and selected clip name/count. Each submission
captures that scene, selected clip ids, and playhead (converted from editor ticks
to seconds). Chat and Goal receive the same context. The agent describes the
active scene on each tool round-trip, and rejects missing scenes or selected
clips before starting the model loop. Existing CLI calls without context still
use the main scene.

Selection helps interpret “this clip” and “these clips”; it is not a hard edit
restriction. Explicit requests can refer to other clips in the active scene.

To test locally, add two clips, select one, and ask “Mute this clip.” Confirm
only that clip changes. Select both and ask “Mute these clips.” Try both modes,
then switch to a second scene and repeat. With no selection, a specific named
clip request should still work; an ambiguous “this clip” request should prompt
for clarification. Confirm the context label follows your selection and scene.
