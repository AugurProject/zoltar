# augurScan

augurScan is a read-only activity explorer for the Zoltar/Augur protocol. It indexes multiple configured networks from Ethereum JSON-RPC into PostgreSQL while the web UI shows one globally selected network at a time. The indexer detects each configured contract's deployment boundary before range-scanning its logs, fetches transaction evidence only for matching log transactions, decodes them with a self-contained ABI catalog, retains raw evidence and orphaned reorg history, and streams committed updates to the UI.

The selector in the top-right header sets the `chainId` URL parameter for Activity, **Operations**, **System state**, **Contracts**, and **Rich list**. Operations summarizes index freshness, OpenOracle reports, escalation games, truth auctions, current pool/vault risk, fork/migration evidence, trading history, chain replacements, scanner provenance, price provenance, and recent semantic changes. Its catalogs live at `/operations/reports`, `/operations/escalations`, `/operations/auctions`, `/operations/risk`, `/operations/forks`, `/operations/trading`, and `/operations/integrity`; catalog rows open direct report, escalation, auction, fork, market, pool-risk, and vault-risk routes. System state derives bounded registries for indexed security pools, questions, vaults, and Zoltar universes. Pool details show coordinator/OpenOracle history, conditional YES/NO prices, REP/WETH and REP/native-ETH curves, REP/USDC curves, exact venue liquidity evidence, and a link to the pair's AMM analytics. Contracts links each selection to deployment evidence without showing scanner-internal registry provenance or discovery bookkeeping.

Direct browser routes are `/operations/report/:openOracleAddress/:reportId`, `/operations/escalation/:gameAddress`, `/operations/auction/:auctionAddress`, `/operations/fork/:universeIdentity`, `/operations/risk/pool/:poolAddress`, `/operations/risk/vault/:poolAddress/:vaultAddress`, and `/operations/trading/:marketAddress`. Preserve the selected network with the `chainId` query parameter when constructing a link.

Deployment detection requires an actual historical boundary. A lagging RPC that reports head `#0` but returns present-day bytecode for `eth_getCode(..., #0)` cannot prove a deployment at genesis, so augurScan leaves the deployment pending. Even after that node advances, code reported at genesis is treated as an untrustworthy historical response unless block `0` was explicitly configured as the deployment. An inexact non-genesis boundary is labeled “Deployed at or before”; exact binary-search results are labeled “Deployed at.”

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

