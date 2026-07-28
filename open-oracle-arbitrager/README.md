# OpenOracle arbitrager

The OpenOracle arbitrager monitors active Ethereum WETH/token games, compares their
locked exchange against executable Uniswap V3 quotes, and identifies disputes whose
modeled hedge remains profitable after OpenOracle fees and gas. It includes a local
operator dashboard for live state, strategy controls, wallet inventory, submitted
disputes, transaction delivery, and ETH-denominated profit tracking.

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
window, the bot either settles the final report or detects that a later reporter
replaced it, withdraws the wallet's OpenOracle balances, and closes its durable
position record only after canonical receipts and exact asset recovery agree.

The wallet must approve the executor before it can pull WETH and the report token.
Private delivery can include those wallet-to-executor approvals in the entry bundle;
public delivery requires them before the opportunity appears. During
`hedgeAndDispute`, the executor grants separate, exact temporary allowances to the
authenticated Uniswap router and OpenOracle, then clears them before returning. See
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
  - ETH for the atomic approval/dispute bundle.
  - WETH for the total executor funding shown in the dashboard.
  - The configured token (REPv2, fork REP, or another ERC-20) for the total
    executor funding shown in the dashboard.
- For private delivery, at least one Flashbots-compatible bundle relay. Private
  mode can bundle missing approvals with the atomic executor call. Public delivery
  sends the single atomic executor transaction directly to every configured public
  RPC and is eligible only when the required executor allowances already exist.
- External process supervision, endpoint health alerts, and a procedure for any
  position shown as **recovery-required**. The bot automatically settles or detects
  replacement, withdraws balances through the configured private or public delivery
  mode, and verifies exact asset recovery before classifying P&amp;L as realized.

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
`uniswap-quoter`, `uniswap-router`, `executor`, `coordinator`, and `token`.
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

Private bundle delivery is the default. To simulate and send the ordered approvals
and dispute to multiple bundle relays:

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
4. Uses exact-input and exact-output QuoterV2 calls to model both directions.
5. Derives the same replacement swap side as the OpenOracle contract.
6. Calculates the exact WETH and token contributions and checks wallet inventory.
7. Applies the absolute-profit and basis-point thresholds.
8. Requires independent RPCs to return one exact block hash and the same pool state,
   two hedge quotes, replacement quote, gas basis, balances, allowances, nonce, and
   OpenOracle state hash before deriving or signing any transaction.
9. Uses the quorum-confirmed executor allowances to create the minimum ordered transaction list:
   optional zero-reset/approval transactions followed by one atomic executor call.
10. In private mode, signs consecutive nonces, simulates the entire ordered list with
    `eth_callBundle`, requires the configured number of successful simulations,
    includes an on-chain exact-parent-hash guard, and re-applies the profit threshold
    to the largest successful simulation gas usage. In public mode, refuses the
    opportunity unless allowances are already sufficient and simulates one atomic
    executor call.
11. Sends the all-or-nothing target-block bundle only to relays that successfully
    simulated it, or fans the identical single public transaction to every configured
    public RPC. No reverting transaction hashes are allowed.
12. Writes a durable pending-entry record before submission. After inclusion, it
    verifies every bundle receipt and its required effective gas price against the
    independently confirmed canonical target-block hash, decodes the executor’s
    actual hedge event, records every entry transaction hash and actual bundle gas,
    and only then allows the position to progress as confirmed.
13. On later blocks, automatically settles when eligible or detects replacement,
    then withdraws WETH and token balances. Private mode bundles the lifecycle;
    public mode journals all signed hashes before sequential settlement/withdrawal
    and verifies every receipt independently. It records realized P&amp;L only when
    actual withdrawals exactly match the hedge-neutral expected inventory. Any
    mismatch stops new execution and remains `recovery-required`.

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
  `(callbackGasLimit + 1,050,000) × gas price` in public mode or
  `(callbackGasLimit + 1,100,000) × gas price` in private mode. The private
  projection includes its separate 50,000-gas canonical-parent guard.

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
  withdrawals, state, and realized net P&amp;L. A staged entry shows **Awaiting entry
  evidence** and is excluded from actual P&amp;L totals until receipt and executor-event
  quorum succeeds. A lifecycle attempt is likewise excluded while any receipt is
  ambiguous. Realized totals include only closed positions whose expected inventory
  fully reconciled or whose manual reconciliation explicitly records P&amp;L.
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
modeled net profit, profit before gas, and tracked net profit in ETH. Actual gas
includes every approval and executor transaction in a confirmed private bundle.
Private submissions request atomic inclusion and provide no allowed reverting
hashes, so a compliant relay/builder omits the entire bundle when a step would
revert. An unincluded bundle consumes no on-chain gas. An anomalous partial,
independent, or reverted inclusion can consume gas; the bot records those receipts
in its in-memory transaction lifecycle but does not create confirmed execution
history. Public execution records the single executor transaction and its actual
gas through the same durable position and history accounting.

