# AugurScan backend boundaries

The backend is organized by capability and keeps dependencies directed toward runtime-neutral evidence types:

- `api/` owns HTTP validation, cursor parsing, response serialization, and route-family controllers. It contains no SQL; `api.ts` is its public entry point.
- `repositories/` owns the read-only SQL for API catalogs, histories, entity details, portfolios, exports, and integrity evidence. Repositories return rows or domain data and cannot depend on HTTP, indexer, database-session, or projection implementations.
- `indexer/` owns provider selection, ownership and replay lifecycle, canonical-chain synchronization, bounded log scanning, and block ingestion. Each stage is a focused layer in the network runner, while `indexer.ts` is the stable public entry point.
- `database/` owns lease/session handling, network and contract catalog persistence, direct observations, history and checkpoint transitions, and atomic block persistence. Repository layers inherit one connection owner so transaction boundaries stay explicit, while `database.ts` is the stable public entry point.
- `projections/` converts decoded evidence into typed state and domain projections. `projections.ts` is its public entry point.
- `process-bootstrap.ts`, `server.ts`, and `indexer-process.ts` compose those capabilities into runnable processes.

API controllers receive an explicit `SQL` transaction or connection and pass it to a focused read repository after validating the request. This keeps HTTP parsing and pure response serialization separate from query execution and connection ownership while leaving query transaction boundaries visible to callers. The indexer may depend on persistence and projections; persistence and projections must not depend on indexer orchestration. Production consumers use each capability's top-level entry point rather than importing private route, repository, or database modules.

`bun run check:boundaries` enforces these directions and rejects SQL execution anywhere in the HTTP layer. `bun run test:unit` covers pure validation, cursor, projection, and lifecycle behavior; `bun run test:api` covers routes and response contracts; `bun run test:replay` covers indexer/replay behavior; and `bun run test:integration` exercises real PostgreSQL transaction, lease, reorganization, and API boundaries.
