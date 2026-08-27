# augurScan delivery plan

## Goal and boundaries

augurScan is a self-contained, read-only protocol explorer and debugging tool. It indexes activity from configured EVM JSON-RPC networks into PostgreSQL, presents a live one-row-per-log feed, explains decoded values and known addresses, and retains raw and historical evidence. Ethereum Mainnet and Sepolia are configured initially; more networks can be added through the same configuration model.

The scanner owns its application, configuration, and database inputs under `/augurScan` and reuses the parent repository's shared Ethereum adapter at build time. The Docker image copies that adapter alongside the scanner rather than depending on the parent checkout at runtime. Sending transactions, holding keys, indexing unrelated contracts, and claiming internal calls that emit no log are outside this release.

## Delivered architecture

The shipped stack is Bun and TypeScript, the repository's `micro-eth-signer`-based adapter for JSON-RPC and ABI primitives, PostgreSQL for persistence, a Bun-native HTTP/SSE server, and a dependency-free HTML/CSS/JavaScript browser UI. Dependency versions and container images are pinned. `compose.yaml` starts the app and its persistent database; the app initializes an empty database, applies supported forward migrations transactionally, records migration/run provenance, and rejects unknown layouts without modifying them.

Configuration is checked in under `config/`:

- `networks.json` supplies network identity, chain ID, native currency symbol, RPC/start-block environment variable names, manifest, explorer, and reorg depth.
- `manifests/*.json` supplies initial `[address, label, kind]` contract entries with an optional decimal-string deployment block for deterministic historical replay.
- `abis.json` is the self-contained contract-kind ABI snapshot used for event and calldata decoding.

At runtime one connection-scoped advisory lock elects an indexer for each chain. The winner seeds configuration, verifies `eth_chainId`, resumes at the stored checkpoint, catches up every missing block, and polls again every 12 seconds. Other replicas remain non-writing standbys for that chain while continuing to serve the API and UI.

## Evidence and history

Each block transaction commits atomically with its receipt, top-level protocol action, logs, decode results, argument schemas, newly discovered contracts, token metadata observations, state measurements, and checkpoint. Integers remain exact strings or PostgreSQL numeric values.

Logs emitted by protocol activity sources or tracked REP tokens select receipts for indexing and dynamic discovery; configured Uniswap factory and PoolManager filters can select them too. For each selected receipt, augurScan also stores its top-level call. A tracked REP token therefore selects unrelated transfers emitted by that token. Shared WETH, USDC, Multicall3, scalar-outcome, and proxy-deployer contracts do not select unrelated receipts, but their known logs are retained when another source selected the receipt. Registration events add pools, share tokens, price coordinators, truth auctions, escalation games, and child reputation tokens. A fixed-point receipt pass retains initializer logs that occur before their registration log. Unknown or malformed events keep their topics, data, and decode error.

Token display rules are keyed by contract kind, event/function, and argument. Semantic `atto*` fields, the OpenOracle ETH sentinel, and known REP/share/WETH kinds use fixed 18-decimal protocol units; configured USDC uses a fixed 6-decimal unit. Arbitrary token values use canonical metadata read at an indexed block and fall back to exact base units only when that metadata is unavailable. Failed metadata reads retry with bounded block backoff and follow canonical reorg state.

Before extending a chain, the indexer verifies parent hashes. A mismatch searches the configured 64-block window for a common ancestor, marks old branch evidence noncanonical, invalidates its derived state, and replays the replacement branch. If no retained ancestor matches, canonical state is rebuilt from the configured start boundary. Orphaned blocks, actions, receipts, and logs remain queryable as debugging evidence.

## Current-state model

Canonical decoded events populate registries for every observed pool, question, vault, and Zoltar universe. Immutable identity/configuration is stored separately from block-stamped temporal measurements. The UI plots pool collateral and REP capacity ownership, vault REP backing and capacity ownership, and universe theoretical REP supply; it also renders the bounded returned universe parent/child lineage. [STATE_MODEL.md](STATE_MODEL.md) is the field and event reference.

The browser provides:

- network indexed block, timestamp, live age, observed head, lag, phase, and errors;
- a filtered, paginated, one-line activity ledger for the globally selected network;
- deep-linked evidence with contract provenance, complete receipt, related logs, decoded action/event schemas, exact raw values, copy controls, and explorer links;
- searchable pool, question, vault, and universe catalogs with automatic loading, live commit refresh, error recovery, and responsive graph/detail layouts;
- a single-network rich list ranked by ETH or SepoliaETH, WETH, or sent transactions, with bounded per-token REP balances, pool/vault participation, and explicit pending or partial balance state.
- an Operations destination with freshness, report, escalation, auction, tagged pool/vault risk, fork/migration, price-provenance, semantic-change, and direct entity-detail views;
- canonical domain projections and unified timelines for reports, games, auctions, AMM activity, forks, and migrations;
- bounded canonical tagged-block reads for current pool, vault, escalation, and auction values, with retained read failures and stale-on-reorg semantics;
- stable keyset pagination; full-window exact AMM volume and fee summaries; and explicitly bounded price-impact, TWAP-coverage, and candlestick observations;
- pool-level OpenOracle coordinator history plus REP/WETH, REP/native-ETH, REP/USDC, and liquidity histories.
- explicit state-history block ranges, pagination and coverage metadata; actual-time charts; and NDJSON evidence export;
- durable chain-reorganization records, canonical/orphan log selection, and schema/application/ABI/network provenance;
- first-class fork, AMM-market, LP-position, reporter-participation, liquidation-history, and chain-integrity views.

## Delivery and validation

The implementation is delivered in these completed slices:

1. Isolated configuration, ABI snapshot, Docker packaging, transactional schema initialization/migration, and health endpoints.
2. Resumable multi-network indexing, polling, advisory leases, RPC recovery, reorg retention, dynamic discovery, exact decoding, and SSE commit notices.
3. Log/action APIs and responsive activity/evidence UI.
4. Event-replayed system catalogs and historical charts.
5. Unit coverage for configuration, lifecycle recovery, metadata/decoding, and projections, plus a PostgreSQL integration scenario for schema initialization, leases, restart, discovery, receipt evidence, API canonicality, and reorg replacement.

Acceptance requires an empty-volume Compose start to expose the UI and begin each configured network independently; exact head progress and failures must remain visible; restart must resume without duplicate canonical occurrences; a reorg must retain the orphan and serve its replacement; and decoded amounts must always expose both a correctly scaled display value and exact raw evidence.

## Deferred scope

Provider-specific internal-call tracing and failed-call ingestion, automatic re-decoding after an ABI snapshot change, arbitrary contract state-at-block reads, normalized cross-venue liquidity, manipulation-resistant TWAP claims, very large deployment load testing, and automated backup/restore drills remain future work. Historical event APIs do support explicit block ranges, but they do not infer calls that emitted no retained log. A production operator must still choose archival-capable RPC providers, verified deployment start blocks, credentials, resource limits, backup schedules, and external access controls.
