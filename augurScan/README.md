# augurScan

augurScan is a read-only activity explorer for the Zoltar/Augur protocol. It indexes multiple configured networks from Ethereum JSON-RPC into PostgreSQL while the web UI shows one globally selected network at a time. The indexer range-scans project logs, fetches transaction evidence only for matching log transactions, decodes them with a self-contained ABI catalog, retains raw evidence and orphaned reorg history, and streams committed updates to the UI.

The selector in the top-right header sets the `chainId` URL parameter for Activity, **System state**, **Contracts**, and **Rich list**. System state derives bounded registries for indexed security pools, questions, vaults, and Zoltar universes. It distinguishes immutable identity/configuration from event-driven accounting, plots pool/vault/REP-supply histories, and renders the returned universe parent/child graph. Contracts lists the configured and dynamically discovered system contracts, checks their runtime bytecode through the configured RPC provider, and links each selection to its deployment evidence and explorer. When code is present, augurScan searches historical bytecode back to the configured start block; the provider must support those historical reads. A contract already present at that boundary is reported as deployed at or before the start block, while a failed historical read leaves its deployment status pending without stopping block indexing. The Rich list ranks every observed sender and decoded participant by ETH or SepoliaETH, WETH, or sent transactions and displays amounts with at most two decimal places. Each REP token remains separate with its contract identity, alongside pool associations and vault positions. Clicking a sent-transaction count opens the account's sent transactions with decoded details. Pending and partial labels distinguish incomplete balance sampling from a known zero balance. See [STATE_MODEL.md](STATE_MODEL.md) for the event, balance, and field model.

Address links stay inside augurScan. Known addresses use their protocol name; unknown addresses use the full address wherever the layout has room and compact forms only in dense rows. `/address?chainId=:chainId&address=:address` shows the address's balances, separate REP tokens, pools, vaults, interaction counts, and recent transactions, with Etherscan available as a secondary link.

Every visible route refreshes automatically after a committed block notification and on the 12-second status cycle. Activity prepends new logs while preserving the reader's scroll position; system registries, selected history, contract deployments, rich-list rows, address balances, protocol references, and open account-transaction details refresh in place. New and changed activity, system-state, rich-list, address, and account-transaction records receive a brief highlight without an update badge; contract rows and the indexer status card update without animation. Routine refreshes do not raise a notice, and `prefers-reduced-motion` disables the remaining animations without disabling updates.

## Start with Docker

From this directory:

```bash
cp .env.example .env
docker compose up --build
```

Open <http://localhost:3000>. PostgreSQL is included and stored in the `augurscan-data` named volume. The website is available while historical backfill is running and reports the indexed block, its timestamp/age, observed head, lag, percentage complete, estimated time remaining, and network errors. Completion is measured from the configured start block to the latest observed head. The ETA appears after the indexer or browser has observed enough forward progress to measure throughput.

Set private or higher-capacity RPC endpoints in `.env` for reliable historical indexing. The included public defaults are convenient for evaluation but can rate-limit large backfills. Set `MAINNET_START_BLOCK` and `SEPOLIA_START_BLOCK` to the verified earliest project deployment blocks before relying on the database as a complete production history. The conservative default of block `0` cannot omit protocol history but is expensive.

The start boundary is the main backfill-speed control: do not scan blocks before the first possible project deployment. `LOG_SCAN_RANGE_SIZE` replaces the removed `BLOCK_BATCH_SIZE` setting and defines the maximum inclusive `eth_getLogs` window; it defaults to `2000` blocks. Replace any existing `BLOCK_BATCH_SIZE` entry when upgrading. If a provider rejects a multi-block query because its range or result set is too large, augurScan halves the attempted window until it succeeds, commits that contiguous segment, and then resumes at the following block with the configured maximum again. A one-block failure is never hidden by splitting and can trigger provider failover. `POLL_INTERVAL_MS` affects caught-up polling and retry cadence, not continuous historical backfill.

Each RPC variable may contain an ordered, comma-separated provider pool, for example `SEPOLIA_RPC_URL=https://primary.example,https://fallback.example`. augurScan verifies each provider's chain on its first use in each process and caches only successful verification. Requests use bounded retries on one verified provider; if the polling operation still fails, augurScan resumes from the last committed checkpoint with the next matching provider.

