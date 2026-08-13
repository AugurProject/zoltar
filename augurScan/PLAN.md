# augurScan delivery plan

## Goal and boundaries

augurScan is a self-contained, read-only protocol explorer and debugging tool. It indexes activity from configured EVM JSON-RPC networks into PostgreSQL, presents a live one-row-per-log feed, explains decoded values and known addresses, and retains raw and historical evidence. Ethereum Mainnet and Sepolia are configured initially; more networks can be added through the same configuration model.

Everything needed to build and run the scanner lives under `/augurScan`. The Docker image does not import parent-repository runtime files. Sending transactions, holding keys, indexing unrelated contracts, and claiming internal calls that emit no log are outside this release.

## Delivered architecture

The shipped stack is Bun and TypeScript, `viem` for JSON-RPC and ABI primitives, PostgreSQL for persistence, a Bun-native HTTP/SSE server, and a dependency-free HTML/CSS/JavaScript browser UI. Dependency versions and container images are pinned. `compose.yaml` starts the app and its persistent database; the app runs idempotent migrations before it serves traffic.

Configuration is checked in under `config/`:

- `networks.json` supplies network identity, chain ID, native currency symbol, RPC/start-block environment variable names, manifest, explorer, and reorg depth.
- `manifests/*.json` supplies initial `[address, label, kind]` contract entries with an optional decimal-string deployment block for deterministic historical replay.
- `abis.json` is the self-contained contract-kind ABI snapshot used for event and calldata decoding.

At runtime one connection-scoped advisory lock elects an indexer for each chain. The winner seeds configuration, verifies `eth_chainId`, resumes at the stored checkpoint, catches up every missing block, and polls again every 12 seconds. Other replicas remain non-writing standbys for that chain while continuing to serve the API and UI.

## Evidence and history

Each block transaction commits atomically with its receipt, top-level protocol action, logs, decode results, argument schemas, newly discovered contracts, token metadata observations, state measurements, and checkpoint. Integers remain exact strings or PostgreSQL numeric values.

Logs and top-level calls involving protocol activity sources select receipts for indexing and dynamic discovery. Shared WETH, REP, Multicall3, and proxy-deployer contracts never select unrelated receipts, but their known logs are retained when either activity-source path selected the receipt. Registration events add pools, share tokens, price coordinators, truth auctions, escalation games, and child reputation tokens. A fixed-point receipt pass retains initializer logs that occur before their registration log. Unknown or malformed events keep their topics, data, and decode error.

Token display rules are keyed by contract kind, event/function, and argument. Semantic `atto*` fields, the OpenOracle ETH sentinel, and known REP/share/WETH kinds use fixed 18-decimal protocol units. Arbitrary token values use canonical metadata read at an indexed block and fall back to exact base units only when that metadata is unavailable. Failed metadata reads retry with bounded block backoff and follow canonical reorg state.

Before extending a chain, the indexer verifies parent hashes. A mismatch searches the configured 64-block window for a common ancestor, marks old branch evidence noncanonical, invalidates its derived state, and replays the replacement branch. If no retained ancestor matches, canonical state is rebuilt from the configured start boundary. Orphaned blocks, actions, receipts, and logs remain queryable as debugging evidence.

## Current-state model

Canonical decoded events populate registries for every observed pool, question, vault, and Zoltar universe. Immutable identity/configuration is stored separately from block-stamped temporal measurements. The UI plots pool collateral and REP capacity ownership, vault REP backing and capacity ownership, and universe theoretical REP supply; it also renders the bounded returned universe parent/child lineage. [STATE_MODEL.md](STATE_MODEL.md) is the field and event reference.

The browser provides:

- network indexed block, timestamp, live age, observed head, lag, phase, and errors;
- a filtered, paginated, one-line activity ledger for the globally selected network;
- deep-linked evidence with contract provenance, complete receipt, related logs, decoded action/event schemas, exact raw values, copy controls, and explorer links;
- searchable pool, question, vault, and universe catalogs with automatic loading, live commit refresh, error recovery, and responsive graph/detail layouts;
- a single-network rich list ranked by ETH or SepoliaETH, WETH, or sent transactions, with bounded per-token REP balances, pool/vault participation, and explicit pending or partial balance state.

## Delivery and validation

The implementation is delivered in these completed slices:

1. Isolated configuration, ABI snapshot, Docker packaging, migrations, and health endpoints.
2. Resumable multi-network indexing, polling, advisory leases, RPC recovery, reorg retention, dynamic discovery, exact decoding, and SSE commit notices.
3. Log/action APIs and responsive activity/evidence UI.
4. Event-replayed system catalogs and historical charts.
5. Unit coverage for configuration, lifecycle recovery, metadata/decoding, and projections, plus a PostgreSQL integration scenario for migrations, leases, restart, discovery, receipt evidence, API canonicality, and reorg replacement.

Acceptance requires an empty-volume Compose start to expose the UI and begin each configured network independently; exact head progress and failures must remain visible; restart must resume without duplicate canonical occurrences; a reorg must retain the orphan and serve its replacement; and decoded amounts must always expose both a correctly scaled display value and exact raw evidence.

## Deferred scope

Provider-specific internal-call tracing, automatic re-decoding after an ABI snapshot change, arbitrary historical state-at-block queries, very large deployment load testing, and automated backup/restore drills remain future work. A production operator must still choose archival-capable RPC providers, verified deployment start blocks, credentials, resource limits, backup schedules, and external access controls.
