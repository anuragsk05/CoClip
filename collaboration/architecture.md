# Architecture

```text
               Media Storage
          (browser cache / shared chunks)
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

Media is cached in browser storage. Video, audio, and image files are currently
shared through SpacetimeDB asset chunks and reassembled into local playable
copies. Asset references also support local, S3, and R2 storage types; the browser
sharing path currently uses SpacetimeDB. The agent subscribes without media bytes.

The OpenCut client keeps its existing editor: timeline UI, preview, track controls, and clip interactions. Those actions leave the client as editor commands.

The collaboration adapter is the only path from an OpenCut client into SpacetimeDB. It turns editor commands into reducers and applies subscribed state back into the local editor.

SpacetimeDB is the canonical shared project: projects, tracks, clips, effects, presence, edit history, users, and metadata. Human editors and the AI agent call the same reducers (`move_clip`, `trim_clip`, `split_clip`, `delete_clip`, `set_volume`, `add_effect`, and the rest).

## Boundary

OpenCut UI actions should be translated into collaboration commands. Remote commands should be subscribed to and reconciled back into OpenCut's local editor state.

The collaboration layer owns synchronization semantics, presence, permissions,
live sessions, history, and shared media transport. Decoding, rendering, and
export remain in the editor. Reducers serialize shared edits transactionally;
the web bridge applies canonical remote snapshots to local tracks. Local
undo/redo commands publish their resulting track changes through the same bridge.
