# AugurScan backend boundaries

The backend is organized by capability and keeps dependencies directed toward runtime-neutral evidence types:

- `api/` owns HTTP validation, cursor parsing, response serialization, and route-family queries. `api.ts` is its public entry point.
- `indexer/` owns provider selection, ownership and replay lifecycle, canonical-chain synchronization, bounded log scanning, and block ingestion. Each stage is a focused layer in the network runner, while `indexer.ts` is the stable public entry point.
- `database/` owns lease/session handling, network and contract catalog persistence, direct observations, history and checkpoint transitions, and atomic block persistence. Repository layers inherit one connection owner so transaction boundaries stay explicit, while `database.ts` is the stable public entry point.
- `projections/` converts decoded evidence into typed state and domain projections. `projections.ts` is its public entry point.
- `process-bootstrap.ts`, `server.ts`, and `indexer-process.ts` compose those capabilities into runnable processes.

API modules receive an explicit `SQL` transaction or connection rather than constructing database pools. This keeps HTTP parsing separate from connection ownership while leaving query transaction boundaries visible to callers. The indexer may depend on persistence and projections; persistence and projections must not depend on indexer orchestration. Production consumers use each capability's top-level entry point rather than importing private route modules.

`bun run check:boundaries` enforces these directions. `bun run test:unit` covers pure validation, cursor, projection, lifecycle, and route behavior; `bun run test:integration` exercises PostgreSQL transaction, lease, replay, reorganization, and API boundaries.