Execution startup verifies that the history destination is writable. If persistence
later fails after a confirmed dispute, the record remains visible in memory, further
execution is blocked, and the bot retries the queued write on later polls. An append
is acknowledged only after the file and parent directory have been synchronized.
A malformed or torn non-empty JSONL record stops startup with its line number
instead of being silently omitted from revenue or gas totals.

Position profit is tracked in ETH using the exact 1 WETH = 1 ETH unwrap relationship:

```text
sell-token hedged P&L before gas = actual WETH out − old report WETH − WETH fees
buy-token hedged P&L before gas = old report WETH − actual WETH in
open hedged net = hedged P&L before gas − actual entry gas − lifecycle gas so far
realized net = hedged P&L before gas − actual entry gas − actual lifecycle gas
```

The old confirmed-submission table keeps quote-time modeled and tracked values for
diagnostics. They are not realized P&amp;L. After entry receipt quorum, the durable
position table derives hedge economics from the executor event and includes mined
entry and lifecycle gas. Before that quorum, staged quote values remain recovery
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

Market discovery checks all Uniswap V3 fee tiers (`0.01%`, `0.05%`, `0.3%`, and
`1%`) plus mainnet Uniswap V2 and SushiSwap V2 WETH pairs. For V3, “Liquidity” is
the pool contract’s raw in-range `liquidity()` value; for constant-product venues it
shows both token reserves. Neither is a token-denominated TVL or a promise that the
full game size can execute without price impact. “Price” is the decimal-normalized
WETH-per-token spot price derived from V3 `sqrtPriceX96` or V2 reserves; it is not
an executable size-aware quote. Strategy execution remains limited to Uniswap V3
pools that also pass the executable QuoterV2 and spot/TWAP guards.

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
next-block inclusion. Public lifecycle transactions are journaled together but
broadcast and confirmed sequentially, potentially across multiple blocks.

Private mode signs approvals and the executor call at consecutive nonces, requests
`eth_callBundle` from every configured relay, and then fans the same ordered
target-block transaction list only to relays whose simulation passed. The payload omits
`revertingTxHashes`, so any reverted transaction invalidates the complete bundle.
The executor call, and the first transaction in every lifecycle bundle, require
`blockhash(parent)` to equal the independently agreed quote-block hash. A relay or
builder using a different same-height parent therefore simulates or executes a
revert, invalidating the atomic bundle. Immediately before journaling and delivery,
all read RPCs must still agree on both the parent height and hash.
The configured number of relays must successfully simulate the bundle, and at least
one of those relays must accept submission, or delivery fails closed. Configured
endpoints must implement the
[Flashbots bundle RPC](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint)
and authentication format.

The transaction tracker records each approval and executor call as `submitting`,
`pending`, `confirmation unknown`, `confirmed`, `reverted`, or `submission failed`.
It shows which targets accepted or rejected the payload. A private bundle targets
only the next block and is not resubmitted from a stale quote. After that target
block, absent, unsuccessful, or disagreeing receipt evidence leaves the journaled
attempt pending or `recovery-required`. Later scans attempt only independent receipt
recovery, and the one-nonclosed-position guard prevents a new position until normal
or manual reconciliation closes the attempt. Public lifecycle transactions are
journaled as one recovery attempt but may land in consecutive blocks. Active
transaction-tracker rows are kept in process memory and reset on
restart; confirmed dispute history and its ETH profit totals are persisted in the
configured history file.

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
| `--deployment-manifest` | none | Reviewed chain/address/role/runtime-code-hash trust root. Required in execution mode. |
| `--quorum-rpc-url` | none | Independent read RPC. Repeat as needed; at least one secondary is required in execution mode. |
| `--coordinator-address` | none | Restart-time approved `OpenOraclePriceCoordinator`. Repeat as needed. Execution requires at least one and verifies each coordinator's immutable template against the configured OpenOracle and WETH. The comma-separated `OPEN_ORACLE_COORDINATOR_ADDRESSES` environment variable is also accepted. |
| `--lookback-blocks` | `50000` | Initial event-log search range. Choose a start range that covers every potentially active report. |
| `--ui-port` | `4173` | Local dashboard port. |
| `--history-file` | Network-specific JSONL | Persistent confirmed-submission history. |
| `--position-file` | Network-specific JSON | Recovery-critical durable positions, entry/lifecycle bundle hashes, and lifecycle pre-state. Keep overrides separate by chain and signer. |
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
pending-entry → open → withdrawing → closed
     │           │          │
     └───────────┴──────────┴──→ recovery-required
                                      ↓ signer-key-authorized local reconciliation
                                    closed (P&L recorded or unavailable)
