# Zoltar security-pool liquidator

The liquidator discovers every security pool registered by a configured
`SecurityPoolFactory`, shows pool and vault statistics in a local dashboard, and
evaluates unsafe vaults in operator-selected pools. Dry-run is the default. Live
execution requires an explicit signer, independent read RPC quorum, execution
flag, and non-zero deployment addresses.

The bot owns an ordinary vault under its signer address in each selected pool. A
liquidation transfers coverage commitment and a 5%-bonus vault REP backing award,
represented by REP backing units, from the target into that vault. Because this REP
backing award is deliberately insufficient to collateralize the transferred coverage commitment
by itself, the bot deposits the minimum additional REP
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
approved and its system state is operational. For an undeployed origin pool,
add its universe, question, multiplier, and priority-fee tuple to `desiredPools`.
The bot resolves the canonical factory address and selects it when present; when
`allowAutomaticPoolCreation` is enabled, it deploys a missing desired pool before
continuing liquidation. The universe table shows parent and fork-outcome lineage,
operational and forked pool counts, pool selection, and whether a bot vault can
migrate into that universe.

`deployment.zoltar` identifies the universe registry, and
`approvedUniverses` is the operator's explicit truth policy. A root universe or
fork-created child remains inert until it is approved. For a given forked parent
universe, the bot rejects configuration that approves more than one direct child
outcome. This prevents an ambiguous vault route. Universe approval does not
enable every pool in that universe: both the universe and each individual pool
must be selected before the bot liquidates or maintains its vault there.
Every discovered pool's REP token must match the configured Zoltar registry's
token for that universe. A mismatch fails the scan instead of applying the truth
policy to another universe tree; this also supports the external genesis REP
token, which does not expose a Zoltar accessor.

When `allowAutomaticVaultMigrations` is enabled, the bot looks for a selected
forked parent pool where its signer has non-escrowed vault accounting and one deployed direct
child universe is approved. During the protocol's eight-week migration window
it calls the
parent's `SecurityPoolForker.migrateVault(parent, outcomeIndex)`. The migration
moves the signer's complete non-escrowed vault accounting to the chosen child and atomically
creates the child security pool when it does not exist. The bot does not split a
parent vault across outcomes. Once the child becomes operational, normal vault
maintenance and liquidation continue there because the next registry scan
inherits the selected parent pool onto its approved child. A missing approved
child, closed migration window, empty vault, active staged operation involving
the bot vault, disabled migration setting, or conflicting child approval
produces no migration.

Pool-selection inheritance is a configuration reconciliation and remains active
in dry-run mode and when automatic vault migrations are disabled. Only the
on-chain vault movement is controlled by `allowAutomaticVaultMigrations`.

The active-vault scan is capped by `runtime.maxVaultsPerPool`. A capped scan is
marked in the dashboard and must not be treated as a complete opportunity view.

## Independent market consensus

Both bots use the shared CCXT public market-data API to normalize order books
from independently configured exchanges. Each `centralizedMarkets.sources`
entry identifies an exchange with its CCXT `exchangeId`, a unified `REP/QUOTE`
market, and an `ETH/QUOTE` market when REP is not quoted directly in ETH. Public
ticker and order-book reads do not require exchange credentials. A cross-quoted
observation is fresh only when both its REP order book and ETH ticker are fresh.
Exchange-provided timestamps are retained (using the older timestamp for a
cross-quoted observation), so polling a cached response cannot extend freshness
or satisfy the temporal-persistence rule. Required consensus does not admit a
CEX observation without a native order-book timestamp and, for cross quotes, a
native ETH-ticker timestamp.

The bot converts each venue into REP per ETH, sums executable bid and ask depth
inside `depthBps`, and uses the median of fresh venue prices. An estimate is
reliable only when it has `minimumSourceCount` independent exchanges, minimum
two-sided depth, and no more than `maximumVenueDispersionBps` disagreement.
Configured sources and their liquidity are shown in the dashboard. Operators can
add or remove CCXT exchanges from the market-configuration editor without any
exchange adapter being hard-coded by the bot.