To enable only one network, set `NETWORKS=mainnet` or `NETWORKS=sepolia` on the app service. `config/networks.json` defines each network and selects its manifest. A manifest contains a `contracts` array whose entries are `[address, label, kind]`. Copy kinds from the checked-in manifests or the authoritative `kindToContractName` decoder registry in `src/metadata.ts`; examples include `zoltar`, `openOracle`, `securityPoolFactory`, `reputationToken`, and `weth`. `config/abis.json` stores the Solidity-contract ABI snapshot to which that registry maps. A seed address or earlier start boundary added after indexing does not retroactively fill its earlier history. For complete history after either change, start with a fresh database or deliberately rebuild the named volume from the configured start block.

All quantities and identifiers are stored losslessly. Protocol fields explicitly named `attoREP`, `attoETH`, or `attoShares`, the OpenOracle native-token sentinel, and known REP/share/WETH contract kinds use fixed 18-decimal protocol units. Native values use the selected network's configured symbol (`ETH` or `SepoliaETH`). Other token amounts use the referenced token's discovered on-chain decimals and symbol. Only an arbitrary token without metadata is labeled in exact base units instead of being guessed. Raw values remain available in details.

## Local development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run dev
```

Local development expects PostgreSQL at `POSTGRES_URL`. The server applies SQL migrations under a PostgreSQL advisory lock before serving. Migration 005 introduces range-index dataset cursors and rejects an older database if it has an indexed network checkpoint or any block row. No legacy checkpoint or activity compatibility is retained. For the Compose setup, run `docker compose down --volumes` to delete the old database, then `docker compose up --build` to rebuild it from each network's verified start block. A database without a checkpoint or block row migrates in place.

The standalone package centralizes its `viem` runtime dependency in `src/viem-runtime.js`; application and test code import Ethereum primitives through `src/ethereum.ts`. `bun run check:ethereum-imports` enforces that boundary across TypeScript and JavaScript sources without requiring parent-repository files in the Docker build context.

The default test suite runs without infrastructure. To exercise migration, checkpoint restart, dynamic discovery persistence, reorg/orphan retention, and current-chain API results, start a separate disposable PostgreSQL container and run the integration test against it:

```bash
docker run --detach --rm --name augurscan-test-postgres \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=augurscan \
  --env POSTGRES_PASSWORD=augurscan \
  --env POSTGRES_DB=augurscan_test \
  postgres:17.6-alpine

