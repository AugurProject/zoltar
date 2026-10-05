# Statoblast liquidator

The liquidator monitors configured security pools, their direct child pools, and resolved desired pools from a configured `SecurityPoolFactory`. It shows pool and vault statistics in a local dashboard and evaluates unsafe vaults in operator-selected pools. Dry-run is the default. Live execution requires an explicit signer, the configured read RPC quorum, the execution flag, and deployed canonical contracts.

The bot owns an ordinary vault under its signer address in each selected pool. A liquidation moves ETH-denominated open-interest debt, the proportional attoREP capacity ownership, and a 5%-bonus REP backing award from the target into that vault. When the award would not satisfy both protocol health branches, the bot first makes a backing-only REP top-up using `MAX_UINT256` as the target health factor, which adds REP backing while rounding new capacity ownership to zero. It then ends the cycle and reloads the target, receiver, aggregate capacity ownership, and live open interest before deciding whether to stage the liquidation. Ordinary fee-earning deposits create price-independent capacity ownership, and the pool's live REP/ETH price converts that ownership into current ETH minting capacity. Actual ETH open interest comes from settlement collateral and is allocated among vaults in proportion to their capacity ownership. For stale prices the bot pre-funds against a configurable higher price bound before queueing the operation. It later withdraws surplus REP when the vault is safely above the withdrawal threshold.

> Use a dedicated low-balance signer, begin on Sepolia, keep dry-run logs, and supervise pool health. Assumed pool open interest remains an economic obligation even when the fixed liquidation bonus is positive.

## Contents