The source-admission table explains whether each configured source is admitted
or excluded and shows the current exclusion reason. **Test saved sources** runs
a fresh read-only probe without changing configuration. The same probe is
available for deployment smoke checks while the bot is running:

```bash
bun run smoke:markets -- http://127.0.0.1:4183
```

It exits unsuccessfully if any configured source cannot produce a usable
observation and exercises the saved CCXT adapters, RPC connection, chain, pair
addresses, and WETH deployment.

When `venueConsensus` is configured, the liquidator also reads each explicit
constant-product REP/WETH pair in `dexSources` directly from the chain. It probes
both trade directions at `dexProbeDepthEth`, rejects pairs whose executable
spread is too wide, and grants one vote per distinct `sourceId`. Pair addresses
are explicit so an untrusted discovery service cannot insert a venue.

The CEX and DEX groups are aggregated separately. If both groups are internally
reliable, they must agree within `maximumGroupDeviationBps`. If one group is
dispersed while the other has the configured independent quorum and total source
count, the coherent group can supply the guarded reference only when
`allowSingleGroupFallback` is explicitly enabled. Thus one manipulated CEX need
not halt the bot when multiple sufficiently liquid DEX venues agree, but the
dashboard warns that venue independence is reduced.
If both coherent groups disagree, or neither has quorum, price-dependent actions
stop in required mode. Configure at least three independent failure domains;
multiple pools controlled by one venue must share a `sourceId` and receive only
one vote. `minimumSourceObservationCount` and
`minimumSourceObservationSpanMilliseconds` require agreement to persist across
polls, preventing a one-block or one-request spike from immediately becoming a
trusted reference. The span cannot exceed `maximumObservationAgeMilliseconds`,
and leaving then returning to an earlier price regime restarts its history.

When `requiredForExecution` is true, `venueConsensus` is mandatory and the
configured CEX, DEX, total-source, and temporal quorum rules fail closed. The
configured source lists must be large enough to satisfy those minimums before
the bot starts. The
current price regime itself must persist for the configured count and span; old
observations cannot warm up a newly changed price. Liquidation and
price-dependent vault maintenance recheck evidence age after preparation and
immediately before persisting each signed intent, including after approvals or
funding transactions.
Migration and transaction recovery continue because they do not rely on a REP
market price. When `requiredForExecution` is false, healthy independent evidence
can still reject an outlying coordinator price, but unavailable or unreliable
evidence remains advisory.

Saving a new market configuration clears all accumulated CEX and DEX evidence;
replacement sources must establish their own temporal history before execution
can resume.

The guarded estimate is an independent manipulation guard; it never replaces the
coordinator price in protocol arithmetic and never authorizes a transaction by
itself. Evidence is keyed by exact chain and REP token. Configure root REP in
`centralizedMarkets` and exact approved child-universe REP tokens in
`childMarketConfigurations`; each child stays fail-closed until its own market
history is reliable. Price-independent fee redemption continues without it.

Example source entries (only use venues where these exact markets exist):

```json
"sources": [
  { "exchangeId": "kraken", "repMarket": "REP/USD", "ethMarket": "ETH/USD" },
  { "exchangeId": "anotherexchange", "repMarket": "REP/ETH", "ethMarket": null }
]
```

Set `assetAddress`, `assetChainId`, and `assetSymbol: "REP"` to the exact REP
deployment before adding sources. Put root REP in `centralizedMarkets` and child
REP configurations in `childMarketConfigurations`. The bot rejects another token
base, chain, or address, and CEX exchange IDs cannot be reused as DEX
failure-domain IDs.

Example DEX source entries (addresses are intentionally placeholders):

```json
"venueConsensus": {
	"allowSingleGroupFallback": false,
  "dexProbeDepthEth": "1",
  "dexSources": [
    { "sourceId": "uniswap-v2", "pair": "0x0000000000000000000000000000000000000000", "feeBps": 30 },
    { "sourceId": "sushiswap-v2", "pair": "0x0000000000000000000000000000000000000000", "feeBps": 30 }
  ],
  "maximumGroupDeviationBps": 500,
  "minimumDexAskDepthEth": "0.5",
  "minimumDexBidDepthEth": "0.5",
  "minimumDexSourceCount": 2,
	"minimumSourceObservationCount": 2,
	"minimumSourceObservationSpanMilliseconds": 10000,
  "minimumTotalSourceCount": 3
}
```

