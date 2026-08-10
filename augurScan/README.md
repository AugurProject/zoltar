# augurScan

augurScan is a read-only, multi-network activity explorer for the Zoltar/Augur protocol. It indexes canonical project logs and top-level protocol actions from Ethereum JSON-RPC into PostgreSQL, decodes them with a self-contained ABI catalog, retains raw evidence and orphaned reorg history, and streams committed updates to a compact web UI.

The **System state** view derives canonical registries for every indexed security pool, question, vault, and Zoltar universe. It distinguishes immutable identity/configuration from event-driven accounting, plots pool/vault/REP-supply histories, and renders the complete universe parent/child graph. See [STATE_MODEL.md](STATE_MODEL.md) for the event and field model.

## Start with Docker

From this directory:

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:3000>. PostgreSQL is included and stored in the `augurscan-data` named volume. The website is available while historical backfill is running and reports the indexed block, its timestamp/age, observed head, lag, and network errors.

Set private or higher-capacity RPC endpoints in `.env` for reliable historical indexing. The included public defaults are convenient for evaluation but can rate-limit large backfills. Set `MAINNET_START_BLOCK` and `SEPOLIA_START_BLOCK` to the verified earliest project deployment blocks before relying on the database as a complete production history. The conservative default of block `0` cannot omit protocol history but is expensive.

Each RPC variable may contain an ordered, comma-separated provider pool, for example `SEPOLIA_RPC_URL=https://primary.example,https://fallback.example`. augurScan verifies each provider's chain independently. Requests use bounded retries on one verified provider; if the polling operation still fails, augurScan resumes from the last committed checkpoint with the next matching provider.

To enable only one network, set `NETWORKS=mainnet` or `NETWORKS=sepolia` on the app service. `config/networks.json` defines each network and selects its manifest. A manifest contains a `contracts` array whose entries are `[address, label, kind]`. Copy kinds from the checked-in manifests or the canonical `kindToContractName` decoder registry in `src/metadata.ts`; examples include `zoltar`, `openOracle`, `securityPoolFactory`, `reputationToken`, and `weth`. `config/abis.json` stores the Solidity-contract ABI snapshot to which that registry maps. A seed address or earlier start boundary added after indexing does not retroactively fill its earlier history. For complete history after either change, start with a fresh database or deliberately rebuild the named volume from the configured start block.

All quantities and identifiers are stored losslessly. Protocol fields explicitly named `attoREP`, `attoETH`, or `attoShares`, the OpenOracle ETH sentinel, and known REP/share/WETH contract kinds use fixed 18-decimal protocol units. Other token amounts use the referenced token's discovered on-chain decimals and symbol. Only an arbitrary token without metadata is labeled in exact base units instead of being guessed. Raw values remain available in details.

## Local development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run dev
```

Local development expects PostgreSQL at `POSTGRES_URL`. The server applies SQL migrations under a PostgreSQL advisory lock before serving.

The standalone package centralizes its `viem` runtime dependency in `src/viem-runtime.js`; application and test code import Ethereum primitives through `src/ethereum.ts`. `bun run check:ethereum-imports` enforces that boundary across TypeScript and JavaScript sources without requiring parent-repository files in the Docker build context.

The default test suite runs without infrastructure. To exercise migration, checkpoint restart, dynamic discovery persistence, reorg/orphan retention, and canonical API results, start a separate disposable PostgreSQL container and run the integration test against it:

```bash
docker run --detach --rm --name augurscan-test-postgres \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=augurscan \
  --env POSTGRES_PASSWORD=augurscan \
  --env POSTGRES_DB=augurscan_test \
  postgres:17-alpine

