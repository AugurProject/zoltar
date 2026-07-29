# OpenOracle arbitrager

The OpenOracle arbitrager monitors active Ethereum WETH/token games, compares their
locked exchange against executable Uniswap V2, V3, or hookless V4 quotes, and identifies disputes whose
modeled hedge remains profitable after OpenOracle fees and gas. It includes a local
operator dashboard for live state, strategy controls, wallet inventory, submitted
disputes, transaction delivery, and ETH-denominated profit tracking.

The rendered [operator guide](./documentation.html) explains the UI and CLI,
execution math, exchange support, recovery states, and includes populated dashboard
screenshots. When the dashboard is running, select **Operator guide** or open
`http://127.0.0.1:4173/documentation` (using the configured UI port).

Dry-run is the default. The bot cannot submit a transaction unless it is explicitly
started with `--execute` and has a signer supplied through `PRIVATE_KEY`, saved
restart settings, or the local dashboard when `--ui` is enabled.

> **Live execution is experimental.** Mainnet commands below are operator
> references, not production approval. Rehearse on Sepolia with a dedicated
> low-balance key, validate current executable liquidity, and supervise every
> position; no automated strategy can guarantee a profit or prevent every loss.
> The protocol security model records the
> [latest pinned market fixture](../docs/security-model.html#open-oracle-market-fixture)
> as dated historical evidence.

## How the flow works

A Zoltar `OpenOraclePriceCoordinator` creates an OpenOracle report, also called a
game, that locks WETH and another ERC-20 at the current reporter's proposed exchange
rate. The arbitrager wallet compares that rate with executable Uniswap liquidity.
When the replacement report can be hedged profitably, the wallet calls the stateless
executor, which swaps the required inventory atomically and submits the OpenOracle
dispute while preserving the wallet as the replacement reporter. After the dispute
window, the bot settles the final report, withdraws the position's exact OpenOracle
balances, and closes its durable position record only after canonical receipts and
exact asset recovery agree through 12 canonical descendants and every configured
read RPC serves the same twelfth-descendant block hash. If a later reporter replaces
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
transaction. See
[OpenOracle integration](../docs/open-oracle-integration.html) for the protocol
report lifecycle and economics.

## Requirements

- Bun and this monorepo's frozen dependencies.
- An RPC endpoint for Ethereum mainnet or Sepolia. An archive-capable endpoint is recommended when
  `--lookback-blocks` reaches beyond the provider's retained log history.
- The deployed OpenOracle contract address.
- At least one reviewed Zoltar `OpenOraclePriceCoordinator` address. Supply repeated
  `--coordinator-address` flags or the comma-separated
  `OPEN_ORACLE_COORDINATOR_ADDRESSES` environment variable for every coordinator
  whose games this wallet may dispute; execution is fail-closed without either.
- A deployed `OpenOracleArbitrageExecutor`. Deploy the stateless executor once per
  network with `./open-oracle-arbitrager/deploy-executor`, then pass the printed
  address through `--executor-address` whenever execution mode is enabled.
- The exact Uniswap V3 SwapRouter address supplied with `--uniswap-router`.
- Optionally, the exact Uniswap V2 Router02 supplied with
  `--uniswap-v2-router`. When configured and authenticated, mainnet execution
  adds direct WETH/token V2 hedges to the configured venue comparison.
- Optionally, an exact Uniswap V4 PoolManager and V4 Quoter supplied together with
  `--uniswap-v4-pool-manager` and `--uniswap-v4-quoter`. V4 execution is limited to
  direct native-ETH/token pools at the standard fee/tick-spacing pairs with no hook.
  The executor converts ETH and WETH one-for-one inside the atomic entry.
- A reviewed `--deployment-manifest` that pins chain, role, address, and runtime
  bytecode hash for every contract and executable token. Every read RPC authenticates
  every manifest entry before the bot can sign.
- At least two independently operated read RPCs: the primary `--rpc-url` plus one or
  more repeated `--quorum-rpc-url` values. Live execution requires exact
  quote-block agreement on OpenOracle state, pool state, quotes, confirmed nonce,
  and balances, plus exact agreement on the pending nonce actually signed. A
  legitimate pending transaction visible to only one provider blocks signing until
  the providers converge or the operator resolves it.
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

Do not use a key that controls unrelated protocol or treasury funds. The dashboard
binds to `127.0.0.1`, but the execution key still lives in the bot process and must be
protected like any hot wallet.

## End-user readiness backlog

The repository implementation is a guarded operator tool, not yet a supported
retail release. Complete these items before declaring or packaging a supported
end-user release. The commands below remain experimental operator references:

1. Publish separate, reviewed mainnet and Sepolia **execution manifests** containing
   the deployed executor, OpenOracle, approved coordinators, router, factory,
   quoter, WETH, and executable tokens with runtime bytecode hashes. The protocol
   address manifest in `docs/mainnet-deployment-addresses.json` is not a substitute
   for this bot trust root.
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

From the monorepo root:

```bash
bun install --frozen-lockfile
```

Run the executable directly from the monorepo:

```bash
./open-oracle-arbitrager/run --help
```

## Monitor without trading

Run one scan:

```bash
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --coordinator-address=0xYourPriceCoordinator \
  --lookback-blocks=50000 \
  --once
```

Run continuously with the local dashboard:

```bash
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --coordinator-address=0xYourPriceCoordinator \
  --ui
```

Then open `http://127.0.0.1:4173`. Dry-run opportunities are evaluated exactly like
execution opportunities, but no approvals or disputes are sent. Without an approved
coordinator, dry-run still synchronizes a bounded sample for diagnostics but refuses
to classify any report as an executable opportunity.

Every startup and dashboard RPC change calls `eth_chainId`. The bot refuses to start
or apply a change unless the read RPC and every public-submission RPC report the
selected network. It also checks the chain before every scan.

Startup enters **Syncing** while the bot scans the configured historical lookback in
100-block chunks. The deliberately bounded response size prevents permissionless
OpenOracle event volume from turning one historical RPC response into an unbounded
memory spike. Once caught up, it polls the latest head and covers every unseen
height in the OpenOracle event-log query; if several blocks arrive between polls, no
event-log height is skipped. Opportunity evaluation and pool sampling run once at
the newest observed head, not once at every intermediate historical height. A
12-block overlap is re-read and reconciled for shallow reorgs in event-derived
report state. With no new head the bot remains **Running** without re-evaluating or
writing duplicate price samples.

### Data freshness and retention

Startup lookback backfills OpenOracle events, but it does not backfill historical
pool prices. The append-only price file can retain a sample from a block displaced
by a reorg; the 12-block reconciliation applies only to report events. The dashboard
loads and charts the latest 2,000 valid price records. Approved-coordinator report
paths are reconstructed in memory from the startup lookback plus events observed by
the current process. Consequently a path can begin at a dispute when its submission
predates the lookback, and a settlement-only report is not shown when no earlier
event for that report was observed. For each active report, the scanner retains one
pre-overlap state anchor plus every event in the 12-block reorg window; older dispute
steps are compacted instead of replayed forever. Settled paths remain through that
reorg window and are then removed from the live scanner; confirmed transaction
history remains in the execution history file. Unapproved reports are not retained
in the execution cache. In diagnostic mode without configured coordinators, at most
256 reports and 64 permissionlessly observed tokens are retained so event spam
cannot create ever-growing per-block work. Increase `--lookback-blocks` when
complete active-game context is operationally important.

## Run on Sepolia

Sepolia uses the canonical Sepolia WETH9, Uniswap V3 factory, and QuoterV2 defaults.
There is no canonical REP deployment, so the REP and OpenOracle addresses must be
supplied explicitly:

```bash
./open-oracle-arbitrager/run \
  --network=sepolia \
  --rpc-url=https://your-sepolia-rpc.example \
  --public-rpc-url=https://your-sepolia-rpc.example \
  --rep-address=0xYourSepoliaRep \
  --open-oracle=0xYourSepoliaOpenOracle \
  --coordinator-address=0xYourSepoliaPriceCoordinator \
  --ui
```

Only use addresses deployed for the same Sepolia test environment. Override
`--weth-address`, `--uniswap-factory`, or `--uniswap-quoter` when the test deployment
uses noncanonical contracts. The selected network cannot be changed in the
dashboard; restart with a different `--network` so cached reports, transaction
and contract identities cannot cross networks. The network-specific default history
paths also isolate records; when overriding `--history-file`, use a different file
for every network because records do not contain a chain ID and a shared file would
combine rows and profit totals.

## Execute disputes

Deploy the stateless executor from the same selected network:

```bash
PRIVATE_KEY=0xYourDeploymentPrivateKey \
ETH_RPC_URL=https://your-private-mainnet-rpc.example \
  ./open-oracle-arbitrager/deploy-executor --network=mainnet
```

### Executor ABI source

The bot's executor ABI is generated from
`solidity/artifacts/Contracts.json`. Never edit
`executor-abi.generated.ts` directly. After compiling an executor contract change,
run `bun run generate:open-oracle-arbitrager-abi`, review the generated diff, and
verify freshness with `bun run check:open-oracle-arbitrager-abi`. The remaining
minimal ABIs in `abi.ts` are maintained separately and checked against compiled
artifacts by `abi.test.ts`.

Verify the deployment address independently, then start an inventory-funded
execution process:

```bash
PRIVATE_KEY=0xYourDedicatedPrivateKey \
ETH_RPC_URL=https://your-private-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --coordinator-address=0xYourPriceCoordinator \
  --executor-address=0xYourExecutor \
  --uniswap-router=0xYourUniswapV3SwapRouter \
  --deployment-manifest=/secure/operator/mainnet-deployments.json \
  --quorum-rpc-url=https://your-independent-mainnet-rpc.example \
  --relay-url=https://relay.flashbots.net \
  --execute \
  --ui
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

The schema is `execution-manifest.schema.json`. Generate hashes from one endpoint
and verify the resulting file through a separately operated endpoint:

The parser and schema bind `mainnet` to chain ID `1` and `sepolia` to chain ID
`11155111`; a contradictory network/chain pair is rejected before any RPC result
can verify the file.

```bash
./open-oracle-arbitrager/execution-manifest generate \
  --network=sepolia \
  --rpc-url=https://first-provider.example \
  --contract=executor:0x... \
  --contract=open-oracle:0x... \
  --output=/secure/operator/sepolia-deployments.json

./open-oracle-arbitrager/execution-manifest verify \
  --rpc-url=https://independent-provider.example \
  --manifest=/secure/operator/sepolia-deployments.json
```

`execution-manifest.example.json` is deliberately placeholder-only and must never
be used as an execution trust root.

Execution remains fixed for the lifetime of the process. It cannot be enabled from
the dashboard. When `--execute --ui` starts without `PRIVATE_KEY` or a remembered
signer, it remains locked until a key is set in the local dashboard. Signer set/clear
changes apply at the next unpaused scan boundary; they do not interrupt the current
scan or confirmation wait, and clearing a signer cannot cancel a transaction already
broadcast. Restarting the command is required to change between dry-run and
execution.

Private bundle delivery is the default. To simulate and send the single guarded
dispute transaction to multiple bundle relays:

```bash
PRIVATE_KEY=0xYourDedicatedPrivateKey \
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --coordinator-address=0xYourPriceCoordinator \
  --executor-address=0xYourExecutor \
  --uniswap-router=0xYourUniswapV3SwapRouter \
  --deployment-manifest=/secure/operator/mainnet-deployments.json \
  --quorum-rpc-url=https://your-independent-mainnet-rpc.example \
  --execute \
  --submission-mode=private \
  --relay-url=https://relay.flashbots.net \
  --relay-url=https://your-second-relay.example \
  --ui
```

Execution supports **Private relays** and **Public mempool** delivery. Private mode
requires at least one relay and supports up to eight. The configurable successful
simulation threshold determines how many relays must validate the exact complete
bundle; submission is sent only to those successful relays. A broken optional relay
therefore cannot disable trading unless the configured threshold requires it.
Startup and dashboard updates probe every private relay with `eth_chainId`, then
send intentionally invalid `eth_callBundle` and `eth_sendBundle` requests. A
compatible relay returns method-specific authentication or parameter errors; a
same-chain ordinary RPC returning unsupported-method errors is rejected and shown
as a failed relay. Ambiguous, successful, or malformed probe responses are rejected
too. Non-successful HTTP responses are rejected regardless of their body.
No transaction is signed or submitted by this capability check. The configuration
is also rejected when a relay is unreachable or reports the wrong selected network.
Relay URLs changed in the dashboard are saved in the network-specific operator
settings file. Startup `--relay-url` values remain process overrides until a
dashboard save. Relay URLs are never written to the transaction-history file. URLs
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
    amounts, remains canonical through 12 descendants, and every configured read RPC
    serves the same twelfth-descendant block hash. Before that point the position is
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
and the atomic hedge. The branch formulas and event fields are canonicalized in the
[Operator Reference](../docs/operator-reference.md#support-module-inventory).

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
cast send 0xWETH \
  "approve(address,uint256)" \
  0xExecutor \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xReportToken \
  "approve(address,uint256)" \
  0xExecutor \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle \
  "approveInternal(address,address,uint256)" \
  0xExecutor 0xWETH \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"

cast send 0xOpenOracle \
  "approveInternal(address,address,uint256)" \
  0xExecutor 0xReportToken \
  0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff \
  --private-key "$PRIVATE_KEY" --rpc-url "$ETH_RPC_URL"
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
  (`--max-hedge-slippage-bps`).
- The larger of `--lifecycle-gas-reserve-weth` and
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

Start with `--ui` and optionally choose another local port:

```bash
./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --ui \
  --ui-port=4180
```

The dashboard shows:

- Bot mode, **Syncing**, **Running**, **Paused**, **Error**, or **Stopped** status, latest block,
  block age relative to the operator computer, errors, and active-report count.
- Selected network, expected chain ID, read/public RPC controls, and endpoint checks.
- A local signer control, connected address, and its ETH/WETH/REP balances.
- ETH, WETH, REP, executable REP value, and estimated portfolio value.
- Native ETH stakes, WETH stakes, and ETH settler rewards locked in active games
  observed within the configured event lookback. The combined figure treats 1 WETH
  as 1 ETH and can undercount games created before that lookback.
- Current opportunities, token-metadata-normalized inventory requirements, deadline
  window, token-specific direction, pool, and decision.
- Durable positions with actual hedge execution, entry and lifecycle gas, exact
  settler reward, withdrawals, state, and realized net P&amp;L. A staged entry shows **Awaiting entry
  evidence** and is excluded from actual P&amp;L totals until receipt and executor-event
  quorum succeeds. A lifecycle attempt is likewise excluded while any receipt is
  ambiguous. `closed-pending-finality` retains its risk slot and does not contribute
  realized profit until every configured read RPC serves the same
  twelfth-descendant block hash for its exact lifecycle evidence. Realized totals
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
- The submitted/disputed/settled events observed for each OpenOracle report,
  including blocks, reporters, raw locked amounts, and transaction links. See
  [data freshness and retention](#data-freshness-and-retention) for lookback limits.
- A per-asset current-head price-history chart with one series per supported pool,
  axes, point tooltips, and a recent exact-value table. Samples persist across
  restarts, subject to the retention and reorg limits above.
- A 500-entry in-memory operations journal. The dashboard hides routine scan entries
  and shows decisions, configuration changes, transaction states, and the reason for
  each action.

The UI is intentionally local-only. A private key entered there is sent only to the
loopback bot process over HTTP, immediately cleared from the input, and never echoed
by the API or written to logs or transaction history. It is kept in memory unless
**Save this new key in plaintext for future restarts** is selected. That explicit
choice stores the key in the owner-only operator settings file; protect the host,
backups, and settings path as wallet credentials. **Forget saved key** atomically
removes only the restart credential while retaining the active in-memory signer.
**Clear signer & saved key** removes both the active signer and any saved restart credential.
The status names the active address and, when different, the address that a future
restart will use. Setting a different memory-only key preserves an existing restart
key until **Forget saved key** or **Clear signer & saved key** is used. Mutable API requests
require same-origin JSON and the fixed loopback host authority. Do not reverse-proxy
or expose the dashboard to a network without adding authentication and transport
security.

## Persistent operator settings

Dashboard changes to strategy, read/public RPCs, delivery mode, relay URLs and
relay-success threshold, the
token list, and the pause state are atomically saved after validation and restored on restart. Mainnet
and Sepolia use separate files by default:

```text
.open-oracle-arbitrager/settings-mainnet.json
.open-oracle-arbitrager/settings-sepolia.json
```

Override the destination with `--settings-file=/secure/operator/settings.json`.
The containing directory is created with owner-only permissions when possible, and
every replacement settings file is mode `0600`. File contents and the containing
directory are synced before a successful save is reported. The default directory is ignored by
Git. A malformed, unsupported, or wrong-network file stops startup instead of
silently reverting to defaults. A runtime write failure rejects the dashboard
mutation and keeps the prior runtime settings active; fix the settings path or
permissions and retry.

Startup resolves values in this order:

| Field | Highest-to-lowest precedence |
| --- | --- |
| Strategy value | Its explicit strategy flag; saved value; built-in default |
| Read RPC | `--rpc-url`; `ETH_RPC_URL`; saved read RPC; network default |
| Public submission RPCs | Repeated `--public-rpc-url`; saved list; selected read RPC |
| Active signer | `PRIVATE_KEY`; saved restart signer; no signer |
| Submission mode | `--submission-mode`; saved mode; `private` |
| Relay URLs | Repeated `--relay-url`; saved list; Flashbots relay |
| Relay simulation threshold | `--minimum-relay-successes`; saved dashboard value; `1` |
| Token list | Repeated `--token-address`; saved list; canonical network REP |
| Pause state | Saved value; `false` |

An environment `PRIVATE_KEY` is never automatically remembered and does not replace
an existing saved restart signer. The dashboard shows active, queued, and restart
addresses independently, and **Forget saved key** removes the disk credential
without changing the environment-backed in-memory signer. Every successful
dashboard mutation writes one complete snapshot of the effective strategy,
connectivity, submission, pause, and persisted-signer settings. This means a CLI or
environment override for a non-secret setting becomes the saved restart value after
any dashboard save. `PRIVATE_KEY` is the exception: it is saved only through the
explicit plaintext opt-in.

Approved coordinator addresses are deliberately restart-time trust roots. They are
not mutable through the dashboard and are not copied into the dashboard settings
file; pass the same reviewed `--coordinator-address` values on every restart or use
`OPEN_ORACLE_COORDINATOR_ADDRESSES`.

Pause blocks new position entry. It deliberately does not block settlement,
replacement recovery, or withdrawal for a position that already has capital at
risk. A submission already started may still finish; pause cannot cancel a signed
bundle or transaction.

## Profit and history semantics

Successful dispute submissions are appended to
`.open-oracle-arbitrager/history-mainnet.jsonl` or
`.open-oracle-arbitrager/history-sepolia.jsonl` by default. Override the location with:

```bash
./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --ui \
  --history-file=/secure/operator/open-oracle-history.jsonl
```

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
repeated with `--token-address=0x...` form the execution allowlist. Explicitly adding
a token is a security decision: the atomic executor still enforces exact transfers,
but it cannot establish the token's issuer, economic value, or pool legitimacy. The
primary `--rep-address` remains the token used in the top-level REP portfolio
summary.

### Uniswap venue execution

Market discovery checks all Uniswap V3 fee tiers (`0.01%`, `0.05%`, `0.3%`, and
`1%`) plus mainnet Uniswap V2 and SushiSwap V2 WETH pairs. For V3, “Liquidity” is
the pool contract’s raw in-range `liquidity()` value; for constant-product venues it
shows both token reserves. Neither is a token-denominated TVL or a promise that the
full game size can execute without price impact. “Price” is the decimal-normalized
WETH-per-token spot price derived from V3 `sqrtPriceX96` or V2 reserves; it is not
an executable size-aware quote. V3 execution uses QuoterV2 and the configured
spot/TWAP guard. When `--uniswap-v2-router` is supplied, mainnet execution also
reads the canonical Uniswap V2 pair reserves at the exact quorum quote block and
evaluates the direct WETH/token route with the standard 0.30% fee:

```text
amount out = amount in × 997 × reserve out
             ÷ (reserve in × 1000 + amount in × 997)

amount in  = floor(reserve in × amount out × 1000
             ÷ ((reserve out − amount out) × 997)) + 1
```

When both V4 flags are supplied, the bot also asks the authenticated V4 Quoter for
exact-input and exact-output quotes against these exact pool keys:

| Fee units | Tick spacing |
| --- | --- |
| `100` | `1` |
| `500` | `10` |
| `3000` | `60` |
| `10000` | `200` |

Every supported key has `currency0 = native ETH`, `currency1 = report token`, and
`hooks = address(0)`. The exact swap amount must be no greater than
`2^127 - 1` atomic units so every PoolManager delta fits a signed `int128`.
For a buy, `zeroForOne = true`: the requested exact token output and returned token
delta are positive, while the native input delta is negative and cannot exceed the
signed maximum WETH input. For a sell, `zeroForOne = false`: the requested exact
token input and returned token delta are negative, while the native output delta is
positive and cannot fall below the signed minimum WETH output.

Every read RPC must return the same quote at the exact quorum block. The executor
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

Price samples are stored in
`.open-oracle-arbitrager/prices-mainnet.jsonl` or
`.open-oracle-arbitrager/prices-sepolia.jsonl`. Use
`--price-history-file=/secure/operator/open-oracle-prices.jsonl` to override the
path. Keep files network-specific.

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
execute the value-moving call. Immediately before journaling and delivery, all read
RPCs must still agree on both the parent height and hash.
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
through a 12-block canonical-finality window in either delivery mode. If every read
RPC then agrees that the parent-bound entry executor call was absent, the attempt
becomes `expired-not-included` and releases its risk slot. A quorum-confirmed
reverted atomic entry is terminally closed after recording its gas; it cannot have
changed OpenOracle state. If the atomic lifecycle call was absent, that attempt is
cleared and the open position can safely retry from a fresh parent. Expired hashes
remain in the durable journal and are checked on every poll. If a retained
transaction is later published, its parent guard makes it revert; the bot records
that late gas once, updates the UTC-day gas budget and realized P&amp;L where
applicable, and then removes the archived attempt. An absent hash is also retired
once independent RPCs prove at the finalized height that a later canonical
transaction consumed its nonce, because the retained signature can no longer be
mined. Unexpected successful evidence fails closed. A successful receipt without
the expected executor event or exact durable transaction intent, RPC disagreement,
or ambiguous evidence remains `recovery-required`. Active transaction-tracker rows
are kept in process memory and reset on restart; confirmed dispute history and its
ETH profit totals are persisted in the configured history file.

## Adjust the strategy

Every setting below can be changed in the dashboard and takes effect on the next
scan. The equivalent startup flags are shown below. Defaults apply when neither a
saved value nor a higher-precedence override exists:

| Setting | Default | Flag | Effect |
| --- | ---: | --- | --- |
| Minimum profit | `0.01 WETH` | `--minimum-profit-weth` | Rejects opportunities below an absolute modeled net profit. |
| Minimum return | `100 bps` | `--minimum-profit-bps` | Requires modeled net profit relative to the direction-specific return basis: report WETH plus fees when selling token 2, or exact-output quoted WETH input when buying token 2. |
| Spot/TWAP distance | `100 ticks` | `--max-spot-twap-ticks` | Rejects pools whose current tick is too far from the TWAP. |
| TWAP window | `1800 seconds` | `--twap-seconds` | Controls the Uniswap manipulation-resistance window. Minimum: 60 seconds. |
| Remaining time | `36 seconds` | `--minimum-remaining-seconds` | Inclusion buffer for timestamp-based games. |
| Remaining blocks | `3 blocks` | `--minimum-remaining-blocks` | Inclusion buffer for block-based games. |
| Head poll interval | `1000 ms` | `--poll-ms` | Delay between latest-head checks. Every unseen event-log height is queried; evaluation and pool sampling run once at the newest head. Minimum: 1000 ms. |

Increasing profit thresholds reduces execution frequency. Increasing the TWAP
window or remaining-time buffers is generally more conservative, while decreasing
the maximum Spot/TWAP distance rejects more divergent pools and is more
conservative. Increasing that maximum permits larger Spot/TWAP deviations.
Parameter changes do not disable contract-side deadline, ratio, state-hash,
quote-refresh, simulation, or inventory guards.

Other startup-only options:

| Flag | Default | Purpose |
| --- | ---: | --- |
| `--network` | `mainnet` | Select `mainnet` or `sepolia`; fixes the expected chain ID and address defaults. |
| `--rpc-url` | Network public endpoint | Read RPC. Adjustable in the dashboard only after its chain check passes. |
| `--public-rpc-url` | Read RPC | Public transaction endpoint. Repeat for up to eight; all receive the identical payload. |
| `--rep-address` | Mainnet REP / required on Sepolia | Primary REP token for the portfolio summary and default monitored-token catalog; it does not restrict observed or configured game tokens. |
| `--weth-address` | Network WETH | Override WETH for a custom test deployment. |
| `--uniswap-factory` | Network Uniswap V3 factory | Override the factory for a custom test deployment. |
| `--uniswap-quoter` | Network QuoterV2 | Override the quoter for a custom test deployment. |
| `--executor-address` | none | Deployed atomic executor. Required in execution mode and authenticated against the manifest on every read RPC. |
| `--uniswap-router` | none | SwapRouter used by the atomic hedge. Required and manifest-authenticated in execution mode. |
| `--uniswap-v2-router` | none | Optional mainnet Uniswap V2 Router02. When set, it is manifest-authenticated as `uniswap-v2-router` and joins automatic best-route hedge selection. |
| `--uniswap-v4-pool-manager` | none | Optional V4 PoolManager for direct hookless native-ETH/token hedges. Requires `--uniswap-v4-quoter` and manifest role `uniswap-v4-pool-manager`. |
| `--uniswap-v4-quoter` | none | Optional V4 Quoter for exact-input and exact-output quorum quotes. Requires `--uniswap-v4-pool-manager` and manifest role `uniswap-v4-quoter`. |
| `--deployment-manifest` | none | Reviewed chain/address/role/runtime-code-hash trust root. Required in execution mode. |
| `--quorum-rpc-url` | none | Independent read RPC. Repeat as needed; at least one secondary is required in execution mode. |
| `--coordinator-address` | none | Restart-time approved `OpenOraclePriceCoordinator`. Repeat as needed. Execution requires at least one and verifies each coordinator's immutable template against the configured OpenOracle and WETH. The comma-separated `OPEN_ORACLE_COORDINATOR_ADDRESSES` environment variable is also accepted. |
| `--lookback-blocks` | `50000` | Initial event-log search range. Choose a start range that covers every potentially active report. |
| `--ui-port` | `4173` | Local dashboard port. |
| `--history-file` | Network-specific JSONL | Persistent confirmed-submission history. |
| `--position-file` | Network-specific JSON | Recovery-critical durable positions, entry/lifecycle transaction hashes, and lifecycle intent. Keep overrides separate by chain and signer. |
| `--settings-file` | Network-specific JSON | Persistent dashboard strategy, endpoint, delivery, pause, and opt-in signer settings. |
| `--once` | off | Run one scan and exit. Cannot be combined with `--ui`. |
| `--execute` | off | Enable guarded bundle/executor submission. Requires an executor address, at least one approved coordinator, and `PRIVATE_KEY`, a saved restart signer, or `--ui` so a signer can be supplied locally. |
| `--submission-mode` | `private` | `private` simulates/fans out atomic bundles; `public` submits one atomic entry transaction and requires pre-existing allowances. |
| `--relay-url` | `https://relay.flashbots.net` | Flashbots-compatible bundle relay. Repeat the flag for up to eight relays; adjustable in the dashboard. |
| `--minimum-relay-successes` | `1` | Number of configured private relays that must successfully simulate the exact bundle before submission; adjustable in the dashboard. |
| `--max-hedge-slippage-bps` | `50` | Maximum atomic Uniswap hedge slippage, capped at 1,000 bps. |
| `--lifecycle-gas-reserve-weth` | `0.01` | Minimum modeled reserve for settlement and withdrawal gas. |
| `--max-daily-gas-weth` | `0.05` | Maximum UTC-day recorded gas plus the candidate's mode-specific entry reserve and lifecycle reserve. |
| `--max-position-weth` | `5` | Maximum conservative WETH-equivalent funded notional for one position. |
| `--max-total-locked-weth` | `10` | Maximum stored funded notional across non-closed positions plus the candidate. |

The position notional uses the refreshed required WETH plus required token funding
valued at the higher of the executable hedge quote and signed hedge limit.
Immediately before journal write and delivery, the bot rechecks that notional, the
total of every non-closed durable position, and the UTC-day gas total. Public mode
uses `1,200,000 × gas price` for the candidate entry; private mode uses the largest
gas usage from the successful relay simulations. Both add the lifecycle reserve. A
value equal to a configured cap is allowed; one wei above it is rejected.

Actual gas is assigned to the UTC day of each receipt's quorum-confirmed canonical
block timestamp, not the local time at which the transaction was staged or later
recovered. The durable position stores one dated gas expenditure per confirmed
receipt, and both the execution limit and dashboard use that same ledger.

### Durable position journal

The default journal is `.open-oracle-arbitrager/positions-mainnet.json` or
`.open-oracle-arbitrager/positions-sepolia.json`. Before relay delivery, writes use
an owner-only temporary file, sync its complete contents, atomically rename it, and
sync the parent directory. A malformed journal stops startup rather than discarding
recovery state. Back it up with the settings and history files, never share one
override across networks or execution signers, and preserve it until every position
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
     ├── atomic public/private: after 12 canonical descendants and unanimous absence
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
quorum-confirmed atomic revert closes after gas accounting. Missing or ambiguous
evidence remains `recovery-required` and never produces trading profit. Legacy
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
until all configured read RPCs serve the same twelfth-descendant block hash; it then
realizes profit, or removes provisional withdrawal and gas accounting and reopens
the position if the receipt was reorged out. A lagging or unavailable quorum RPC
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
   match the journal record. Save a copy of the journal, operation log, relay
   responses, and all configured read RPC responses.
2. For **entry receipt could not be recovered**, current records contain one
   `entryTransactionHashes` value. Look it up on independent explorers/RPCs. It must
   be absent, revert without an executor event, or succeed in its parent-bound target
   block with the exact matching event. A quorum-confirmed revert is closed
   automatically after gas accounting. A legacy record can contain multiple hashes;
   inspect every hash and never treat the record as expired merely because its target
   passed. If evidence is temporarily unavailable, restore independent RPC service
   and restart; the bot retries quorum recovery. For a successful mismatched receipt,
   reorganization, disagreement, or legacy multi-transaction record, keep the bot
   paused and reconcile allowances, wallet balances, OpenOracle holder balances, and
   the current reporter manually.
3. For **lifecycle receipt could not be recovered**, inspect the single
   `lifecycleTransactionHashes` value and `lifecycleTargetBlockNumber`. A successful
   call must be in that target block and emit the exact matching lifecycle event.
   A public or private attempt that all RPCs still report absent after 12 canonical
   descendants is automatically cleared for a fresh retry. Keep the bot paused for
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
PRIVATE_KEY=0x... ./open-oracle-arbitrager/reconcile-position \
  --position-file=.open-oracle-arbitrager/positions-sepolia.json \
  --report-id=42 \
  --confirm-report-id=42 \
  --evidence='receipts and balance snapshots archived under incident-42' \
  --note='residual REP sold manually; balances checked on all configured read RPCs' \
  --external-cost-eth=0.003 \
  --final-wallet-weth=4.2 \
  --final-wallet-token=85 \
  --pnl-unavailable=true
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

- Ethereum mainnet and Sepolia WETH/token games using standard Uniswap V3 fee tiers
  and exact-transfer ERC-20s are supported. Mainnet can additionally execute through
  authenticated Uniswap V2 Router02 when `--uniswap-v2-router` is configured.
  Both networks can execute through authenticated Uniswap V4 PoolManager and Quoter
  contracts when both V4 flags are configured, but only against standard-fee,
  hookless native-ETH/token pools. V3 remains the reference/TWAP safety anchor.
  Identities remain operator-supplied, but
  live mode authenticates every address and runtime bytecode hash against the
  reviewed deployment manifest through every read RPC. The manifest itself remains
  an operator trust root.
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized
  execution.
- Live execution requires exact agreement from at least two configured read RPCs at
  one canonical block. Signed entry values come from that agreed snapshot, and an
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
- A 12-block event overlap is replayed whenever a new head is processed to tolerate
  short reorganizations. The retained pre-overlap block hash is checked on every
  poll; a deeper reorganization stops execution and requires restart so the complete
  lookback is rebuilt. Operators still need independent alerting.
- Continuous mode retries transient poll failures. The dashboard exposes the latest
  error, but production operation still requires external process supervision and
  alerts.
- Every public transaction and private entry bundle targets one block. The bot waits
  12 canonical descendants before unanimous receipt absence can finalize it as
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
  after its canonical receipt and exact executor event agree and every read RPC
  serves the same twelfth-descendant block hash. Unavailable, lagging, or
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