Configured DEX reserve reads are pinned to the scanned canonical block. Polling
the same block again cannot build price persistence; a changed canonical hash
discards accumulated DEX history. Single-group fallback is
opt-in; when enabled, only sources in the selected reliable group count toward
the total-source quorum.

## Strategy controls

Amounts use 18-decimal ETH or REP units in the operator JSON.

- `minimumLiquidationCoverageCommitmentEth` and `maximumLiquidationCoverageCommitmentEth` bound the human-readable ETH values accepted at the configuration boundary for a target coverage-commitment transfer; parsing produces internal `minimumLiquidationCoverageCommitmentAttoEth` and `maximumLiquidationCoverageCommitmentAttoEth` values.
- `minimumRewardValueEth` filters the fixed-bonus value before gas.
- `maximumGasCostEth` caps the padded EIP-1559 gas limit actually signed for
  every automated action.
- `maximumOracleRequestCostEth` caps fresh-price bounty funding.
- `maximumRepPerPoolRep` and `maximumTotalDeployedRep` bound liquidation
  acquisitions and every automatic maintenance deposit.
- `walletRepReserveRep` remains outside pools.
- `vaultTopUpHealthBps` triggers maintenance.
- `vaultTargetHealthBps` is the post-deposit and post-liquidation target.
- `vaultWithdrawHealthBps` must exceed the target and gates surplus withdrawals.
- `minimumRepWithdrawalRep` avoids small staged withdrawals.
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
submission. Restart recovery quorum-checks receipts and nonce state. It never
rebroadcasts an ambiguous price-dependent intent using stale market evidence.
Public intents remain blocked until the original receipt appears or a finalized
replacement or cancellation proves that the same signer nonce was consumed.
Private intents expire only after their relay validity ceiling plus twelve
canonical confirmation blocks. Non-price-dependent intents can resubmit the
exact durable signed transaction while it remains viable. A failed live cycle
pauses automatic execution and remains visible until the operator reviews it.

For a replaced or canceled public intent, pause the bot and use **Transaction
recovery** to enter the finalized replacement hash. The replacement must have
the same sender and nonce, quorum-confirmed receipt evidence, a canonical receipt
block, and twelve confirmations. Successful reconciliation is recorded in the
durable activity journal. There is deliberately no unsafe “forget transaction”
action.

When a coordinator price is stale, the bot wraps and approves the buffered
minimum WETH report amount, approves the matching REP amount, and funds a staged
liquidation only if the request remains within configured limits. Settlement and
execution of that staged operation remain visible in subsequent pool scans. The
queued operation ID is persisted across restarts and reconciled against quorum
event reads; a failed execution or oracle-recovery consumption pauses execution
and is recorded instead of being treated as a successful liquidation. Active
staged liquidations are paged from the coordinator, reserved in REP exposure
accounting, and excluded from candidate selection until consumed.

## Market adapter limitations

- CEX support uses CCXT's unified public ticker and order-book interface. Symbol
  availability, timestamps, rate limits, maintenance behavior, and response
  quality remain exchange-specific. Run the source smoke check before enabling
  execution and after changing an adapter.
- Configured DEX sources are Uniswap-V2-style constant-product REP/WETH pairs.
  The arbitrager dynamically observes authenticated V2, V3, and V4 deployments,
  but the liquidator does not claim a universal configurable V3/V4 format.
- Single-group fallback weakens venue independence and is always surfaced as an
  operator warning.
- Required consensus fails closed. Missing depth, excessive dispersion, stale
  timestamps, insufficient persistence, asset mismatch, or canonical-block
  failure can intentionally stop price-dependent actions.

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
> Sepolia, keep dry-run logs, and supervise pool health. Assumed pool coverage commitment
> remains an economic obligation even when the fixed liquidation bonus is
> positive.