POSTGRES_TEST_URL=postgres://augurscan:augurscan@localhost:55432/augurscan_test bun run test:integration
docker stop augurscan-test-postgres
```

The integration test truncates its target database; never point `POSTGRES_TEST_URL` at a database containing data you need.

Regenerate the committed ABI snapshot after contract event/function changes:

```bash
bun run metadata:snapshot
```

The script reads Solidity sources from the parent repository but only writes `config/abis.json`. The production image does not depend on parent files.

## Indexing model

- Every enabled network has an independent loop. Chain IDs are verified before indexing.
- Historical batches run continuously until caught up; live networks poll their RPC head every 12 seconds and ingest every missed block.
- Each JSON-RPC request has a timeout and bounded transport retries on its selected provider. If verification or a polling operation still fails across the provider pool, that network reports a redacted degraded error and retries indefinitely with jittered exponential backoff capped at five minutes. Blocks committed earlier in the operation remain durable, and the next attempt resumes from their checkpoint; a block whose database transaction fails does not advance it. Other enabled networks continue independently. Every provider used for backfill must retain each block and receipt from the configured `startBlock`.
- Logs from protocol activity sources and successful or failed top-level calls to those sources select relevant receipts. Shared WETH, REP, Multicall3, and permissionless proxy-deployer addresses remain labeled and ABI/token-aware but never select receipts from unrelated public traffic; their known logs are retained after either activity-source selection path makes the receipt relevant.
- Factory and registry events discover pools, share tokens, price coordinators, truth auctions, escalation games, and child REP tokens. Receipts are decoded to a fixed point so constructor/initializer logs that precede the registration event are retained.
- Token name, symbol, and decimals are read at the indexed block and cached for known/discovered tokens and token-bearing OpenOracle logs or calls. Failed reads retry with bounded backoff and metadata observations follow canonical reorg state. Known REP/share/WETH kinds and the OpenOracle ETH sentinel have fixed 18-decimal protocol units; only arbitrary tokens whose metadata is unavailable fall back to exact base units.
- OpenOracle's raw 235-byte `ReportSubmitted` and `ReportDisputed` payloads are length-checked and decoded with their canonical packed field layout.
- Block, complete transaction receipt, transaction/action ABI schema, contract discovery, log, and checkpoint changes commit atomically. Expanded evidence retains argument type/order and every raw receipt log.
- A connection-scoped PostgreSQL advisory lock elects one active indexer per chain. Additional app replicas serve the UI and wait in standby until that chain's lock is released.
- A parent-hash mismatch searches the configured 64-block safety window for a common ancestor. Orphaned rows remain stored as noncanonical debugging evidence, and canonical indexing resumes from the ancestor. If no retained ancestor matches, that network safely rewinds to its configured start boundary and rebuilds canonical state.
- Unknown and failed ABI decodes retain topics, data, and the decoder error. Updating the ABI catalog never removes raw evidence.

Version 0.1 indexes top-level actions sent to protocol activity sources and every known-contract log in the receipts selected by those actions or protocol-emitter logs. Known shared dependencies do not select unrelated receipts. Internal calls that emit no protocol log require provider-specific trace APIs and are intentionally not claimed as actions.

## Operations

- Liveness: `GET /health/live`
- Database readiness: `GET /health/ready`
- Indexer freshness and recent canonical-integrity audit: `GET /health/indexers`
- Network status: `GET /api/v1/networks`
- Paginated logs: `GET /api/v1/logs`
- Full log occurrence: `GET /api/v1/logs/:chainId/:blockHash/:txHash/:logIndex`
- Top-level protocol actions: `GET /api/v1/actions`
- Contract identity: `GET /api/v1/contracts/:chainId/:address`
- Durable live commit/reorg/status notifications with seven-day `Last-Event-ID` replay: `GET /api/v1/stream`. A cursor older than that window receives a reset event so the UI reloads current canonical state.
- Pools, questions, vaults, and universes: `GET /api/v1/state/catalog`
- Pool history: `GET /api/v1/state/pools/:chainId/:poolAddress`
- Vault history: `GET /api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress`
- Question usage: `GET /api/v1/state/questions/:chainId/:questionId`
- Universe history: `GET /api/v1/state/universes/:chainId/:universeId`

State catalog responses default to 500 and cap at 1,000 rows per entity class. History endpoints default `limit` to 1,000 and cap it at 2,000 records per returned series; `truncated` is true when any series has more records. Use `chainId` on the catalog to narrow large registries. These bounds keep database transactions, JSON normalization, and graph rendering predictable.

Back up the named volume with normal PostgreSQL tooling (`pg_dump`/`pg_restore`). Stop the app gracefully before infrastructure maintenance. `docker compose down` preserves history; `docker compose down --volumes` intentionally deletes it.

Do not expose PostgreSQL publicly. Replace the local default database password for shared deployments, keep RPC URLs server-side, and place the app behind authenticated access if decoded operational history is sensitive.
