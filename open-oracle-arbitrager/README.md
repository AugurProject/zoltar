# OpenOracle arbitrager

The OpenOracle arbitrager monitors active Ethereum WETH/token games, compares their
locked exchange against executable Uniswap V3 quotes, and identifies disputes whose
modeled hedge remains profitable after OpenOracle fees and gas. It includes a local
operator dashboard for live state, strategy controls, wallet inventory, submitted
disputes, transaction delivery, and ETH-denominated profit tracking.

Dry-run is the default. The bot cannot submit a transaction unless it is explicitly
started with `--execute` and has a signer supplied through `PRIVATE_KEY`, saved
restart settings, or the local dashboard when `--ui` is enabled.

## Requirements

- Bun and this monorepo's frozen dependencies.
- An RPC endpoint for Ethereum mainnet or Sepolia. An archive-capable endpoint is recommended when
  `--lookback-blocks` reaches beyond the provider's retained log history.
- The deployed OpenOracle contract address.
- A deployed `OpenOracleArbitrageExecutor`. Deploy the stateless executor once per
  network with `./open-oracle-arbitrager/deploy-executor`, then pass the printed
  address through `--executor-address` whenever execution mode is enabled.
- For execution, a dedicated key on the selected network with:
  - ETH for the atomic approval/dispute bundle.
  - WETH for the token-1 contribution shown in the dashboard.
  - The configured token (REPv2, fork REP, or another ERC-20) for the token-2
    contribution shown in the dashboard.
- A Flashbots-compatible bundle relay is recommended. Public-mempool delivery is
  available only when the executor already has sufficient token allowances, so the
  bot can send one transaction without exposing standalone approvals.
- Operational procedures for settlement, OpenOracle withdrawals, and inventory
  rebalancing. This process submits disputes; it does not settle games or perform a
  separate Uniswap hedge.

Do not use a key that controls unrelated protocol or treasury funds. The dashboard
binds to `127.0.0.1`, but the execution key still lives in the bot process and must be
protected like any hot wallet.

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
  --lookback-blocks=50000 \
  --once
```

Run continuously with the local dashboard:

```bash
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --ui
```

Then open `http://127.0.0.1:4173`. Dry-run opportunities are evaluated exactly like
execution opportunities, but no approvals or disputes are sent.

Every startup and dashboard RPC change calls `eth_chainId`. The bot refuses to start
or apply a change unless the read RPC and every public-submission RPC report the
selected network. It also checks the chain before every scan.

Startup enters **Syncing** while the bot scans the configured historical lookback in
10,000-block chunks. Once caught up, it polls the latest head and covers every unseen
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
loads and charts the latest 2,000 valid price records. Report paths are reconstructed
in memory from the startup lookback plus events observed by the current process.
Consequently a path can begin at a dispute when its submission predates the
lookback, and a settlement-only report is not shown when no earlier event for that
report was observed. Increase `--lookback-blocks` when complete historical context
is operationally important.

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

Verify the deployment address independently, then start an inventory-funded
execution process:

```bash
PRIVATE_KEY=0xYourDedicatedPrivateKey \
ETH_RPC_URL=https://your-private-mainnet-rpc.example \
  ./open-oracle-arbitrager/run \
  --open-oracle=0xYourOpenOracle \
  --executor-address=0xYourExecutor \
  --execute \
  --ui
```

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
  --executor-address=0xYourExecutor \
  --execute \
  --submission-mode=private \
  --relay-url=https://relay.flashbots.net \
  --relay-url=https://your-second-relay.example \
  --ui
