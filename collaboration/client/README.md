# Client adapter

`CollabSession` in `src/session.ts` connects to SpacetimeDB, dispatches typed
commands to reducers, and emits project snapshots, presence, history, access
changes, and session departures. Humans and the agent use this same interface.

The web bridge at `apps/web/src/collaboration/bridge.ts` intercepts committed
track writes, flattens/diffs them into commands, and rebuilds remote snapshots.
An `applyRemote` guard prevents feedback loops; temporary drag previews publish
on commit. Browser media transfer lives in `shared-media.ts` beside the bridge;
chunk assembly lives in this package's `src/media-bytes.ts`.

`src/module_bindings/` is generated. Run `bun run generate` in this directory
after server schema changes.
