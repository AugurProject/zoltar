# OpenOracle arbitrager

The OpenOracle arbitrager monitors active Ethereum WETH/token games, compares their
locked exchange against executable Uniswap V2, V3, or hookless V4 quotes, and identifies disputes whose
modeled hedge remains profitable after OpenOracle fees and gas. It includes a local
operator dashboard for live state, strategy controls, wallet inventory, submitted
disputes, transaction delivery, and ETH-denominated profit tracking.

The rendered [operator guide](./docs/operator-guide.html) explains the UI and configuration,
execution math, exchange support, recovery states, and includes populated dashboard
screenshots. When the dashboard is running, select **Operator guide** or open
`http://127.0.0.1:4173/documentation` (using the configured UI port).

Dry-run is the example default. The bot cannot submit a transaction unless
`runtime.execute` is enabled in its configuration and a signer is saved in that
configuration or supplied through the local dashboard.

> **Live execution is experimental.** Mainnet commands below are operator
> references, not production approval. Rehearse on Sepolia with a dedicated
> low-balance key, validate current executable liquidity, and supervise every
> position; no automated strategy can guarantee a profit or prevent every loss.
> The [latest pinned market fixture](./docs/market-fixture.html#open-oracle-market-fixture)
> is dated historical evidence, not a live liquidity or profitability claim.

## Project layout

The arbitrager is an independent project inside the monorepo:

- `src/cli/` contains the operator-facing runtime, deployment, and reconciliation
  entrypoints; `src/config/execution-manifest.ts` owns the manifest CLI.
- `config/` contains manifest examples and schemas.
- `contracts/` contains the executor Solidity source and its local test harnesses.
- `docs/` contains the rendered operator guide, market fixture, chart runtime, styles,
  and screenshots.
- `scripts/` owns contract generation, documentation checks, fixture replay, and
  screenshot capture.
- `src/` groups runtime code by configuration, contracts, core strategy, dashboard,
  execution, monitoring, infrastructure, and durable state.
- `tests/` mirrors the runtime areas and contains the executor contract suite.

Its own `package.json`, lockfile, TypeScript configuration, test configuration, and
generated contract artifacts define its build. The executor imports unchanged
protocol ERC-20 utilities from the monorepo's top-level `solidity/` project; it is
not compiled into the protocol peripheral artifact set.

## How the flow works

A Zoltar `OpenOraclePriceCoordinator` creates an OpenOracle report, also called a
game, that locks WETH and another ERC-20 at the current reporter's proposed exchange
rate. The arbitrager wallet compares that rate with executable Uniswap liquidity.
When the replacement report can be hedged profitably, the wallet calls the stateless
executor, which swaps the required inventory atomically and submits the OpenOracle
dispute while preserving the wallet as the replacement reporter. After the dispute
window, the bot settles the final report, withdraws the position's exact OpenOracle
balances, and closes its durable position record only after canonical receipts and
exact asset recovery pass the finality quorum through 12 canonical descendants. The
finality quorum requires at least two available readers, and every available reader
must agree. If a later reporter replaces
the bot, it derives the exact one-token credit from the authenticated old and new
report amounts, withdraws only that amount through a parent-bound executor call,
and verifies the `ReplacementCreditWithdrawn` event through the same receipt and
finality quorum. The record then becomes **replaced** and continues consuming its
risk slot: the bot has recovered the funds, but it does not label the one-sided
inventory as realized profit or automatically trade it back to the original mix.

The wallet must grant two distinct kinds of approval: ERC-20 allowances let the
executor pull entry funding, and OpenOracle internal allowances let it move the
position's exact lifecycle proceeds into the executor for immediate withdrawal.
Both private and public delivery require ERC-20 allowances before the opportunity
appears, so every signed entry is one parent-bound executor transaction. OpenOracle
internal allowances must also exist before either mode can enter a position. During
`hedgeAndDispute`, the executor grants separate, exact temporary allowances to the
authenticated V2 or V3 router and OpenOracle, then clears them before returning.
V4 instead unlocks the authenticated PoolManager only for one hookless pool swap,
settles its exact native-ETH/token deltas, and wraps or unwraps WETH inside the same
transaction. See [profit and history semantics](#profit-and-history-semantics)
for the report lifecycle assumptions and economics used by the arbitrager.

## Requirements

- Bun and this project's frozen dependencies.
- An RPC endpoint for Ethereum mainnet or Sepolia. Approved-coordinator discovery
  uses current contract state and does not require historical log access. Legacy
  journals without a persisted dispute index are the bounded exception: after a
  restart, replacement-credit recovery scans only that report's dispute logs from
  its entry block until the immediate successor. Execution RPCs must therefore
  retain log history back to the oldest open legacy position's entry block. Archive
  access can also be useful for coordinator-free diagnostic mode when
  `runtime.lookbackBlocks` reaches beyond the provider's retained log history.
- The deployed OpenOracle contract address.
- At least one reviewed Zoltar `OpenOraclePriceCoordinator` address for every
  coordinator whose games this wallet may dispute.
- A deployed `OpenOracleArbitrageExecutor`. Deploy the stateless executor at a
  predictable CREATE2 address from the dashboard or with `bun run deploy-executor --`,
  then authenticate that address in the execution manifest.
- The exact Uniswap V3 SwapRouter address.
- Optionally, the exact Uniswap V2 Router02 in
  `deployment.uniswapV2Router`. When configured and authenticated, mainnet execution
  adds direct WETH/token V2 hedges to the configured venue comparison.
- Optionally, an exact Uniswap V4 PoolManager and V4 Quoter supplied together in
  `deployment.uniswapV4PoolManager` and `deployment.uniswapV4Quoter`. V4 execution is limited to
  direct native-ETH/token pools at the standard fee/tick-spacing pairs with no hook.
  The executor converts ETH and WETH one-for-one inside the atomic entry.
- A reviewed deployment manifest that pins chain, role, address, and runtime
  bytecode hash for every contract and executable token. At least two available read
  RPCs authenticate every manifest entry before the bot can sign; a contradictory
  authentication result fails closed.
- At least three independently operated read RPCs: one primary plus two or more
  quorum endpoints. Only a retryable transport failure makes a reader unavailable.
  Live execution requires at least two responses, and every responding reader must
  agree exactly. One transport-unavailable reader is reported as degraded without
  stopping an otherwise healthy quorum; a malformed or contradictory response is a
  safety fault and fails closed. Execution also requires exact
  quote-block agreement on OpenOracle state, pool state, quotes, confirmed nonce,
  and balances, plus exact agreement on the pending nonce actually signed. A
  legitimate pending transaction visible to only one provider blocks signing until
  the providers converge or the operator resolves it. The
  [operator configuration](#persistent-operator-settings) supplies every
  restart-time value.
- For execution, a dedicated key on the selected network with:
  - ETH for the atomic dispute transaction.
  - WETH for the total executor funding shown in the dashboard.
  - The configured token (REPv2, fork REP, or another ERC-20) for the total
    executor funding shown in the dashboard.
  - OpenOracle internal allowances from that key to the executor for WETH and each
    executable report token. Before entry the bot requires enough allowance for
    both normal lifecycle withdrawal and the largest credit that report could
    receive if replaced (`2 × report amount + report fee`). A maximum allowance is
    recommended because OpenOracle decrements finite allowances as positions close.
- For private delivery, at least one Flashbots-compatible bundle relay. Both modes
  are eligible only when the required executor and OpenOracle internal allowances
  already exist. Public delivery sends the single atomic executor transaction
  directly to every configured public RPC.
- External process supervision, endpoint health alerts, and a procedure for any
  position shown as **recovery-required** or **replaced**. A replaced position has
  automatically recovered its exact OpenOracle credit, but its remaining one-sided
  inventory still requires an operator-approved unwind before P&amp;L can be classified
  as realized.

Do not use a key that controls unrelated protocol or treasury funds. By default, the
dashboard binds to `127.0.0.1`; the host-loopback container setup is documented
under [Docker](#docker). The execution key still lives in the bot process and must
be protected like any hot wallet.

## End-user readiness backlog

The repository implementation is a guarded operator tool, not yet a supported
retail release. Complete these items before declaring or packaging a supported
end-user release. The commands below remain experimental operator references:

1. Publish separate, reviewed mainnet and Sepolia **execution manifests** containing
   the deployed executor, OpenOracle, approved coordinators, router, factory,
   quoter, WETH, and executable tokens with runtime bytecode hashes. The protocol
   deployment manifests for other projects are not a substitute for this bot trust
   root.
2. Deploy and source-verify the stateless executor on each supported network, then
   reproduce every manifest hash through at least two independently operated RPCs.
3. Run a funded, low-limit Sepolia rehearsal covering entry, replacement, normal
   settlement, withdrawal, restart after each journal stage, relay rejection,
   RPC disagreement, and signer-authorized manual reconciliation. Retain transaction
   hashes and recovery evidence as release artifacts.
4. Add an external signer or encrypted-keystore interface so routine operators do
   not need to paste a raw private key into the dashboard or save it in plaintext.
   Until then, use a dedicated low-balance key and leave **Save this new key in
   plaintext for future restarts** off.
5. Extend the deterministic interrupted-write, partial-relay, same-origin RPC,
   clock-skew, and deep-reorganization tests with host-level disk-full and
   provider-specific chaos rehearsals.
6. Publish a supported relay/RPC compatibility matrix and continuously exercise
   exact bundle simulation, submission, receipt, and archive-read behavior against
   those providers.
7. Package a versioned release with pinned Bun support, checksums or signatures,
   reproducible installation, default service supervision, log rotation, health
   checks, and alerts for paused, syncing, error, stale-head, recovery-required,
   low-inventory, and unconfirmed-bundle states.
8. Commission an independent review of the final deployed addresses, manifests,
   signer integration, release package, and funded rehearsal evidence. Repeat the
   review whenever execution dependencies or token allowlists change.

## Install

From the monorepo root, enter the arbitrager project:

```bash
cd bots/open-oracle-arbitrager
bun install --frozen-lockfile
```

Copy the paused example and run the executable with no arguments. On first start,
save the chain and RPC endpoints through **Chain and RPC connectivity** in the dashboard;
then review deployment values in **Complete bot configuration** before enabling
execution:

```bash
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
bun run run
```

The package scripts call the TypeScript entrypoints directly through Bun. No Bash
wrapper scripts are required:

```bash
bun run run
bun run deploy-executor -- [deployment options]
bun run manifest -- generate [manifest options]
bun run reconcile -- [reconciliation options]
```

## Docker

Docker Compose builds the image, keeps bot state in a named volume, publishes the
dashboard only on host loopback, and starts the bot. From this directory, run:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory to start the same Compose command.

Compose restarts the container only while Docker and the host remain available; a
direct Bun process needs an external supervisor. If the host or named volume is
lost, restore the complete bot state before resuming live execution with the same
signer. Do not reuse that signer from incomplete recovery state.

On first start, the container creates a paused, dry-run configuration in its
persistent volume. Open `http://127.0.0.1:4173`; the dashboard does not require a
username or password. Compose publishes the port only on host loopback, so connect
from another machine through a trusted tunnel to the host rather than changing the
port binding. Keep `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` paired with that
`127.0.0.1` mapping.

In **Chain and RPC connectivity**, select the chain, enter its read and public RPC URLs, and
save so every endpoint is checked against that chain. Reload the dashboard, then
open [**Complete bot configuration**](http://127.0.0.1:4173/#complete-configuration).
Add the reviewed deployment settings, set the centralized-market REP address to
match `deployment.rep`, choose chain-specific history, price, and position paths,
and save. Configuration changes apply after restart:

```bash
docker compose restart
```

Run `docker compose down` to stop the bot and `docker compose up --detach` to start
it again. Compose preserves the operator configuration and bot history unless you
explicitly delete the named volume.

Do not publish the dashboard on a public interface: it controls signer and execution
settings. Do not bake private keys, RPC credentials, or manifests containing private
infrastructure into the image. Do not attach the bot to a Docker network shared
with untrusted containers. Loopback RPC URLs refer to the container itself, so use
a container-reachable RPC address when the node runs elsewhere.

## Monitor without trading

Set `runtime.execute` to `false`. Set `runtime.once` to `true` for one scan, or
set `runtime.ui` to `true` for continuous monitoring with the local dashboard:

```bash
bun run run
```

Then open `http://127.0.0.1:4173`. Dry-run opportunities are evaluated exactly like
execution opportunities, but no approvals or disputes are sent. Without an approved
coordinator, dry-run still synchronizes a bounded sample for diagnostics but refuses
to classify any report as an executable opportunity.

When network settings exist, startup and dashboard RPC changes validate
`eth_chainId`. An initially unconfigured bot keeps its paused dashboard available
without making RPC calls. It will not scan until a verified chain and endpoint set
has been saved and the process restarted. A configured bot also keeps the dashboard
available when RPC validation is temporarily unavailable, reports
`connectivity-degraded`, and retries with bounded backoff. The bot checks the chain
before every scan.

With approved coordinators configured, startup discovers reports by reading each
coordinator's `pendingReportId` at one fixed block and then reads the corresponding
stored OpenOracle state. It repeats those current-state reads at each new head and
does not query historical OpenOracle logs. Execution mode requires a quorum to agree
on the block and report snapshot. Opportunity evaluation and pool sampling run once
at the newest agreed head. With no new head the bot remains **Running** without
re-evaluating or writing duplicate price samples.

Coordinator-free diagnostic mode retains the historical fallback: startup scans
`runtime.lookbackBlocks` in 100-block log-query chunks, then reads a 12-block overlap
at each new head for shallow reorganization handling. The deliberately bounded
response size prevents permissionless event volume from producing an unbounded RPC
response.

### Data freshness and retention

The price file can retain a sample from a block displaced by a reorganization. The
bot reads at most the latest 8 MiB, loads and charts the latest 2,000 valid price
records, and atomically compacts the file to those records after it crosses 8 MiB.
Approved-coordinator monitoring keeps the complete current state of each pending
report but does not reconstruct its historical dispute path from logs. Reports that
are no longer pending are removed from the live cache; confirmed bot transaction
history remains in the execution history file. In coordinator-free diagnostic mode,
the startup lookback backfills report events but not historical pool prices. At most
256 reports and 64 permissionlessly observed tokens are retained so event spam
cannot create ever-growing per-block work. Increase `runtime.lookbackBlocks` only
when broader diagnostic event history is operationally important.

## Run on Sepolia

Use a separate operator configuration and separate history, price, and position
paths for Sepolia; an existing configured operator file cannot be retargeted to
another chain. Start the new file paused and unconfigured, then save `sepolia` and
its RPC URLs in **Chain and RPC connectivity**. Reload the dashboard so **Complete bot
configuration** contains the persisted network. Replace
every deployment address with values from the same reviewed test environment, set
`centralizedMarkets.assetAddress` to the same REP address as `deployment.rep`, and
use separate history, price, and position paths before saving the complete
configuration and restarting:

```bash
install -m 600 config/operator.example.json .state/operator-sepolia.json
OPEN_ORACLE_ARBITRAGER_CONFIG=.state/operator-sepolia.json bun run run
```

Keep `OPEN_ORACLE_ARBITRAGER_CONFIG=.state/operator-sepolia.json` on the restart
command and in the service definition. Before enabling execution, set the file's
runtime paths to distinct Sepolia-specific files such as
`.state/history-sepolia.jsonl`, `.state/prices-sepolia.jsonl`, and
`.state/positions-sepolia.json`.

Deployment addresses can be changed in the complete JSON editor and apply only
after restart. The selected chain cannot be changed after initial configuration,
because durable records do not contain a chain ID. This prevents cached reports,
transactions, positions, and profit totals from crossing networks.

## Execute disputes

Deploy the stateless executor from the same selected network. The default zero salt
is deterministic; use the same 32-byte `--salt` to obtain the same address on every
chain where the canonical CREATE2 proxy and executor init code are identical:

```bash
PRIVATE_KEY=0xYourDeploymentPrivateKey ETH_RPC_URL=https://rpc-a.example bun run deploy-executor -- --network=mainnet --quorum-rpc-url=https://rpc-b.example --quorum-rpc-url=https://rpc-c.example --salt=0x0000000000000000000000000000000000000000000000000000000000000000
```

The three read RPCs must use independent origins. Before broadcasting, the command
requires exact quorum agreement on chain, proxy and destination code, pending nonce,
gas estimate, and gas price, then syncs the signed intent beside the active operator
configuration as `<operator-config>.executor-deployment.json`. It also holds the same
chain-and-signer process lock as the operator. Repeating the command with the same
signer, chain, and salt recovers or rebroadcasts those exact bytes after a disconnect
or crash; the journal is removed only after quorum-backed canonical finality. Set
`OPEN_ORACLE_ARBITRAGER_CONFIG` when the operator configuration is not at its default
path; both commands must use the same value.

### Executor ABI source

The project compiles `contracts/OpenOracleArbitrageExecutor.sol` into
`src/contracts/artifacts.generated.ts` and derives
`src/contracts/executor-abi.generated.ts` from that local artifact. Never edit either
generated file directly. After an executor contract change, run
`bun run compile-contracts && bun run generate:abi`, review the generated diff, and
verify freshness with `bun run check:generated`. The remaining minimal ABIs in
`src/contracts/abi.ts` are maintained separately and checked against compiled
artifacts by `tests/contracts/abi.test.ts`.

### Executor public surface

The bot calls only the parent-bound entrypoints in the first four rows below.
`dispute` is a lower-level, unhedged funding helper: it intentionally has no
parent-block guard and emits no durable bot-accounting event, so the arbitrager
runtime does not use it.

The runtime—not the executor—authenticates which report and amounts belong to a
durable position. It derives those values from quorum-confirmed state and the
position journal, then matches the resulting event during receipt recovery. The
executor enforces the parent binding and exact caller-requested transfers, but its
event alone is not self-authenticating position-attribution evidence.

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

Verify the deployment address independently, set `runtime.execute` to `true`, save
the signer through the local dashboard (or the owner-only JSON file), and start:

```bash
bun run run
```

The manifest is JSON with this shape. Replace every placeholder with reviewed
deployment data and compute each `runtimeCodeHash` as the Keccak-256 hash of the
deployed runtime bytecode:

```json
{
  "version": 1,
  "network": "mainnet",
  "chainId": 1,
  "contracts": [
    {
      "role": "open-oracle",
      "address": "0x...",
      "runtimeCodeHash": "0x..."
    }
  ]
}
```

Allowed roles are `open-oracle`, `weth`, `uniswap-factory`,
`uniswap-quoter`, `uniswap-router`, `uniswap-v2-router`,
`uniswap-v4-pool-manager`, `uniswap-v4-quoter`, `executor`, `coordinator`,
and `token`.
Include every address in use. Do not construct this trust root from the same RPC
that the bot will authenticate; independently review the deployment, compiler
settings, and runtime code.

The schema is `config/execution-manifest.schema.json`. Generate hashes from one endpoint
and verify the resulting file through a separately operated endpoint:

The parser and schema bind `mainnet` to chain ID `1` and `sepolia` to chain ID
`11155111`; a contradictory network/chain pair is rejected before any RPC result
can verify the file.

```bash
bun run manifest -- generate --network=sepolia --rpc-url=https://first-provider.example --contract=executor:0x... --contract=open-oracle:0x... --output=/secure/operator/sepolia-deployments.json

bun run manifest -- verify --rpc-url=https://independent-provider.example --manifest=/secure/operator/sepolia-deployments.json
```

`config/execution-manifest.example.json` is deliberately placeholder-only and must never
be used as an execution trust root.

Execution remains fixed for the lifetime of the process. It can be configured in
the complete JSON editor but requires a restart. When execution starts without a
remembered signer, it remains locked until a key is set in the local dashboard. Signer set/clear
changes apply at the next unpaused scan boundary; they do not interrupt the current
scan or confirmation wait, and clearing a signer cannot cancel a transaction already
broadcast. Restarting the command is required to change between dry-run and
execution.

Private bundle delivery is the example default. Configure relay URLs and the
successful bundle-relay threshold under `submission.minimumBundleRelaySuccesses`,
either in the focused dashboard form or the complete JSON editor. In private mode,
this threshold applies both to pre-submission bundle simulations and to final bundle
fan-out. The bot proceeds only when at least that many simulated relays accept the
canonical bundle submission. Public transaction fan-out succeeds after one public
RPC accepts the canonical transaction hash.

Execution supports **Private relays** and **Public mempool** delivery. Private mode
requires at least one relay and supports up to eight. The configurable bundle-relay
threshold determines how many relays must validate and then accept the exact complete
bundle; submission is sent only to relays whose simulations succeeded. A broken
optional relay therefore cannot disable trading unless the configured threshold
requires it.
Startup and dashboard updates probe every private relay with `eth_chainId`, then
send intentionally invalid `eth_callBundle` and `eth_sendBundle` requests. A
compatible relay returns method-specific authentication or parameter errors; a
same-chain ordinary RPC returning unsupported-method errors is rejected and shown
as a failed relay. Ambiguous, successful, or malformed probe responses are rejected
too. Non-successful HTTP responses are rejected regardless of their body.
No transaction is signed or submitted by this capability check. The configuration
is also rejected when a relay is unreachable or reports the wrong selected network.
Relay URLs changed in the dashboard are saved in `submission.relayUrls` in the
operator configuration. Relay URLs are never written to the transaction-history file. URLs
may use HTTPS, or loopback HTTP for a locally operated relay; embedded URL
credentials, query parameters, fragments, and redirects are rejected.

Before each dispute, the bot:

1. Requires `helper.creator` to be an approved coordinator and requires the report
   to exactly match that coordinator's on-chain OpenOracle, WETH, REP, callback,
   timing, fee, multiplier, and flag template. Independent hard bounds reject
   callback gas above 10,000,000, timestamp settlement windows above seven days,
   block settlement windows above 50,400 blocks, and multipliers above 2x even when
   a configured coordinator exposes them.
2. Checks that the game is WETH plus a usable token and inside its dispute window.
   In execute mode, token 2 must be an Augur-discovered REP or an address explicitly
   configured by the operator; a permissionlessly observed token is monitor-only.
3. Finds an active Uniswap V3 pool and rejects excessive spot/TWAP deviation.
4. Models both directions across configured venues: QuoterV2 for V3, exact
   constant-product reserve math for V2, and the authenticated V4 Quoter across
   every standard fee/tick-spacing pair. The best executable quote competes
   independently of the V3 pool used as the TWAP anchor.
5. Derives the same replacement swap side as the OpenOracle contract.
6. Calculates the exact WETH and token contributions and checks wallet inventory.
7. Applies the absolute-profit and basis-point thresholds.
8. Requires independent RPCs to return one exact block hash and the same pool state,
   two hedge quotes, replacement quote, gas basis, balances, allowances, nonce, and
   OpenOracle state hash before deriving or signing any transaction.
9. Requires sufficient quorum-confirmed ERC-20 and OpenOracle internal allowances,
   then creates one atomic executor call.
10. In private mode, signs that transaction, simulates it with
    `eth_callBundle`, requires the configured number of successful simulations,
    includes an on-chain exact-parent-hash guard, and re-applies the profit threshold
    to the largest successful simulation gas usage. Public mode simulates the same
    atomic executor call.
11. Sends the all-or-nothing target-block bundle only to relays that successfully
    simulated it, or fans the identical single public transaction to every configured
    public RPC. No reverting transaction hashes are allowed.
12. Writes a durable pending-entry record before submission. After inclusion, it
    verifies every bundle receipt and its required effective gas price against the
    independently confirmed canonical target-block hash, decodes the executor’s
    actual hedge event, records every entry transaction hash and actual bundle gas,
    and only then allows the position to progress as confirmed.
13. On later blocks, automatically settles when eligible, then submits one atomic,
    exact-amount lifecycle executor call in either delivery mode. Settlement,
    internal transfers, WETH/token withdrawals, and the canonical parent check share
    one revert boundary. It records realized P&amp;L only when the canonical receipt
    contains the executor event matching the position's account, report, tokens, and
    amounts, and passes the finality quorum through 12 canonical descendants. Before
    that point the position is
    `closed-pending-finality`, still consumes its risk slot, and is automatically
    reopened if the receipt disappears in a reorganization. If a later reporter
    replaces the bot, it computes the exact credit from the two authenticated report
    states and withdraws that credit alone through `withdrawReplacementCredit`.
    Aggregate holder balances are only an availability check, never position
    attribution evidence. After finality the record remains **replaced** until its
    one-sided inventory is explicitly reconciled.

The executor atomically swaps the old report inventory through the authenticated
router, pulls the calculated contribution, verifies exact balance deltas into itself
and OpenOracle, calls `dispute` with the wallet as the recorded disputer, clears its
router and OpenOracle allowances, refunds unused WETH, and requires its ending token
balances to equal their starting balances. Fee-on-transfer and other non-exact
balance changes therefore revert the whole execution. A later rebase is not
detectable by the executor and can invalidate OpenOracle's nominal collateral
accounting; only reviewed, non-rebasing exact-transfer tokens should be allowlisted.

Reports already owned by the execution account are skipped because OpenOracle
self-disputes use different accounting. At most one dispute is executed per poll so
a second transaction cannot rely on the pre-transaction balance snapshot.

## Required ETH, WETH, and tokens

There is no single fixed funding amount. OpenOracle contributions increase with the
current round, while the executor also needs hedge inventory. The dashboard's
**Open opportunities** table shows the total `Required WETH` and `Required token`
that the executor pulls from the wallet, including both the OpenOracle contribution
and the atomic hedge. The branch formulas and event fields are explained in the
[operator guide](./docs/operator-guide.html#math).

The execution account needs:

- `ETH balance >=` the sum of every signed transaction's gas limit multiplied by its
  fee cap, plus an operational buffer.
- `WETH balance >= required WETH` for the selected report.
- `Token balance >= required token` for the selected report.
- `WETH.allowance(account, executor) >= required WETH` and
  `token.allowance(account, executor) >= required token` for entry.
- `OpenOracle.internalAllowance(account, executor, WETH) >= locked WETH` and
  `OpenOracle.internalAllowance(account, executor, token) >= locked token`.

Grant ERC-20 and OpenOracle internal allowances from the dedicated bot account
(replace the addresses and use the selected network RPC):

```bash
cast send 0xWETH "approve(address,uint256)" 0xExecutor 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xReportToken "approve(address,uint256)" 0xExecutor 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle "approveInternal(address,address,uint256)" 0xExecutor 0xWETH 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle "approveInternal(address,address,uint256)" 0xExecutor 0xReportToken 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"
```

Maximum allowances avoid missing an opportunity after a finite allowance is
consumed. A finite ERC-20 allowance is also supported when it covers the dashboard's
displayed requirement, but it must be refreshed before the next larger entry. Review
each allowlisted token's approval semantics: tokens that require resetting a nonzero
allowance to zero first need two separate setup transactions, and tokens with
nonstandard, rebasing, or fee-on-transfer behavior must not be enabled merely because
`approve` succeeds.

OpenOracle rejects changing one nonzero internal allowance directly to another
nonzero value. Set it to zero first when rotating or reducing an existing allowance.
The bot checks both ERC-20 and both internal allowances through its independent read
quorum before signing an entry, and checks the internal allowances again before
lifecycle submission.

Opportunity selection reserves 1,200,000 gas for entry plus the larger of the
configured lifecycle reserve and the current fee estimate for callback gas plus
settlement and withdrawals. This is not a wallet balance guarantee; keep additional
ETH for approvals, adverse base-fee movement, and recovery work. Capital can remain
locked through later dispute rounds.

“Modeled net profit” is the direction-specific hedge P&amp;L before gas minus:

- The entry reserve: initially `1,200,000 × (2 × base fee + 2 gwei)`. Public
  delivery retains that fixed reserve. Private delivery replaces it with the
  largest gas usage returned by the successful relay simulations at the same gas
  price.
- The full adverse movement permitted by the signed hedge limit
  (`runtime.maxHedgeSlippageBps`).
- The larger of `runtime.riskLimits.lifecycleGasReserveAttoWeth` and
  `(callbackGasLimit + 900,000) × gas price`. Public and private delivery use the
  same single atomic lifecycle call.

The resulting fully reserved value must satisfy both the absolute minimum-profit
floor and a direction-specific basis-point floor. The return basis is the current
report's WETH plus WETH fees when selling token 2, and the exact-output quoted WETH
input when buying token 2. The bot recomputes both thresholds from the canonical
quote-block snapshot immediately before it signs.

The dashboard balance calculation reports:

- Native ETH.
- Wallet WETH and REP.
- The best executable WETH output for selling the entire REP balance through a
  currently accepted pool.
- Estimated executable portfolio value:
  `ETH + WETH + quoted REP value`, treating 1 ETH as 1 WETH.

That portfolio value is a liquidation estimate. It is not cost-basis accounting and
can move sharply when REP/WETH liquidity is shallow.

## Dashboard

Set `runtime.ui` to `true`, choose `runtime.uiPort`, and run:

```bash
bun run run
```

The dashboard shows:

- Bot mode, **Syncing**, **Running**, **Paused**, **Error**, or **Stopped** status, latest block,
  block age relative to the operator computer, errors, and active-report count.
- Selected network, expected chain ID, read/public RPC controls, and endpoint checks.
- A local signer control, connected address, and its ETH/WETH/REP balances.
- ETH, WETH, REP, executable REP value, and estimated portfolio value.
- Native ETH stakes, WETH stakes, and ETH settler rewards locked in reports currently
  pending on configured coordinators. The combined figure treats 1 WETH as 1 ETH.
- Current opportunities, token-metadata-normalized inventory requirements, deadline
  window, token-specific direction, pool, and decision.
- Durable positions with actual hedge execution, entry and lifecycle gas, exact
  settler reward, withdrawals, state, and realized net P&amp;L. A staged entry shows **Awaiting entry
  evidence** and is excluded from actual P&amp;L totals until receipt and executor-event
  quorum succeeds. A lifecycle attempt is likewise excluded while any receipt is
  ambiguous. `closed-pending-finality` retains its risk slot and does not contribute
  realized profit until its exact lifecycle evidence passes the finality quorum.
  Realized totals
  include only closed positions whose expected
  inventory fully reconciled or whose manual reconciliation explicitly records
  P&amp;L.
- Confirmed dispute transactions and their older quote-time accounting. The table
  and trend are bounded to the latest 500 records; durable position totals use the
  complete position journal.
- Signed transaction status, public/private delivery, accepted and failed relay
  targets, mined replacement hash, actual gas, and ETH profit estimates.
- A read-only active risk envelope showing configured position, locked-capital,
  daily-gas, and lifecycle-reserve limits alongside current usage and remaining
  capacity.
- Persistent strategy, RPC fanout, relay submission controls, and pause/resume.
- A token catalog with wallet balances and supported WETH/token pools. Each pool
  address links to the selected-network explorer. The [market discovery section](#token-and-pool-discovery)
  owns the venue, price, and liquidity semantics. A token with no supported pool is
  explicitly labeled instead of disappearing.
- In coordinator-free diagnostic mode, the submitted/disputed/settled events
  observed for each OpenOracle report, including blocks, reporters, raw locked
  amounts, and transaction links. Configured-coordinator mode shows current report
  state without reconstructing these historical paths. See
  [data freshness and retention](#data-freshness-and-retention) for lookback limits.
- A per-asset current-head price-history chart with one series per supported pool,
  axes, point tooltips, and a recent exact-value table. Samples persist across
  restarts, subject to the retention and reorg limits above.
- A 500-entry in-memory operations journal. The dashboard hides routine scan entries
  and shows decisions, configuration changes, transaction states, and the reason for
  each action.

The UI is local-only by default. A private key entered there is sent over HTTP to the
loopback endpoint, immediately cleared from the input, and never echoed by the API
or written to logs or transaction history. In the documented Docker setup, the
process listens on the container interface while Docker publishes it only on host
loopback; this supplied Compose path does not require a password. Outside that
explicit host-loopback setup, binding to `0.0.0.0` requires a
`ZOLTAR_BOT_DASHBOARD_PASSWORD` of at least 16 characters. For a custom network-bound
container, remove `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` and explicitly pass the
password into the container. Authenticate as `operator` in the browser's HTTP Basic
prompt. Basic authentication protects access but does not encrypt traffic, so keep
that network free of untrusted peers or terminate TLS at an authenticated proxy.
JSON API bodies are capped at 1 MiB. The key is kept in memory unless
**Save this new key in plaintext for future restarts** is selected. That explicit
choice stores the key in the owner-only operator settings file; protect the host,
backups, and settings path as wallet credentials. **Forget saved key** atomically
removes only the restart credential while retaining the active in-memory signer.
**Clear signer & saved key** removes both the active signer and any saved restart credential.
The status names the active address and, when different, the address that a future
restart will use. Setting a different memory-only key preserves an existing restart
key until **Forget saved key** or **Clear signer & saved key** is used. Mutable API
requests require authentication when network-bound, same-origin JSON, and the fixed
loopback host authority. Do not expose the dashboard to a network without transport
security.

## Persistent operator settings

`.state/operator.json` is the source of persisted bot settings. The bot accepts no
command-line arguments and does not read chain or RPC settings from environment
variables. Copy the example before first startup:

```bash
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
```

`OPEN_ORACLE_ARBITRAGER_CONFIG` may locate a different file; it does not override
any value inside the document. This locator is useful for service managers and
tests. Select the chain and enter the read and public RPC URLs in **RPC
connectivity**. Every endpoint is checked against the selected chain before it is
saved. Initial chain selection applies after restart; an RPC-only change on the
active chain applies at the next scan boundary. To operate another chain, follow
the [separate-configuration steps](#run-on-sepolia). Configure independent quorum
readers with the deployment controls before enabling execution.

Direct file editing is an offline workflow: stop the bot, edit the configuration,
and restart it. While the bot is running, use the dashboard only; do not edit the
file concurrently with a dashboard save.

The dashboard's focused forms and **Complete bot configuration** JSON editor write
the same versioned file. The complete editor exposes network, runtime, paths, risk,
strategy, connectivity, submission, tokens, and deployment fields. A saved private
key is returned as `__PRESERVE_SAVED_PRIVATE_KEY__`, never as key material; leaving
that marker unchanged preserves the credential.

The containing directory is created with owner-only permissions when possible, and
every replacement configuration file is mode `0600`. File contents and the containing
directory are synced before a successful save is reported. The default directory is ignored by
Git. A malformed or unsupported file stops startup instead of silently reverting
to defaults. A runtime write failure rejects the dashboard
mutation and keeps the prior runtime settings active; fix the settings path or
permissions and retry.

Deployment identities remain restart-time trust roots, but the dashboard can validate
the syntax and shape of REP, WETH, OpenOracle, coordinator, executor, manifest,
quorum-RPC, and Uniswap V2/V3/V4 values and save them for the next restart. Saving
does not authenticate contracts or verify RPC independence.

For dashboard deployment, configure a public submission RPC on the selected chain
and set an active signer. If execution is armed, pause the bot first; pause blocks
new entries but not lifecycle recovery, settlement, or withdrawal, so wait until
there are no pending or in-flight signer operations before deploying. Enter the
bytes32 salt and confirm the predicted address. The deploy action checks the RPC
chain and canonical CREATE2 proxy. A fresh deployment verifies its successful
receipt and runtime bytecode; if the predicted address is already deployed, the
action verifies matching runtime bytecode without sending a transaction. It then
saves the executor and clears the old manifest. Paste a reviewed manifest
containing the new executor, save, and restart; startup authenticates every
configured identity and the manifest through the read quorum before execution
begins.

Pause blocks new position entry. It deliberately does not block settlement,
replacement recovery, or withdrawal for a position that already has capital at
risk. A submission already started may still finish; pause cannot cancel a signed
bundle or transaction.

## Profit and history semantics

Successful dispute submissions are appended to `runtime.historyFile`. The example
uses `.state/history-mainnet.jsonl`; use separate paths for each network.

The history file is created with owner-only permissions when possible and is ignored
by Git at its default path. Each record contains the report, pool, direction,
total executor-funded inventory, mined executor transaction hash, block, actual transaction gas,
modeled net profit, profit before gas, and tracked net profit in ETH. Both modes
submit one parent-bound executor transaction per entry. Private submissions provide
no allowed reverting hashes, so a compliant relay/builder omits a reverting call.
An unincluded transaction consumes no on-chain gas. Public execution records the
same single executor transaction and its actual gas through the durable position
and history accounting.

Execution startup verifies that the history destination is writable. If persistence
later fails after a confirmed dispute, the record remains visible in memory, further
execution is blocked, and the bot retries the queued write on later polls. An append
is acknowledged only after the file and parent directory have been synchronized.
A malformed or torn non-empty JSONL record stops startup with its line number
instead of being silently omitted from revenue or gas totals.

Before submission, the position journal also records the immutable execution
intent plus the signer nonce and submission block. Live confirmation and
confirmation recovered after a restart both use that intent to commit the
confirmed position and its complete history record together through a durable
outbox. The bot then appends the record to JSONL idempotently and clears the
outbox with another synchronized position write. A crash before, during, or
immediately after confirmation or the append therefore replays the missing
history operation on restart without losing or duplicating the confirmed revenue
record.

Position profit is tracked in ETH using the exact 1 WETH = 1 ETH unwrap relationship:

```text
sell-token hedged P&L before gas = actual WETH out − old report WETH − WETH fees
buy-token hedged P&L before gas = old report WETH − actual WETH in
open hedged net = hedged P&L before gas − actual entry gas − lifecycle gas so far
realized net = hedged P&L before gas + exact settler reward − actual entry gas − actual lifecycle gas
```

The old confirmed-submission table keeps quote-time modeled and tracked values for
diagnostics. They are not realized P&amp;L. After entry receipt quorum, the durable
position table derives hedge economics from the executor event and includes mined
entry and lifecycle gas. A finalized lifecycle adds the exact ETH settler reward
from its executor event; a zero reward is recorded when the executor did not settle.
Before that quorum, staged quote values remain recovery
metadata, render as awaiting evidence, and are excluded from actual P&amp;L totals.
Automatically realized P&amp;L is withheld unless actual WETH and token withdrawals exactly equal
the expected hedge-neutral inventory. A mismatch is marked `recovery-required`
because the residual token exposure must be valued or unwound manually. Relay
refunds and transactions sent outside this process are not included automatically.
For a manual reconciliation, `--realized-net-profit-eth` is an operator-calculated,
all-in result. Add every OpenOracle or manual-withdrawal receipt and every external
unwind or sale proceed; subtract all entry, lifecycle, and external gas, fees,
slippage, and `--external-cost-eth`. The command records this value and its evidence;
it does not calculate or validate the economic result.

## Token and pool discovery

On Ethereum mainnet startup discovery reads Augur’s genesis universe, its forking
market, and the instantiated child universes for every complete single-winner payout
vector derived from that market's outcome count. Discovery must succeed before the
bot scans or executes; an RPC or contract-read failure is surfaced as an operator
error rather than silently omitting fork tokens. The resulting reputation tokens
currently include:

| Token | Address |
| --- | --- |
| REPv2 | `0x221657776846890989a759BA2973e427DfF5C9bB` |
| REPv2_Yes_1 | `0xCf6A0A7826fa124B7705d6f3c675eAD76f1e540D` |
| REPv2_No_1 | `0x2F4005456c2F098358213f01DbE34abDAa2989A4` |

These are discovered from contract state rather than trusted as a hardcoded trading
list. Tokens present only in retained approved-coordinator games are monitored and
shown with their pools, but cannot trigger execution. A coordinator-free diagnostic
run additionally samples at most 64 permissionlessly observed tokens.
Augur-discovered REP tokens and addresses explicitly entered in the dashboard or
listed in `tokenAddresses` form the execution allowlist. Explicitly adding
a token is a security decision: the atomic executor still enforces exact transfers,
but it cannot establish the token's issuer, economic value, or pool legitimacy. The
primary `deployment.rep` remains the token used in the top-level REP portfolio
summary.

### Uniswap venue execution

Market discovery checks all Uniswap V3 fee tiers (`0.01%`, `0.05%`, `0.3%`, and
`1%`) plus mainnet Uniswap V2 and SushiSwap V2 WETH pairs. For V3, “Liquidity” is
the pool contract’s raw in-range `liquidity()` value; for constant-product venues it
shows both token reserves. Neither is a token-denominated TVL or a promise that the
full game size can execute without price impact. “Price” is the decimal-normalized
WETH-per-token spot price derived from V3 `sqrtPriceX96` or V2 reserves; it is not
an executable size-aware quote. V3 execution uses QuoterV2 and the configured
spot/TWAP guard. When `deployment.uniswapV2Router` is configured, mainnet execution also
reads the canonical Uniswap V2 pair reserves at the exact quorum quote block and
evaluates the direct WETH/token route with the standard 0.30% fee:

```text
amount out = amount in × 997 × reserve out
             ÷ (reserve in × 1000 + amount in × 997)

amount in  = floor(reserve in × amount out × 1000
             ÷ ((reserve out − amount out) × 997)) + 1
```

When `deployment.uniswapV4PoolManager` and `deployment.uniswapV4Quoter` are both
configured, the bot also asks the authenticated V4 Quoter for
exact-input and exact-output quotes against these exact pool keys:

| Fee units | Tick spacing |
| --- | --- |
| `100` | `1` |
| `500` | `10` |
| `3000` | `60` |
| `10000` | `200` |

Every supported key has `currency0 = native ETH`, `currency1 = report token`, and
`hooks = address(0)`. The exact swap amount must be no greater than
`2^127 - 1` token base units so every PoolManager delta fits a signed `int128`.
For a buy, `zeroForOne = true`: the requested exact token output and returned token
delta are positive, while the native input delta is negative and cannot exceed the
signed maximum WETH input. For a sell, `zeroForOne = false`: the requested exact
token input and returned token delta are negative, while the native output delta is
positive and cannot fall below the signed minimum WETH output.

At least two available read RPCs must return the same quote at the exact quorum
block, and every available response must agree. The executor
calls the authenticated PoolManager directly, requires those signed deltas to match
the requested input or output, settles only those deltas, and converts native ETH
to or from WETH before funding the OpenOracle dispute. Hooked pools, dynamic-fee
pools, and any other fee/tick-spacing pair remain excluded because they can alter
swap behavior or require a separate reviewed trust policy.

The bot compares complete strategy profit after its conservative gas and slippage
reserves, not spot price alone. Every selected V2, V3, or V4 swap executes inside
the same parent-bound atomic executor transaction with an exact minimum output or
maximum input. SushiSwap V2 remains monitoring-only because it has no authenticated
execution router in this release. The bot will not silently fall back to an
unsupported venue.

Price samples are stored at `runtime.priceHistoryFile`. The example uses
`.state/prices-mainnet.jsonl`; keep files network-specific.

### Independent CEX and DEX manipulation guard

The shared market observer uses CCXT's public unified `fetchTicker` and
`fetchOrderBook` APIs. Configure independent exchanges under
`centralizedMarkets.sources` with an exchange id, a unified `REP/QUOTE` market,
and an `ETH/QUOTE` reference market unless REP is quoted directly in ETH. The
cross market must be exactly `ETH/<REP quote>`; direct `REP/ETH` books must omit
it. The
configuration also declares `assetAddress`, `assetChainId`, and the required
`REP` base symbol; startup rejects a mapping that does not match the configured
REP deployment and chain. CEX and DEX source IDs share one global namespace so
one failure domain cannot vote in both groups. The dashboard shows each
normalized REP/ETH observation and its executable bid and
ask depth inside the configured `depthBps` band. A cross-quoted observation is
fresh only when both the REP order book and ETH reference ticker are fresh.
Exchange-provided timestamps are retained (using the older timestamp for a
cross-quoted observation), so polling cached data cannot extend freshness or
manufacture temporal persistence. Required consensus does not admit a CEX
observation without a native order-book timestamp and, for cross quotes, a
native ETH-ticker timestamp.

The CEX estimate is the median of fresh venue prices. Reliability requires
`minimumSourceCount`, minimum bid and ask depth, and venue dispersion within
`maximumVenueDispersionBps`. With `requiredForExecution` enabled,
`venueConsensus` is mandatory, at least two independent exchanges are required,
the configured source lists must be large enough to satisfy every CEX, DEX, and
total-source minimum, and the complete CEX/DEX/temporal quorum fails closed. The current price regime
itself must persist for the configured count and span; old observations cannot
warm up a newly changed price. The guard runs during opportunity selection and
again against the canonical final execution quote. That final check revalidates
evidence age after simulation and canonical-chain preflight, before the durable
pending-position journal is written, so an expired quote cannot authorize
submission or leave an intent that recovery might broadcast.

With `venueConsensus` configured, the bot also builds a separate DEX consensus
from executable two-sided Uniswap V2, V3, and V4 quotes. Each protocol is one
failure domain regardless of its number of fee tiers. The venue selected for an
opportunity is excluded from that opportunity's reference, so a candidate never
votes for itself. Explicit constant-product pair sources can supplement those
discovered venues; the bot pins their reserve reads and every executable quote
to the scanned canonical block. Repeated polls of the same block retain the same
native observation identity and cannot build temporal persistence. The bot
rechecks the block hash after each market-read batch and discards DEX history if
the canonical hash changes.

The two groups must agree within `maximumGroupDeviationBps` when both are
reliable. Single-group fallback is disabled by default and is used only when
`allowSingleGroupFallback` is explicitly enabled; rejected-group observations
never count toward its total-source quorum. Two coherent but disagreeing groups
stop execution because the bot cannot identify the truthful group. Per-source DEX
depth, minimum DEX and total source counts, freshness, venue dispersion, and the
final candidate deviation are all configurable. The dashboard reports the CEX
median, DEX consensus, guarded reference, and DEX depth separately.
`minimumSourceObservationCount` and
`minimumSourceObservationSpanMilliseconds` additionally require each source to
remain coherent across multiple polls before it can vote. The span cannot exceed
`maximumObservationAgeMilliseconds`, and leaving then returning to an earlier
price regime restarts its history.

This reference does not replace executable Uniswap quotes, spot/TWAP checks,
quorum reads, slippage limits, or profitability accounting. It is a second,
off-chain manipulation signal. Operators must still verify that each configured
exchange ticker represents the declared REP contract. The estimate is bound to
that contract and chain;
fork REP tokens without matching CEX markets remain ineligible when CEX
confirmation is required and do not inherit the primary token's estimate.

CCXT uses unified market symbols:

```json
"sources": [
  { "exchangeId": "kraken", "repMarket": "REP/USD", "ethMarket": "ETH/USD" },
  { "exchangeId": "anotherexchange", "repMarket": "REP/ETH", "ethMarket": null }
]
```

Only configure symbols verified on that venue; the example names illustrate the
schema and are not an assertion that a venue currently lists REP.

## Transaction delivery and tracking

Public mode broadcasts one signed atomic executor call to every configured public
RPC. It cannot safely broadcast prerequisite approvals alongside the opportunity,
so any entry with insufficient executor allowances is rejected before signing.
The call uses the same exact-parent guard as private entry and can succeed only in
the direct child of its quoted block. Inclusion in a later block reverts and can
still consume gas. Public delivery exposes the opportunity to copying, reordering,
front-running, and other MEV, and does not provide bundle confidentiality or
next-block inclusion. Public lifecycle delivery broadcasts one executor transaction
whose parent-hash guard, optional settlement, exact OpenOracle internal transfers,
and exact withdrawals share one revert boundary. Its hash, signer nonce, submission
block, target block, and expected amounts are synced before broadcast. Every
observed repricing, cancellation, or unrelated same-nonce replacement is synced
before its outcome is accepted. A successful replacement must also match the durable
sender, nonce, destination, calldata, and ETH value byte-for-byte; only a proven
revert may close without that intent match. After a crash, independent RPCs scan
canonical blocks for that sender and nonce if the replacement hash was not yet
durable.

Private mode signs the executor call, requests `eth_callBundle` from every configured
relay, and then fans the same target-block transaction only to relays whose
simulation passed. The payload omits `revertingTxHashes`, so a revert invalidates
the bundle.
The entry executor call and the single lifecycle executor call require
`blockhash(parent)` to equal the independently agreed quote-block hash. A relay or
builder using a different same-height parent, retaining a transaction beyond its
target, or splitting prerequisite entry approvals from the guarded call cannot
execute the value-moving call. Immediately before journaling and delivery, the read
quorum must still agree on both the parent height and hash.
The configured number of relays must successfully simulate the bundle, and at least
one of those relays must accept submission, or delivery fails closed. Configured
endpoints must implement the
[Flashbots bundle RPC](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint)
and authentication format.

The transaction tracker records each submitted executor call as `submitting`,
`pending`, `confirmation unknown`, `confirmed`, `reverted`, or `submission failed`.
It shows which targets accepted or rejected the payload. Every atomic entry and
lifecycle transaction is parent-bound to one target block and is not resubmitted
from a stale quote. In public mode, receipt polling yields once that target passes so
the durable recovery loop can continue. Missing receipt evidence remains pending
through a 12-block canonical-finality window in either delivery mode. If receipt
absence passes the finality quorum, the attempt becomes `expired-not-included` and
releases its risk slot. A quorum-confirmed
reverted atomic entry is terminally closed after recording its gas; it cannot have
changed OpenOracle state. If the atomic lifecycle call was absent, that attempt is
cleared and the open position can safely retry from a fresh parent. Expired hashes
remain in the durable journal and are checked on every poll. If a retained
transaction is later published, its parent guard makes it revert; the bot records
that late gas once, updates the UTC-day gas budget and realized P&amp;L where
applicable, and then removes the archived attempt. An absent hash is also retired
once independent RPCs prove at the finalized height that a later canonical
transaction consumed its nonce, because the retained signature can no longer be
mined. Unexpected successful evidence fails closed. Inter-reader disagreement rejects
the quorum read, leaves the journal in its current state, and blocks execution until
the readers agree. Once the quorum agrees, a successful receipt without the expected
executor event, exact durable transaction intent, or attributable assets remains
`recovery-required`. Active transaction-tracker rows
are kept in process memory and reset on restart; confirmed dispute history and its
ETH profit totals are persisted in the configured history file.

## Adjust the strategy

Every setting below can be changed in the dashboard and takes effect on the next
scan. The same values live under `strategy` in the complete configuration:

| Setting | Example | JSON field | Effect |
| --- | ---: | --- | --- |
| Minimum profit | `0.01 WETH` | `minimumProfitWeth` | Rejects opportunities below an absolute modeled net profit. |
| Minimum return | `100 bps` | `minimumProfitBps` | Requires modeled net profit relative to the direction-specific return basis. |
| Spot/TWAP distance | `100 ticks` | `maxSpotTwapTicks` | Rejects pools whose current tick is too far from the TWAP. |
| TWAP window | `1800 seconds` | `twapSeconds` | Controls the Uniswap manipulation-resistance window. Minimum: 60 seconds. |
| Remaining time | `36 seconds` | `minimumRemainingSeconds` | Inclusion buffer for timestamp-based games. |
| Remaining blocks | `3 blocks` | `minimumRemainingBlocks` | Inclusion buffer for block-based games. |
| Head poll interval | `1000 ms` | `pollMilliseconds` | Delay between latest-head checks. Coordinator-free diagnostic mode queries every unseen event-log height. |

Increasing profit thresholds reduces execution frequency. Increasing the TWAP
window or remaining-time buffers is generally more conservative, while decreasing
the maximum Spot/TWAP distance rejects more divergent pools and is more
conservative. Increasing that maximum permits larger Spot/TWAP deviations.
Parameter changes do not disable contract-side deadline, ratio, state-hash,
quote-refresh, simulation, or inventory guards.

All other startup values are in `deployment`, `submission`, `tokenAddresses`, and
`runtime`; `network` and `connectivity` are absent until the focused dashboard form
saves them. The UI's complete JSON editor can change the remaining fields;
deployment, path, execution-mode, UI-bind, and risk changes take effect after
restart.

The position notional uses the refreshed required WETH plus required token funding
valued at the higher of the executable hedge quote and signed hedge limit.
Immediately before journal write and delivery, the bot rechecks that notional, the
total of every non-closed durable position, and the UTC-day gas total. Public mode
uses `1,200,000 × gas price` for the candidate entry; private mode uses the largest
gas usage from the successful relay simulations. Both add the lifecycle reserve. A
value equal to a configured cap is allowed; one attoETH above it is rejected.

Actual gas is assigned to the UTC day of each receipt's quorum-confirmed canonical
block timestamp, not the local time at which the transaction was staged or later
recovered. The durable position stores one dated gas expenditure per confirmed
receipt, and both the execution limit and dashboard use that same ledger.

### Durable position journal

The configured `runtime.positionFile` is the durable journal; the example uses
`.state/positions-mainnet.json`. Before relay delivery, writes use
an owner-only temporary file, sync its complete contents, atomically rename it, and
sync the parent directory. A malformed journal stops startup rather than discarding
recovery state. Back it up with the configuration and history files, never share one
path across networks or execution signers, and preserve it until every position
is closed and reconciled.

Execute mode holds `<position-file>.lock` for the process lifetime to prevent
concurrent writers. While a signer is active or queued, it also holds an
operating-system temporary-directory lock that prevents a second local process from
using the same signer on the same chain with a different journal, provided both
processes share the same OS temporary-directory namespace. A signer change acquires
the new lock before persistence and keeps the old and new locks until the next scan
boundary completes the transfer. The reconciliation command also holds the journal
lock. Journal contention fails before journal load, while signer contention fails
before signer activation, signing, or submission. Lock files include the owner PID
and acquisition time and are removed after normal completion or caught-error
unwinding. After any interrupted, terminated, or crashed process, verify that no bot
or reconciliation process is still running before removing an orphan lock; never
delete a live lock to force startup. Signer locks cannot coordinate different
temporary-directory roots, private temp namespaces, containers, or hosts. Never run
the same execution signer across any of those boundaries.

The state sequence is:

```text
pending-entry → open → withdrawing → closed-pending-finality → closed
     │           │          │                    │
     │           └──────────┴──→ recovery-required
     │                                ↓ signer-key-authorized local reconciliation
     │                              closed (P&L recorded or unavailable)
     ├── atomic public/private: after 12 canonical descendants and quorum-confirmed absence
     │    → expired-not-included
     ├── quorum-confirmed atomic revert → closed (gas recorded)
     └── lifecycle receipt removed by reorg → open (provisional accounting removed)
```

The bot records every entry transaction hash before submission. Private and public
entry each have one guarded executor transaction. After a restart the bot requires
independent RPC agreement on every required receipt and on that receipt block's
current canonical hash. Every receipt must include its mined effective gas price.
The bot then decodes the executor event and reconstructs actual entry gas and hedge
economics before leaving `pending-entry`. A current atomic public or private attempt
proven absent after the 12-block window becomes `expired-not-included`; a
quorum-confirmed atomic revert closes after gas accounting. Inter-reader disagreement
keeps the current journal state pending and blocks execution. Quorum-agreed evidence
that is missing required executor events or conflicts with the durable journal moves
the position to `recovery-required` and never produces trading profit. Legacy
multi-transaction private records are never auto-expired because their prerequisite
signatures lack the executor's on-chain parent binding.

Before lifecycle delivery, the bot atomically records the one executor transaction
hash, nonce, token decimals, target block, and delivery mode. Both modes call
`settleAndWithdraw`, which optionally settles, moves only the recorded position
amounts using OpenOracle internal allowances, and withdraws those exact amounts in
the same parent-bound transaction. After a crash the bot reconstructs lifecycle gas
and withdrawals, including the exact optional ETH settler reward, from the canonical
receipt and `LifecycleExecuted` event. Wallet
balance deltas and `withdraw(max)` are not accounting evidence, so permissionless
OpenOracle dust, unrelated transfers, and other positions sharing a token remain
separate. Exact successful evidence first moves the record to
`closed-pending-finality`. The bot retains the risk slot and transaction evidence
until the exact lifecycle evidence passes the finality quorum; it then
realizes profit, or removes provisional withdrawal and gas accounting and reopens
the position if the receipt was reorged out. Fewer than two available agreeing RPCs
therefore delays closure rather than releasing the slot from the primary RPC's head.

When another report replaces the bot, the durable entry already contains the exact
amounts and fee needed to reproduce OpenOracle's replacement-credit formula. The bot
checks the authenticated current report, records a `replacement-credit` lifecycle,
and calls `withdrawReplacementCredit` for exactly one credited token. The executor
uses an exact OpenOracle internal transfer and withdrawal, verifies the wallet
receipt, and leaves the one-unit sentinel and every unrelated balance untouched.
Missed or reverted attempts follow the same expiry/retry rules as settlement.
Canonical success becomes **replaced**, not **closed**, because only one side of the
hedged inventory has returned and automatic revenue would be misleading.

### `recovery-required` runbook

Stop new entries and preserve the position journal before investigating. Do not
delete or hand-edit a record to bypass the one-position guard.

1. Confirm the dashboard network, signer address, OpenOracle, executor, and token
   match the journal record. Save a copy of the journal, operation log, and evidence
   from every configured reader. At least two readers must respond and every response
   must agree exactly; record a reader as unavailable only for a positively identified
   retryable transport failure. Preserve malformed or contradictory responses as
   safety-fault evidence rather than excluding them.
2. For **entry receipt could not be recovered**, current records contain one
   `entryTransactionHashes` value. Look it up on independent explorers/RPCs. It must
   be absent, revert without an executor event, or succeed in its parent-bound target
   block with the exact matching event. A quorum-confirmed revert is closed
   automatically after gas accounting. A legacy record can contain multiple hashes;
   inspect every hash and never treat the record as expired merely because its target
   passed. If evidence is temporarily unavailable, restore independent RPC service
   and restart; the bot retries quorum recovery. For a successful mismatched receipt,
   reorganization, or legacy multi-transaction record, keep the bot paused and
   reconcile allowances, wallet balances, OpenOracle holder balances, and the current
   reporter manually. For inter-reader disagreement, preserve the contradictory
   evidence and restore a trustworthy agreeing quorum before deciding whether manual
   reconciliation is required.
3. For **lifecycle receipt could not be recovered**, inspect the single
   `lifecycleTransactionHashes` value and `lifecycleTargetBlockNumber`. A successful
   call must be in that target block and emit the exact matching lifecycle event.
   A public or private attempt whose absence passes the finality quorum after 12
   canonical descendants is automatically cleared for a fresh retry. Keep the bot paused for
   disagreement or ambiguous evidence; do not authorize a second transaction while
   the recorded attempt remains live.
4. For **stored-state/current-reporter mismatch**, compare the current reporter,
   settlement state, dispute events, and the wallet's OpenOracle WETH/token holder
   balances through independent RPCs. When the bot's authenticated entry transaction
   is immediately followed by one canonical replacement, the bot computes that
   report's exact one-token credit and claims only that amount automatically. If the
   immediate successor cannot be authenticated, its arithmetic does not match the
   durable entry, or the exact credit is unavailable, the bot refuses an aggregate
   withdrawal and keeps the record in recovery. Never attribute the wallet's whole
   OpenOracle balance to this report.
5. For **unexpected residual assets**, use the lifecycle event and OpenOracle
   internal balances to distinguish the position's exact withdrawal from unrelated
   dust or other deposits. Value or unwind any external token exposure, including
   its gas and slippage, before treating manual reconciliation as complete.

After resolving all residual assets, close the recovery record with the dedicated
command. The command requires the same private key as the position, exact typed
report confirmation, evidence, external cost, final WETH/token balances, and either
an independently calculated realized P&amp;L or an explicit declaration that P&amp;L
is unavailable:

```bash
PRIVATE_KEY=0x... bun run reconcile -- --position-file=.state/positions-sepolia.json --report-id=42 --confirm-report-id=42 --evidence='receipts and balance snapshots archived under incident-42' --note='residual REP sold manually; balances checked on all configured read RPCs' --external-cost-eth=0.003 --final-wallet-weth=4.2 --final-wallet-token=85 --pnl-unavailable=true
```

Use `--realized-net-profit-eth=-0.04 --acknowledge-pnl-is-all-in=true` instead of
`--pnl-unavailable=true` only when entry evidence was recovered and the all-in value
can be independently reproduced. Add every OpenOracle or manual-withdrawal receipt
and every external unwind or sale proceed; subtract all entry, lifecycle, and
external gas, fees, slippage, and `--external-cost-eth`. The command records rather
than computes that result. It writes the evidence, costs, final balances, signer,
time, and P&amp;L status
into the owner-only journal before moving the record to `closed`. It never submits
an on-chain transaction and stores no cryptographic signature or independently
verifiable attestation; “signer-key-authorized” means only that the supplied key
derives the position account. Keep the pre-reconciliation backup with the incident
artifacts. There is intentionally no dashboard force-close button.

Escalate unresolved or contradictory evidence to the protocol/operator security
team. Resume unattended entry only after the journal shows `closed`; recovery
states are a safety stop, not an ignorable warning.

The current safety policy permits one non-closed durable position at a time. This is
separate from the per-position and total-locked WETH limits; it prevents a second
entry from depending on wallet inventory already committed to recovery.

## Operational limitations

- CEX evidence depends on each configured CCXT exchange's public symbol catalog,
  timestamps, rate limits, maintenance behavior, and order-book quality. The unified
  API normalizes access but cannot make exchange-specific data semantics identical.
- Explicit operator-configured DEX sources use constant-product V2 pair semantics.
  Dynamic authenticated arbitrager discovery and execution supports V2, V3, and V4,
  but there is intentionally no claimed universal configurable V3/V4 adapter schema.
- Ethereum mainnet and Sepolia WETH/token games using standard Uniswap V3 fee tiers
  and exact-transfer ERC-20s are supported. Mainnet can additionally execute through
	  authenticated Uniswap V2 Router02 when `deployment.uniswapV2Router` is configured.
	  Both networks can execute through authenticated Uniswap V4 PoolManager and Quoter
	  contracts when `deployment.uniswapV4PoolManager` and
	  `deployment.uniswapV4Quoter` are configured, but only against standard-fee,
  hookless native-ETH/token pools. V3 remains the reference/TWAP safety anchor.
  Identities remain operator-supplied, but
  live mode authenticates every address and runtime bytecode hash against the
  reviewed deployment manifest through at least two available read RPCs. Every
  available authentication result must agree; the manifest itself remains an
  operator trust root.
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized
  execution.
- Live execution uses the exact read-quorum rule above at one canonical block:
  only retryable transport failures omit a reader, at least two readers must
  respond, and every response must agree exactly. Signed entry values come from
  that agreed snapshot, and an
  on-chain guard binds entry and lifecycle executor calls to its exact parent hash. This
  catches disagreement; it does not help when all
  endpoints share the same compromised upstream, implementation bug, or correlated
  failure. Use independently operated providers.
- Private and public entry each send only the atomic hedge-and-dispute executor call
  and therefore require existing ERC-20 allowances. Both lifecycle delivery modes
  use one parent-bound executor call and require existing OpenOracle internal
  allowances.
- Private delivery reduces public-mempool exposure but does not guarantee
  confidentiality, inclusion, fair ordering, or relay/builder behavior. Configuring
  multiple relays shares the signed payload with every listed operator.
- Approved-coordinator reports are reread from a fixed block whenever a new head is
  processed. A retained block hash is checked on every poll; a deeper reorganization
  stops execution and requires restart. Coordinator-free diagnostic mode separately
  replays a 12-block event overlap. Operators still need independent alerting.
- Continuous mode retries transient poll failures with bounded exponential backoff.
  The dashboard exposes per-endpoint health and the latest error, `/healthz` supports
  container supervision, and Compose restarts an unexpectedly exited process.
  Production operation still requires external alerts.
- Every public transaction and private entry bundle targets one block. The bot waits
  12 canonical descendants before quorum-confirmed receipt absence can finalize it as
  `expired-not-included`.
  Disagreement or a successful receipt without the matching executor event remains
  fail-closed. A quorum-confirmed reverted atomic entry closes after recording its
  gas. A lifecycle attempt in either delivery mode proven absent after the same
  window is cleared
  and rebuilt against a fresh parent rather than replaying its signed transaction.
- The owner-only position journal is written immediately before entry and lifecycle
  submission and recovered on restart. A pending entry advances only after every
  recorded bundle receipt, mined gas price, canonical receipt-block hash, and
  executor event agree; a lifecycle attempt realizes profit and releases risk only
  after its canonical receipt and exact executor event agree and at least two
  available read RPCs serve the same twelfth-descendant block hash. Insufficient, lagging, or
  inconsistent evidence fails closed under the recovery runbook above.
- No automated trading system can guarantee that users never lose money. Reorgs,
  correlated RPC lies, relay/builder faults, base-fee spikes, malicious or rebasing
  tokens, OpenOracle/Uniswap defects, compromised keys, and market movement can
  still cause loss. Start on Sepolia, use a dedicated low-balance wallet, set small
  risk limits, and supervise every live position.
- A profitable dry-run observation is not production approval. Before enabling
  execution, verify the current pools, relay simulations, inventory, risk limits,
  deployment manifest, settlement path, and recovery procedure with a low-value
  rehearsal.
