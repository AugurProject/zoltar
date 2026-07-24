# OpenOracle arbitrager

The OpenOracle arbitrager monitors active mainnet WETH/REP games, compares their
locked exchange against executable Uniswap V3 quotes, and identifies disputes whose
modeled hedge remains profitable after OpenOracle fees and gas. It includes a local
operator dashboard for live state, strategy controls, wallet inventory, submitted
disputes, transaction delivery, and ETH-denominated profit tracking.

Dry-run is the default. The bot cannot submit a transaction unless it is explicitly
started with both `--execute` and a `PRIVATE_KEY`.

## Requirements

- Bun and this monorepo's frozen dependencies.
- An Ethereum mainnet RPC endpoint. An archive-capable endpoint is recommended when
  `--lookback-blocks` reaches beyond the provider's retained log history.
- The deployed OpenOracle contract address.
- For execution, a dedicated mainnet key with:
  - ETH for approvals and dispute gas.
  - WETH for the token-1 contribution shown in the dashboard.
  - REP for the token-2 contribution shown in the dashboard.
- A choice of public-mempool or private-relay delivery. Private delivery is
  recommended to reduce exposure of the quote and dispute to front-running and
  adverse inclusion.
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

The repository-level executable runs the TypeScript source directly:

```bash
./open-oracle-arbitrager --help
```

## Monitor without trading

Run one scan:

```bash
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --lookback-blocks=50000 \
  --once
```

Run continuously with the local dashboard:

```bash
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --ui
```

Then open `http://127.0.0.1:4173`. Dry-run opportunities are evaluated exactly like
execution opportunities, but no approvals or disputes are sent.

## Execute disputes

Start an inventory-funded execution process:

```bash
PRIVATE_KEY=0xYourDedicatedPrivateKey \
ETH_RPC_URL=https://your-private-mainnet-rpc.example \
  ./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --execute \
  --ui
```

Execution remains fixed for the lifetime of the process. It cannot be enabled from
the dashboard. The dashboard can pause scanning and adjust strategy or submission
settings, but restarting the command is required to change between dry-run and
execution.

Public mempool delivery is the default. To send the same signed transaction to
multiple private relays instead:

```bash
PRIVATE_KEY=0xYourDedicatedPrivateKey \
ETH_RPC_URL=https://your-mainnet-rpc.example \
  ./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --execute \
  --submission-mode=private \
  --relay-url=https://relay.flashbots.net \
  --relay-url=https://your-second-relay.example \
  --ui
```

Choose **Public mempool** or **Private relays** in the dashboard to change delivery
for the next scan. Private mode requires at least one relay and supports up to eight.
Relay URLs are process memory only and are not written to the history file. URLs may
use HTTPS, or loopback HTTP for a locally operated relay; embedded URL credentials,
query parameters, fragments, and redirects are rejected.

Before each dispute, the bot:

1. Checks that the game is WETH/REP and inside its dispute window.
2. Finds an active Uniswap V3 pool and rejects excessive spot/TWAP deviation.
3. Uses exact-input and exact-output QuoterV2 calls to model both directions.
4. Derives the same replacement swap side as the OpenOracle contract.
5. Calculates the exact WETH and REP contributions and checks wallet inventory.
6. Applies the absolute-profit and basis-point thresholds.
7. Approves only the prepared contribution amounts.
8. Refreshes pool state, quotes, gas, deadline, inventory requirements, and the
   OpenOracle state hash.
9. Estimates gas, fetches the pending nonce, constructs and signs one canonical
   EIP-1559 transaction.
10. Sends that identical signed payload either to the public RPC or every configured
    private relay.
11. Tracks submission targets and confirmation, waits for a successful receipt, and
    records the mined transaction and ETH profitability calculation locally.

Reports already owned by the execution account are skipped because OpenOracle
self-disputes use different accounting. At most one dispute is executed per poll so
a second transaction cannot rely on the pre-transaction balance snapshot.

## Required ETH, WETH, and REP

There is no single fixed funding amount. Contributions increase with the current
OpenOracle round and depend on which side of the locked ratio the replacement uses.
The dashboard's **Open opportunities** table shows the current exact `Required WETH`
and `Required REP` for each evaluated report.