To enable only one network, set `NETWORKS=mainnet` or `NETWORKS=sepolia` on the app service. `config/networks.json` defines each network and selects its manifest. A manifest contains a `contracts` array whose entries are `[address, label, kind]` or `[address, label, kind, deploymentBlock]`; `deploymentBlock` is an optional decimal string at or after the configured network start block. Copy kinds from the checked-in manifests or the authoritative `kindToContractName` decoder registry in `src/metadata.ts`; examples include `zoltar`, `openOracle`, `securityPoolFactory`, `reputationToken`, and `weth`. `config/abis.json` stores the Solidity-contract ABI snapshot to which that registry maps. Supplying a verified deployment block avoids historical bytecode discovery and makes an address update's replay boundary deterministic. Moving that boundary earlier than an existing address cursor triggers replay when it remains within the stored index range; an earlier boundary requires a rebuild. Without an explicit boundary, augurScan finds the deployment with historical `eth_getCode` binary search before polling; if that lookup fails, it retries through provider failover instead of advancing the new source past an unfilled gap. Keep an old address in the manifest when it remains a valid activity source. Adding, removing, relabeling, or changing the kind of a manifest contract resets that network's canonical checkpoint to its stored effective start and replays the current manifest. Logs and derived records from removed contracts, including contracts discovered only through an obsolete deployment, remain as noncanonical history and are excluded from current-state and catalog APIs. Retained log and timeline occurrences remain available through the log and [NDJSON export](API_REFERENCE.md#evidence-and-export) surfaces with `canonical=orphaned|all`. Once blocks have been indexed, augurScan retains the stored effective start when the configured discovery floor is at or below it. Raising the floor above the stored start requires rebuilding the named volume. An index created with the former block `0` behavior also requires one rebuild to adopt a later automatically discovered start.

Set `MAINNET_AMM_FACTORY_ADDRESS` and/or `SEPOLIA_AMM_FACTORY_ADDRESS` to the deployed Augur `TwoWayConstantProductFactory` for each enabled network. The factory becomes an activity source, `PairCreated` discovers each canonical pair, and pair `Sync` events supply reserve snapshots. No public AMM deployment address is assumed by this repository. Adding or changing a factory after indexing has begun triggers the same deployment-aware reconciliation as a manifest address update: history within the stored index range is replayed, while an earlier deployment requires a rebuild.

Uniswap V2, V3, and V4 indexing is configured independently with the `*_UNISWAP_V2_FACTORY_ADDRESS`, `*_UNISWAP_V3_FACTORY_ADDRESS`, and `*_UNISWAP_V4_POOL_MANAGER_ADDRESS` variables. Canonical mainnet V2/V3/V4 addresses and the canonical Sepolia V3 factory are defaults; Sepolia V2 and V4 remain opt-in. Factory events retain exact known-universe REP/WETH and REP/USDC pairs; the checked-in manifests identify WETH and Circle USDC so token decimals and quote orientation stay explicit. V4 retains hookless REP/native-ETH and REP/USDC pool IDs for the four configured fee/tick-spacing pairs; ERC-20 currencies use Uniswap's address-sorted order, while native ETH is the zero-address currency. V2 liquidity is the exact reserve product, while V3/V4 liquidity is the exact active-liquidity integer emitted by `Swap`; these raw values are not normalized across token systems.

All quantities and identifiers are stored losslessly. Protocol fields explicitly named `attoREP`, `attoETH`, or `attoShares`, the OpenOracle native-token sentinel, and known REP/share/WETH contract kinds use fixed 18-decimal protocol units. A configured USDC contract uses the fixed 6-decimal `USDC` unit. Native values use the selected network's configured symbol (`ETH` or `SepoliaETH`). Other token amounts use the referenced token's discovered on-chain decimals and symbol. Only an arbitrary token without metadata is labeled in exact base units instead of being guessed. Raw values remain available in details.

## Local development

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run dev
```

The browser source lives under `browser/`. `bun run build` bundles `browser/app.ts` and its helpers to the stable browser entry point `public/app.js`; that generated file is ignored and must not be edited. `bun run dev`, `bun run start`, and `bun run qa:serve` build it automatically, and development mode rebuilds it when browser TypeScript changes.

Local development expects PostgreSQL at `POSTGRES_URL`. On first start, augurScan applies the complete [`schema.sql`](schema.sql) in one explicit transaction under a PostgreSQL advisory lock and records schema version 2. A version 1 database is upgraded in place with the ordered migration under [`migrations/`](migrations/); the migration retains raw and orphaned evidence, backfills newly classified historical projections, and records its completion in `augurscan_schema_migrations`. Before accepting either supported marker, startup fingerprints the complete public layout: tables, identity sequences, column types/nullability/defaults, constraints, and non-constraint indexes must match exactly, and unexpected public objects are rejected. The post-migration layout is checked again before the marker update commits. Restore a compatible backup or run the intervening supported augurScan release instead of deleting historical evidence. Back up PostgreSQL before every release upgrade and test restore procedures independently; augurScan records migration provenance but does not create operator backups. The same transaction boundary prevents partially applied initialization or migration work.

`POSTGRES_URL` must connect directly to PostgreSQL or through a session-mode pooler. The per-network writer lease is a session-level advisory lock and is not compatible with transaction-mode pooling. At acquisition, augurScan records the PostgreSQL backend PID and verifies that later lease checks remain on that backend. If a proxy moves the reserved connection, the indexer reports an actionable `DatabaseConsistencyError` instead of treating the new backend as the lease owner.

The scanner imports its Ethereum primitives through `src/ethereum.ts`, which reuses the repository's `micro-eth-signer`-based shared adapter. The adapter performs strict JSON-RPC envelope validation and does not batch unrelated requests, so malformed provider responses cannot be mistaken for missing blocks. `bun run check:ethereum-imports` rejects direct Viem imports. The Docker image copies only the scanner inputs and this shared adapter source from the repository build context.

The default test suite runs without infrastructure. To exercise fresh-schema initialization, checkpoint restart, dynamic discovery persistence, reorg/orphan retention, and current-chain API results, start a separate disposable PostgreSQL container and run the integration test against it:

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

The integration test expects a dedicated test database and destroys and recreates its `public` schema; never point `POSTGRES_TEST_URL` at a database containing data you need.

Regenerate the committed ABI snapshot after contract event/function changes:

```bash
bun run metadata:snapshot
```

The script reads Solidity and deployment-address sources from the parent repository, then refreshes `config/abis.json` and the mainnet/Sepolia manifests. It only writes inside `augurScan/config`; the production image uses the generated snapshot and does not copy those Solidity or deployment sources.

## Indexing model

- Every enabled network has an independent loop. Chain IDs are verified before indexing.
- Historical scans run continuously until caught up; live networks poll their RPC head every 12 seconds and ingest every missed block.
- Each JSON-RPC request has a timeout and bounded transport retries on its selected provider. If verification or a polling operation still fails across the provider pool, that network reports a redacted degraded error and retries indefinitely with jittered exponential backoff capped at five minutes. Blocks committed earlier in the operation remain durable, and the next attempt resumes from their checkpoint; a block whose database transaction fails does not advance it. Other enabled networks continue independently. Every provider used for backfill must retain runtime bytecode history from the configured discovery floor, every block header from the effective start stored for the index, and every transaction and receipt selected by the queried logs.
- Before querying a range, augurScan checks unresolved manifest activity sources for runtime bytecode at the range end. Addresses without code are omitted. When code appears, historical bytecode lookup finds the first deployed block and that inclusive block becomes the address's log boundary. A provider that cannot supply trustworthy deployment history causes that address to fall back to the complete stored index range, so this optimization cannot silently omit activity.
- Protocol activity-source addresses and every tracked REP-token address are queried with inclusive `eth_getLogs` ranges beginning at their individual deployment boundaries. Matching hashes select the only transactions and receipts fetched; a tracked REP token therefore selects unrelated transfers emitted by that token. Filtered Uniswap factory and PoolManager events can also select receipts. Failed transactions and successful transactions without one of these matching logs are intentionally outside the index. This is a declared coverage boundary, not an implication that no failed call occurred. Shared WETH, USDC, Multicall3, scalar-outcome, and permissionless proxy-deployer addresses remain labeled and ABI/token-aware but never select receipts from unrelated public traffic; their known logs are retained when another source selected the receipt.
- Every directly queried log source has an independent PostgreSQL cursor recording its effective scan boundary and last successfully retrieved block. Configured WETH and USDC identities also receive coverage cursors because they determine which Uniswap events pass the historical market filters, even though augurScan does not query their logs directly. A cursor boundary is the deployment or discovery block when known, or the stored effective start when deployment detection requires conservative fallback. Deployment observations and all cursors covered by a successful segment advance atomically with that segment's final block commit. Dynamic contracts start at their discovery block; reorg recovery rewinds affected deployment observations and cursors and removes orphan-only datasets.
- Range-size and result-limit failures split the current inclusive query in half without overlapping its successor. For example, rejected `0-100` and `0-50` requests can become a successful `0-25`; the next inclusive request begins at `26`, not `25`. Unrelated authentication, transport, and chain errors are preserved for normal provider failover.
- Factory and registry events discover pools, share tokens, price coordinators, truth auctions, escalation games, child REP tokens, Augur AMM pairs, and exact REP/WETH or REP/USDC Uniswap V2/V3 pools. V4 activity is selected by standard hookless REP/native-ETH and address-sorted REP/USDC pool IDs; discovering child REP expands those filters in the discovery block and remaining scan range. Receipts are decoded to a fixed point so constructor/initializer logs that precede the registration event are retained.
- Token name, symbol, and decimals are read at the indexed block and cached for known/discovered tokens and token-bearing OpenOracle logs or calls. Failed reads retry with bounded backoff and metadata observations follow active-chain reorg state. Known REP/share/WETH kinds and the OpenOracle ETH sentinel have fixed 18-decimal protocol units, while configured USDC has a fixed 6-decimal unit; only arbitrary tokens whose metadata is unavailable fall back to exact base units.
- OpenOracle's raw 235-byte `ReportSubmitted` and `ReportDisputed` payloads are length-checked and decoded with their specified packed field layout.
- Coordinator initialization `RepEthPriceSet` events and accepted `PriceReported` settlements form the coordinator REP/ETH price series. An initialization seed can be zero or inherited from a parent pool and has no settlement timestamp, so it does not establish timestamp-based coordinator price validity. Rejected reports do not create observations. Uniswap V2 `Sync` reserves and V3/V4 `Initialize` or `Swap` square-root prices form separate, pool-attributed REP/WETH, REP/USDC, or REP/native-ETH spot series for the pool's exact universe REP token. They are event-time marginal prices, not a TWAP; no liquidity-depth or manipulation-resistance claim is made. Each Augur AMM `Sync` event records exact YES/NO reserves and derives complementary conditional prices in basis points; these are manipulable spot observations, not a TWAP or protocol oracle.
- Block, complete transaction receipt, transaction/action ABI schema, contract discovery, log, and checkpoint changes commit atomically. Expanded evidence retains argument type/order and every raw receipt log.
- A connection-scoped PostgreSQL advisory lock elects one active indexer per chain. Additional app replicas serve the UI and wait in standby until that chain's lock is released.
- A parent-hash mismatch searches the configured 64-block safety window for a common ancestor. Orphaned rows remain stored as replaced-chain debugging evidence, and active-chain indexing resumes from the ancestor. If no retained ancestor matches, that network safely rewinds to its stored effective start and rebuilds current state.
- Unknown and failed ABI decodes retain topics, data, and the decoder error. Updating the ABI catalog never removes raw evidence.
- At the live head, each network refreshes the least-recently measured known addresses in bounded batches. ETH (or SepoliaETH), WETH, and every known genesis-or-child REP balance are read at one indexed block and stored historically. REP token balances remain separate so balances with different universe semantics are never summed.

Version 0.1 indexes transactions selected by protocol activity-source logs, tracked REP-token logs, or the configured Uniswap event filters, plus every known-contract log contained in those receipts. It does not index failed calls, successful calls without a selecting log, or unrelated traffic involving excluded shared dependencies such as WETH, USDC, Multicall3, scalar-outcome contracts, and permissionless proxy deployers.

## Preserve and audit history

Run these commands from `augurScan/`. They assume the Compose deployment above and mainnet chain ID `1`; change `AUGURSCAN_CHAIN_ID` for another indexed network.

1. Set the API location and take a custom-format backup before every upgrade.

   ```bash
   export AUGURSCAN_URL=http://localhost:3000
   export AUGURSCAN_CHAIN_ID=1
   docker compose exec -T postgres pg_dump -U augurscan -d augurscan --format=custom > augurscan-before-upgrade.dump
   test -s augurscan-before-upgrade.dump
   ```

2. Prove that the backup restores into a separate database. A successful schema-version query is the restore check; the live `augurscan` database is not changed. Keep `augurscan_restore` until the deterministic export in step 6 finishes.

   ```bash
   docker compose exec -T postgres dropdb -U augurscan --if-exists augurscan_restore
   docker compose exec -T postgres createdb -U augurscan augurscan_restore
   docker compose exec -T postgres pg_restore -U augurscan -d augurscan_restore --exit-on-error --no-owner < augurscan-before-upgrade.dump
   docker compose exec -T postgres psql -U augurscan -d augurscan_restore -c 'SELECT schema_version FROM augurscan_schema WHERE singleton'
   ```

3. Upgrade and wait for database readiness. Supported schema migrations run transactionally during startup.

   ```bash
   docker compose up --build --force-recreate --detach
   until curl --fail --silent --show-error "$AUGURSCAN_URL/health/ready"; do sleep 2; done
   ```

4. Audit the current checkpoint, cursor positions, and recent canonical continuity. The request can return HTTP 503 for a stale indexer or an integrity failure, so `--fail-with-body` preserves the diagnostic body. `integrityIssues` is empty only when those checks pass; the parent-hash continuity scan starts at the greater of the configured start block and `indexed_block - 10000`, so this health endpoint does not re-audit older retained continuity. Also resolve any stale network reported by `staleChainIds`, then use the replacement review and exports below for the wider historical audit.

   ```bash
   curl --fail-with-body --silent --show-error "$AUGURSCAN_URL/health/indexers"
   ```

5. Review durable replacements and process provenance. Open `$AUGURSCAN_URL/operations/integrity?chainId=$AUGURSCAN_CHAIN_ID` in a browser and select **Show more indexed records** until the control is replaced by **All indexed records are shown.** API clients must follow `data.nextCursor` while `data.hasMore` is true; `/api/v1/reorgs` clients instead increase `offset` until `offset + items.length` equals `total`. The migrations shown alongside them are global, and the run list is the latest 25 global process runs repeated on every replacement page. `/api/v1/provenance` expands that global run list to 100; if its `runsTruncated` is true, query the protected `indexer_runs` table for older runs. These catalogs explain recorded replacements but do not replace the recent-window continuity result from step 4.

6. Start an isolated, indexer-disabled app against the restored database, then export bounded evidence until the continuation header is absent. The alternate host port lets the live service continue running.

   ```bash
   set -eu
   export AUGURSCAN_LIVE_URL=$AUGURSCAN_URL
   export AUGURSCAN_EXPORT_CONTAINER="augurscan-export-$$"
   stop_augurscan_export() {
     docker stop "$AUGURSCAN_EXPORT_CONTAINER" >/dev/null 2>&1 || true
   }
   trap stop_augurscan_export EXIT INT TERM
   docker compose run --detach --rm --no-deps \
     --name "$AUGURSCAN_EXPORT_CONTAINER" \
     --publish 127.0.0.1:3002:3000 \
     --env DISABLE_INDEXER=1 \
     app sh -c 'export POSTGRES_URL="${POSTGRES_URL%/*}/augurscan_restore"; exec bun augurScan/src/server.ts'
   export AUGURSCAN_URL=http://localhost:3002
   until curl --fail --silent --show-error "$AUGURSCAN_URL/health/ready"; do sleep 2; done
   AUGURSCAN_EXPORT_DATASETS=${AUGURSCAN_EXPORT_DATASETS:-"logs reorgs"}
   for AUGURSCAN_EXPORT_DATASET in $AUGURSCAN_EXPORT_DATASETS; do
     case "$AUGURSCAN_EXPORT_DATASET" in
       logs)
         AUGURSCAN_EXPORT_OFFSET=${AUGURSCAN_LOGS_EXPORT_OFFSET:-0}
         AUGURSCAN_EXPORT_RETRY_VARIABLE=AUGURSCAN_LOGS_EXPORT_OFFSET
         AUGURSCAN_CANONICAL_QUERY='&canonical=all'
         ;;
       reorgs)
         AUGURSCAN_EXPORT_OFFSET=${AUGURSCAN_REORGS_EXPORT_OFFSET:-0}
         AUGURSCAN_EXPORT_RETRY_VARIABLE=AUGURSCAN_REORGS_EXPORT_OFFSET
         AUGURSCAN_CANONICAL_QUERY=
         ;;
       timeline)
         AUGURSCAN_EXPORT_OFFSET=${AUGURSCAN_TIMELINE_EXPORT_OFFSET:-0}
         AUGURSCAN_EXPORT_RETRY_VARIABLE=AUGURSCAN_TIMELINE_EXPORT_OFFSET
         AUGURSCAN_CANONICAL_QUERY='&canonical=all'
         ;;
       *)
         echo "Unsupported export dataset: $AUGURSCAN_EXPORT_DATASET" >&2
         exit 1
         ;;
     esac
     while :; do
       AUGURSCAN_EXPORT_PAGE="augurscan-$AUGURSCAN_EXPORT_DATASET-$AUGURSCAN_EXPORT_OFFSET.ndjson"
       AUGURSCAN_EXPORT_PART="$AUGURSCAN_EXPORT_PAGE.part"
       AUGURSCAN_HEADERS_PART="$AUGURSCAN_EXPORT_PAGE.headers.part"
       if ! curl --fail-with-body --silent --show-error --dump-header "$AUGURSCAN_HEADERS_PART" \
         --output "$AUGURSCAN_EXPORT_PART" \
         "$AUGURSCAN_URL/api/v1/export?chainId=$AUGURSCAN_CHAIN_ID&dataset=$AUGURSCAN_EXPORT_DATASET$AUGURSCAN_CANONICAL_QUERY&offset=$AUGURSCAN_EXPORT_OFFSET&limit=50000"; then
         echo "Export failed. Retry only this dataset with:" >&2
         echo "AUGURSCAN_EXPORT_DATASETS=$AUGURSCAN_EXPORT_DATASET $AUGURSCAN_EXPORT_RETRY_VARIABLE=$AUGURSCAN_EXPORT_OFFSET" >&2
         exit 1
       fi
       AUGURSCAN_NEXT_OFFSET=$(tr -d '\r' < "$AUGURSCAN_HEADERS_PART" | awk 'tolower($1) == "x-augurscan-next-offset:" { print $2 }')
       mv "$AUGURSCAN_EXPORT_PART" "$AUGURSCAN_EXPORT_PAGE"
       mv "$AUGURSCAN_HEADERS_PART" "$AUGURSCAN_EXPORT_PAGE.headers"
       test -n "$AUGURSCAN_NEXT_OFFSET" || break
       AUGURSCAN_EXPORT_OFFSET=$AUGURSCAN_NEXT_OFFSET
     done
   done
   stop_augurscan_export
   docker compose exec -T postgres dropdb -U augurscan --if-exists augurscan_restore
   trap - EXIT INT TERM
   export AUGURSCAN_URL=$AUGURSCAN_LIVE_URL
   ```

   Only a successful request is renamed from `.part` to newline-delimited JSON. The final response has no `x-augurscan-next-offset` header. The default dataset list exports logs and reorganizations consecutively, gives each an independent initial offset of zero, and includes the dataset in every filename. Set `AUGURSCAN_EXPORT_DATASETS=timeline` for semantic history, or select one dataset together with its dataset-specific retry offset after a failed page. Add `fromBlock` and `toBlock` to constrain an audit interval. The endpoint rejects offsets above 10,000,000, so split a larger export into block ranges that remain below that ceiling. For a recorded replacement range, export `canonical=orphaned` logs and compare their block hashes with a `canonical=canonical` export of the same range.

   Export offsets are not inherently snapshot-bound. The isolated container derives the restore URL from the Compose-resolved app `POSTGRES_URL`, so it uses the same credential whether `POSTGRES_PASSWORD` came from the shell or `.env`; only the database name changes. The restored database keeps the chain evidence stable while these pages are read; startup only migrates the supported schema and records that isolated process run. A failed page stops the isolated app but keeps `augurscan_restore` and its current offset available for a retry; drop that database only after a complete export. If you deliberately export the live database instead, a reorganization or reset can insert or reclassify rows ahead of the current offset. Record `/api/v1/networks` and `/health/indexers` before and after; if a network's `indexed_hash` changes because of a replacement or the integrity result degrades, discard the pages and restart at offset `0`.

7. Stop the app gracefully before database infrastructure maintenance.

   ```bash
   docker compose stop app
   ```

   `docker compose down` preserves the named history volume. `docker compose down --volumes` deletes it and must only be used when that loss is intentional and a tested backup exists.

The complete endpoint and pagination contract is in [API_REFERENCE.md](API_REFERENCE.md). Historical evidence semantics, completeness rules, and projection identities are in [STATE_MODEL.md](STATE_MODEL.md).

Do not expose PostgreSQL publicly. Replace the local default database password for shared deployments, keep RPC URLs server-side, and place the app behind authenticated access if decoded operational history is sensitive.
