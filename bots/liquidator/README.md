# Zoltar security-pool liquidator

The liquidator discovers every security pool registered by a configured
`SecurityPoolFactory`, shows pool and vault statistics in a local dashboard, and
evaluates unsafe vaults in operator-selected pools. Dry-run is the default. Live
execution requires an explicit signer, independent read RPC quorum, execution
flag, and non-zero deployment addresses.

The bot owns an ordinary vault under its signer address in each selected pool. A
liquidation transfers bond allowance and bonus-priced REP from the target into
that vault. Because the seized REP is deliberately insufficient to collateralize
the transferred allowance by itself, the bot deposits the minimum additional REP
needed to reach its configured target health before submitting an immediate
liquidation. For stale prices it pre-funds against a configurable higher price
bound before queueing the operation, so settlement within that operator-approved
bound cannot consume an unfunded liquidation. It later withdraws surplus REP when the vault is safely above the
withdrawal threshold.

## Operator setup

```bash
cp config/operator.example.json .state/operator.json
bun install --frozen-lockfile
bun run run
```

Set `ZOLTAR_LIQUIDATOR_CONFIG` to use another operator file. The bot accepts no
command-line arguments. The dashboard defaults to
`http://127.0.0.1:4183`.

Keep `runtime.execute` false until the factory, WETH, signer, selected pools, RPC
endpoints, gas limits, and REP limits have been reviewed. When execution is
enabled:

- `connectivity.readRpcUrl` supplies the local operational view.
- `connectivity.quorumRpcUrls` must contain at least one independent read RPC.
- The critical pool, price, vault, and candidate snapshot must agree across every
  read endpoint before a transaction is sent.
- `submission.mode` may be `public` or `private`. ETH-funded stale-price requests
  use the same signed-transaction delivery policy as other actions.
- `privateKey` is stored in the local operator file only when explicitly saved.
  The dashboard never returns it.

## Universe and pool selection

The universe browser walks Zoltar's deployed child-universe tree from universe
zero, including deployed universes that do not have a security pool yet. The
pool table is loaded automatically from
`securityPoolDeploymentCount()` and `securityPoolDeploymentsRange()`. Selecting a
pool enables candidate evaluation and execution only while its universe is also
approved and its system state is operational. It does not deploy a new
security-pool contract. The universe table shows parent and fork-outcome lineage,
operational and forked pool counts, pool selection, and whether a bot vault can
migrate into that universe.

`deployment.zoltar` identifies the universe registry, and
`approvedUniverses` is the operator's explicit truth policy. A root universe or
fork-created child remains inert until it is approved. For a given forked parent
universe, the bot rejects configuration that approves more than one direct child
outcome. This prevents an ambiguous vault route. Universe approval does not
enable every pool in that universe: both the universe and each individual pool
must be selected before the bot liquidates or maintains its vault there.
Every discovered pool's REP token must identify the configured Zoltar contract;
a mismatch fails the scan instead of applying the truth policy to another
universe tree.

When `allowAutomaticVaultMigrations` is enabled, the bot looks for a selected
forked parent pool where its signer has an unlocked vault and one deployed direct
child universe is approved. During the protocol's eight-week migration window
it calls the
parent's `SecurityPoolForker.migrateVault(parent, outcomeIndex)`. The migration
moves the signer's complete unlocked vault to the chosen child and atomically
creates the child security pool when it does not exist. The bot does not split a
parent vault across outcomes. Once the child becomes operational, normal vault
maintenance and liquidation continue there because the next registry scan
inherits the selected parent pool onto its approved child. A missing approved
child, closed migration window, empty vault, active staged operation involving
the bot vault, disabled migration setting, or conflicting child approval
produces no migration.

The active-vault scan is capped by `runtime.maxVaultsPerPool`. A capped scan is
marked in the dashboard and must not be treated as a complete opportunity view.

## Strategy controls

Amounts use 18-decimal ETH or REP units in the operator JSON.

- `minimumLiquidationDebtEth` and `maximumLiquidationDebtEth` bound target debt.
- `minimumRewardValueEth` filters the fixed-bonus value before gas.
- `maximumGasCostEth` caps the padded EIP-1559 gas limit actually signed for
  every automated action.
- `maximumOracleRequestCostEth` caps fresh-price bounty funding.
- `maximumRepPerPool` and `maximumTotalDeployedRep` bound liquidation
  acquisitions and every automatic maintenance deposit.
- `walletRepReserve` remains outside pools.
- `vaultTopUpHealthBps` triggers maintenance.
- `vaultTargetHealthBps` is the post-deposit and post-liquidation target.
- `vaultWithdrawHealthBps` must exceed the target and gates surplus withdrawals.
- `minimumRepWithdrawal` avoids small staged withdrawals.
- `redeemFeesAboveEth` controls ETH fee redemption.
- `stalePriceFundingBufferBps` conservatively pre-funds the liquidator vault before a stale-price operation is queued.
- `fallbackRepPerEthPrice` is used only for a never-seeded stale coordinator.
- `allowAutomaticVaultMigrations` permits the fork migration described above.
- Stale full-close candidates are rejected because the target can add REP and
  the eventual oracle price is not bounded on-chain; that branch cannot
  guarantee the configured REP exposure limits.

The protocol safety boundary is 10,000 bps. The top-up threshold must not exceed
the target, and the withdrawal threshold must be above the target.

## Execution lifecycle

Each cycle performs an authoritative factory read, loads active vaults, computes
exact protocol floor and rounding behavior, and selects at most one action:

1. Migrate an applicable selected parent vault into its one approved child
   universe.
2. Top up an existing bot vault that is approaching its safety boundary.
3. Withdraw REP that is safely above the configured threshold.
4. Redeem accrued ETH fees.
5. Pre-fund a liquidation vault and submit the best liquidation candidate.

Transaction intent and outcomes are written to `runtime.stateFile`. The activity
journal is restored on restart. A signed intent, nonce, serialized transaction,
submission block, and validity ceiling are fsynced before relay or RPC
submission. Restart recovery quorum-checks receipts and nonce state, resubmits
the exact same signed transaction while it remains viable, and expires an
unincluded private transaction only after every read head passes its validity
ceiling. A failed live cycle pauses automatic execution in the running process
and remains visible in the dashboard until the operator reviews and resumes it.

When a coordinator price is stale, the bot wraps and approves the buffered
minimum WETH report amount, approves the matching REP amount, and funds a staged
liquidation only if the request remains within configured limits. Settlement and
execution of that staged operation remain visible in subsequent pool scans. The
queued operation ID is persisted across restarts and reconciled against quorum
event reads; a failed execution or oracle-recovery consumption pauses execution
and is recorded instead of being treated as a successful liquidation. Active
staged liquidations are paged from the coordinator, reserved in REP exposure
accounting, and excluded from candidate selection until consumed.

## Development

```bash
bun run typecheck
bun run test
bun run format:check
bun run check
```

The reusable Ethereum, connectivity, quorum, block synchronization, signer gate,
retry, and transaction-submission primitives live in `../shared`.

> Live liquidation is experimental. Use a dedicated low-balance signer, begin on
> Sepolia, keep dry-run logs, and supervise pool health. Assumed pool allowance
> remains an economic obligation even when the fixed liquidation bonus is
> positive.