POSTGRES_TEST_URL=postgres://augurscan:augurscan@localhost:55432/augurscan_test bun run test:integration
docker stop augurscan-test-postgres
```

The integration test truncates its target database; never point `POSTGRES_TEST_URL` at a database containing data you need.

Regenerate the committed ABI snapshot after contract event/function changes:

```bash
bun run metadata:snapshot
```

The script reads Solidity and deployment-address sources from the parent repository, then refreshes `config/abis.json` and the mainnet/Sepolia manifests. It only writes inside `augurScan/config`; the production image does not depend on parent files.

## Indexing model

- Every enabled network has an independent loop. Chain IDs are verified before indexing.
- Historical scans run continuously until caught up; live networks poll their RPC head every 12 seconds and ingest every missed block.
- Each JSON-RPC request has a timeout and bounded transport retries on its selected provider. If verification or a polling operation still fails across the provider pool, that network reports a redacted degraded error and retries indefinitely with jittered exponential backoff capped at five minutes. Blocks committed earlier in the operation remain durable, and the next attempt resumes from their checkpoint; a block whose database transaction fails does not advance it. Other enabled networks continue independently. Every provider used for backfill must retain each block and receipt from the configured `startBlock`.
- Protocol activity-source addresses are queried with inclusive `eth_getLogs` ranges. Matching hashes select the only transactions and receipts fetched; failed transactions and successful transactions without a matching protocol log are intentionally outside the index. Shared WETH, REP, Multicall3, and permissionless proxy-deployer addresses remain labeled and ABI/token-aware but never select receipts from unrelated public traffic; their known logs are retained when a selected receipt contains them.
- Every queried activity-source address has an independent PostgreSQL cursor recording its start block and last successfully retrieved block. All cursors covered by a successful segment advance with that segment's final block commit. Dynamic contracts start at their discovery block; reorg recovery rewinds affected cursors and removes orphan-only datasets.
- Range-size and result-limit failures split the current inclusive query in half without overlapping its successor. For example, rejected `0-100` and `0-50` requests can become a successful `0-25`; the next inclusive request begins at `26`, not `25`. Unrelated authentication, transport, and chain errors are preserved for normal provider failover.
- Factory and registry events discover pools, share tokens, price coordinators, truth auctions, escalation games, and child REP tokens. Receipts are decoded to a fixed point so constructor/initializer logs that precede the registration event are retained.
- Token name, symbol, and decimals are read at the indexed block and cached for known/discovered tokens and token-bearing OpenOracle logs or calls. Failed reads retry with bounded backoff and metadata observations follow active-chain reorg state. Known REP/share/WETH kinds and the OpenOracle ETH sentinel have fixed 18-decimal protocol units; only arbitrary tokens whose metadata is unavailable fall back to exact base units.
- OpenOracle's raw 235-byte `ReportSubmitted` and `ReportDisputed` payloads are length-checked and decoded with their specified packed field layout.
- Block, complete transaction receipt, transaction/action ABI schema, contract discovery, log, and checkpoint changes commit atomically. Expanded evidence retains argument type/order and every raw receipt log.
- A connection-scoped PostgreSQL advisory lock elects one active indexer per chain. Additional app replicas serve the UI and wait in standby until that chain's lock is released.
- A parent-hash mismatch searches the configured 64-block safety window for a common ancestor. Orphaned rows remain stored as replaced-chain debugging evidence, and active-chain indexing resumes from the ancestor. If no retained ancestor matches, that network safely rewinds to its configured start boundary and rebuilds current state.
- Unknown and failed ABI decodes retain topics, data, and the decoder error. Updating the ABI catalog never removes raw evidence.
- At the live head, each network refreshes the least-recently measured known addresses in bounded batches. ETH (or SepoliaETH), WETH, and every known genesis-or-child REP balance are read at one indexed block and stored historically. REP token balances remain separate so balances with different universe semantics are never summed.

Version 0.1 indexes transactions selected by protocol-emitter logs and every known-contract log contained in those receipts. It does not index failed calls, successful calls without protocol logs, or unrelated traffic involving shared dependencies.

## Operations

- Liveness: `GET /health/live`
- Database readiness: `GET /health/ready`
- Indexer freshness and recent chain-integrity audit: `GET /health/indexers`
- Network status: `GET /api/v1/networks`
- Paginated logs: `GET /api/v1/logs?chainId=:chainId`
- Full log occurrence: `GET /api/v1/logs/:chainId/:blockHash/:txHash/:logIndex`
- Top-level protocol actions: `GET /api/v1/actions`
- System contract registry and deployment evidence: `GET /api/v1/contracts?chainId=:chainId`
- Contract identity: `GET /api/v1/contracts/:chainId/:address`
- Durable live commit/reorg/status notifications with seven-day `Last-Event-ID` replay: `GET /api/v1/stream`. A cursor older than that window receives a reset event so the UI reloads current state. The server disables Bun's per-request idle timeout for this endpoint and sends heartbeats so an idle indexer does not truncate the stream.
- Bounded address rankings with ETH or SepoliaETH and bounded per-token REP/WETH breakdowns: `GET /api/v1/richlist?chainId=:chainId`
- Snapshot-bound transactions sent by one address: `GET /api/v1/address-transactions?chainId=:chainId&address=:address`. Follow the opaque `nextCursor` to read later pages without newly indexed blocks shifting the result set. The cursor is bound to the chain, address, snapshot block and hash, and stable transaction total. If a reorg or historical insertion invalidates that snapshot, the endpoint returns `409 Transaction history changed; restart pagination`; restart from the first page without a cursor.
- Known protocol identity for an address: `GET /api/v1/address-identity?chainId=:chainId&address=:address`
- Pools, questions, vaults, and universes: `GET /api/v1/state/catalog?chainId=:chainId`
- Pool history: `GET /api/v1/state/pools/:chainId/:poolAddress`
- Vault history: `GET /api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress`
- Question usage: `GET /api/v1/state/questions/:chainId/:questionId`
- Universe history: `GET /api/v1/state/universes/:chainId/:universeId`

The UI always sends its selected `chainId` to the logs, rich-list, and state-catalog endpoints. Direct API clients may omit it to query all configured networks. State catalog responses default to 500 and cap at 1,000 rows per entity class. History endpoints default `limit` to 1,000 and cap it at 2,000 records per returned series; `truncated` is true when any series has more records. These bounds keep database transactions, JSON normalization, and graph rendering predictable.

Back up the named volume with normal PostgreSQL tooling (`pg_dump`/`pg_restore`). Stop the app gracefully before infrastructure maintenance. `docker compose down` preserves history; `docker compose down --volumes` intentionally deletes it.

Do not expose PostgreSQL publicly. Replace the local default database password for shared deployments, keep RPC URLs server-side, and place the app behind authenticated access if decoded operational history is sensitive.
