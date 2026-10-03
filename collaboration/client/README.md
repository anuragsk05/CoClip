# Client adapter

This directory is reserved for the OpenCut ↔ SpacetimeDB adapter.

Responsibilities:

1. Connect/authenticate to SpacetimeDB.
2. Subscribe to the active project's shared state.
3. Convert local OpenCut timeline mutations into reducers.
4. Apply remote state updates back into OpenCut.
5. Prevent feedback loops when replaying remote changes locally.
6. Publish ephemeral presence separately from durable edit state.
