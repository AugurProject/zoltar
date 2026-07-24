# OpenOracle arbitrager

This command monitors packed OpenOracle report events, checks active WETH/REP games
against executable Uniswap V3 QuoterV2 quotes, rejects pools whose spot tick diverges
from their 30-minute TWAP, and reports the best after-fee, after-gas opportunity.

Dry-run is the default:

```bash
./open-oracle-arbitrager --open-oracle=0x... --once
```

Continuous execution requires a dedicated, funded key:

```bash
PRIVATE_KEY=0x... ETH_RPC_URL=https://... ./open-oracle-arbitrager \
  --open-oracle=0x... \
  --execute
```

Important operational constraints:

- Only mainnet WETH/REP games are accepted.
- `--execute` approves the prepared OpenOracle contributions, then refreshes the
  pool, TWAP, executable quotes, gas estimate, profit threshold, report deadline,
  and report state hash before simulating and submitting. It aborts if the refreshed
  contribution would require a larger approval or if the replacement ratio does not
  derive the intended swap side. It supplies on-chain block and timestamp timing
  bounds so a delayed transaction reverts. Reports already owned by the execution
  account are skipped because OpenOracle self-disputes use different accounting.
- The strategy uses executable exact-input and exact-output Uniswap quotes. It does
  not execute a flash swap. Operators must hold both contribution assets, keep
  enough ETH for gas, settle winning reports, withdraw the returned assets, and
  rebalance inventory separately. Capital can remain locked through further dispute
  rounds.
- The default minimum is 0.01 WETH and 100 bps of quoted hedge cost. The modeled gas
  allowance is 600,000 gas.
- The bot requires at least 36 seconds for time-based games or three blocks for
  block-based games before settlement. Override these only under an approved
  inclusion policy.
- A 50,000-block lookback is only a convenience. Production operators should choose
  a start block known to precede every report that could still be active.
- Continuous mode retries transient polling failures. Pool, quote-direction, and
  report failures are isolated, and the event cache replays a 12-block overlap on
  each poll so a short reorganization does not preserve replaced logs.
- Quoter calls and TWAP checks are necessary filters, not guarantees of inclusion or
  realized execution. The RPC supplied to an executing process must provide private
  transaction delivery; use a separate endpoint or process for independent
  monitoring.

Options include `--minimum-profit-weth`, `--minimum-profit-bps`,
`--max-spot-twap-ticks`, `--twap-seconds`, `--lookback-blocks`, and `--poll-ms`.
The inclusion options are `--minimum-remaining-seconds` and
`--minimum-remaining-blocks`.