```

Choose **Public mempool** or **Private relays** in the dashboard to change delivery
for the next scan. Private mode requires at least one relay and supports up to eight.
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

1. Checks that the game is WETH plus a usable token and inside its dispute window.
   In execute mode, token 2 must be an Augur-discovered REP or an address explicitly
   configured by the operator; a permissionlessly observed token is monitor-only.
2. Finds an active Uniswap V3 pool and rejects excessive spot/TWAP deviation.
3. Uses exact-input and exact-output QuoterV2 calls to model both directions.
4. Derives the same replacement swap side as the OpenOracle contract.
5. Calculates the exact WETH and token contributions and checks wallet inventory.
6. Applies the absolute-profit and basis-point thresholds.
7. Refreshes pool state, quotes, gas, deadline, inventory requirements, and the
   OpenOracle state hash before signing any transaction.
8. Reads the executor allowances and creates the minimum ordered transaction list:
   optional zero-reset/approval transactions followed by one executor dispute.
9. In private mode, signs consecutive nonces, simulates the entire ordered list with
   `eth_callBundle` on every configured relay, and re-applies the profit threshold to
   the largest simulated gas usage.
10. Sends the all-or-nothing target-block bundle to every configured relay with
    `eth_sendBundle`. No reverting transaction hashes are allowed.
11. In public mode, refuses execution if any approval is missing; otherwise it
    simulates and broadcasts the single executor transaction.
12. Verifies every bundle receipt was successful in the target block and records
    total mined gas and ETH profitability.

The executor pulls the calculated contribution, verifies exact balance deltas into
itself and OpenOracle, calls `dispute` with the wallet as the recorded disputer,
clears its OpenOracle allowances, and requires its ending token balances to equal
their starting balances. Fee-on-transfer and other non-exact balance changes during
the call therefore revert the whole execution. A later rebase is not detectable by
the executor and can invalidate OpenOracle's nominal collateral accounting; only
reviewed, non-rebasing exact-transfer tokens should be explicitly allowlisted.

Reports already owned by the execution account are skipped because OpenOracle
self-disputes use different accounting. At most one dispute is executed per poll so
a second transaction cannot rely on the pre-transaction balance snapshot.

## Required ETH, WETH, and tokens

There is no single fixed funding amount. Contributions increase with the current
OpenOracle round and depend on which side of the locked ratio the replacement uses.
The dashboard's **Open opportunities** table shows the current exact `Required WETH`
and `Required token` for each evaluated report.

The execution account needs:

- `ETH balance >=` the sum of every signed transaction's gas limit multiplied by its
  fee cap, plus an operational buffer.
- `WETH balance >= required WETH` for the selected report.
- `Token balance >= required token` for the selected report.

The modeled gas allowance used during opportunity selection is 600,000 gas. This is
not a wallet reserve limit; keep additional ETH for ERC-20 approvals, later
settlement, and withdrawals. Capital contributed to a report can remain locked
through later dispute rounds.

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
- Confirmed dispute transactions, modeled revenue before gas, estimated net profit,
  actual gas, and an all-history cumulative summary. The table and trend are bounded
  to the latest 500 records; the summary still includes every valid unique record in
  the history file.
- Signed transaction status, public/private delivery, accepted and failed relay
  targets, mined replacement hash, actual gas, and ETH profit estimates.
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

Dashboard changes to strategy, read/public RPCs, delivery mode, relay URLs, the
token list, and the pause state are atomically saved after validation and restored on restart. Mainnet
and Sepolia use separate files by default:

```text
.open-oracle-arbitrager/settings-mainnet.json
.open-oracle-arbitrager/settings-sepolia.json
```

Override the destination with `--settings-file=/secure/operator/settings.json`.
The containing directory is created with owner-only permissions when possible, and
every replacement settings file is mode `0600`. The default directory is ignored by
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

Pause is checked immediately before bundle or public submission. A submission
already started may still finish. Pause cannot interrupt confirmation or cancel a
transaction already sent to Ethereum; the dashboard explicitly keeps those
distinctions visible.

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
contributed inventory, mined executor transaction hash, block, actual transaction gas,
modeled net profit, profit before gas, and tracked net profit in ETH. Actual gas
includes every approval and executor transaction in a confirmed private bundle.
Private submissions request atomic inclusion and provide no allowed reverting
hashes, so a compliant relay/builder omits the entire bundle when a step would
revert. An unincluded bundle consumes no on-chain gas. An anomalous partial,
independent, or reverted inclusion can consume gas; the bot records those receipts
in its in-memory transaction lifecycle but does not create confirmed execution
history. Public mode broadcasts only one executor transaction.

Execution startup verifies that the history destination is writable. If persistence
later fails after a confirmed dispute, the record remains visible in memory, further
execution is blocked, and the bot retries the queued write on later polls.

Profit is tracked in ETH using the exact 1 WETH = 1 ETH unwrap relationship:

```text
revenue before gas = quoted proceeds − hedge cost
modeled net ETH = quoted proceeds − hedge cost − modeled gas allowance
tracked net ETH = quoted proceeds − hedge cost − actual approval/dispute gas
```

The dashboard's revenue figure is modeled pre-gas arbitrage P&L, not gross token
turnover. **Tracked net profit is still not realized profit.** It combines the
submission-time executable Uniswap quote with mined gas cost. Final P&L also depends
on later disputes, settlement, withdrawals, whether and where the external hedge
executes, inventory price changes, relay refunds, and transactions not sent by this
process. Negative tracked net profit is retained and included in cumulative totals.

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
list. Tokens present only in observed OpenOracle games are monitored and shown with
their pools, but cannot trigger execution. Augur-discovered REP tokens and addresses
explicitly entered in the dashboard or repeated with `--token-address=0x...` form
the execution allowlist. Explicitly adding a token is a security decision: the
atomic executor still enforces exact transfers, but it cannot establish the token's
issuer, economic value, or pool legitimacy. The primary `--rep-address` remains the
token used in the top-level REP portfolio summary.

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

Public mode calls `eth_sendRawTransaction` concurrently on every configured public
RPC, exposing the single signed executor transaction to the public mempool. It is
disabled for a candidate whenever any allowance reset or approval is required. At
least one RPC must return the locally computed transaction hash.

Private mode signs approvals and the executor call at consecutive nonces, calls
`eth_callBundle` on every configured relay, and then fans the same ordered
target-block transaction list out through `eth_sendBundle`. The payload omits
`revertingTxHashes`, so any reverted transaction invalidates the complete bundle.
At least one relay must accept the bundle or submission fails closed. Configured
endpoints must implement the
[Flashbots bundle RPC](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint)
and authentication format.

The transaction tracker records each approval and executor call as `submitting`,
`pending`, `confirmation unknown`, `confirmed`, `reverted`, or `submission failed`.
It shows which targets accepted or rejected the payload. A private bundle targets
only the next block and is not resubmitted from a stale quote. After that target
block, every signed transaction must have a successful receipt in that block or the
attempt fails and a later scan must build a new quote and bundle. Public
single-transaction confirmation retains replacement tracking. Active lifecycle rows
are kept in process memory and reset on restart; confirmed dispute history and its
ETH profit totals are persisted in the configured history file.

## Adjust the strategy

Every setting below can be changed in the dashboard and takes effect on the next
scan. The equivalent startup flags are shown below. Defaults apply when neither a
saved value nor a higher-precedence override exists:

| Setting | Default | Flag | Effect |
| --- | ---: | --- | --- |
| Minimum profit | `0.01 WETH` | `--minimum-profit-weth` | Rejects opportunities below an absolute modeled net profit. |
| Minimum return | `100 bps` | `--minimum-profit-bps` | Requires modeled net profit relative to quoted hedge cost. |
| Spot/TWAP distance | `100 ticks` | `--max-spot-twap-ticks` | Rejects pools whose current tick is too far from the TWAP. |
| TWAP window | `1800 seconds` | `--twap-seconds` | Controls the Uniswap manipulation-resistance window. Minimum: 60 seconds. |
| Remaining time | `36 seconds` | `--minimum-remaining-seconds` | Inclusion buffer for timestamp-based games. |
| Remaining blocks | `3 blocks` | `--minimum-remaining-blocks` | Inclusion buffer for block-based games. |
| Head poll interval | `1000 ms` | `--poll-ms` | Delay between latest-head checks. Every unseen event-log height is queried; evaluation and pool sampling run once at the newest head. Minimum: 1000 ms. |

Increasing profit thresholds reduces execution frequency. Increasing the TWAP window,
spot/TWAP restriction, or remaining-time buffers is more conservative but may reject
legitimate late opportunities. Parameter changes do not disable contract-side
deadline, ratio, state-hash, quote-refresh, simulation, or inventory guards.

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
| `--executor-address` | none | Deployed atomic executor. Required in execution mode; startup verifies contract code exists on the selected chain. |
| `--lookback-blocks` | `50000` | Initial event-log search range. Choose a start range that covers every potentially active report. |
| `--ui-port` | `4173` | Local dashboard port. |
| `--history-file` | Network-specific JSONL | Persistent confirmed-submission history. |
| `--settings-file` | Network-specific JSON | Persistent dashboard strategy, endpoint, delivery, pause, and opt-in signer settings. |
| `--once` | off | Run one scan and exit. Cannot be combined with `--ui`. |
| `--execute` | off | Enable guarded bundle/executor submission. Requires an executor address and `PRIVATE_KEY`, a saved restart signer, or `--ui` so a signer can be supplied locally. |
| `--submission-mode` | `private` | `private` simulates/fans out atomic bundles; `public` submits one already-authorized executor call. Adjustable in the dashboard. |
| `--relay-url` | `https://relay.flashbots.net` | Flashbots-compatible bundle relay. Repeat the flag for up to eight relays; adjustable in the dashboard. |