The execution account needs:

- `ETH balance >= approval gas + dispute gas + a replacement/repricing buffer`.
- `WETH balance >= required WETH` for the selected report.
- `REP balance >= required REP` for the selected report.

The modeled gas allowance used during opportunity selection is 600,000 gas. This is
not a wallet reserve limit; keep additional ETH for two ERC-20 approvals, transaction
replacement, settlement, and withdrawals. Capital contributed to a report can remain
locked through later dispute rounds.

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
./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --ui \
  --ui-port=4180
```

The dashboard shows:

- Bot mode, scan status, latest block, errors, and active-report count.
- ETH, WETH, REP, executable REP value, and estimated portfolio value.
- Current opportunities, exact inventory requirements, deadline window, direction,
  pool, and decision.
- Confirmed dispute transactions, estimated net profit, actual gas, and an
  all-history cumulative summary. The table and trend are bounded to the latest 500
  records; the summary still includes every valid unique record in the history file.
- Signed transaction status, public/private delivery, accepted and failed relay
  targets, mined replacement hash, actual gas, and ETH profit estimates.
- Runtime strategy and submission controls plus pause/resume.

The UI is intentionally local-only and does not receive the private key. Mutable API
requests require same-origin JSON and the fixed loopback host authority. Do not
reverse-proxy or expose the dashboard to a network without adding authentication and
transport security.

Pause prevents the next approval or dispute from being broadcast. It cannot cancel a
transaction already sent to Ethereum; the dashboard explicitly keeps that distinction
visible.

## Profit and history semantics

Successful dispute submissions are appended to
`.open-oracle-arbitrager/history.jsonl` by default. Override the location with:

```bash
./open-oracle-arbitrager \
  --open-oracle=0xYourOpenOracle \
  --ui \
  --history-file=/secure/operator/open-oracle-history.jsonl
