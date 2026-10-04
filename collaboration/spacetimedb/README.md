# SpacetimeDB module

This Rust module owns canonical shared project state. `src/schema.rs` defines
projects, metadata, memberships, collaborators, live sessions, share invites,
scenes, tracks, clips, effects, assets, media chunks, presence, users, and history.

Reducers live in `projects.rs`, `tracks.rs`, `clips.rs`, `effects.rs`, `assets.rs`,
and `presence.rs`. `edit.rs` centralizes write authorization, project revisions,
and attributed history. Reducer errors roll back the transaction. Clip geometry
uses `rust/crates/timeline`; timing uses `rust/crates/time` at 120,000 ticks/second.

This crate has a separate Cargo workspace and is excluded from the root workspace.
See [local setup](../README.md) for publishing and regenerating client bindings.
