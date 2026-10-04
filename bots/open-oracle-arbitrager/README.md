# OpenOracle arbitrager

The OpenOracle arbitrager monitors active Ethereum WETH/token games, compares their locked exchange against executable Uniswap V2, V3, or hookless V4 quotes, and identifies disputes whose modeled hedge remains profitable after OpenOracle fees and gas. It includes a local operator dashboard for live state, strategy controls, wallet inventory, submitted disputes, transaction delivery, and ETH-denominated profit tracking.

The rendered [operator guide](./docs/operator-guide.html) explains the UI and configuration, execution math, exchange support, recovery states, and includes populated dashboard screenshots. When the dashboard is running, select **Operator guide** or open `http://127.0.0.1:4173/documentation` (using the configured UI port).

Dry-run is the example default. The bot cannot submit a transaction unless `runtime.execute` is enabled in its configuration and a signer is saved in that configuration or supplied through the local dashboard.

> Use a dedicated low-balance key, validate current executable liquidity, and supervise every position; no automated strategy can guarantee a profit or prevent every loss. The [latest pinned market fixture](./docs/market-fixture.html#open-oracle-market-fixture) is dated historical evidence, not a live liquidity or profitability claim.

## Contents

- [How the flow works](#how-the-flow-works)
- [Quick start](#quick-start)
- [Docker](#docker)
- [Monitor without trading](#monitor-without-trading)
- [Run on Sepolia](#run-on-sepolia)
- [Go-live checklist](#go-live-checklist)
- [Limitations](#limitations)
- [Project layout and development](#project-layout-and-development)

Reference documents:

| Document | Owns |
| --- | --- |
| [EXECUTION.md](./EXECUTION.md) | Read agreement and finality rules, requirements, executor deployment and contract surface, execution mode, submission, the pre-dispute checks, wallet funding and allowances, transaction tracking, and profit semantics |
| [CONFIGURATION.md](./CONFIGURATION.md) | The operator file, every configuration key, strategy and settlement settings, diagnostic mode, data retention, the dashboard, and upgrade notes |
| [MARKETS.md](./MARKETS.md) | Token and pool discovery, universe approval, Uniswap venue execution, and the market manipulation guard |
| [RECOVERY.md](./RECOVERY.md) | The durable position journal, its states, and the `recovery-required` runbook |
| [Shared bot behaviour](../README.md) | Environment variables, the signer lock, the RPC agreement requirement, dashboard access, and market consensus settings common to every bot |

## How the flow works

A Zoltar `OpenOraclePriceCoordinator` creates an OpenOracle report, also called a game, that locks WETH and another ERC-20 at the current reporter's proposed exchange rate. The arbitrager wallet compares that rate with executable Uniswap liquidity. When the replacement report can be hedged profitably, the wallet calls the stateless executor, which swaps the required inventory atomically and submits the OpenOracle dispute while preserving the wallet as the replacement reporter. After the dispute window, the bot settles the final report, withdraws the position's exact OpenOracle balances, and closes its durable position record only after canonical receipts and exact asset recovery pass the [finality rule](./EXECUTION.md#read-agreement-and-finality). If a later reporter replaces the bot, it derives the exact one-token credit from the authenticated old and new report amounts, withdraws only that amount through a parent-bound executor call, and verifies the `ReplacementCreditWithdrawn` event under the same rule. The record then becomes **replaced** and continues consuming its risk slot: the bot has recovered the funds, but it does not label the one-sided inventory as realized profit or automatically trade it back to the original mix.

The wallet approvals this flow needs are listed under [required ETH, WETH, and tokens](./EXECUTION.md#required-eth-weth-and-tokens). [Profit and history semantics](./EXECUTION.md#profit-and-history-semantics) explains the report lifecycle assumptions and economics.

## Quick start

From the repository root, install once, then enter the project:

```bash
bun install --frozen-lockfile
cd bots/open-oracle-arbitrager
```

Copy the paused, dry-run example and start the bot. It accepts no command-line arguments:

```bash
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
bun run run
```

Open `http://127.0.0.1:4173`. Save the chain and RPC endpoints in **Chain and RPC connectivity**, then work down the Settings steps (Connect, Markets, Trading policy, Go live). An unconfigured bot keeps its paused dashboard available without making RPC calls and does not scan until a verified chain and endpoint set has been saved.

The package scripts call the TypeScript entrypoints directly through Bun:

| Command | Purpose |
| --- | --- |
| `bun run run` | Start the bot and its dashboard. |
| `bun run deploy-executor -- [options]` | [Deploy the executor](./EXECUTION.md#deploy-the-executor). `--help` lists the options. |
| `bun run reconcile -- [options]` | Close a [`recovery-required` position](./RECOVERY.md#recovery-required-runbook). `--help` lists the options. |

Set `OPEN_ORACLE_ARBITRAGER_CONFIG` when the operator file is not at `.state/operator.json`; every command must use the same value.

## Docker

Docker Compose builds the image, keeps bot state in a named volume, publishes the dashboard only on host loopback, and starts the bot. From this directory, run:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker volume create zoltar-bot-signer-locks >/dev/null
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory; it stops the stack, rebuilds the image, and recreates the containers.

On first start, the container creates a paused, dry-run configuration in its persistent volume. Open `http://127.0.0.1:4173`; the dashboard does not require a username or password in this setup.

Run `docker compose down` to stop the bot and `docker compose up --detach` to start it again. Compose preserves the operator configuration and bot history unless you explicitly delete the named volume.

The [shared bot guide](../README.md) owns the behaviour this service has in common with the other bots:

- the [signer lock](../README.md#signer-lock) and the `zoltar-bot-signer-locks` volume;
- [dashboard access](../README.md#dashboard-access), including the host-loopback pairing and the password required for a network-bound listener;
- the [environment variables](../README.md#environment-variables), including `SCAN_BLOCK_TIME_MS`. The Compose service does not pass `ZOLTAR_BOT_RPC_QUORUM`: set the read agreement requirement in the saved settings instead.

## Monitor without trading

Set `runtime.execute` to `false`. Set `runtime.once` to `true` for one scan, or set `runtime.ui` to `true` for continuous monitoring with the local dashboard:

```bash
bun run run
```

Then open `http://127.0.0.1:4173`. Dry-run opportunities are evaluated exactly like execution opportunities, but no approvals or disputes are sent. Without an approved coordinator, dry-run still synchronizes a bounded sample for diagnostics but refuses to classify any report as an executable opportunity.

When network settings exist, startup and dashboard RPC changes validate `eth_chainId`. An initially unconfigured bot keeps its paused dashboard available without making RPC calls. It will not scan until a verified chain and endpoint set has been saved. A configured bot also keeps the dashboard available when RPC validation is temporarily unavailable, reports `connectivity-degraded`, and retries with bounded backoff. The bot checks the chain whenever it validates a new endpoint set.

A head watcher polls `eth_blockNumber` once per second. Outside failure backoff, a new head wakes the scan immediately; a completed scan logs `scanBlock=<number> durationMs=<duration>`. Scan reads are batched through the canonical Multicall3 deployment at one pinned block, so a scan costs a handful of RPC round trips regardless of how many tokens, pools, or reports are evaluated. Centralized-exchange sampling runs on its own timer; after the first sample it no longer sits in the block-scan path.

For pools in approved universes, each scan discovers reports by reading each coordinator's `pendingReportId` at one fixed block and then reads the corresponding stored OpenOracle state. It repeats those current-state reads at each new head and does not query historical OpenOracle logs. Execution mode requires a quorum to agree on the block and report snapshot. Opportunity evaluation and pool sampling run once at the newest agreed head. With no new head the bot remains **Running** without re-evaluating or writing duplicate price samples.

That fallback is the bounded [coordinator-free diagnostic mode](./CONFIGURATION.md#coordinator-free-diagnostic-mode).

## Run on Sepolia

Choose Sepolia in **Chain and RPC connectivity**. The bot saves the current chain profile, pauses at a safe scan boundary, releases its current chain locks, and loads the selected profile without exiting the process or restarting the container. The browser reconnects automatically.

The first switch creates a clean Sepolia profile from the reviewed defaults. Its settings, signer, deployment addresses, tokens, strategy, submission policy, and history, price, and position journals are independent from mainnet. Configure its Sepolia RPCs, universe approvals, and venue switches. OpenOracle, genesis REP, WETH, and the root market identity are selected automatically from the Sepolia manifest. Switching back to Mainnet restores the saved mainnet profile and journals, but the bot remains paused until you explicitly resume it.

Profiles are private sibling files beside the active operator file. Docker keeps them in the existing named volume, and direct Bun uses the same behavior. Only the selected profile is active at one time. In-place switching requires both profiles to use the same `runtime.once`, `runtime.ui`, `runtime.uiHost`, and `runtime.uiPort` values so the running process and browser keep their operating mode and dashboard origin. The bot rejects an incompatible profile before changing any file. Resolve any pending executor-deployment recovery before switching chains.

## Go-live checklist

Keep `runtime.execute` off until every step holds. The dashboard's **Execution mode** panel enforces the on-chain prerequisites, but not the operational ones.

1. **Use a dedicated key.** Do not use a key that controls unrelated protocol or treasury funds. The execution key lives in the bot process and must be protected like any hot wallet. Start on Sepolia with small risk limits.
2. **Connect.** Save the chain and its read and public RPC URLs. For a two-reader policy, also configure the quorum readers described under the [RPC agreement requirement](../README.md#rpc-agreement-requirement).
3. **Approve universes.** Select the Zoltar universes whose pool reports this wallet may dispute; see [token and pool discovery](./MARKETS.md#token-and-pool-discovery).
4. **Enable a venue.** At least one [Uniswap version](./MARKETS.md#uniswap-venue-execution) must be enabled and available on the selected network.
5. **Deploy the executor** from the dashboard or with [`bun run deploy-executor`](./EXECUTION.md#deploy-the-executor), and verify the address independently.
6. **Fund the wallet and grant allowances** as listed under [required ETH, WETH, and tokens](./EXECUTION.md#required-eth-weth-and-tokens).
7. **Set the policy.** Review the [strategy thresholds, risk limits](./CONFIGURATION.md#adjust-the-strategy), and the [market guard](./MARKETS.md#independent-cex-and-dex-manipulation-guard).
8. **Choose delivery.** Public mempool is the example default; private delivery needs at least one Flashbots-compatible relay. See [submission modes](./EXECUTION.md#submission-modes).
9. **Watch a dry run.** Confirm that the opportunities, pools, relay simulations, inventory requirements, and settlement path look right.
10. **Arm and resume.** Set the signer, enable live execution in **Execution mode**, then **Resume bot**. See [enable execution](./EXECUTION.md#enable-execution).
11. **Supervise.** Provide external process supervision, endpoint health alerts, and a procedure for any position shown as **recovery-required** or **replaced**; see [RECOVERY.md](./RECOVERY.md). Verify the whole path with a low-value transaction before raising limits.

## Limitations

- No automated trading system can guarantee that users never lose money. Reorgs, correlated RPC lies, relay or builder faults, base-fee spikes, malicious or rebasing tokens, OpenOracle or Uniswap defects, compromised keys, and market movement can still cause loss.
- Ethereum mainnet and Sepolia WETH/token games using exact-transfer ERC-20s are supported. Uniswap V2 execution is mainnet-only; V4 execution is limited to standard-fee, hookless native-ETH/token pools. See [Uniswap venue execution](./MARKETS.md#uniswap-venue-execution).
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized execution.
- Private delivery reduces public-mempool exposure but does not guarantee confidentiality, inclusion, fair ordering, or relay or builder behaviour. Configuring multiple relays shares the signed payload with every listed operator.
- Read agreement catches disagreement between providers; it does not help when all endpoints share the same compromised upstream, implementation bug, or correlated failure.
- A **replaced** position has recovered its exact OpenOracle credit, but its one-sided inventory still requires an operator-approved unwind before P&L can be classified as realized.
- Approved-coordinator reports are reread from a fixed block whenever a new head is processed, and a retained block hash is checked on every poll. If canonical history changes beyond that retained anchor, execution stays blocked while the bot clears its report and market caches, resets the retained in-memory cursor, and rebuilds the latest configured bounded window automatically.
- Continuous mode retries transient poll failures with exponential backoff capped at 30 seconds or the poll interval, whichever is longer. The dashboard exposes per-endpoint health and the latest error, and `/healthz` supports container supervision. Production operation still requires external alerts.
- The market guard depends on exchange-specific data quality; see the shared [adapter limitations](../README.md#adapter-limitations).

## Project layout and development

The arbitrager is an independent project inside the monorepo:

- `src/cli/` contains the operator-facing runtime, deployment, and reconciliation entrypoints.
- `src/` otherwise groups code by `config`, `contracts`, `core` strategy, `dashboard`, `execution`, `monitoring`, `runtime`, and durable `state`.
- `config/` contains the example operator configuration.
- `contracts/` contains the executor Solidity source and its local test harnesses.
- `docs/` contains the rendered operator guide, market fixture, chart runtime, styles, and screenshots.
- `scripts/` owns contract generation, documentation checks, fixture replay, and screenshot capture.
- `tests/` mirrors the runtime areas and contains the executor contract suite.

Its own `package.json`, TypeScript configuration, test configuration, and generated contract artifacts define its build. The executor imports unchanged protocol ERC-20 utilities from the monorepo's top-level `solidity/` project; it is not compiled into the protocol statoblast artifact set.

| Command | Purpose |
| --- | --- |
| `bun run check` | Typecheck, lint, generated-file freshness, tests, documentation checks, and formatting. |
| `bun run typecheck`, `bun run lint`, `bun run test`, `bun run format:check` | The individual steps. |
| `bun run check:docs` | Validates the operator guide, these reference documents, and the pinned market fixture. |
| `bun run build:docs` | Rebuilds the tracked `docs/chart-runtime.js` that the operator guide loads. |
| `bun run compile-contracts`, `bun run generate:abi`, `bun run check:generated` | Regenerate and verify the [executor artifacts](./EXECUTION.md#executor-abi-source). |

`scripts/capture-docs-screenshots.mts` recaptures the operator-guide screenshots. It reads `CHROMIUM_PATH` (default `/usr/bin/chromium`) and `OPEN_ORACLE_SCREENSHOT_OUTPUT_DIR` (default `docs/assets`); each `OPEN_ORACLE_CAPTURE_<GROUP>=1` variable adds a group of QA states. `check:docs` replays the pinned market fixture against an archive node only when `OPEN_ORACLE_ARCHIVE_RPC_URL` is set.