## Operational limitations

- Ethereum mainnet and Sepolia WETH/token games using standard Uniswap V3 fee tiers
  and exact-transfer ERC-20s are supported. Sepolia REP, OpenOracle, and executor
  identities are operator-supplied and are not authenticated against a deployment
  registry beyond selected-chain code checks.
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized
  execution.
- The configured read RPC remains a trusted input for report state, pool state,
  quotes, balances, nonces, and confirmation. Public-submission RPC fanout and relay
  chain checks do not provide read quorum. A compromised or faulty read RPC can
  therefore corrupt the bot's economic decision; operate a trusted endpoint and
  monitor it independently.
- The bot does not use a flash swap, settle reports, withdraw OpenOracle balances, or
  rebalance inventory.
- Private delivery reduces public-mempool exposure but does not guarantee
  confidentiality, inclusion, fair ordering, or relay/builder behavior. Configuring
  multiple relays shares the signed payload with every listed operator.
- Public RPCs offer no standard per-transaction inclusion deadline. A public
  executor call that remains pending after its embedded one-block quote window can
  still be mined, revert the contract timing check, and spend gas. Private bundles
  target exactly the next block.
- A 12-block event overlap is replayed whenever a new head is processed to tolerate short
  reorganizations. Operators still need independent alerting for deeper reorgs and
  RPC disagreement.
- Continuous mode retries transient poll failures. The dashboard exposes the latest
  error, but production operation still requires external process supervision and
  alerts.
- After a public transaction broadcast, receipt timeouts and transient RPC failures
  keep the execution loop blocked while confirmation is retried. Repriced public
  replacements are followed and recorded under the mined hash; cancellations and
  unrelated replacements fail definitively. A private bundle instead targets one
  block and receives one complete-inclusion check after that block: missing or
  unsuccessful receipts mark the attempt as confirmation unknown or failed, and a
  later scan must build a new quote and bundle.
- A process restart does not recover or resume a broadcast but unconfirmed
  transaction. Reconcile the execution account nonce and transaction status before
  restarting execution mode.
- The current [ORACLE-A1 launch analysis](../docs/oracle-a1-launch-analysis.html)
  concludes that observed REP/WETH executable liquidity is insufficient for
  deployment. Running this tool does not override that launch gate.
