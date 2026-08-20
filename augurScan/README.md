# augurScan

augurScan is a read-only activity explorer for the Zoltar/Augur protocol. It indexes multiple configured networks from Ethereum JSON-RPC into PostgreSQL while the web UI shows one globally selected network at a time. The indexer detects each configured contract's deployment boundary before range-scanning its logs, fetches transaction evidence only for matching log transactions, decodes them with a self-contained ABI catalog, retains raw evidence and orphaned reorg history, and streams committed updates to the UI.

The selector in the top-right header sets the `chainId` URL parameter for Activity, **System state**, **Contracts**, and **Rich list**. System state derives bounded registries for indexed security pools, questions, vaults, and Zoltar universes. It distinguishes immutable identity/configuration from event-driven accounting, plots pool/vault/REP-supply histories, renders dedicated coordinator and Uniswap REP/ETH price charts plus a conditional YES/NO AMM chart, and renders the returned universe parent/child graph. Contracts lists the configured and dynamically discovered system contracts, checks their runtime bytecode through the configured RPC provider, and links each selection to its deployment evidence and explorer. After the index has an effective start, deployment refreshes search historical bytecode back to that stored boundary; the provider must support those historical reads. A contract already present there is reported as code present at the search boundary without claiming an exact deployment block, while a failed historical read leaves its deployment status pending without stopping block indexing. The Rich list ranks every observed sender and decoded participant by ETH or SepoliaETH, WETH, or sent transactions and displays amounts with at most two decimal places. Each REP token remains separate with its contract identity, alongside pool associations and vault positions. Clicking a sent-transaction count opens the account's sent transactions with decoded details. Pending and partial labels distinguish incomplete balance sampling from a known zero balance. See [STATE_MODEL.md](STATE_MODEL.md) for the event, balance, and field model.

Address links stay inside augurScan. Known addresses use their protocol name; unknown addresses use the full address wherever the layout has room and compact forms only in dense rows. `/address?chainId=:chainId&address=:address` shows the address's balances, separate REP tokens, pools, vaults, interaction counts, and recent transactions, with Etherscan available as a secondary link.

Every visible route refreshes automatically after a committed block notification and on the 12-second status cycle. Activity prepends new logs while preserving the reader's scroll position; system registries, selected history, contract deployments, rich-list rows, address balances, protocol references, and open account-transaction details refresh in place. New and changed activity, system-state, rich-list, address, and account-transaction records receive a brief highlight without an update badge; contract rows and the indexer status card update without animation. Routine refreshes do not raise a notice, and `prefers-reduced-motion` disables the remaining animations without disabling updates.

## Start with Docker

From this directory:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory to start the same Compose command.

Open <http://localhost:3000>. PostgreSQL is included and stored in the `augurscan-data` named volume. The website is available while historical backfill is running and reports the indexed block, its timestamp/age, observed head, lag, percentage complete, estimated time remaining, and network errors. Completion is measured from the effective start block stored for the index to the latest observed head. The ETA appears after the indexer or browser has observed enough forward progress to measure throughput.

The Compose services join the shared external `zoltar` network. When this repository's Reth Compose project is running, set `SEPOLIA_RPC_URL=http://reth:8545` to use it without exposing RPC beyond the host.

Set private or higher-capacity RPC endpoints in `.env` for reliable historical indexing. The included public defaults are convenient for evaluation but can rate-limit large backfills. On a fresh database, augurScan searches from `MAINNET_START_BLOCK` or `SEPOLIA_START_BLOCK` through the observed head for the earliest deployment whose history it tracks, then begins indexing at that deployment instead of walking earlier empty blocks. If none of those contracts is deployed yet, indexing waits at the block after the observed head. The conservative default floor of block `0` cannot omit protocol history; a later verified floor reduces historical bytecode reads. Before accepting a manifest change, augurScan verifies that every newly tracked deployment is within the stored index range. An earlier deployment stops with a rebuild error and leaves the current canonical index unchanged. An accepted address, label, or kind change resets that network to its stored effective start and durably replays the current manifest.

