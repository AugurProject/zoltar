# Statoblast liquidator

The liquidator monitors selected portfolio/universe pairs authenticated against the canonical `SecurityPoolFactory`. Its dashboard shows capital, distressed positions, retirement blockers, and funded takeover candidates. Dry-run is the default; live execution requires a signer, the configured RPC agreement, canonical contracts, and explicit automation settings.

The signer funds portfolio takeovers within explicit principal, commitment, wallet-reserve, and gas limits. Acquired underwriting remains an economic obligation; a positive REP award alone is not evidence of a profitable takeover. Begin paused in dry-run mode and review candidates before enabling execution.

## Contents

- [Operator setup](#operator-setup)
- [Universe and portfolio selection](#universe-and-portfolio-selection)
- [Portfolio operation](#portfolio-operation)
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

Live portfolio automation also requires read RPC support for sender ETH balance overrides on `eth_estimateGas`. Gas estimates override only the simulated sender's ETH balance so a node's default gas allowance cannot turn an unaffordable opportunity into an ambiguous contract revert. They preserve the signing fee policy, pinned block, contract code and storage. The configured gas budget, real wallet reserves and exposure limits still apply; final padded simulation and signing use the real balance without overrides. An RPC that rejects this capability stops preflight before any transaction intent is created.

Zoltar, the security pool factory, and WETH addresses come from the selected network's canonical deployment manifest: `mainnet-deployment-addresses.json` or `sepolia-deployment-addresses.json` in the repository-root `docs/` directory. The bot checks contract code at these addresses and reports the checked block while waiting for deployments. An absence of pools is a separate empty state; it does not mean Zoltar is missing.

A configured bot keeps its dashboard available when retryable RPC transport unavailability prevents startup validation. It reports `connectivity-degraded`, shows per-endpoint health in the dashboard, and retries with bounded backoff. `/healthz` provides process-liveness checks without dashboard authentication. The supplied Compose service checks that endpoint and uses `restart: unless-stopped` if the bot process exits unexpectedly. Contradictory chain, malformed response, or other safety validation failures stop startup instead of being treated as an outage.

### Switching chains

To operate on Sepolia, choose Sepolia in the dashboard's **Chain** selector and confirm the switch; while live execution is armed the confirmation asks for a typed phrase. The bot saves the current profile, pauses at a safe scan boundary, releases its current chain and state locks, and loads Sepolia without exiting the process or restarting the container. The first switch creates a clean profile with a chain-named durable state file. Switching back restores the saved mainnet settings and recovery state, but the bot remains paused until you explicitly resume it. Only the selected profile is active at one time. In-place switching requires both profiles to use the same `runtime.once`, `runtime.ui`, `runtime.uiHost`, and `runtime.uiPort` values so the running process and browser retain their operating mode and dashboard origin. The bot rejects an incompatible profile before changing any file.

### Settings and going live

The dashboard's Settings page is grouped into setup steps with a jump bar: **1 · Connect** (chain and RPCs), **2 · Markets** (approved universes, market configuration), **3 · Liquidation policy** (strategy and automation), and **4 · Go live** (execution signer, submission, execution mode). Each form's save button unlocks only after an edit differs from the loaded values and its panel shows an **Unsaved changes** badge until it is saved. Saving one panel keeps unsaved edits in the others.

Keep live execution off until the factory, WETH, signer, selected portfolios, RPC endpoints, gas limits, and REP limits have been reviewed. The **Execution mode** panel under Go live lists every prerequisite the bot enforces (execution signer, chain and RPC endpoints, independent quorum RPCs, canonical contracts, delivery) plus advisory rows for approved universes, supported portfolios, and market evidence, and keeps the live switch locked until the required rows hold. Enabling it pauses the bot and reserves the signer for this process; resume through the readiness check to start signing. A memory-only signer arms live mode in the running process alone: the saved file keeps paused dry-run mode so a restart cannot execute without its key. `runtime.execute` in the operator file remains the startup mode.

Submission and signer:

- `submission.mode` may be `public` or `private` and is edited in the **Submission** panel; private relays are checked against the selected chain before they are saved. The mode cannot change while a pending transaction sent under the current mode awaits recovery, because recovery resubmits with the saved delivery policy. Portfolio transactions use the same signed-transaction delivery policy.
- `privateKey` is stored in the local operator file only when explicitly saved. The dashboard never returns it.

## Universe and portfolio selection

Use the **Portfolios** page to select a portfolio address and universe. Selection does not approve that universe or enable execution. The bot authenticates each selection against the canonical factory and universe registry before using its capital state.

Approve the root or truthful child universe in Settings. Approvals are saved per chain profile; more than one direct child outcome of the same fork cannot be approved. Both selection and universe approval are required for acquisitions. The bot does not decide fork outcomes. Prepare the child capital ledger in the Statoblast interface, select and approve that child, then use an explicit fork-choice instruction below or the Statoblast interface to record your choice.

## Portfolio operation

Select addresses and universes on the **Portfolios** page, then edit limits and automation under **Portfolio policy** in Settings. The saved file represents each selection as `{ "address": "0x…", "universeId": "0" }` in `selectedPortfolios`, with at most 16 selections. Every default portfolio exposure and funding limit is zero, `allowFundedTakeovers` is false, and the example remains paused with dry-run execution and no approved universes.

The monitor checks the constructor seed's canonical factory origin, portfolio factory and Zoltar, capital authority, commitment-index authority, universe, and canonical REP token. It authenticates auction controllers, engines, individual vaults, and the capital auction delegate before exposing winning bids as targets. All reads, including owner and wallet balances, use one confirmed block; reorgs invalidate the snapshot. Live scans and final execution reads require the configured RPC quorum. A missing or unreadable managed scope blocks acquisitions instead of being counted as zero exposure.

Position discovery reads at most `maximumPositionsPerScan` historical IDs per managed scope per cycle. Latency grows with historical position count; discovery is not instant and does not guarantee execution. A fixed sweep boundary prevents new append-only registrations from extending the current sweep. The cursor survives restart, wraps to revisit old positions after lazy retirement or health rekeying, and resets after detected canonical-head replacement. The panel labels the page and next cursor; it does not present the page as all distressed positions. Retirement previews report ready, earlier-request, spare-capacity, demand, and import blockers. A retirement is marked stalled after the same commitment and cohort are observed unchanged for `stalledRetirementSeconds`. Timing starts with this operator's observation, not the original request. The latest 256 retiring positions per scope retain those observations; an evicted position starts a new observation period when revisited.

Previously selected portfolio/universe pairs remain in durable exposure history even after deselection, including unapproved or forked universes. Their owner principal is reread before every acquisition. An exported parent requires its authenticated chosen child universe to be included in managed scope history; add that child to `selectedPortfolios` before continuing. This does not approve the child for execution. The total cap covers direct ledger principal, owned auction vaults (including unactivated winners), and a conservative full-inventory reserve for pending bids. The bot enumerates its own bidder history, authenticates each vault, and carries known vault addresses across managed universes before evaluating exposure. It cannot discover manually funded portfolios that were never selected. Add all managed scopes before enabling automation. Vaults controlled by the signer remain excluded from external-profit candidates. History is limited to 64 explicitly managed scopes and is never silently evicted. Keep the durable state file when upgrading or restarting. Scope-history exhaustion requires operator reconciliation; there is no automatic pruning. Each chain profile has separate history. Do not use another process or wallet to submit transactions for the same signer while this operator is armed.

To enable funded takeovers, first set the owner's exact health target through the Statoblast portfolio interface, select the portfolio and approve its universe, configure positive principal, commitment and REP funding limits below, and review dry-run candidates. Enable **Funded takeovers and earnings claims**, then use the existing Go live and Resume controls. Independent market evidence, price freshness, signer locking, pending recovery, and gas ceilings still apply. The saved policy is also the policy used by execution; editing the bot target does not change the owner’s on-chain health target.

| `portfolioPolicy` key | Default | Meaning |
| --- | --- | --- |
| `allowFundedTakeovers` | `false` | Permit earnings collection, approvals, principal funding, and bounded takeovers after live mode is armed. |
| `maximumPositionsPerScan` | `32` | Entries per registry page per scope per cycle; 1–256. Position and auction-bid registries have separate pages. |
| `maximumPrincipalRep` | `"0"` | Maximum owner principal in one portfolio/universe, including acquired REP. |
| `maximumTotalPrincipalRep` | `"0"` | Maximum principal across every retained managed scope. |
| `maximumCommitmentEth` | `"0"` | Maximum resulting owner commitment in one portfolio/universe. |
| `maximumOwnFundingRep` | `"0"` | Maximum new owner REP funded for one candidate. |
| `minimumNetRewardEth` | `"0.001"` | Minimum net reward after applicable funding and gas budgets: three calls for a takeover, one for an earnings claim. |
| `walletReserveEth` | `"0.01"` | ETH retained in the wallet in addition to transaction gas budgets. |
| `targetHealthFactorBps` | `15000` | Required exact receiver health target; 10,001–1,000,000. The bot never changes it automatically. |
| `stalledRetirementSeconds` | `3600` | Unchanged observation period before a retirement warning; 1–31,536,000 seconds. |

Every takeover transaction first runs the target's cure, which removes the commitment its REP cannot back, floored at the minimum commitment and capped by spare capacity above demand. Otherwise only the position's owner can cure, by lowering its commitment, and no cure pays a reward. The automation mirrors that cure exactly and takes over the complete residual only if it remains distressed, so an unpaid partial cure runs atomically with a profitable takeover. If the cure alone would restore health, the bot skips the position; it cannot submit a standalone cure. An existing receiver must share the target's retirement cohort. The planner reserves the full possible auction award in principal limits, uses the owner's conservative funding price, and preserves `strategy.walletReserveRep`. The received REP remains pledged backing, so the bot never counts it as spendable gas funding. Award minus funding is an investment screening estimate; assumed commitment remains an economic obligation.

Execution performs one durable transaction per cycle: exact REP approval if needed, owner principal funding if needed, then takeover. Each stage estimates its exact transaction at one quorum-agreed block, uses the largest successful estimate, and adds the existing 20% plus 10,000 gas allowance for simulation and signing. A gas cost above `maximumGasCostEth` skips that opportunity before signing or spending on that stage. The final takeover estimate is available only after its funding prerequisites are satisfied. After each prerequisite it waits for canonical finality and scans again. Immediately before persisting and submitting each signed intent it rechecks every managed scope, the target, demand and total commitment, owner policy, market evidence, funding, and exposure. The final `takeOverWithBounds` or `takeOverAuctionBid` transaction atomically checks owner principal and commitment caps, target health consent, price epoch, source cohort, minimum award, and maximum idle own REP. The operator submits at most one portfolio transaction per cycle. A takeover opportunity that expires before broadcast ends that cycle; repeated changes to the first eligible target can delay later candidates. Known opportunity changes found during revalidation before broadcast are skipped and screened again next cycle; authentication or conflicting quorum evidence still pauses execution. A submitted transaction that reverts still pauses the operator and requires review, preventing automatic retries from draining gas. Confirmed bot funding is journaled with its original target. If that target becomes ineligible, the operator can return the tracked amount that remains free and withdrawable to its wallet. It rechecks the original target, independent pricing, current balances and gas reserves before signing. It never retires commitments to fund this unwind; committed REP and funding predating this journal remain under manual capital controls.

The same portfolio automation toggle also enables collection of the owner's earned fees with `claimEarnings`. Earned REP is valued at the highest authenticated conservative REP-per-ETH price and counts only with current independent market evidence. The ETH plus REP value must cover one configured transaction gas budget plus `minimumNetRewardEth`, and the wallet must separately retain enough ETH for gas. Collection occurs in its own cycle and credits the wallet; the bot does not automatically sell REP to replenish ETH. No portfolio execution reserve needs to be funded.

Winning bids appear as **Auction bid N** until materialized. The protected aggregate cohort is never a keeper target. Discovery reads one bounded position page and one bounded auction-bid page per scope, each limited by `maximumPositionsPerScan`, with separately persisted cursors and fixed sweep endpoints. A funded takeover materializes only its target bid inside that operation. If another caller already materialized the bid, the bot drops that candidate and discovers its ordinary position on a later sweep. It never pays for a standalone materialization transaction.

Targeted retirement service remains available in the portfolio interface or SDK. Bids, vault management and fork choices can also be scheduled as explicit one-shot operator instructions below. Private intents that expire or become uncertain use the existing recovery/reconciliation flow; the bot does not blindly replay a price-dependent portfolio intent. No portfolio is deployed or approved automatically.

## Independent market consensus

The liquidator uses the shared market observer described under [independent market consensus](../README.md#independent-market-consensus), which owns the source format, freshness and persistence rules, group agreement, required and advisory modes, the adapter limitations, and every `centralizedMarkets` key. This section covers only what is specific to the liquidator.

**Where the settings live.** Put root REP sources in `centralizedMarkets` with `assetSymbol: "REP"`. The root asset address and chain come from the selected network's deployment manifest; saved settings omit those two fields and cannot override them. Put child REP configurations in `childMarketConfigurations`, including each child's exact `assetAddress`, `assetChainId`, and `assetSymbol: "REP"`. Child assets must match the selected chain and the discovered universe REP, and each child stays fail-closed until its own market history is reliable.

**What the guard gates.** The guarded estimate never replaces the coordinator price in protocol arithmetic. In required mode, price-dependent portfolio takeovers recheck evidence age after preparation and immediately before persisting each signed intent, including after approvals or funding transactions. Transaction recovery and price-independent earnings claims continue, because they do not rely on a REP market price. In advisory mode, healthy independent evidence can still reject an outlying coordinator price.

**DEX sources.** The liquidator's DEX group consists only of the explicit constant-product pairs in `venueConsensus.dexSources`. The arbitrager dynamically observes authenticated V2, V3, and V4 deployments, but the liquidator has no configurable V3 or V4 source format.

Configured sources and their liquidity are shown in the dashboard. Operators can add or remove CCXT exchanges from the market-configuration editor without any exchange adapter being hard-coded by the bot.

The source-admission table explains whether each configured source is admitted or excluded and shows the current exclusion reason. **Test saved sources** runs a fresh read-only probe without changing configuration. The same probe is available for deployment smoke checks while the bot is running:

```bash
bun run smoke:markets -- http://127.0.0.1:4183
```

It exits unsuccessfully if any configured source cannot produce a usable observation and exercises the saved CCXT adapters, RPC connection, chain, pair addresses, and WETH deployment.

Run that smoke check before enabling execution and after changing an adapter.

## Strategy controls

The Settings form saves `portfolioPolicy` together with the gas ceiling, wallet REP reserve, and log-recovery settings. Principal and commitment caps are acquisition limits; lowering them does not withdraw existing capital or change its on-chain health target. Disable **Funded takeovers and earnings claims** to stop new automated portfolio transactions. Pending signed intents still require transaction recovery.

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
| `selectedPortfolios` | array | up to 16 address/universe pairs | `[]` | `[]` | Portfolios the bot monitors. |
| `portfolioPolicy` | object | see [Portfolio operation](#portfolio-operation) | conservative defaults | absent | Portfolio acquisition and scanning limits. |
| `centralizedMarkets` | object | [shared](../README.md#centralizedmarkets-keys) | required | no sources | Root REP market policy. |
| `childMarketConfigurations` | array | each entry uses the shared keys plus `assetAddress` and `assetChainId` | `[]` | `[]` | Child-universe REP market policies. |
| `submission` | object | [shared](../README.md#submission) | required | public | Delivery mode and relays. |

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

Both keys are required. Portfolio amounts and limits are documented under [Portfolio operation](#portfolio-operation).

| Key | Type | Example | Effect |
| --- | --- | --- | --- |
| `maximumGasCostEth` | Non-negative decimal string | `"0.02"` | Caps the padded EIP-1559 gas budget for each automated transaction. |
| `walletReserveRep` | Non-negative decimal string | `"100"` | REP retained outside the portfolio when funding a takeover. |

## Execution lifecycle

Each cycle authenticates selected portfolio state, advances bounded position and auction-bid discovery, and evaluates funded takeovers and earnings claims. Execution rechecks the selected target, receiver, price evidence, exposure, and wallet reserves. Funding and approvals are separate transactions followed by fresh checks before takeover. Explicit one-shot instructions support auction bids, activation/refunds, vault capital management, and fork choices; the bot never chooses a bid price or truth branch itself.

Transaction intent and outcomes are written to `runtime.stateFile`. The activity journal is restored on restart. A signed intent, nonce, serialized transaction, submission block, and validity ceiling are fsynced before relay or RPC submission. Restart recovery quorum-checks receipts and nonce state. It never rebroadcasts an ambiguous price-dependent intent using stale market evidence. Public intents remain blocked until the original receipt appears or a finalized replacement or cancellation proves that the same signer nonce was consumed. Private intents expire only after their relay validity ceiling plus twelve canonical confirmation blocks. Non-price-dependent intents can resubmit the exact durable signed transaction while it remains viable. Transport failures enter `connectivity-degraded`, remain visible, and retry with bounded backoff. Safety failures such as contradictory chain state or execution evidence still pause automatic execution until operator review.

For a replaced or canceled public intent, pause the bot and use **Transaction recovery** to enter the finalized replacement hash. The replacement must have the same sender and nonce, quorum-confirmed receipt evidence, a canonical receipt block, and twelve confirmations. Successful reconciliation is recorded in the durable activity journal. There is deliberately no unsafe “forget transaction” action.

## Development

`bun run check` runs typecheck, lint, tests, and the format check. The individual steps are `bun run typecheck`, `bun run lint`, `bun run test`, and `bun run format:check`.

`bun run ui:fixture` serves the dashboard against fixture data without a chain or key, on port `4183` unless `DASHBOARD_FIXTURE_PORT` is set.

The reusable Ethereum, connectivity, quorum, block synchronization, signer gate, retry, and transaction-submission primitives live in `../shared`.

## Upgrading

The operator file must use `version: 2`. Deployment addresses come from the selected network's manifest. Removed standalone-pool settings are ignored and disappear on the next save; configure `selectedPortfolios` and `portfolioPolicy` explicitly before enabling portfolio automation. Keep the durable state file and chain profiles so managed exposure and pending transactions remain recoverable.

## Explicit portfolio instructions

Set `portfolioInstructions` in the operator configuration while paused, then restart or reload that configuration. Each instruction needs a unique `id`, the portfolio address, and the source `universeId`. All amounts and IDs below are decimal integer strings; `AttoEth` and `AttoRep` use 18 decimal places. Instructions run only in execution mode for selected portfolios and approved universes. Configure them when their on-chain prerequisites are ready; failed preflight or authentication follows the normal operator error handling.

```json
{
  "portfolioInstructions": [
    {
      "id": "child-7-bid-1",
      "portfolio": "0x1111111111111111111111111111111111111111",
      "universeId": "7",
      "action": "auction-bid",
      "lots": "2",
      "minimumAttoRepPerLot": "5000000000000000000",
      "targetHealthFactorBps": "15000",
      "maximumValueAttoEth": "100000000000000000"
    }
  ]
}
```

The example address and terms are placeholders. A bid must satisfy the auction’s actual lot size, REP grid, collateral requirement, independent price checks, wallet reserve and configured principal/commitment caps. Exposure budgeting reserves the entire possible inventory award, not merely the minimum bid REP. Pending-bid exposure can therefore make subsequent bids conservatively ineligible.

| Action | Additional fields | Effect |
| --- | --- | --- |
| `auction-bid` | `lots`, `minimumAttoRepPerLot`, `targetHealthFactorBps`, `maximumValueAttoEth` | Submit one bounded ETH bid |
| `auction-activate` | `bidId` | Materialize a winning vault |
| `auction-refund` | `bidId` | Claim eligible unused ETH, including credited refunds |
| `vault-deposit` | `vault`, `amountAttoRep`, `targetHealthFactorBps` | Approve exact REP, then deposit after a fresh check |
| `vault-health` | `vault`, `targetHealthFactorBps` | Change that vault’s health target |
| `vault-retire` | `vault`, `commitmentAttoEth` | Reduce its commitment; any retirement queue still applies |
| `vault-withdraw` | `vault`, `amountAttoRep` | Withdraw currently available principal to the signer |
| `vault-earnings` | `vault` | Collect vault earnings to the signer |
| `fork-choice` | `outcome` | Record the direct account’s irreversible choice |
| `vault-fork-choice` | `vault`, `outcome` | Record an owned vault’s irreversible choice |

Prepare the child capital ledger in the Statoblast interface, then select and approve that child before recording a fork choice. Existing choice deadlines still apply. Vault operations accept only vaults authenticated as belonging to the signer and managed portfolio. The vault address remains the account identity after migration; it is not replaced by a new auction’s bid ID.

Completed instruction IDs and their exact terms are persisted with finalized receipts. A restart does not resubmit a completed bid. Reverted instructions are consumed too; inspect the failure and use a new ID for an intentional retry. Keep the durable state file. Do not edit or reuse a completed ID with different terms, or run another process with the same signer. At most one instruction, approval, takeover, claim, or unused-funding withdrawal is submitted per cycle.
