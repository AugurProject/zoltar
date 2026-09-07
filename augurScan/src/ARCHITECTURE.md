# AugurScan backend boundaries

The backend is organized by capability and keeps dependencies directed toward runtime-neutral evidence types:

- `api/` owns HTTP validation, cursor parsing, response serialization, and route-family queries. `api.ts` is its public entry point.
- `indexer/` owns provider checks, scan planning, canonical-chain fencing, lifecycle/ownership state, and discovery. `indexer.ts` retains the network runner and public entry point.
- `database/` owns stored record contracts, history invalidation, lease/session handling, and transaction helpers. `database.ts` retains the database repository class and public entry point.
- `projections/` converts decoded evidence into typed state and domain projections. `projections.ts` is its public entry point.
- `process-bootstrap.ts`, `server.ts`, and `indexer-process.ts` compose those capabilities into runnable processes.

API modules receive an explicit `SQL` transaction or connection rather than constructing database pools. This keeps HTTP parsing separate from connection ownership while leaving query transaction boundaries visible to callers. The indexer may depend on persistence and projections; persistence and projections must not depend on indexer orchestration. Production consumers use each capability's top-level entry point rather than importing private route modules.

`bun run check:boundaries` enforces these directions. `bun run test:unit` covers pure validation, cursor, projection, lifecycle, and route behavior; `bun run test:integration` exercises PostgreSQL transaction, lease, replay, reorganization, and API boundaries.