The configured start block is the lower bound for automatic deployment discovery. `LOG_SCAN_RANGE_SIZE` replaces the removed `BLOCK_BATCH_SIZE` setting and defines the maximum inclusive `eth_getLogs` window after indexing begins; it defaults to `10000` blocks. Replace any existing `BLOCK_BATCH_SIZE` entry when upgrading. If a provider rejects a multi-block query because its range or result set is too large, augurScan halves the attempted window until it succeeds, commits that contiguous segment, and then resumes at the following block with the configured maximum again. A one-block failure is never hidden by splitting and can trigger provider failover. `POLL_INTERVAL_MS` affects caught-up polling and retry cadence, not continuous historical backfill.

Each RPC variable may contain an ordered, comma-separated provider pool, for example `SEPOLIA_RPC_URL=https://primary.example,https://fallback.example`. augurScan verifies each provider's chain on its first use in each process and caches only successful verification. One process-wide FIFO queue admits at most five concurrent RPC operations across every enabled network and provider, with capacity for 100 pending operations. An operation's transport timeout begins only after it leaves the queue. If the pending capacity is full, augurScan treats the rejected operation as local backpressure, reports the network as degraded, and retries from its durable checkpoint without failing over to another provider. Requests use bounded retries on one verified provider; if the polling operation still fails, augurScan resumes from the last committed checkpoint with the next matching provider.

To enable only one network, set `NETWORKS=mainnet` or `NETWORKS=sepolia` on the app service. `config/networks.json` defines each network and selects its manifest. A manifest contains a `contracts` array whose entries are `[address, label, kind]` or `[address, label, kind, deploymentBlock]`; `deploymentBlock` is an optional decimal string at or after the configured network start block. Copy kinds from the checked-in manifests or the authoritative `kindToContractName` decoder registry in `src/metadata.ts`; examples include `zoltar`, `openOracle`, `securityPoolFactory`, `reputationToken`, and `weth`. `config/abis.json` stores the Solidity-contract ABI snapshot to which that registry maps. Supplying a verified deployment block avoids historical bytecode discovery and makes an address update's replay boundary deterministic. Moving that boundary earlier than an existing address cursor triggers replay when it remains within the stored index range; an earlier boundary requires a rebuild. Without an explicit boundary, augurScan finds the deployment with historical `eth_getCode` binary search before polling; if that lookup fails, it retries through provider failover instead of advancing the new source past an unfilled gap. Keep an old address in the manifest when it remains a valid activity source. Adding, removing, relabeling, or changing the kind of a manifest contract resets that network's canonical checkpoint to its stored effective start and replays the current manifest. Logs and derived records from removed contracts, including contracts discovered only through an obsolete deployment, remain only as noncanonical internal history and are excluded from the API. Once blocks have been indexed, augurScan retains the stored effective start when the configured discovery floor is at or below it. Raising the floor above the stored start requires rebuilding the named volume. An index created with the former block `0` behavior also requires one rebuild to adopt a later automatically discovered start.

Set `MAINNET_AMM_FACTORY_ADDRESS` and/or `SEPOLIA_AMM_FACTORY_ADDRESS` to the deployed Augur `TwoWayConstantProductFactory` for each enabled network. The factory becomes an activity source, `PairCreated` discovers each canonical pair, and pair `Sync` events supply reserve snapshots. No public AMM deployment address is assumed by this repository. Adding or changing a factory after indexing has begun triggers the same deployment-aware reconciliation as a manifest address update: history within the stored index range is replayed, while an earlier deployment requires a rebuild.

Uniswap V2, V3, and V4 indexing is configured independently with the `*_UNISWAP_V2_FACTORY_ADDRESS`, `*_UNISWAP_V3_FACTORY_ADDRESS`, and `*_UNISWAP_V4_POOL_MANAGER_ADDRESS` variables. Canonical mainnet V2/V3/V4 addresses and the canonical Sepolia V3 factory are defaults; Sepolia V2 and V4 remain opt-in because this repository's testnet deployment can use locally deployed addresses. Factory events discover only exact known-universe REP/WETH pairs. V4 queries are restricted by indexed pool ID to the standard hookless REP/native-ETH configurations used by the repository (fees `100`, `500`, `3000`, and `10000`, with tick spacing `1`, `10`, `60`, and `200` respectively); the shared PoolManager's unrelated global traffic is not indexed. Empty an environment value to disable its default venue. Adding a venue after the network checkpoint has passed its deployment replays history when the deployment is within the stored index range; an earlier deployment requires a rebuild before live polling can resume.