- [Operator setup](#operator-setup)
- [Universe and pool selection](#universe-and-pool-selection)
- [Independent market consensus](#independent-market-consensus)
- [Strategy controls](#strategy-controls)
- [Configuration keys](#configuration-keys)
- [Execution lifecycle](#execution-lifecycle)
- [Development](#development)
- [Upgrading](#upgrading)

Behaviour shared with the other bots (environment variables, the signer lock, the RPC agreement requirement, dashboard access, and the market consensus settings) is in the [shared bot guide](../README.md).

## Operator setup

### Docker Compose

From this directory, build and start the bot:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker volume create zoltar-bot-signer-locks >/dev/null
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory. It stops the stack, rebuilds the image, and recreates the container with `docker compose up --no-build --force-recreate`.

On first start, the container creates a paused, dry-run configuration in its named volume. Open `http://127.0.0.1:4183`; the dashboard does not require a username or password. [Dashboard access](../README.md#dashboard-access) explains the host-loopback pairing and what a network-bound listener requires.

Save the chain and RPCs in **Chain and RPC connectivity**, finish the remaining configuration, and resume only after reviewing the saved settings. Run `docker compose down` to stop the bot and `docker compose up` to start it again. The named volume preserves its configuration, history, and recovery state.

Compose shares one [signer lock](../README.md#signer-lock) with the other bot containers on the host, and passes `ZOLTAR_BOT_RPC_QUORUM` through from the host. The [environment variables](../README.md#environment-variables) table lists every variable, including `SCAN_BLOCK_TIME_MS`.

### Bun

From the repository root, install once, then enter the project:

```bash
bun install --frozen-lockfile
cd bots/liquidator
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
bun run run
```

Set `ZOLTAR_LIQUIDATOR_CONFIG` to use another operator file. The bot accepts no command-line arguments. It refuses to load a configuration or durable state file that is a symbolic link, is not owned by the bot user, or has a mode other than `0600`. The dashboard defaults to `http://127.0.0.1:4183`.

A direct Bun process needs an external supervisor.

### Chain and RPC connectivity

The dashboard's **Chain and RPC connectivity** form is the source of network and endpoint selection. It chain-checks the read, public-submission, and independent quorum RPCs before saving them. An initially unconfigured process remains paused with its dashboard available and begins scanning only after a verified selection is saved. Same-chain RPC changes apply at the next scan. A chain profile includes its signer, markets, selections, strategy, RPCs, and runtime state path. Profiles are private sibling files beside the active operator file, and a newly created profile receives a separate chain-named recovery state path. This prevents transactions, staged operations, and scan state from crossing chains. Docker and direct Bun use the same in-process switching behavior.

Each chain profile saves its own [RPC agreement requirement](../README.md#rpc-agreement-requirement). The default is `1`, so the primary read RPC is sufficient and independent quorum RPCs are optional. Select agreement `2` in **Chain and RPC connectivity** and configure two independent quorum RPC URLs when that chain must retain a two-reader policy. For a critical pool, price, vault, or candidate snapshot, the configured number of readers must respond and every responding reader must agree exactly before a transaction is sent.

Zoltar, the security pool factory, and WETH addresses come from the selected network's canonical deployment manifest: `mainnet-deployment-addresses.json` or `sepolia-deployment-addresses.json` in the repository-root `docs/` directory. The bot checks contract code at these addresses and reports the checked block while waiting for deployments. An absence of pools is a separate empty state; it does not mean Zoltar is missing.

A configured bot keeps its dashboard available when retryable RPC transport unavailability prevents startup validation. It reports `connectivity-degraded`, shows per-endpoint health in the dashboard, and retries with bounded backoff. `/healthz` provides process-liveness checks without dashboard authentication. The supplied Compose service checks that endpoint and uses `restart: unless-stopped` if the bot process exits unexpectedly. Contradictory chain, malformed response, or other safety validation failures stop startup instead of being treated as an outage.

### Switching chains

To operate on Sepolia, choose Sepolia in the dashboard's **Chain** selector and confirm the switch; while live execution is armed the confirmation asks for a typed phrase. The bot saves the current profile, pauses at a safe scan boundary, releases its current chain and state locks, and loads Sepolia without exiting the process or restarting the container. The first switch creates a clean profile with a chain-named durable state file. Switching back restores the saved mainnet settings and recovery state, but the bot remains paused until you explicitly resume it. Only the selected profile is active at one time. In-place switching requires both profiles to use the same `runtime.once`, `runtime.ui`, `runtime.uiHost`, and `runtime.uiPort` values so the running process and browser retain their operating mode and dashboard origin. The bot rejects an incompatible profile before changing any file.

### Settings and going live

The dashboard's Settings page is grouped into setup steps with a jump bar: **1 · Connect** (chain and RPCs), **2 · Markets** (approved universes, market and pool configuration), **3 · Liquidation policy** (strategy and automation), and **4 · Go live** (execution signer, submission, execution mode). Each form's save button unlocks only after an edit differs from the loaded values and its panel shows an **Unsaved changes** badge until it is saved. Saving one panel keeps unsaved edits in the others.

Keep live execution off until the factory, WETH, signer, selected pools, RPC endpoints, gas limits, and REP limits have been reviewed. The **Execution mode** panel under Go live lists every prerequisite the bot enforces (execution signer, chain and RPC endpoints, independent quorum RPCs, canonical contracts, delivery) plus advisory rows for approved universes, supported pools, and market evidence, and keeps the live switch locked until the required rows hold. Enabling it pauses the bot and reserves the signer for this process; resume through the readiness check to start signing. A memory-only signer arms live mode in the running process alone: the saved file keeps paused dry-run mode so a restart cannot execute without its key. `runtime.execute` in the operator file remains the startup mode.

Submission and signer:

- `submission.mode` may be `public` or `private` and is edited in the **Submission** panel; private relays are checked against the selected chain before they are saved. The mode cannot change while a pending transaction sent under the current mode awaits recovery, because recovery resubmits with the saved delivery policy. ETH-funded stale-price requests use the same signed-transaction delivery policy as other actions.
- `privateKey` is stored in the local operator file only when explicitly saved. The dashboard never returns it.

## Universe and pool selection

The universe browser walks Zoltar's deployed child-universe tree from universe zero, including deployed universes that do not have a security pool yet. The bot monitors the chain profile's `selectedPools`, the direct child deployments of those pools, and deployed pools resolved from `desiredPools`; the monitor does not scan unrelated pools for vaults or liquidation candidates. On the **Pool work** page, the **All pools** tab automatically browses the active chain's factory registry in pages of 12, including pools you have not selected. Cards show the question, universe, security multiplier, pool-held REP, and vault count. Use **Refresh** to reload the listing, counts, and metrics. **Catalog snapshot** shows the last successful catalog snapshot in UTC and how long ago it was taken; a failed refresh preserves that snapshot.

Pool deployment date comes from the factory deployment event’s block timestamp. Question start date and Question end date come from the question’s stored time bounds. All three dates use UTC; unavailable dates are marked as such. Optional deployment-date discovery has a 1.5-second deadline, so a stalled historical RPC cannot hold up the pool catalog. Verified dates are cached per chain, factory, and pool, with their deployment block hash checked before reuse.

To find a known pool, paste its full address into **Search by pool address** in the **All pools** tab, then select **Add to supported** on the matching card. Search checks the active chain’s factory, including pools outside the current page. Clear the search to return to browsing. Switch to **Monitored pools** to filter the same cards to pools the bot is currently monitoring. Expand **Monitoring details** for oracle freshness, vault balances, and liquidation targets. These cards and monitoring values come from the bot snapshot and remain visible when catalog discovery fails; catalog dates are optional enrichment.

Use **Add to supported** on a card to save a pool to the chain profile's `selectedPools`, or **Remove from supported** to remove it. This does not approve its universe or change execution mode. A pool with unavailable metrics remains visible. Use **Refresh** if discovery fails. For an existing or undeployed origin pool, you can instead add its universe, question, multiplier, and priority-fee tuple to `desiredPools` in **Market and pool configuration**. The bot resolves the canonical factory address and selects it when present; when `allowAutomaticPoolCreation` is enabled, it deploys a missing desired pool before continuing liquidation. Selecting a pool enables candidate evaluation and execution only while its universe is also approved and its system state is operational. The universe table shows parent and fork-outcome lineage, operational and forked pool counts, pool selection, and whether a bot vault can migrate into that universe.

The canonical Zoltar contract identifies the universe registry, and `approvedUniverses` is the operator's explicit truth policy, shared with the arbitrager. The liquidator and arbitrager example configurations both start with no approvals. Select the root or truthful child in the universe UI; approvals are saved per network profile and REP addresses come from the canonical universe registry. A root universe or fork-created child remains inert until it is approved. For a given forked parent universe, the bot rejects configuration that approves more than one direct child outcome. This prevents an ambiguous vault route. Universe approval does not enable every pool in that universe: both the universe and each individual pool must be selected before the bot liquidates or maintains its vault there. Every discovered pool's REP token must match the configured Zoltar registry's token for that universe. A mismatch fails the scan instead of applying the truth policy to another universe tree; this also supports the external genesis REP token, which does not expose a Zoltar accessor.

When `allowAutomaticVaultMigrations` is enabled, the bot looks for a selected forked parent pool where its signer has non-escrowed vault accounting and one deployed direct child universe is approved. During the protocol's eight-week migration window it calls the parent's `SecurityPoolForker.migrateVault(parent, outcomeIndex)`. The migration moves the signer's REP backing units and capacity ownership to the chosen child and atomically creates the child security pool when it does not exist. Claimable fees remain redeemable from the parent, while escalation accounting follows its separate migration path described in the [canonical migration design](../../docs/explanation/statoblast.html#forks-migration). The bot does not split a parent vault across outcomes. Once the child becomes operational, normal vault maintenance and liquidation continue there because the next registry scan inherits the selected parent pool onto its approved child. A missing approved child, closed migration window, empty vault, active staged operation involving the bot vault, disabled migration setting, or conflicting child approval produces no migration.

Pool-selection inheritance is a configuration reconciliation and remains active in dry-run mode and when automatic vault migrations are disabled. Only the on-chain vault movement is controlled by `allowAutomaticVaultMigrations`.

The bot bootstraps every registered vault, then keeps an incremental index of vaults with REP backing or REP committed to a dispute. In steady state, later scans reread only newest registry entries and vaults named by `VaultAccountingCheckpoint` or `VaultEscrowUpdated`. A `TruthAuctionHaircutApplied` event refreshes every retained dispute-staked vault; reorg recovery rebuilds the full registry. An adaptive bounded log scan catches up after long outages. Current pool totals and price recompute backing, open interest, health, and liquidation candidates locally for every retained vault. Vaults whose pool-held and dispute-staked REP both reach zero are evicted until a later event reactivates them. Empty registrations are discarded after inspection, so they do not consume steady-state memory or hide older liquidation opportunities.

## Independent market consensus

The liquidator uses the shared market observer described under [independent market consensus](../README.md#independent-market-consensus), which owns the source format, freshness and persistence rules, group agreement, required and advisory modes, the adapter limitations, and every `centralizedMarkets` key. This section covers only what is specific to the liquidator.

**Where the settings live.** Put root REP sources in `centralizedMarkets` with `assetSymbol: "REP"`. The root asset address and chain come from the selected network's deployment manifest; saved settings omit those two fields and cannot override them. Put child REP configurations in `childMarketConfigurations`, including each child's exact `assetAddress`, `assetChainId`, and `assetSymbol: "REP"`. Child assets must match the selected chain and the discovered universe REP, and each child stays fail-closed until its own market history is reliable.

**What the guard gates.** The guarded estimate never replaces the coordinator price in protocol arithmetic. In required mode, liquidation and price-dependent vault maintenance recheck evidence age after preparation and immediately before persisting each signed intent, including after approvals or funding transactions. Migration, transaction recovery, and price-independent fee redemption continue, because they do not rely on a REP market price. In advisory mode, healthy independent evidence can still reject an outlying coordinator price.

**DEX sources.** The liquidator's DEX group consists only of the explicit constant-product pairs in `venueConsensus.dexSources`. The arbitrager dynamically observes authenticated V2, V3, and V4 deployments, but the liquidator has no configurable V3 or V4 source format.

Configured sources and their liquidity are shown in the dashboard. Operators can add or remove CCXT exchanges from the market-configuration editor without any exchange adapter being hard-coded by the bot.

The source-admission table explains whether each configured source is admitted or excluded and shows the current exclusion reason. **Test saved sources** runs a fresh read-only probe without changing configuration. The same probe is available for deployment smoke checks while the bot is running:

```bash
bun run smoke:markets -- http://127.0.0.1:4183
```

It exits unsuccessfully if any configured source cannot produce a usable observation and exercises the saved CCXT adapters, RPC connection, chain, pair addresses, and WETH deployment.

Run that smoke check before enabling execution and after changing an adapter.

## Strategy controls

The [`strategy` table](#strategy) lists every key with its range and example value. Three rules apply across them:

- The protocol safety boundary is 10,000 bps. The top-up threshold must not exceed the target, and the withdrawal threshold must be above the target.
- `maximumPerPoolRep` and `maximumTotalDeployedRep` bound liquidation acquisitions and every automatic maintenance deposit.
- Stale full-close candidates are rejected because the target can add REP and the eventual oracle price is not bounded on-chain; that branch cannot guarantee the configured REP exposure limits.

## Configuration keys

The operator file is `version: 2`. A key is required unless the Default column gives a value; the Example column shows `config/operator.example.json`. Amounts are decimal strings in 18-decimal ETH or REP units, and every key ending in `Bps` is a JSON number. `connectivity`, `submission`, and `centralizedMarkets` use the [shared sections](../README.md#shared-configuration-sections) and the shared [`centralizedMarkets` keys](../README.md#centralizedmarkets-keys).

### Top level

| Key | Type | Range | Default | Example | Effect |
| --- | --- | --- | --- | --- | --- |
| `version` | number | `2` | required | `2` | File format version. |
| `paused` | boolean | — | required | `true` | Stops automatic execution. |
| `privateKey` | string or `null` | 32-byte `0x` hex | required | `null` | Saved signer; `null` when none is remembered. |
| `network` | object | `name` is `mainnet` or `sepolia`, with its matching `chainId` and an `explorerUrl` | the mainnet preset | absent | Written by **Chain and RPC connectivity**. |
| `networkConfigured` | boolean | — | `true` when `connectivity` is present | absent | An unconfigured file must be paused and dry-run. |
| `connectivity` | object | [shared](../README.md#connectivity) | absent until saved | absent | RPC endpoints and the agreement requirement. |
| `approvedUniverses` | string array | decimal universe ids below 2^248 | required | `[]` | The operator's truth policy. |
| `selectedPools` | address array | — | required | `[]` | Pools the bot evaluates and maintains a vault in. |
| `desiredPools` | array | see below | `[]` | `[]` | Origin pools resolved through the factory. |
| `centralizedMarkets` | object | [shared](../README.md#centralizedmarkets-keys) | required | no sources | Root REP market policy. |
| `childMarketConfigurations` | array | each entry uses the shared keys plus `assetAddress` and `assetChainId` | `[]` | `[]` | Child-universe REP market policies. |
| `submission` | object | [shared](../README.md#submission) | required | public | Delivery mode and relays. |

Each `desiredPools` entry has four required fields: `universeId` (decimal string below 2^248), `questionId` and `initialReportPriorityFeeAttoEthPerGas` (decimal uint256 strings), and `statoblastSecurityMultiplierBps` (a number above `10000`). Duplicate entries are rejected.

### `runtime`

| Key | Type | Range | Default | Example | Effect |
| --- | --- | --- | --- | --- | --- |
| `execute` | boolean | — | required | `false` | Startup execution mode; `false` is dry-run. |
| `once` | boolean | — | required | `false` | Runs one cycle and exits. |
| `ui` | boolean | — | required | `true` | Serves the dashboard. |
| `uiHost` | string | `127.0.0.1` or `0.0.0.0` | required | `127.0.0.1` | Dashboard bind address. See [dashboard access](../README.md#dashboard-access). |
| `uiPort` | number | 1–65,535 | required | `4183` | Dashboard port. |
| `pollMilliseconds` | number | 1,000–3,600,000 | required | `12000` | Main loop interval. |
| `stateFile` | path | — | required | `.state/operator-state.json` | Durable transaction intent, outcomes, and activity journal. |
| `logLookbackBlocks` | number | 1–256 | `256` | `256` | Latest block window that normal recovery checks, newest first. |
| `historicalLogRecovery` | boolean | — | `false` | `false` | Enables the historical recovery backfill, which walks older required blocks newest first and saves each successful chunk. |

### `strategy`

Every key is required except `allowAutomaticPoolCreation`.

| Key | Type | Range | Example | Effect |
| --- | --- | --- | --- | --- |
| `allowAutomaticDeposits` | boolean | — | `true` | Permits REP deposits into the bot vault. When `false`, a candidate that requires REP is rejected. |
| `allowAutomaticWithdrawals` | boolean | — | `true` | Permits surplus REP withdrawals. |
| `allowAutomaticVaultMigrations` | boolean | — | `true` | Permits the fork migration described under [universe and pool selection](#universe-and-pool-selection). |
| `allowAutomaticPoolCreation` | boolean | — | `false` | Deploys a missing desired pool before continuing liquidation. Defaults to `false` when absent. |
| `candidatePriority` | string | `largest-bonus`, `largest-debt`, or `lowest-top-up` | `largest-bonus` | Ranks liquidation candidates by bonus value, by debt moved, or by the smallest required top-up. |
| `minimumLiquidationDebtEth` | decimal string | not above the maximum | `"1"` | Smallest ETH debt requested from a target. |
| `maximumLiquidationDebtEth` | decimal string | — | `"25"` | Largest ETH debt requested from a target. |
| `minimumRewardValueEth` | decimal string | — | `"0.02"` | Filters the fixed-bonus value before gas. |
| `maximumGasCostEth` | decimal string | — | `"0.02"` | Caps the padded EIP-1559 gas limit actually signed for every automated action. |
| `maximumOracleRequestCostEth` | decimal string | — | `"0.02"` | Caps fresh-price bounty funding. |
| `maximumPerPoolRep` | decimal string | not above `maximumTotalDeployedRep` | `"10000"` | Bounds liquidation acquisitions and automatic maintenance deposits in one pool. |
| `maximumTotalDeployedRep` | decimal string | — | `"25000"` | Bounds them across all pools. |
| `walletReserveRep` | decimal string | — | `"100"` | REP that remains outside pools. |
| `minimumRepWithdrawalRep` | decimal string | — | `"10"` | Avoids small staged withdrawals. |
| `redeemFeesAboveEth` | decimal string | — | `"0.01"` | Controls ETH fee redemption. |
| `fallbackRepPerEthPrice` | decimal string | — | `"0"` | Used only for a never-seeded stale coordinator. |
| `stalePriceFundingBufferBps` | number | 10,000–1,000,000 | `15000` | Pre-funds the liquidator vault before a stale-price operation is queued. |
| `stagedOperationValidForSeconds` | number | 1–300 | `240` | Validity window passed to each staged liquidation or withdrawal request. |
| `vaultTopUpHealthBps` | number | 10,000–1,000,000, not above the target | `11000` | Triggers maintenance. |
| `vaultTargetHealthBps` | number | 10,001–1,000,000 | `12500` | Post-deposit and post-liquidation target. |
| `vaultWithdrawHealthBps` | number | 10,001–1,000,000, above the target | `15000` | Gates surplus withdrawals. |

## Execution lifecycle

Each cycle performs an authoritative factory read, loads current positions from the known-vault registry, computes exact protocol floor and rounding behavior, and selects at most one action:

1. Migrate an applicable selected parent vault into its one approved child universe.
2. Top up an existing bot vault that is approaching its safety boundary.
3. Withdraw REP that is safely above the configured threshold.
4. Redeem accrued ETH fees.
5. Pre-fund a liquidation vault and submit the best liquidation candidate.

The bot uses the self-receiving route: the signer is both operator and receiver vault, the target is distinct, and the approval ID is zero. The operator therefore pays gas and any oracle costs and its own receiver vault receives the debt, capacity ownership, and REP award. The contracts also support separately authorized receiver vaults, but this bot does not install or consume delegated receiver approvals.

Transaction intent and outcomes are written to `runtime.stateFile`. The activity journal is restored on restart. A signed intent, nonce, serialized transaction, submission block, and validity ceiling are fsynced before relay or RPC submission. Restart recovery quorum-checks receipts and nonce state. It never rebroadcasts an ambiguous price-dependent intent using stale market evidence. Public intents remain blocked until the original receipt appears or a finalized replacement or cancellation proves that the same signer nonce was consumed. Private intents expire only after their relay validity ceiling plus twelve canonical confirmation blocks. Non-price-dependent intents can resubmit the exact durable signed transaction while it remains viable. Transport failures enter `connectivity-degraded`, remain visible, and retry with bounded backoff. Safety failures such as contradictory chain state or execution evidence still pause automatic execution until operator review.

For a replaced or canceled public intent, pause the bot and use **Transaction recovery** to enter the finalized replacement hash. The replacement must have the same sender and nonce, quorum-confirmed receipt evidence, a canonical receipt block, and twelve confirmations. Successful reconciliation is recorded in the durable activity journal. There is deliberately no unsafe “forget transaction” action.

When a coordinator price is stale, the bot wraps and approves the buffered minimum WETH report amount, approves the matching REP amount, and funds a staged liquidation only if the request remains within configured limits. Settlement and execution of that staged operation remain visible in subsequent pool scans. The queued operation ID is persisted across restarts and reconciled against quorum event reads; a failed execution or oracle-recovery consumption pauses execution and is recorded instead of being treated as a successful liquidation. Active staged liquidations are paged from the coordinator, reserved in REP exposure accounting, and excluded from candidate selection until consumed.

## Development

`bun run check` runs typecheck, lint, tests, and the format check. The individual steps are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run format:check`.

`bun run ui:fixture` serves the dashboard against fixture data without a chain or key, on port `4183` unless `DASHBOARD_FIXTURE_PORT` is set.

The reusable Ethereum, connectivity, quorum, block synchronization, signer gate, retry, and transaction-submission primitives live in `../shared`.

## Upgrading

Configuration written by earlier releases still loads:

- **Operator file `version: 1`.** Its string `desiredPools[].statoblastSecurityMultiplierBps` values become JSON numbers, and the next save writes version 2.
- **Saved deployment address fields.** They are ignored and removed when settings are saved; addresses come from the selected network's manifest.
