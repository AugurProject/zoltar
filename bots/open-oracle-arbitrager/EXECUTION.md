# Execution reference

This document owns how the [OpenOracle arbitrager](./README.md) reads the chain, what it needs before it can trade, how it builds and delivers a dispute, and how it accounts for the result. Settings are defined in [CONFIGURATION.md](./CONFIGURATION.md); recovery procedures are in [RECOVERY.md](./RECOVERY.md).

**Contents**

- [Read agreement and finality](#read-agreement-and-finality)
- [Requirements](#requirements)
- [Deploy the executor](#deploy-the-executor)
- [Enable execution](#enable-execution)
- [Submission modes](#submission-modes)
- [Before each dispute](#before-each-dispute)
- [Required ETH, WETH, and tokens](#required-eth-weth-and-tokens)
- [Transaction delivery and tracking](#transaction-delivery-and-tracking)
- [Profit and history semantics](#profit-and-history-semantics)

## Read agreement and finality

These two rules apply to every read and every receipt the bot acts on. The other sections refer to them as the **read quorum** and the **finality rule** instead of restating them.

**Read quorum.** The bot reads through `connectivity.readRpcUrl` and `connectivity.quorumRpcUrls` under the saved `connectivity.rpcQuorum`. The shared [RPC agreement requirement](../README.md#rpc-agreement-requirement) defines which readers count as available, how many must respond, and when a response is a safety fault. For this bot the agreed snapshot is taken at one exact block hash and must match on OpenOracle state, pool state, quotes, the confirmed nonce, balances, and allowances, plus the pending nonce actually signed. A legitimate pending transaction visible to only one provider blocks signing until the providers converge or the operator resolves it. Inter-reader disagreement rejects the read, leaves every journal in its current state, and blocks execution until the readers agree.

**Finality rule.** A receipt, or the proven absence of one, is final only after 12 canonical descendants, when the read quorum serves the same block hash at that depth. Until then:

- a successful lifecycle remains `closed-pending-finality`, keeps its risk slot, contributes no realized profit, and is reopened if the receipt disappears in a reorganization;
- a missing receipt remains pending rather than expired;
- insufficient, lagging, or inconsistent evidence fails closed under the [recovery runbook](./RECOVERY.md#recovery-required-runbook).

Under the two-reader policy, fewer than two available agreeing readers therefore delays closure rather than releasing the slot from the primary reader's head.

## Requirements

- Bun and this project's frozen dependencies.
- An RPC endpoint for Ethereum mainnet or Sepolia. Approved-coordinator discovery uses current contract state and does not require historical log access. [Coordinator-free diagnostic mode](./CONFIGURATION.md#coordinator-free-diagnostic-mode) reads only the configured latest-block window.
- OpenOracle deployed at the address in the selected network manifest.
- Approved Zoltar universes whose pool reports this wallet may dispute. Each scan discovers their pools through the canonical security-pool factory registry and verifies the immutable pool-to-coordinator link at the selected block. Coordinator addresses are not configurable.
- A deployed `OpenOracleArbitrageExecutor`. Deploy the stateless executor at a fixed CREATE2 address from the dashboard or with [`bun run deploy-executor`](#deploy-the-executor). The bot derives the address and checks that code exists there; the CREATE2 address commits to the bundled contract, so no executor address is entered manually.
- At least one enabled Uniswap version available on the selected network.
- `deployment.uniswapV3Enabled` (`true` in the example configuration) enables V3 with its spot/TWAP check.
- Optionally, `deployment.uniswapV2Enabled` (`true` in the example configuration) adds authenticated direct WETH/token V2 hedges on mainnet. V2 is unavailable on Sepolia; switching networks does not discard the enabled preference.
- Optionally, `deployment.uniswapV4Enabled` (`false` in the example configuration) enables the network-derived V4 PoolManager and Quoter together. V4 execution is limited to direct native-ETH/token pools at the standard fee/tick-spacing pairs with no hook. The executor converts ETH and WETH one-for-one inside the atomic entry.
- Canonical deployment addresses bundled for the selected network. All venue and core addresses derive from that network; none are entered manually. The bot checks that the core and enabled venue contracts and the executor are deployed. Coordinators and REP tokens come from the canonical pool and universe registries, subject to universe approval.
- One primary read RPC, plus the independent quorum readers that the saved `connectivity.rpcQuorum` requires; see the [read quorum](#read-agreement-and-finality). The [operator configuration](./CONFIGURATION.md#persistent-operator-settings) supplies every persisted value.
- For execution, a dedicated key on the selected network with:
  - ETH for the atomic dispute transaction.
  - WETH for the total executor funding shown in the dashboard.
  - The configured token (REPv2, fork REP, or another ERC-20) for the total executor funding shown in the dashboard.
  - OpenOracle internal allowances from that key to the executor for WETH and each executable report token. Before entry the bot requires enough allowance for both normal lifecycle withdrawal and the largest credit that report could receive if replaced (`2 × report amount + report fee`). A maximum allowance is recommended because OpenOracle decrements finite allowances as positions close.
- For private delivery, at least one Flashbots-compatible bundle relay. Both modes are eligible only when the required executor and OpenOracle internal allowances already exist. Public delivery sends the single atomic executor transaction directly to every configured public RPC.
- External process supervision, endpoint health alerts, and a procedure for any position shown as **recovery-required** or **replaced**. A replaced position has automatically recovered its exact OpenOracle credit, but its remaining one-sided inventory still requires an operator-approved unwind before P&L can be classified as realized.

Do not use a key that controls unrelated protocol or treasury funds. By default, the dashboard binds to `127.0.0.1`; the host-loopback container setup is documented under [dashboard access](../README.md#dashboard-access). The execution key still lives in the bot process and must be protected like any hot wallet.

## Deploy the executor

Deploy the stateless executor on the selected network. Its fixed zero salt and bundled init code determine the address through the canonical CREATE2 proxy. The dashboard and CLI use the same address; custom salts are not accepted:

```bash
PRIVATE_KEY=0xYourDeploymentPrivateKey ETH_RPC_URL=https://rpc-a.example bun run deploy-executor -- --network=mainnet --quorum-rpc-url=https://rpc-b.example --quorum-rpc-url=https://rpc-c.example
```

The second and third reader are needed only when the saved `connectivity.rpcQuorum` is `2`; all three read RPCs must then use independent origins. With the default requirement of `1`, the primary RPC is enough. For example, against a local development node that serves a Sepolia fork:

```bash
PRIVATE_KEY=0xYourLocalDevelopmentKey ETH_RPC_URL=http://localhost:8545 bun run deploy-executor -- --network=sepolia
```

| Option or variable | Meaning |
| --- | --- |
| `PRIVATE_KEY` | Required. The 32-byte `0x`-prefixed deployment key. |
| `--network=mainnet\|sepolia` | Selects the chain and its saved profile. |
| `--rpc-url=URL` | Primary read and submission RPC. Falls back to `ETH_RPC_URL`, then to the shared chain default that the protocol UIs use: `https://ethereum.dark.florist` on mainnet and `https://ethereum-sepolia-rpc.publicnode.com` on Sepolia. |
| `--quorum-rpc-url=URL` | Repeatable. Independent readers; two are required when the saved requirement is `2`. |
| `OPEN_ORACLE_ARBITRAGER_CONFIG` | Operator file location when it is not at its default path. The bot and this command must use the same value. |
| `--help` | Prints the usage. |

The command takes the agreement requirement from the selected network's saved profile, or from `ZOLTAR_BOT_RPC_QUORUM` when no profile exists. A custom `--salt` is rejected.

Before broadcasting, the command requires exact read-quorum agreement on chain, proxy and destination code, pending nonce, gas estimate, and gas price, then syncs the signed intent beside the active operator configuration as `<operator-config>.<network>.executor-deployment.json`. Each chain's recovery intent is isolated from the other chain. The command also holds the same chain-and-signer process lock as the operator. Repeating the command with the same signer, chain, and salt recovers or rebroadcasts those exact bytes after a disconnect or crash; the journal is removed once the read quorum sees the included receipt and the verified executor runtime bytecode, without waiting for further confirmations. If the bot was running and paused for that journal, it notices the removal at its next scan. Scanning resumes once the bot's read endpoints show the executor bytecode, and the operations log records the reconciliation. Execution stays paused until you resume it.

For dashboard deployment, see [deploy from the dashboard](./CONFIGURATION.md#deploy-from-the-dashboard).

### Executor ABI source

The project compiles `contracts/OpenOracleArbitrageExecutor.sol` into `src/contracts/artifacts.generated.ts`, compiles the test harness contracts into `tests/contracts/harness-artifacts.generated.ts`, and derives `src/contracts/executor-abi.generated.ts` from the executor artifact. Never edit these generated files directly. After an executor contract change, run `bun run compile-contracts && bun run generate:abi`, review the generated diff, and verify freshness with `bun run check:generated`. ABIs for repository contracts (OpenOracle, the price coordinator) come from `@zoltar/bot-shared/contracts/abi`, which `tooling/contracts/generate-bot-abis.mts` generates from the compiled artifacts and `bots/shared`'s `check:generated` keeps fresh. `src/contracts/abi.ts` holds only external-contract ABIs (Uniswap, Augur, generic ERC-20) that have no compiled artifact in this repository.

### Executor public surface

The bot calls only the parent-bound entrypoints in the first four rows below. `dispute` is a lower-level, unhedged funding helper: it intentionally has no parent-block guard and emits no durable bot-accounting event, so the arbitrager runtime does not use it.

The runtime—not the executor—authenticates which report and amounts belong to a durable position. It derives those values from quorum-confirmed state and the position journal, then matches the resulting event during receipt recovery. The executor enforces the parent binding and exact caller-requested transfers, but its event alone is not self-authenticating position-attribution evidence.

| Function | Intended caller and behavior | Success evidence and constraints |
| --- | --- | --- |
| `hedgeAndDispute` | Arbitrager wallet; executes the selected authenticated V2, V3, or hookless V4 hedge and replacement report atomically. | Requires the signed canonical parent and emits `HedgeAndDisputeExecuted`. |
| `settleAndWithdraw` | Arbitrager wallet; executes the runtime's requested two-token withdrawal and optionally settles the supplied report. | Requires the signed canonical parent, transfers the exact caller-supplied amounts, and emits `LifecycleExecuted`. The runtime authenticates report and position attribution. |
| `withdrawReplacementCredit` | Arbitrager wallet; executes the runtime's requested one-token credit withdrawal. | Requires the signed canonical parent, transfers the exact caller-supplied amount, and emits `ReplacementCreditWithdrawn` with the caller-supplied report ID. The runtime derives and authenticates the immediate-replacement credit. |
| `assertParentBlock` | Bot transaction preflight or atomic bundle; checks the next-block parent binding without changing state. | Reverts unless the supplied parent is the current block's canonical parent. |
| `dispute` | Low-level integrator; funds an OpenOracle dispute without a Uniswap hedge. | No parent binding and no executor evidence event. The caller must provide both exact contributions and must not use this path for durable bot accounting. |
| `contributions` | Read-only integrator; reproduces the executor's exact contribution calculation. | Pure helper; returns token1 and token2 contribution amounts. |
| `unlockCallback` | Authenticated V4 PoolManager only, during an active `hedgeAndDispute` call. | Rejects every other caller or payload; settles one exact hookless pool swap. |
| `receive` | Internal WETH/V4 conversion only while execution is active. | Rejects unsolicited ETH. |

## Enable execution

Verify the deployment address independently, set `runtime.execute` to `true`, save the signer through the local dashboard (or the owner-only JSON file), and start:

```bash
bun run run
```

Canonical contract addresses are supplied automatically from the bundled network deployment data. The bot inspects the executor deployment and the canonical contracts (OpenOracle, WETH, the security-pool factory, and the enabled Uniswap venue contracts) on its first scan and keeps re-checking each scan until all of them are present; live execution refuses to start until they hold.

Execution mode can be changed in the dashboard's **Execution mode** form and applies at the next scan boundary. The form shows a readiness checklist (signer, quorum RPCs, venue, deployed executor, canonical contracts, delivery) and keeps the live-execution switch locked until every required row holds; the on-chain rows come from the latest scan, so a freshly deployed executor appears once the bot has inspected it, and a venue saved since that scan holds the contracts row until the next scan inspects its contracts. A trailing **Pool coordinators** row is advisory: arming does not need a discovered pool, but nothing can trade until one exists.

The panel summary reads **Dry run**, **Armed** (saved, activating at the next scan with the bot paused), or **Live**. The bot additionally rejects a switch to live execution unless the saved file is already startable in live mode (quorum RPCs and an enabled venue), binds live execution to the signer that will be active at that boundary (the queued signer when a signer change is pending, otherwise the running one), reserves its exclusive process lock before saving, and pauses the bot so signing begins only after **Resume bot** and its readiness check. When execution starts without a remembered signer, it remains locked until a key is set in the local dashboard. Signer set/clear changes apply at the next unpaused scan boundary; they do not interrupt the current scan or confirmation wait, and clearing a signer cannot cancel a transaction already broadcast.

## Submission modes

Public mempool delivery is the example default. Configure relay URLs and the successful bundle-relay threshold under `submission.minimumBundleRelaySuccesses` in the dashboard's **Submission** form. In private mode, this threshold applies both to pre-submission bundle simulations and to final bundle fan-out: at least that many distinct relay origins must simulate the bundle successfully, and at least that many must then accept its submission. Public transaction fan-out succeeds after one public RPC accepts the canonical transaction hash.

Execution supports **Private relays** and **Public mempool** delivery. Private mode requires at least one relay and supports up to eight. The configurable bundle-relay threshold determines how many relays must validate and then accept the exact complete bundle; submission is sent only to relays whose simulations succeeded. A broken optional relay therefore cannot disable trading unless the configured threshold requires it. Startup and dashboard updates probe every private relay with `eth_chainId`, then send intentionally invalid `eth_callBundle` and `eth_sendBundle` requests. A compatible relay returns method-specific authentication or parameter errors; a same-chain ordinary RPC returning unsupported-method errors is rejected and shown as a failed relay. Ambiguous, successful, or malformed probe responses are rejected too. Non-successful HTTP responses are rejected regardless of their body. No transaction is signed or submitted by this capability check. The configuration is also rejected when a relay is unreachable or reports the wrong selected network. Relay URLs changed in the dashboard are saved in `submission.relayUrls` in the operator configuration. Relay URLs are never written to the transaction-history file. URLs may use HTTPS, or loopback HTTP for a locally operated relay; embedded URL credentials, query parameters, fragments, and redirects are rejected.

## Before each dispute

Before each dispute, the bot:

1. Requires `helper.creator` to be an approved coordinator and requires the report to exactly match that coordinator's on-chain OpenOracle, WETH, REP, callback, timing, fee, multiplier, and flag template. Independent hard bounds reject callback gas above 10,000,000, timestamp settlement windows above seven days, block settlement windows above 50,400 blocks, and multipliers above 2x even when a discovered coordinator exposes them.
2. Checks that the game is WETH plus a usable token and inside its dispute window. In execute mode, token 2 must be the REP of an explicitly approved Zoltar universe through the canonical universe registry. Other observed tokens are monitor-only.
3. Finds candidates for each enabled Uniswap version. V3 candidates must pass the configured spot/TWAP check; V2 and V4 do not depend on V3 liquidity.
4. Models both directions across configured venues: QuoterV2 for V3, exact constant-product reserve math for V2, and the authenticated V4 Quoter across every standard fee/tick-spacing pair. Each venue supplies its own replacement exact-input quote. Selection and final validation both require successful sell, buy, and replacement quotes; incomplete candidates cannot block other venues.
5. Derives the same replacement swap side as the OpenOracle contract.
6. Calculates the exact WETH and token contributions and checks wallet inventory.
7. Applies the absolute-profit and basis-point thresholds.
8. Requires the [read quorum](#read-agreement-and-finality) to return one exact block hash and the same pool state, two hedge quotes, replacement quote, gas basis, balances, allowances, nonce, and OpenOracle state hash before deriving or signing any transaction.
9. Requires sufficient quorum-confirmed ERC-20 and OpenOracle internal allowances, then creates one atomic executor call.
10. In private mode, signs that transaction, simulates it with `eth_callBundle`, requires the configured number of successful simulations, includes an on-chain exact-parent-hash guard, and re-applies the profit threshold to the largest successful simulation gas usage. Public mode simulates the same atomic executor call.
11. Sends the all-or-nothing target-block bundle only to relays that successfully simulated it, or fans the identical single public transaction to every configured public RPC. No reverting transaction hashes are allowed.
12. Writes a durable pending-entry record before submission. After inclusion, it verifies every bundle receipt and its required effective gas price against the quorum-confirmed canonical target-block hash, decodes the executor’s actual hedge event, records every entry transaction hash and actual bundle gas, and only then allows the position to progress as confirmed.
13. On later blocks, automatically settles when eligible, then submits one atomic, exact-amount lifecycle executor call in either delivery mode. Settlement, internal transfers, WETH/token withdrawals, and the canonical parent check share one revert boundary. It records realized P&L only when the canonical receipt contains the executor event matching the position's account, report, tokens, and amounts, and passes the [finality rule](#read-agreement-and-finality). If a later reporter replaces the bot, it computes the exact credit from the two authenticated report states and withdraws that credit alone through `withdrawReplacementCredit`. Aggregate holder balances are only an availability check, never position attribution evidence. After finality the record remains **replaced** until its one-sided inventory is explicitly reconciled.

The executor atomically swaps the old report inventory through the authenticated router, pulls the calculated contribution, verifies exact balance deltas into itself and OpenOracle, calls `dispute` with the wallet as the recorded disputer, clears its router and OpenOracle allowances, refunds unused WETH, and requires its ending token balances to equal their starting balances. Fee-on-transfer and other non-exact balance changes therefore revert the whole execution. A later rebase is not detectable by the executor and can invalidate OpenOracle's nominal collateral accounting; only reviewed, non-rebasing exact-transfer tokens should be allowlisted.

Reports already owned by the execution account are skipped because OpenOracle self-disputes use different accounting. At most one dispute is executed per poll so a second transaction cannot rely on the pre-transaction balance snapshot.

## Required ETH, WETH, and tokens

There is no single fixed funding amount. OpenOracle contributions increase with the current round, while the executor also needs hedge inventory. The dashboard's **Open opportunities** table shows the total `Required WETH` and `Required token` that the executor pulls from the wallet, including both the OpenOracle contribution and the atomic hedge. The branch formulas and event fields are explained in the [operator guide](./docs/operator-guide.html#math).

The execution account needs:

- `ETH balance >=` the sum of every signed transaction's gas limit multiplied by its fee cap, plus an operational buffer.
- `WETH balance >= required WETH` for the selected report.
- `Token balance >= required token` for the selected report.
- `WETH.allowance(account, executor) >= required WETH` and `token.allowance(account, executor) >= required token` for entry.
- `OpenOracle.internalAllowance(account, executor, WETH) >= locked WETH` and `OpenOracle.internalAllowance(account, executor, token) >= locked token`.

Grant ERC-20 and OpenOracle internal allowances from the dedicated bot account (replace the addresses and use the selected network RPC):

```bash
cast send 0xWETH "approve(address,uint256)" 0xExecutor 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xReportToken "approve(address,uint256)" 0xExecutor 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle "approveInternal(address,address,uint256)" 0xExecutor 0xWETH 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle "approveInternal(address,address,uint256)" 0xExecutor 0xReportToken 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"
```

Maximum allowances avoid missing an opportunity after a finite allowance is consumed. A finite ERC-20 allowance is also supported when it covers the dashboard's displayed requirement, but it must be refreshed before the next larger entry. Review each allowlisted token's approval semantics: tokens that require resetting a nonzero allowance to zero first need two separate setup transactions, and tokens with nonstandard, rebasing, or fee-on-transfer behavior must not be enabled merely because `approve` succeeds.

OpenOracle rejects changing one nonzero internal allowance directly to another nonzero value. Set it to zero first when rotating or reducing an existing allowance. The bot checks both ERC-20 and both internal allowances through its configured read quorum before signing an entry, and checks the internal allowances again before lifecycle submission.

Opportunity selection reserves 1,200,000 gas for entry plus the larger of the configured lifecycle reserve and the current fee estimate for callback gas plus settlement and withdrawals. This is not a wallet balance guarantee; keep additional ETH for approvals, adverse base-fee movement, and recovery work. Capital can remain locked through later dispute rounds.

“Modeled net profit” is the direction-specific hedge P&L before gas minus:

- The entry reserve: initially `1,200,000 × (2 × base fee + 2 nanoETH)`. Public delivery retains that fixed reserve. Private delivery replaces it with the largest gas usage returned by the successful relay simulations at the same gas price.
- The full adverse movement permitted by the signed hedge limit (`runtime.maxHedgeSlippageBps`).
- The larger of `runtime.riskLimits.lifecycleGasReserveWeth` and `(callbackGasLimit + 900,000) × gas price`. Public and private delivery use the same single atomic lifecycle call.

The resulting fully reserved value must satisfy both the absolute minimum-profit floor and a direction-specific basis-point floor. The return basis is the current report's WETH plus WETH fees when selling token 2, and the exact-output quoted WETH input when buying token 2. The bot recomputes both thresholds from the canonical quote-block snapshot immediately before it signs.

The dashboard balance calculation reports:

- Native ETH.
- Wallet WETH and REP.
- The best executable WETH output for selling the entire REP balance through a currently accepted pool.
- Estimated executable portfolio value: `ETH + WETH + quoted REP value`, treating 1 ETH as 1 WETH.

That portfolio value is a liquidation estimate. It is not cost-basis accounting and can move sharply when REP/WETH liquidity is shallow.

## Transaction delivery and tracking

Public mode broadcasts one signed atomic executor call to every configured public RPC. It cannot safely broadcast prerequisite approvals alongside the opportunity, so any entry with insufficient executor allowances is rejected before signing. The call uses the same exact-parent guard as private entry and can succeed only in the direct child of its quoted block. Inclusion in a later block reverts and can still consume gas. Public delivery exposes the opportunity to copying, reordering, front-running, and other MEV, and does not provide bundle confidentiality or next-block inclusion. Public lifecycle delivery broadcasts one executor transaction whose parent-hash guard, optional settlement, exact OpenOracle internal transfers, and exact withdrawals share one revert boundary. Its hash, signer nonce, submission block, target block, and expected amounts are synced before broadcast. Every observed repricing, cancellation, or unrelated same-nonce replacement is synced before its outcome is accepted. A successful replacement must also match the durable sender, nonce, destination, calldata, and ETH value byte-for-byte; only a proven revert may close without that intent match. After a crash, the configured RPC quorum scans canonical blocks for that sender and nonce if the replacement hash was not yet durable.

Private mode signs the executor call, requests `eth_callBundle` from every configured relay, and then fans the same target-block transaction only to relays whose simulation passed. The payload omits `revertingTxHashes`, so a revert invalidates the bundle. The entry executor call and the single lifecycle executor call require `blockhash(parent)` to equal the quorum-agreed quote-block hash. A relay or builder using a different same-height parent, retaining a transaction beyond its target, or splitting prerequisite entry approvals from the guarded call cannot execute the value-moving call. Immediately before journaling and delivery, the read quorum must still agree on both the parent height and hash. The number of distinct relay origins set by `submission.minimumBundleRelaySuccesses` must successfully simulate the bundle, and the same number must accept its submission, or delivery fails closed. Configured endpoints must implement the [Flashbots bundle RPC](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint) and authentication format.

The transaction tracker records each submitted executor call as `submitting`, `pending`, `confirmation unknown`, `confirmed`, `reverted`, or `submission failed`. It shows which targets accepted or rejected the payload. Every atomic entry and lifecycle transaction is parent-bound to one target block and is not resubmitted from a stale quote. In public mode, receipt polling yields once that target passes so the durable recovery loop can continue. Missing receipt evidence remains pending under the [finality rule](#read-agreement-and-finality) in either delivery mode. Once receipt absence is final, the attempt becomes `expired-not-included` and releases its risk slot. A quorum-confirmed reverted atomic entry is terminally closed after recording its gas; it cannot have changed OpenOracle state. If the atomic lifecycle call was absent, that attempt is cleared and the open position can safely retry from a fresh parent. Expired hashes remain in the durable journal and are checked on every poll. If a retained transaction is later published, its parent guard makes it revert; the bot records that late gas once, updates the UTC-day gas budget and realized P&L where applicable, and then removes the archived attempt. An absent hash is also retired once the configured RPC quorum proves at the finalized height that a later canonical transaction consumed its nonce, because the retained signature can no longer be included. Unexpected successful evidence fails closed. A quorum-agreed successful receipt without the expected executor event, exact durable transaction intent, or attributable assets remains `recovery-required`. Active transaction-tracker rows are kept in process memory and reset on restart; confirmed dispute history and its ETH profit totals are persisted in the configured history file.

## Profit and history semantics

Successful dispute submissions are appended to `runtime.historyFile`. New profiles automatically receive chain-named history, price, and position paths.

The history file is created with owner-only permissions when possible and is ignored by Git at its default path. Each record contains the report, pool, direction, total executor-funded inventory, confirmed executor transaction hash, block, actual transaction gas, modeled net profit, profit before gas, and tracked net profit in ETH. Both modes submit one parent-bound executor transaction per entry. Private submissions provide no allowed reverting hashes, so a compliant relay/builder omits a reverting call. An unincluded transaction consumes no on-chain gas. Public execution records the same single executor transaction and its actual gas through the durable position and history accounting.

Execution startup verifies that the history destination is writable. If persistence later fails after a confirmed dispute, the record remains visible in memory, further execution is blocked, and the bot retries the queued write on later polls. An append is acknowledged only after the file and parent directory have been synchronized. A malformed or torn non-empty JSONL record stops startup with its line number instead of being silently omitted from revenue or gas totals.

Before submission, the position journal also records the immutable execution intent plus the signer nonce and submission block. Live confirmation and confirmation recovered after a restart both use that intent to commit the confirmed position and its complete history record together through a durable outbox. The bot then appends the record to JSONL idempotently and clears the outbox with another synchronized position write. A crash before, during, or immediately after confirmation or the append therefore replays the missing history operation on restart without losing or duplicating the confirmed revenue record.

Position profit is tracked in ETH using the exact 1 WETH = 1 ETH unwrap relationship:

```text
sell-token hedged P&L before gas = actual WETH out − old report WETH − WETH fees
buy-token hedged P&L before gas = old report WETH − actual WETH in
open hedged net = hedged P&L before gas − actual entry gas − lifecycle gas so far
realized net = hedged P&L before gas + exact settler reward − actual entry gas − actual lifecycle gas
```

The confirmed-submission table keeps quote-time modeled and tracked values for diagnostics. They are not realized P&L. After entry receipt quorum, the durable position table derives hedge economics from the executor event and includes actual entry and lifecycle gas costs. A finalized lifecycle adds the exact ETH settler reward from its executor event; a zero reward is recorded when the executor did not settle. Before that quorum, staged quote values remain recovery metadata, render as awaiting evidence, and are excluded from actual P&L totals. Automatically realized P&L is withheld unless actual WETH and token withdrawals exactly equal the expected hedge-neutral inventory. A mismatch is marked `recovery-required` because the residual token exposure must be valued or unwound manually. Relay refunds and transactions sent outside this process are not included automatically. A [manual reconciliation](./RECOVERY.md#recovery-required-runbook) records an operator-calculated, all-in result; the command does not calculate or validate it.