```

The history file is created with owner-only permissions when possible and is ignored
by Git at its default path. Each record contains the report, pool, direction,
contributed inventory, mined transaction hash, block, actual transaction gas,
modeled net profit, profit before gas, and tracked net profit in ETH. Actual gas
includes the approval transactions and confirmed dispute for that successful
recorded execution. Gas from an attempt that aborts after an approval but before a
successful dispute is shown in the in-memory transaction tracker but is not included
in confirmed-history totals; reconcile all attempt costs against the wallet's
on-chain transactions.

Execution startup verifies that the history destination is writable. If persistence
later fails after a confirmed dispute, the record remains visible in memory, further
execution is blocked, and the bot retries the queued write on later polls.

Profit is tracked in ETH using the exact 1 WETH = 1 ETH unwrap relationship:

```text
modeled net ETH = quoted proceeds − hedge cost − modeled gas allowance
tracked net ETH = quoted proceeds − hedge cost − actual approval/dispute gas
```

**Tracked net profit is still not realized profit.** It combines the submission-time
executable Uniswap quote with mined gas cost. Final P&L also depends on later
disputes, settlement, withdrawals, whether and where the external hedge executes,
inventory price changes, relay refunds, and transactions not sent by this process.
Negative tracked net profit is retained and included in cumulative totals.

## Transaction delivery and tracking

Public mode calls `eth_sendRawTransaction` on `ETH_RPC_URL`, exposing the signed
transaction to the public mempool. Private mode calls
`eth_sendPrivateTransaction` on every configured relay, authenticating each JSON-RPC
body with `X-Flashbots-Signature` using the execution key. At least one private relay
must accept the exact expected transaction hash or submission fails closed.
Configured endpoints must implement the
[Flashbots private-transaction RPC](https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint#eth_sendprivatetransaction)
and authentication format.

The transaction tracker records approvals and disputes as `submitting`, `pending`,
`confirmation unknown`, `confirmed`, `reverted`, or `submission failed`. It shows
which targets accepted or rejected the payload. Receipt timeouts keep execution
blocked. Private approval payloads can refresh their 25-block inclusion window.
Dispute payloads are capped at the final block accepted by their embedded OpenOracle
quote and are never resubmitted after that block. Repriced replacements are followed
from the locally signed sender and nonce even while the private transaction is not
visible to the public RPC; the mined replacement hash becomes the tracked and
historical hash. Active transaction lifecycle rows are kept in process memory and
reset on restart; confirmed dispute history and its ETH profit totals are persisted
in the configured history file.

## Adjust the strategy

Every setting below can be changed in the dashboard and takes effect on the next
scan. The equivalent startup flags are:

| Setting | Default | Flag | Effect |
| --- | ---: | --- | --- |
| Minimum profit | `0.01 WETH` | `--minimum-profit-weth` | Rejects opportunities below an absolute modeled net profit. |
| Minimum return | `100 bps` | `--minimum-profit-bps` | Requires modeled net profit relative to quoted hedge cost. |
| Spot/TWAP distance | `100 ticks` | `--max-spot-twap-ticks` | Rejects pools whose current tick is too far from the TWAP. |
| TWAP window | `1800 seconds` | `--twap-seconds` | Controls the Uniswap manipulation-resistance window. Minimum: 60 seconds. |
| Remaining time | `36 seconds` | `--minimum-remaining-seconds` | Inclusion buffer for timestamp-based games. |
| Remaining blocks | `3 blocks` | `--minimum-remaining-blocks` | Inclusion buffer for block-based games. |
| Poll interval | `12000 ms` | `--poll-ms` | Delay between completed scans. Minimum: 1000 ms. |

Increasing profit thresholds reduces execution frequency. Increasing the TWAP window,
spot/TWAP restriction, or remaining-time buffers is more conservative but may reject
legitimate late opportunities. Parameter changes do not disable contract-side
deadline, ratio, state-hash, quote-refresh, simulation, or inventory guards.

Other startup-only options:

| Flag | Default | Purpose |
| --- | ---: | --- |
| `--lookback-blocks` | `50000` | Initial event-log search range. Choose a start range that covers every potentially active report. |
| `--ui-port` | `4173` | Local dashboard port. |
| `--history-file` | `.open-oracle-arbitrager/history.jsonl` | Persistent confirmed-submission history. |
| `--once` | off | Run one scan and exit. Cannot be combined with `--ui`. |
| `--execute` | off | Enable guarded approval and dispute submission. Requires `PRIVATE_KEY`. |
| `--submission-mode` | `public` | `public` submits to the RPC mempool; `private` fans out to configured relays. Adjustable in the dashboard. |
| `--relay-url` | `https://relay.flashbots.net` | Private relay endpoint. Repeat the flag for up to eight relays; adjustable in the dashboard. |

## Operational limitations

- Only Ethereum mainnet WETH/REP games and standard Uniswap V3 fee tiers are
  supported.
- Quoter calls and TWAP checks are filters, not guarantees of inclusion or realized
  execution.
- The bot does not use a flash swap, settle reports, withdraw OpenOracle balances, or
  rebalance inventory.
- Private delivery reduces public-mempool exposure but does not guarantee
  confidentiality, inclusion, fair ordering, or relay/builder behavior. Configuring
  multiple relays shares the signed payload with every listed operator.
- Public RPCs offer no standard per-transaction inclusion deadline. A public dispute
  that remains pending after its embedded one-block quote window can still be mined,
  revert the contract timing check, and spend gas. Private relay mode caps the relay
  inclusion request to that same on-chain window.
- A 12-block event overlap is replayed on every poll to tolerate short
  reorganizations. Operators still need independent alerting for deeper reorgs and
  RPC disagreement.
- Continuous mode retries transient poll failures. The dashboard exposes the latest
  error, but production operation still requires external process supervision and
  alerts.
- After any transaction broadcast, receipt timeouts and transient RPC failures keep
  the execution loop blocked while confirmation is retried. Repriced replacements
  are followed and recorded under the mined hash; cancellations and unrelated
  replacements fail definitively.
- A process restart does not recover or resume a broadcast but unconfirmed
  transaction. Reconcile the execution account nonce and transaction status before
  restarting execution mode.
- The current ORACLE-A1 launch analysis concludes that observed REP/WETH executable
  liquidity is insufficient for deployment. Running this tool does not override that
  launch gate.
