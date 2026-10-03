# Architecture

```text
               Media Storage
          (local / S3 / Cloudflare R2)
                    │
                    ↓
             Asset references
                    │
                    ↓
┌────────────── OpenCut Client ──────────────┐
│                                            │
│ Timeline UI                                │
│ Preview                                    │
│ Track controls                             │
│ Clip interactions                          │
│ Existing editor behavior                   │
│                                            │
└──────────────────┬─────────────────────────┘
                   │
                   │ editor commands
                   ↓
          Collaboration Adapter
                   │
                   ↓
┌───────────── SpacetimeDB ──────────────────┐
│                                            │
│ Projects                                   │
│ Tracks                                     │
│ Clips                                      │
│ Effects                                    │
│ Presence                                   │
│ Edit History                               │
│ Users                                      │
│ Metadata                                   │
│                                            │
│ Reducers                                   │
│ move_clip()                                │
│ trim_clip()                                │
│ split_clip()                               │
│ delete_clip()                              │
│ set_volume()                               │
│ add_effect()                               │
│ etc.                                       │
│                                            │
└───────────────┬───────────────┬────────────┘
                ↑               ↑
                │               │
           Editor A         Editor B

                       ↑
                       │
                    AI Agent
```

## Flow

Media bytes stay in local storage, S3, or Cloudflare R2. The editor only receives asset references.

The OpenCut client keeps its existing editor: timeline UI, preview, track controls, and clip interactions. Those actions leave the client as editor commands.

The collaboration adapter is the only path from an OpenCut client into SpacetimeDB. It turns editor commands into reducers and applies subscribed state back into the local editor.

SpacetimeDB is the canonical shared project: projects, tracks, clips, effects, presence, edit history, users, and metadata. Human editors and the AI agent call the same reducers (`move_clip`, `trim_clip`, `split_clip`, `delete_clip`, `set_volume`, `add_effect`, and the rest).

## Boundary

OpenCut UI actions should be translated into collaboration commands. Remote commands should be subscribed to and reconciled back into OpenCut's local editor state.

The collaboration layer should own synchronization semantics, presence, conflict policy, and history. It should not own media decoding, rendering, or export.
