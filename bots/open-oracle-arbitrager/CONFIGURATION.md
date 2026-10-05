# Configuration reference

This document owns the [OpenOracle arbitrager](./README.md) operator file, every configuration key, the dashboard that edits them, and upgrade notes. Execution behaviour is in [EXECUTION.md](./EXECUTION.md).

**Contents**

- [Persistent operator settings](#persistent-operator-settings)
- [Configuration keys](#configuration-keys)
- [Adjust the strategy](#adjust-the-strategy)
- [Third-party settlement](#third-party-settlement)
- [Coordinator-free diagnostic mode](#coordinator-free-diagnostic-mode)
- [Data freshness and retention](#data-freshness-and-retention)
- [Dashboard](#dashboard)
- [Upgrading](#upgrading)

## Persistent operator settings

`.state/operator.json` is the active operator file, which the dashboard calls the compatibility file. Complete settings for each chain are retained in `.state/operator.json.mainnet.profile` and `.state/operator.json.sepolia.profile` while that profile is inactive. Back up all three files so both chain profiles can be restored. The bot refuses to load an operator settings file or position journal that is a symbolic link, is not owned by the bot user, or has a mode other than `0600`. The bot accepts no command-line arguments and does not read chain or RPC URL settings from environment variables; `ZOLTAR_BOT_RPC_QUORUM` only supplies the agreement requirement for a file without a saved `rpcQuorum`. Copy the example before first startup:

```bash
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
```

`OPEN_ORACLE_ARBITRAGER_CONFIG` may locate a different active compatibility file; it does not override any value inside the document. Its chain profiles use the `<operator-config>.mainnet.profile` and `<operator-config>.sepolia.profile` sibling paths. This locator is useful for service managers and tests. Select the chain and enter the read and public RPC URLs in **Chain and RPC connectivity**. Every endpoint is checked against the selected chain before it is saved. Initial chain selection applies immediately, while quorum and RPC changes apply at the next scan boundary. To operate another chain, select its saved chain profile in the dashboard. Configure the readers that the saved [RPC agreement requirement](../README.md#rpc-agreement-requirement) needs in the same form (`connectivity.quorumRpcUrls`) before enabling execution.

Direct file editing is an offline workflow: stop the bot, edit the configuration, and restart it. While the bot is running, use the dashboard only; do not edit the file concurrently with a dashboard save.

Save changes in the dashboard's focused forms, which write the versioned file (`version: 5`). They cover chain connectivity with the quorum RPC URLs, approved universes, venues, the REP market source policy, strategy, the risk limits and scanning form (risk limits, event lookback, polling), third-party settlement, the signer, submission, and execution mode. Each form's save button stays disabled until an edit differs from the loaded values, an **Unsaved changes** badge marks edited panels, and a **Queued · next scan** badge marks sections the bot has saved but not yet applied at a scan boundary. The read-only **Complete configuration** view shows the current file for copying, including the process-fixed runtime fields (paths, dashboard bind, and `once`), which cannot change while the bot runs. A saved private key appears as `__PRESERVE_SAVED_PRIVATE_KEY__`, never as key material.

The containing directory is created with owner-only permissions when possible, and every replacement configuration file is mode `0600`. File contents and the containing directory are synced before a successful save is reported. The default directory is ignored by Git. A malformed or unsupported file stops startup instead of silently reverting to defaults. A runtime write failure rejects the dashboard mutation and keeps the prior runtime settings active; fix the settings path or permissions and retry.

Deployment identities are execution trust roots. REP, WETH, OpenOracle, and all Uniswap addresses come from the selected network. Mainnet and Sepolia use Uniswap's published factory, quoter, and V4 contracts; the Sepolia V3 router is the SwapRouter installed by `deploy:testnet`. The saved configuration contains V2/V3/V4 enable switches, not Uniswap addresses. The dashboard validates venue switches and independent RPC settings before saving them for the next scan boundary. The executor is derived from bundled code and a fixed salt; coordinators come from pools in approved universes. The scan checks the canonical factory's deployment availability and verifies each pool-to-coordinator link. Discovery is bounded to 10,000 registry entries and fails closed if that limit is exceeded.

The canonical addresses come from `mainnet-deployment-addresses.json` and `sepolia-deployment-addresses.json` in the repository-root `docs/` directory, not from this package's own `docs/`. OpenOracle, genesis REP, WETH, and the root market asset and chain all derive from the selected network's manifest; saved settings omit these identities.

### Settings page

The Settings page is grouped into setup steps with a jump bar:

1. **Connect**: chain and RPCs.
2. **Markets**: approved universes, venues and the executor, and REP market sources.
3. **Trading policy**: strategy, risk limits, and settlement.
4. **Go live**: wallet, submission, and execution mode.
5. **Advanced**: a read-only copy of the complete configuration file, collapsed by default.

In **Chain and RPC connectivity**, select the chain, enter its read, public, and quorum RPC URLs, and save so every endpoint is checked against that chain. To require two agreeing readers, select **2 · require two agreeing independent RPCs** and enter two independent quorum RPC URLs in the same form. Supported live configuration changes, including the agreement requirement and endpoint set, apply automatically at the next scan boundary. Chain-specific history, price, and position paths are process-fixed and can only be edited in the file while the bot is stopped.

### Deploy from the dashboard

For dashboard deployment, configure a public submission RPC on the selected chain and set an active signer. If execution is armed, pause the bot first; pause blocks new entries but not lifecycle recovery, settlement, or withdrawal, so wait until there are no pending or in-flight signer operations before deploying. Confirm the fixed derived executor address shown by the dashboard. The deploy action checks the RPC chain and canonical CREATE2 proxy. A fresh deployment verifies its successful receipt and runtime bytecode; if the predicted address is already deployed, the action verifies matching runtime bytecode without sending a transaction. It then queues the verified executor for the next scan. Before execution begins, the read quorum verifies the executor against bundled code and checks canonical contract availability.

### Pause

Pause blocks new position entry. It deliberately does not block settlement, replacement recovery, or withdrawal for a position that already has capital at risk. A submission already started may still finish; pause cannot cancel a signed bundle or transaction.

## Configuration keys

A key marked **required** has no default in the code; the value shown after it is the one in `config/operator.example.json`. Amounts ending in `Weth` or `Eth` are decimal strings, and every key ending in `Bps` is a JSON number. `connectivity`, `submission`, and `centralizedMarkets` use the [shared sections](../README.md#shared-configuration-sections) and the shared [`centralizedMarkets` keys](../README.md#centralizedmarkets-keys).

### Top level

| Key | Type | Range | Default | Effect |
| --- | --- | --- | --- | --- |
| `version` | number | `5` | required | File format version. |
| `paused` | boolean | — | required; `true` | Blocks new position entry. |
| `privateKey` | string or `null` | 32-byte `0x` hex | none | Saved signer. Absent or `null` unless the key was explicitly saved. |
| `network` | string | `mainnet` or `sepolia` | `mainnet` | Written by **Chain and RPC connectivity**. |
| `networkConfigured` | boolean | — | `true` when `connectivity` is present | An unconfigured file must be paused, dry-run, and without `connectivity`. |
| `connectivity` | object | [shared](../README.md#connectivity) | absent until saved | RPC endpoints and the agreement requirement. |
| `approvedUniverses` | string array | decimal universe ids below 2^248 | `[]` | Universes whose REP may be traded. |
| `tokenAddresses` | address array | — | required; `[]` | Additional monitoring-only tokens. |
| `deployment.uniswapV2Enabled` | boolean | — | required; `true` | Enables Uniswap V2 (mainnet only). |
| `deployment.uniswapV3Enabled` | boolean | — | required; `true` | Enables Uniswap V3 with its spot/TWAP check. |
| `deployment.uniswapV4Enabled` | boolean | — | required; `false` | Enables the V4 PoolManager and Quoter together. |
| `centralizedMarkets` | object | [shared](../README.md#centralizedmarkets-keys) | a built-in policy with no sources | The REP market source policy. |
| `submission` | object | [shared](../README.md#submission) | required | Delivery mode and relays. |
| `strategy` | object | see [adjust the strategy](#adjust-the-strategy) | required | Opportunity thresholds. |
| `settlement` | object | see [third-party settlement](#third-party-settlement) | settlement disabled | Third-party settlement policy. |
| `runtime` | object | see below | required | Process and risk settings. |

### `runtime`

Every key is required. `historyFile`, `positionFile`, `priceHistoryFile`, `uiHost`, `uiPort`, `ui`, and `once` are fixed for the life of the process and can be edited only in the file while the bot is stopped.

| Key | Type | Range | Example | Effect |
| --- | --- | --- | --- | --- |
| `execute` | boolean | — | `false` | Startup execution mode; `false` is dry-run. |
| `once` | boolean | cannot be `true` together with `ui` | `false` | Runs one scan and exits. |
| `ui` | boolean | cannot be `true` together with `once` | `true` | Runs continuously with the dashboard. |
| `uiHost` | string | `127.0.0.1` or `0.0.0.0` | `127.0.0.1` | Dashboard bind address. See [dashboard access](../README.md#dashboard-access). |
| `uiPort` | number | 1–65,535 | `4173` | Dashboard port. |
| `historyFile` | path | distinct from the other journals | `.state/history-mainnet.jsonl` | Append-only confirmed-dispute history. |
| `positionFile` | path | distinct from the other journals | `.state/positions-mainnet.json` | [Durable position journal](./RECOVERY.md#durable-position-journal). The settlement journal is `<positionFile>.settlements`. |
| `priceHistoryFile` | path | distinct from the other journals | `.state/prices-mainnet.jsonl` | Pool price samples. |
| `logLookbackBlocks` | number | 0–256 | `256` | [Coordinator-free diagnostic](#coordinator-free-diagnostic-mode) event window; `0` disables event discovery. |
| `maxHedgeSlippageBps` | number | 0–1,000 | `50` | Adverse movement permitted by the signed hedge limit. |
| `pollMilliseconds` | number | 1,000–3,600,000 | `1000` | Longest idle wait between scans, and the centralized-exchange sampling cadence. |
| `riskLimits.lifecycleGasReserveWeth` | decimal string | ≥ 0 | `"0.01"` | Minimum lifecycle gas reserve subtracted from modeled profit. |
| `riskLimits.maxConcurrentPositions` | number | 1–1,000 | `1` | Cap on non-closed durable positions. |
| `riskLimits.maxDailyGasSpendWeth` | decimal string | ≥ 0 | `"0.05"` | UTC-day gas budget shared by positions and settlements. |
| `riskLimits.maxPositionNotionalWeth` | decimal string | not above `maxTotalLockedWeth` | `"5"` | Largest notional of one position. |
| `riskLimits.maxTotalLockedWeth` | decimal string | ≥ 0 | `"10"` | Largest total notional of all non-closed positions. |

## Adjust the strategy

Every setting below can be changed in the dashboard and takes effect on the next scan. The same values live under `strategy` in the complete configuration:

| Setting | JSON field | Type | Range | Example | Effect |
| --- | --- | --- | --- | ---: | --- |
| Minimum profit | `minimumProfitWeth` | decimal string | 0–1,000 WETH | `"0.01"` | Rejects opportunities below an absolute modeled net profit. |
| Minimum return | `minimumProfitBps` | number | 0–100,000 | `100` | Requires modeled net profit relative to the direction-specific return basis. |
| Spot/TWAP distance | `maxSpotTwapTicks` | integer string | 0–100,000 | `"100"` | Rejects V3 pools whose current tick is too far from the TWAP. |
| TWAP window | `twapSeconds` | number | 60–86,400 | `1800` | Controls the V3 manipulation-resistance window. |
| Remaining time | `minimumRemainingSeconds` | integer string | 1–86,400 | `"36"` | Inclusion buffer for timestamp-based games. |
| Remaining blocks | `minimumRemainingBlocks` | integer string | 1–1,000 | `"3"` | Inclusion buffer for block-based games. |

All six fields are required.

Increasing profit thresholds reduces execution frequency. Increasing the TWAP window or remaining-time buffers is generally more conservative, while decreasing the maximum Spot/TWAP distance rejects more divergent pools and is more conservative. Increasing that maximum permits larger Spot/TWAP deviations. Parameter changes do not disable contract-side deadline, ratio, state-hash, quote-refresh, simulation, or inventory guards.

The other sections are listed under [configuration keys](#configuration-keys); `network` and `connectivity` are absent until the focused dashboard form saves them. **Risk limits and scanning** edits `runtime.riskLimits`, `runtime.maxHedgeSlippageBps`, `runtime.logLookbackBlocks`, and `runtime.pollMilliseconds`, the main loop interval: the longest idle wait between scans when no new head arrives (`1000` ms in the example). Outside failure backoff a new block wakes the scan immediately. It is also the centralized-exchange sampling cadence; coordinator-free diagnostic mode queries every unseen event-log height. **Execution mode** edits `runtime.execute`. Deployment, execution-mode, and risk changes take effect at the next scan boundary. Process persistence paths and the dashboard bind cannot be edited while the bot is running.

The position notional uses the refreshed required WETH plus required token funding valued at the higher of the executable hedge quote and signed hedge limit. Immediately before journal write and delivery, the bot rechecks that notional, the total of every non-closed durable position, and the UTC-day gas total. Public mode uses `1,200,000 × gas price` for the candidate entry; private mode uses the largest gas usage from the successful relay simulations. Both add the lifecycle reserve. A value equal to a configured cap is allowed; one attoETH above it is rejected.

Actual gas is assigned to the UTC day of each receipt's quorum-confirmed canonical block timestamp, not the local time at which the transaction was staged or later recovered. The durable position stores one dated gas expenditure per confirmed receipt, and both the execution limit and dashboard use that same ledger.

## Third-party settlement

The bot can also settle reports it never disputed. Every approved-coordinator report that is past its settlement deadline and still unsettled appears in the dashboard's **Settlement queue** with the settler reward the coordinator escrowed, the projected gas for `settle` (the callback gas limit plus the 1/63 slack OpenOracle requires after the callback, plus a fixed base and an amortised reward withdrawal, each padded the way the signer pads its gas limit), and the projected net. Settlement is off until it is enabled in the dashboard's **Settlement** form or under `settlement` in the operator file:

| Setting | JSON field | Type | Range | Default | Effect |
| --- | --- | --- | --- | ---: | --- |
| Enabled | `enabled` | boolean | — | `false` | Allows settle and reward-withdrawal transactions in execution mode. Dry-run mode only reports decisions. |
| Minimum net | `minimumProfitWeth` | decimal string | 0–1 | `"0.001"` | Rejects settlements whose ETH reward minus projected gas is below this amount. |
| Gas price cap | `maxGasPriceNanoEth` | decimal string | above 0, at most 10,000 | `"50"` | Rejects settlements when the projected gas price exceeds the cap, and bounds the fee ceiling every settle and withdrawal is signed with, so a delayed inclusion can never pay more per gas than this. |
| Withdraw threshold | `rewardWithdrawThresholdEth` | decimal string | above 0, at most 100 | `"0.01"` | Settler rewards accrue inside OpenOracle; the bot withdraws them once the unclaimed balance reaches this amount, at a gas price under the cap and within the daily gas budget. |

The defaults apply when the `settlement` section is absent; a present section must contain all four fields.

Reports the wallet itself reported are excluded here because the position lifecycle already settles and withdraws them. Reports off their coordinator template are never settled. Each scan spends at most one transaction: a dispute attempt takes precedence, then the eligible settlement with the highest projected net, then a due reward withdrawal. Both wait (`history-unavailable`) whenever a position's history or receipt recovery has failed, the same gate that blocks disputes, because the shared daily gas budget cannot include that position's gas until recovery completes. The bot simulates `settle` at the scan head before signing, so a report settled by someone else costs nothing. Projected gas, the minimum net, and the daily budget are all judged at the fee ceiling the transaction is signed with (the 25-block validity maximum, bounded by the gas price cap), not at the lower price expected at submission, so the queue's net is the worst case the signature can pay.

Settlement gas is charged to the UTC day of its receipt block and shares the daily gas budget with positions in both directions: it blocks further settlements and dispute entries once the budget is spent, and an attempt that is still pending charges its signed exposure to whichever day is being judged until its outcome is known. A report or reward withdrawal with an attempt that may still be included is never re-sent; that hold is scoped to the OpenOracle the attempt was sent to (and, for withdrawals, to the signing wallet), so an attempt journaled before a contract or signer change keeps its recovery and gas accounting without blocking the new contract's report of the same id or the new wallet's withdrawals. Pausing blocks new settlements and withdrawals.

Because the signature is capped, a base fee that climbs above the cap after submission delays inclusion rather than raising the price. Under private submission the relay drops the transaction at its `maxBlockNumber`, which frees the nonce and lets the journal mark the attempt `dropped`. Under public submission the transaction has no deadline: it waits in the mempool until the base fee falls below the cap or the node evicts it, and because position transactions are signed at the next pending nonce they queue behind it for that time. Set the cap with that head-of-line effect on disputes in mind when running in public mode.

Every signed settlement and reward withdrawal is journaled in `<positionFile>.settlements` (append-only, chain-scoped) with its nonce and durable intent, and shown under **Settlement history** with its projected and actual gas. That derived path is isolated like the configured journals: no configured runtime file, the operator settings file, or a dormant chain profile's journal may resolve to it, through symlinks or otherwise. Each scan reconciles records left `pending` by an interrupted process before any candidate is judged against the daily budget: a receipt resolves the attempt, and because a public transaction has no on-chain deadline an attempt without a receipt stays pending until another transaction consumes its nonce at a reorg-safe depth. A consuming transaction with the same intent (an operator rebroadcast) is adopted under its own hash; any other retires the attempt as `expired`. An attempt becomes `dropped` when it provably has no mempool to land from: a private attempt whose signed horizon has finalized without a receipt (the relay stops including it at `maxBlockNumber`), or a public attempt that every RPC refused with an explicit transaction-pool message (or an invalid-params error) or that a pause stopped between the journal write and the send; a timeout, HTTP failure, or unrecognised error may have followed an ingestion, so those attempts stay pending. Dropping releases the budget at once and the report once the attempt's own signed horizon has finalized, so a refusal that repeats re-signs at that cadence rather than on every scan. A dropped private attempt keeps being rechecked so a late receipt or a consumed nonce still lands in the journal; a dropped public attempt, which no node accepted, leaves the recheck set once its horizon has finalized. No outcome is final on age alone: an included attempt records its receipt block and is rechecked until recovery has verified that block canonical twelve blocks deep (a receipt that moved to another block is re-read, one a reorg orphaned returns the attempt to `pending`), and an expired attempt remembers the transaction that replaced it and is rechecked the same way (an orphaned replacement returns the original to `pending`, or credits it if it landed after all). When a replacement is adopted, its outcome is journaled before the replaced hash is retired, so an interruption between the two writes never loses the receipt. Realized settlement income (confirmed rewards minus every paid gas cost) is tracked separately from arbitrage P&L.

## Coordinator-free diagnostic mode

Without an approved coordinator, dry-run still synchronizes a bounded sample for diagnostics but refuses to classify any report as an executable opportunity.

Coordinator-free diagnostic mode is an explicitly bounded fallback. Set `runtime.logLookbackBlocks` to `0` to disable event discovery, or from `1` through `256` to inspect that many latest blocks. It starts with the newest block and never walks back toward genesis. The bounded response prevents permissionless event volume from producing an unbounded RPC request.

## Data freshness and retention

The price file can retain a sample from a block displaced by a reorganization. The bot reads at most the latest 8 MiB, loads and charts the latest 2,000 valid price records, and atomically compacts the file to those records after it crosses 8 MiB. Approved-coordinator monitoring keeps the complete current state of each pending report but does not reconstruct its historical dispute path from logs. Reports that are no longer pending are removed from the live cache; confirmed bot transaction history remains in the execution history file. In coordinator-free diagnostic mode, the startup lookback backfills report events but not historical pool prices. At most 256 reports and 64 permissionlessly observed tokens are retained so event spam cannot create ever-growing per-block work. Increase `runtime.logLookbackBlocks` only when broader diagnostic event history is operationally important.

## Dashboard

Set `runtime.ui` to `true`, choose `runtime.uiPort`, and run:

```bash
bun run run
```

The dashboard shows:

- Bot mode, **Syncing**, **Running**, **Paused**, **Error**, or **Stopped** status, latest block, block age relative to the operator computer, errors, and active-report count.
- Selected network, expected chain ID, read/public RPC controls, and endpoint checks.
- A local signer control, connected address, and its ETH/WETH/REP balances.
- ETH, WETH, REP, executable REP value, and estimated portfolio value.
- Native ETH stakes, WETH stakes, and ETH settler rewards locked in reports currently pending on discovered coordinators. The combined figure treats 1 WETH as 1 ETH.
- Approved-coordinator reports awaiting third-party settlement, each with reward, projected gas and net, decision, and the settlement and reward-withdrawal history.
- Current opportunities, token-metadata-normalized inventory requirements, deadline window, token-specific direction, pool, and decision. WETH/token reports still inside their settlement window that the scan declined before any venue priced them stay listed as `skipped` with the concrete gate (missing pool, execution allowlist, dispute delay, remaining window, spot/TWAP limit, or the venue quote failure) so they are not visible only in the operation log. Reports past their deadline, off their coordinator template, or not quoted in WETH are logged only.
- Durable positions with actual hedge execution, entry and lifecycle gas, exact settler reward, withdrawals, state, and realized net P&L. A staged entry shows **Awaiting entry evidence** and is excluded from actual P&L totals until receipt and executor-event quorum succeeds. A lifecycle attempt is likewise excluded while any receipt is ambiguous. `closed-pending-finality` retains its risk slot and does not contribute realized profit until its exact lifecycle evidence passes the finality quorum. Realized totals include only closed positions whose expected inventory fully reconciled or whose manual reconciliation explicitly records P&L.
- Confirmed dispute transactions and their older quote-time accounting. The table and trend are bounded to the latest 500 records; durable position totals use the retained recovery records plus the journal's compacted accounting summary.
- Signed transaction status, public/private delivery, accepted and failed relay targets, replacement hash from the receipt, actual gas, and ETH profit estimates.
- A read-only active risk envelope showing configured position, locked-capital, daily-gas, and lifecycle-reserve limits alongside current usage and remaining capacity.
- Persistent strategy, risk-limit, settlement, execution-mode, RPC fanout, relay submission, and REP market source controls, and pause/resume.
- A token catalog with wallet balances and supported WETH/token pools. Each pool address links to the selected-network explorer. The [market discovery section](./MARKETS.md#token-and-pool-discovery) owns the venue, price, and liquidity semantics. A token with no supported pool is explicitly labeled instead of disappearing.
- In coordinator-free diagnostic mode, the submitted/disputed/settled events observed for each OpenOracle report, including blocks, reporters, raw locked amounts, and transaction links. Discovered-coordinator mode shows current report state without reconstructing these historical paths. See [data freshness and retention](#data-freshness-and-retention) for lookback limits.
- A per-asset current-head price-history chart with one series per supported pool, axes, point tooltips, and a recent exact-value table. Samples persist across restarts, subject to the retention and reorg limits above.
- A 500-entry in-memory operations journal. The dashboard hides routine scan entries and shows decisions, configuration changes, transaction states, and the reason for each action.

The UI is local-only by default. A private key entered there is sent over HTTP to the loopback endpoint, immediately cleared from the input, and never echoed by the API or written to logs or transaction history. [Dashboard access](../README.md#dashboard-access) covers the host-loopback container setup and the password a network-bound listener requires. The key is kept in memory unless **Save this key in the local operator file** is selected. That explicit choice stores the key in the owner-only operator settings file; protect the host, backups, and settings path as wallet credentials. **Remove saved key · keep signer** atomically removes only the persisted credential while retaining the active in-memory signer. **Remove signer & saved key** removes both. The status names the active address and, when different, the saved address. Setting a different memory-only key preserves an existing saved key until **Remove saved key · keep signer** or **Remove signer & saved key** is used.

## Upgrading

The current formats are operator file `version: 5` and position journal `version: 4`. Files written by earlier releases still load:

- **Operator file `version: 4`.** Its top-level `rpcQuorum` and `deployment.quorumRpcUrls` move into `connectivity`, `strategy.pollMilliseconds` becomes `runtime.pollMilliseconds`, the string `runtime.lookbackBlocks` becomes the number `runtime.logLookbackBlocks`, and the string basis points `runtime.maxHedgeSlippageBps` and `strategy.minimumProfitBps` become numbers. An unconfigured version 4 profile drops its quorum RPCs and policy, because it has no `connectivity` to hold them. The next successful settings save or chain profile switch writes version 5.
- **`runtime.lookbackBlocks: "50000"`.** Version 4 shipped that value as its Docker default. For that exact value the bot starts with `256` instead of failing; other values above `256` remain invalid.
- **Venue switches.** A profile without the `deployment.uniswapV*Enabled` switches retains its venue choices: a saved router enables V2 or V3, and a saved PoolManager and Quoter pair enables V4. Saving records those choices as switches; all addresses still derive from the network. Saved executor and coordinator overrides are ignored and removed on save.
- **Position journals `version: 2` and `3`.** They are normalized on load and written as version 4 on the next save. Receipt timestamps use `includedAt`; existing settlement history is normalized on read, and new append-only records use `includedAt`, preserving earlier audit lines.
- **Journals without durable dispute evidence.** A legacy journal without durable dispute evidence is marked for manual reconciliation instead of starting an unbounded recovery scan.
- **Multi-transaction private records.** Legacy multi-transaction private records are never auto-expired, because their prerequisite signatures lack the executor's on-chain parent binding. Reconcile them with the [runbook](./RECOVERY.md#recovery-required-runbook).