```

The bot records every entry transaction hash before submission. Private approvals
and entry must all succeed in one target block and in journal order; public entry
has one guarded executor transaction. After a restart the bot requires independent
RPC agreement on every required receipt and on that receipt block's current
canonical hash. Every receipt must include its mined effective gas price. The bot
then decodes the executor event and reconstructs actual entry gas and hedge
economics before leaving `pending-entry`. Missing or ambiguous evidence remains
`recovery-required` and never produces realized P&amp;L.

Before lifecycle delivery, the bot atomically records every
settlement/withdrawal transaction hash, token decimals, and the wallet's raw WETH
and token balances at the quoted block. Private mode also records its next-block
target; every private lifecycle receipt must succeed in that one canonical block.
Public mode records `lifecycleTargetBlockNumber` as `0`, meaning there is no single
target block, and accepts sequential successful receipts across blocks. Its
canonical post-state snapshot is the latest successful receipt block. After a
restart the bot reconstructs lifecycle gas and exact withdrawal deltas and closes
the position only when those deltas match the hedge-neutral expected inventory.

### `recovery-required` runbook

Stop new entries and preserve the position journal before investigating. Do not
delete or hand-edit a record to bypass the one-position guard.

1. Confirm the dashboard network, signer address, OpenOracle, executor, and token
   match the journal record. Save a copy of the journal, operation log, relay
   responses, and both configured RPC responses.
2. For **entry receipt could not be recovered**, look up every
   `entryTransactionHashes` value on independent explorers/RPCs. All approvals and
   the executor transaction must either be absent, or succeed in one block in
   journal order. If evidence is temporarily unavailable, restore independent RPC
   service and restart; the bot retries quorum recovery. If inclusion is partial,
   reverted, reorged, or the executor event identity differs, keep the bot paused
   and reconcile allowances, wallet balances, OpenOracle holder balances, and the
   current reporter manually.
3. For **lifecycle receipt could not be recovered**, inspect every
   `lifecycleTransactionHashes` value and `lifecycleTargetBlockNumber`. For a
   private attempt, restart only after independent RPCs can return the same
   successful receipts in its recorded canonical target block; never send a second
   settlement/withdrawal bundle while inclusion is ambiguous. For a public attempt,
   the target value is `0`: the bot requires every recorded transaction to have a
   successful canonical receipt and uses the latest receipt block for post-state.
   A crash after only part of the sequential public lifecycle does not rebroadcast
   the remaining signed transactions. Keep the bot paused and manually reconcile
   settlement state, holder balances, wallet balances, missing transactions, and
   gas before authorizing any recovery transaction.
4. For **stored-state/current-reporter mismatch**, compare the current reporter,
   settlement state, and the wallet's OpenOracle WETH/token holder balances through
   independent RPCs. A later dispute can legitimately replace the bot; withdraw
   only balances demonstrably owned by the configured signer.
5. For **unexpected withdrawal assets**, compare the journal's raw
   `lifecycleWalletWethBefore` and `lifecycleWalletTokenBefore` values with the
   canonical post-lifecycle block. Value or unwind any residual token exposure
   outside this bot, including its gas and slippage, before treating the position
   as economically reconciled.

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
  --note='residual REP sold manually; balances checked on two RPCs' \
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
  and exact-transfer ERC-20s are supported. Identities remain operator-supplied, but
  live mode authenticates every address and runtime bytecode hash against the
  reviewed deployment manifest through every read RPC. The manifest itself remains
  an operator trust root.
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized
  execution.
- Live execution requires exact agreement from at least two configured read RPCs at
  one canonical block. Signed entry values come from that agreed snapshot, and an
  on-chain guard binds entry and lifecycle bundles to its exact parent hash. This
  catches disagreement; it does not help when all
  endpoints share the same compromised upstream, implementation bug, or correlated
  failure. Use independently operated providers.
- Private entry bundles atomically apply required approvals, hedge, and dispute.
  Public entry sends only the atomic hedge-and-dispute executor call and therefore
  requires existing allowances. A later private lifecycle bundle or journaled
  sequential public lifecycle settles and withdraws expected inventory. The bot
  does not automatically trade unexpected residual assets; it fails closed as
  `recovery-required`.
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
- A private entry bundle targets one block and receives one complete-inclusion check
  after that block. Missing, disagreeing, or unsuccessful receipts leave the
  already-journaled attempt pending or `recovery-required`. Later scans only retry
  independent receipt recovery; they do not submit the recorded entry or lifecycle
  bundle a second time.
- The owner-only position journal is written immediately before entry and lifecycle
  submission and recovered on restart. A pending entry advances only after every
  recorded bundle receipt, mined gas price, canonical receipt-block hash, and
  executor event agree; a lifecycle attempt closes only after its receipts,
  canonical post-state, and balance deltas agree. Unavailable evidence fails
  closed under the recovery runbook above.
- No automated trading system can guarantee that users never lose money. Reorgs,
  correlated RPC lies, relay/builder faults, base-fee spikes, malicious or rebasing
  tokens, OpenOracle/Uniswap defects, compromised keys, and market movement can
  still cause loss. Start on Sepolia, use a dedicated low-balance wallet, set small
  risk limits, and supervise every live position.
- A profitable dry-run observation is not production approval. Before enabling
  execution, verify the current pools, relay simulations, inventory, risk limits,
  deployment manifest, settlement path, and recovery procedure with a low-value
  rehearsal.