All quantities and identifiers are stored losslessly. Protocol fields explicitly named `attoREP`, `attoETH`, or `attoShares`, the OpenOracle native-token sentinel, and known REP/share/WETH contract kinds use fixed 18-decimal protocol units. Native values use the selected network's configured symbol (`ETH` or `SepoliaETH`). Other token amounts use the referenced token's discovered on-chain decimals and symbol. Only an arbitrary token without metadata is labeled in exact base units instead of being guessed. Raw values remain available in details.

## Local development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run dev
```

The browser source lives under `browser/`. `bun run build` bundles `browser/app.ts` and its helpers to the stable browser entry point `public/app.js`; that generated file is ignored and must not be edited. `bun run dev`, `bun run start`, and `bun run qa:serve` build it automatically, and development mode rebuilds it when browser TypeScript changes.

Local development expects PostgreSQL at `POSTGRES_URL`. The server applies SQL migrations under a PostgreSQL advisory lock before serving. Migration 005 introduces range-index dataset cursors and rejects an older database if it has an indexed network checkpoint or any block row. No legacy checkpoint or activity compatibility is retained. For the Compose setup, first run the shared-network command under **Start with Docker**. Then run `docker compose down --volumes` to delete the old database and `docker compose up --build` to rebuild it from each network's automatically discovered effective start. A database without a checkpoint or block row migrates in place.

`POSTGRES_URL` must connect directly to PostgreSQL or through a session-mode pooler. The per-network writer lease is a session-level advisory lock and is not compatible with transaction-mode pooling. At acquisition, augurScan records the PostgreSQL backend PID and verifies that later lease checks remain on that backend. If a proxy moves the reserved connection, the indexer reports an actionable `DatabaseConsistencyError` instead of treating the new backend as the lease owner.

The scanner imports its Ethereum primitives through `src/ethereum.ts`, which reuses the repository's `micro-eth-signer`-based shared adapter. The adapter performs strict JSON-RPC envelope validation and does not batch unrelated requests, so malformed provider responses cannot be mistaken for missing blocks. `bun run check:ethereum-imports` rejects direct Viem imports. The Docker image copies only the scanner inputs and this shared adapter source from the repository build context.

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

The script reads Solidity and deployment-address sources from the parent repository, then refreshes `config/abis.json` and the mainnet/Sepolia manifests. It only writes inside `augurScan/config`; the production image uses the generated snapshot and does not copy those Solidity or deployment sources.

## Indexing model

- Every enabled network has an independent loop. Chain IDs are verified before indexing.
- Historical scans run continuously until caught up; live networks poll their RPC head every 12 seconds and ingest every missed block.
- Each JSON-RPC request has a timeout and bounded transport retries on its selected provider. If verification or a polling operation still fails across the provider pool, that network reports a redacted degraded error and retries indefinitely with jittered exponential backoff capped at five minutes. Blocks committed earlier in the operation remain durable, and the next attempt resumes from their checkpoint; a block whose database transaction fails does not advance it. Other enabled networks continue independently. Every provider used for backfill must retain runtime bytecode history from the configured discovery floor and each block and receipt from the effective start stored for the index.
- Before querying a range, augurScan checks unresolved manifest activity sources for runtime bytecode at the range end. Addresses without code are omitted. When code appears, historical bytecode lookup finds the first deployed block and that inclusive block becomes the address's log boundary. A provider that cannot supply trustworthy deployment history causes that address to fall back to the complete stored index range, so this optimization cannot silently omit activity.
- Protocol activity-source addresses are queried with inclusive `eth_getLogs` ranges beginning at their individual deployment boundaries. Matching hashes select the only transactions and receipts fetched; failed transactions and successful transactions without a matching protocol log are intentionally outside the index. Shared WETH, REP, Multicall3, and permissionless proxy-deployer addresses remain labeled and ABI/token-aware but never select receipts from unrelated public traffic; their known logs are retained when a selected receipt contains them.
- Every queried activity-source address has an independent PostgreSQL cursor recording its effective scan boundary and last successfully retrieved block. Configured REP and WETH identities also receive coverage cursors because they determine which Uniswap events pass the historical market filters, even though augurScan does not query their logs directly. A cursor boundary is the deployment or discovery block when known, or the stored effective start when deployment detection requires conservative fallback. Deployment observations and all cursors covered by a successful segment advance atomically with that segment's final block commit. Dynamic contracts start at their discovery block; reorg recovery rewinds affected deployment observations and cursors and removes orphan-only datasets.
- Range-size and result-limit failures split the current inclusive query in half without overlapping its successor. For example, rejected `0-100` and `0-50` requests can become a successful `0-25`; the next inclusive request begins at `26`, not `25`. Unrelated authentication, transport, and chain errors are preserved for normal provider failover.
- Factory and registry events discover pools, share tokens, price coordinators, truth auctions, escalation games, child REP tokens, Augur AMM pairs, and exact REP/WETH Uniswap V2/V3 pools. V4 activity is selected by standard hookless REP/native pool ID; discovering child REP expands that filter in the discovery block and remaining scan range. Receipts are decoded to a fixed point so constructor/initializer logs that precede the registration event are retained.
- Token name, symbol, and decimals are read at the indexed block and cached for known/discovered tokens and token-bearing OpenOracle logs or calls. Failed reads retry with bounded backoff and metadata observations follow active-chain reorg state. Known REP/share/WETH kinds and the OpenOracle ETH sentinel have fixed 18-decimal protocol units; only arbitrary tokens whose metadata is unavailable fall back to exact base units.
- OpenOracle's raw 235-byte `ReportSubmitted` and `ReportDisputed` payloads are length-checked and decoded with their specified packed field layout.
- Coordinator initialization `RepEthPriceSet` events and accepted `PriceReported` settlements form the coordinator REP/ETH price series. An initialization seed can be zero or inherited from a parent pool and has no settlement timestamp, so it does not establish timestamp-based coordinator price validity. Rejected reports do not create observations. Uniswap V2 `Sync` reserves and V3/V4 `Initialize` or `Swap` square-root prices form separate, pool-attributed spot series for the pool's exact universe REP token. V2/V3 are REP per WETH and V4 is REP per native ETH. They are event-time marginal prices, not a TWAP; no liquidity-depth or manipulation-resistance claim is made. Each Augur AMM `Sync` event records exact YES/NO reserves and derives complementary conditional prices in basis points; these are manipulable spot observations, not a TWAP or protocol oracle.
- Block, complete transaction receipt, transaction/action ABI schema, contract discovery, log, and checkpoint changes commit atomically. Expanded evidence retains argument type/order and every raw receipt log.
- A connection-scoped PostgreSQL advisory lock elects one active indexer per chain. Additional app replicas serve the UI and wait in standby until that chain's lock is released.
- A parent-hash mismatch searches the configured 64-block safety window for a common ancestor. Orphaned rows remain stored as replaced-chain debugging evidence, and active-chain indexing resumes from the ancestor. If no retained ancestor matches, that network safely rewinds to its stored effective start and rebuilds current state.
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
- Pool history, including its bounded AMM, coordinator REP/ETH, and Uniswap REP/ETH price series: `GET /api/v1/state/pools/:chainId/:poolAddress`
- Vault history: `GET /api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress`
- Question usage: `GET /api/v1/state/questions/:chainId/:questionId`
- Universe history: `GET /api/v1/state/universes/:chainId/:universeId`

`GET /health/indexers` includes process-local `ownership` diagnostics for every indexer that has attempted ownership. `failuresTotal` and `reacquisitionsTotal` are counters since process start; `consecutiveFailures`, `lastFailureAt`, and `lastFailureStage` identify an active recovery loop; `active` and `backendPid` identify the session currently used by this replica. These fields are operational diagnostics, not durable protocol data, and reset when the app restarts.

Ownership failures identify the network, lifecycle stage (`acquire`, `verify`, `seed`, `owned-run`, `record-failure`, or `release`), consecutive failure count, retry delay, backend PID when known, and a sanitized reason. Rapid failures use jittered exponential backoff capped at five minutes. A successful takeover or reconnection emits an `indexer ownership reacquired` log before indexing resumes. `standby` remains the expected state when another replica owns the chain's lease and is not reported as a failure.

For `acquire` or `owned-run` connection errors, restore PostgreSQL connectivity and allow the loop to reacquire from its last committed checkpoint; incomplete block transactions roll back and do not require a rebuild. A repeated `verify` error that says the backend moved requires a direct endpoint or session-mode pooler. A repeated `seed` `DatabaseConsistencyError` about a configured discovery floor above the stored start requires restoring the prior setting or deliberately rebuilding from the new boundary. A `seed` consistency error for newly tracked history before the stored start also requires a rebuild. Do not delete the database merely for a transient lease loss.

The pool-history response adds these price members. Their exact JSON shapes are:

```text
market?: {
  chain_id: string; block_hash: string; tx_hash: string; log_index: number; block_number: string;
  pair_address: string; pool_address: string; share_token_address: string;
  universe_id: string; fee_bps: string; canonical: boolean; timestamp: string;
}
ammPrices: Array<{
  chain_id: string; block_hash: string; tx_hash: string; log_index: number; block_number: string;
  pair_address: string; yes_reserve_atto_shares: string; no_reserve_atto_shares: string;
  conditional_yes_bps: string; conditional_no_bps: string; canonical: boolean; timestamp: string;
}>
repEthPrices: Array<{
  chain_id: string; block_hash: string; tx_hash: string; log_index: number; block_number: string;
  coordinator_address: string; event_name: "RepEthPriceSet" | "PriceReported";
  report_id: string | null; rep_per_eth_1e18: string; settlement_timestamp: string | null;
  canonical: boolean; timestamp: string;
}>
uniswapRepEthPrices: Array<{
  chain_id: string; block_hash: string; tx_hash: string; log_index: number; block_number: string;
  venue: "v2" | "v3" | "v4"; market_id: string; event_name: "Initialize" | "Swap" | "Sync";
  contract_address: string; token0_address: string; token1_address: string;
  fee_hundredths_bip: string; tick_spacing: number | null; hooks_address: string | null;
  quote_symbol: "ETH" | "WETH"; quote_token_address: string;
  rep_per_eth_1e18: string; timestamp: string;
}>
```

Except for `log_index` and non-null `tick_spacing`, which are JSON numbers, `chain_id`, `block_number`, onchain integer values, reserves, and basis points are lossless decimal strings. `timestamp` and non-null `settlement_timestamp` are ISO 8601 strings. `market` is omitted when no canonical pair has been indexed. The price arrays are empty when there are no observations. Initialization REP/ETH rows have null report and settlement fields; accepted settlements populate both.

`truncated` becomes true when snapshots, lifecycle events, AMM prices, coordinator REP/ETH prices, or Uniswap REP/ETH prices exceed `limit`; each returned series contains its newest `limit` observations ordered from oldest to newest.

The UI always sends its selected `chainId` to the logs, rich-list, and state-catalog endpoints. Direct API clients may omit it to query all configured networks. State catalog responses default to 500 and cap at 1,000 rows per entity class. History endpoints default `limit` to 1,000 and cap it at 2,000 records per returned series; `truncated` is true when any series has more records. These bounds keep database transactions, JSON normalization, and graph rendering predictable.

Back up the named volume with normal PostgreSQL tooling (`pg_dump`/`pg_restore`). Stop the app gracefully before infrastructure maintenance. `docker compose down` preserves history; `docker compose down --volumes` intentionally deletes it.

Do not expose PostgreSQL publicly. Replace the local default database password for shared deployments, keep RPC URLs server-side, and place the app behind authenticated access if decoded operational history is sensitive.
