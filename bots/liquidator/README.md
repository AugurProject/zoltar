# Statoblast liquidator

The liquidator discovers every security pool registered by a configured
`SecurityPoolFactory`, shows pool and vault statistics in a local dashboard, and
evaluates unsafe vaults in operator-selected pools. Dry-run is the default. Live
execution requires an explicit signer, the configured read RPC quorum, the
execution flag, and non-zero deployment addresses.

The bot owns an ordinary vault under its signer address in each selected pool. A
liquidation moves ETH-denominated open-interest debt, the proportional attoREP
capacity ownership, and a 5%-bonus REP backing award from the target into that
vault. When the award would not satisfy both protocol health branches, the bot
first makes a backing-only REP top-up using `MAX_UINT256` as the target health
factor, which adds REP backing while rounding new capacity ownership to zero. It
then ends the cycle and reloads the target, receiver, aggregate
capacity ownership, and live open interest before deciding whether to stage the liquidation. Ordinary
fee-earning deposits create price-independent capacity ownership, and the pool's
live REP/ETH price converts that ownership into current ETH minting capacity.
Actual ETH open interest comes from settlement collateral and is allocated among
vaults in proportion to their capacity ownership. For stale prices the bot
pre-funds against a configurable higher price bound before queueing the operation.
It later withdraws surplus REP when the vault is safely above the withdrawal
threshold.

## Operator setup

### Docker Compose

From this directory, build and start the bot:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

On Windows, run `start.bat` from this directory to start the same Compose command.

On first start, the container creates a paused, dry-run configuration in its named
volume. Open `http://127.0.0.1:4183`; the dashboard does not require a username or
password. Compose publishes the port only on host loopback, so connect from another
machine through a trusted tunnel to the host rather than changing the port binding.
Keep `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED` paired with that `127.0.0.1` mapping.

Each chain profile saves its own RPC agreement requirement. The default is `1`, so
the primary read RPC is sufficient and independent quorum RPCs are optional. Select
agreement `2` in **Chain and RPC connectivity** and configure two independent quorum
RPC URLs when that chain must retain a two-reader policy. `ZOLTAR_BOT_RPC_QUORUM`
only supplies the migration default for an older profile that has no saved policy;
values other than `1` or `2` stop that migration.

Save the chain and RPCs in **Chain and RPC connectivity**, finish the remaining
configuration, and resume only after reviewing the saved settings. Run
`docker compose down` to stop the bot and `docker compose up` to start it again.
The named volume preserves its configuration, history, and recovery state.

To operate on Sepolia, choose Sepolia in the dashboard's **Chain** selector. The bot
saves the current profile, pauses at a safe scan boundary, releases its current
chain and state locks, and loads Sepolia without exiting the process or restarting
the container. The first switch creates a clean profile with a chain-named durable
state file. Switching back restores the saved mainnet settings and recovery state,
but the bot remains paused until you explicitly resume it.
Only the selected profile is active at one time. In-place switching requires both
profiles to use the same `runtime.once`, `runtime.ui`, `runtime.uiHost`, and
`runtime.uiPort` values so the running process and browser retain their operating
mode and dashboard origin. The bot rejects an incompatible profile before changing
any file.

Compose restarts the container only while Docker and the host remain available; a
direct Bun process needs an external supervisor. If the host or state storage is
lost, restore the complete `.state` directory before resuming live execution with
the same signer. Do not reuse that signer from incomplete recovery state.

Do not publish the dashboard on a public interface. Loopback RPC URLs refer to
the container itself, so use a container-reachable RPC address when the node runs
elsewhere.

### Bun

From the monorepo root, install the root package before entering the liquidator
project. The root package provides the shared Ethereum runtime used by the bot:

```bash
bun install --frozen-lockfile
cd bots/liquidator
bun install --frozen-lockfile
install -d -m 700 .state
install -m 600 config/operator.example.json .state/operator.json
bun run run
```

Set `ZOLTAR_LIQUIDATOR_CONFIG` to use another operator file. The bot accepts no
command-line arguments. The dashboard defaults to
`http://127.0.0.1:4183`.

The dashboard's **Chain and RPC connectivity** form is the source of network and
endpoint selection. It chain-checks the read, public-submission, and independent
quorum RPCs before saving them. An initially unconfigured process remains paused
with its dashboard available and begins scanning only after a verified selection is
saved. Same-chain RPC changes apply at the next scan. A chain profile includes its
signer, deployments, markets, selections, strategy, RPCs, and runtime state path.
Profiles are private sibling files beside the active operator file, and a newly
created profile receives a separate chain-named recovery state path. This prevents
transactions, staged operations, and scan state from crossing chains. Docker and
direct Bun use the same in-process switching behavior.

The primary read RPC is sufficient when the active chain profile uses agreement `1`.
Independent quorum RPCs become mandatory when that profile uses agreement `2`.

A configured bot keeps its dashboard available when retryable RPC transport
unavailability prevents startup validation. It reports `connectivity-degraded`, shows
per-endpoint health in the dashboard, and retries with bounded backoff. `/healthz`
provides process-liveness checks without dashboard authentication. The supplied
Compose service checks that endpoint and uses `restart: unless-stopped` if the bot
process exits unexpectedly. Contradictory chain, malformed response, or other safety
validation failures stop startup instead of being treated as an outage.

Native loopback dashboards and the supplied host-loopback Compose setup need no
password. Outside that Compose setup, if `runtime.uiHost` is `0.0.0.0`, set
`ZOLTAR_BOT_DASHBOARD_PASSWORD` to at least 16 characters before startup. For a
custom network-bound container, remove `ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED`
and explicitly pass the password into the container. The browser's HTTP Basic prompt
uses username `operator` and that password. Keep the listener on a trusted network
or behind an authenticated TLS proxy: Basic authentication protects access but does
not encrypt the private key or settings in transit. Mutable requests also retain
same-origin and fixed-authority checks, and JSON request bodies are capped at 1 MiB.

Keep `runtime.execute` false until the factory, WETH, signer, selected pools, RPC
endpoints, gas limits, and REP limits have been reviewed. When execution is
enabled:

- `connectivity.readRpcUrl` supplies the local operational view.
- `connectivity.rpcQuorum` is `1` or `2` and belongs to the selected chain profile.
- `connectivity.quorumRpcUrls` is optional for agreement `1`. For agreement `2`, it
  must contain at least two independent read RPCs.
- For a critical pool, price, vault, or candidate snapshot, only a retryable
  transport failure makes a reader unavailable. The configured number of readers
  must respond, and every responding reader must agree exactly before a transaction
  is sent. Under the opt-in two-reader policy, one transport-unavailable endpoint degrades
  health without stopping a healthy two-reader quorum. A malformed or contradictory
  response is a safety fault and fails closed.
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
moves the signer's REP backing units and capacity ownership to the chosen child
and atomically creates the child security pool when it does not exist. Claimable
fees remain redeemable from the parent, while escalation accounting follows its
separate migration path described in the
[canonical migration design](../../docs/explanation/statoblast.html#migration).
The bot does not split a
parent vault across outcomes. Once the child becomes operational, normal vault
maintenance and liquidation continue there because the next registry scan
inherits the selected parent pool onto its approved child. A missing approved
child, closed migration window, empty vault, active staged operation involving
the bot vault, disabled migration setting, or conflicting child approval
produces no migration.

Pool-selection inheritance is a configuration reconciliation and remains active
in dry-run mode and when automatic vault migrations are disabled. Only the
on-chain vault movement is controlled by `allowAutomaticVaultMigrations`.

The bot bootstraps every registered vault, then keeps an incremental index of
vaults with REP backing or REP committed to a dispute. It refreshes those active
positions and any vaults reported by accounting checkpoints on every scan.
Empty registrations are discarded after inspection, so they do not consume
steady-state memory or hide older liquidation opportunities.

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

- `minimumLiquidationDebtEth` and `maximumLiquidationDebtEth` bound the human-readable ETH debt requested from a target; parsing produces internal `minimumLiquidationDebtAttoEth` and `maximumLiquidationDebtAttoEth` values.
- `minimumRewardValueEth` filters the fixed-bonus value before gas.
- `maximumGasCostEth` caps the padded EIP-1559 gas limit actually signed for
  every automated action.
- `maximumOracleRequestCostEth` caps fresh-price bounty funding.
- `maximumPerPoolRep` and `maximumTotalDeployedRep` bound liquidation
  acquisitions and every automatic maintenance deposit.
- `walletReserveRep` remains outside pools.
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

Each cycle performs an authoritative factory read, loads current positions from the known-vault registry, computes
exact protocol floor and rounding behavior, and selects at most one action:

1. Migrate an applicable selected parent vault into its one approved child
   universe.
2. Top up an existing bot vault that is approaching its safety boundary.
3. Withdraw REP that is safely above the configured threshold.
4. Redeem accrued ETH fees.
5. Pre-fund a liquidation vault and submit the best liquidation candidate.

The first bot version uses the backward-compatible self-receiving route: the
signer is both operator and receiver vault, the target is distinct, and the
approval ID is zero. The operator therefore pays gas and any oracle costs and its
own receiver vault receives the debt, capacity ownership, and REP award. The
contracts also support separately authorized receiver vaults, but this bot does
not install or consume delegated receiver approvals.

Transaction intent and outcomes are written to `runtime.stateFile`. The activity
journal is restored on restart. A signed intent, nonce, serialized transaction,
submission block, and validity ceiling are fsynced before relay or RPC
submission. Restart recovery quorum-checks receipts and nonce state. It never
rebroadcasts an ambiguous price-dependent intent using stale market evidence.
Public intents remain blocked until the original receipt appears or a finalized
replacement or cancellation proves that the same signer nonce was consumed.
Private intents expire only after their relay validity ceiling plus twelve
canonical confirmation blocks. Non-price-dependent intents can resubmit the
exact durable signed transaction while it remains viable. Transport failures enter
`connectivity-degraded`, remain visible, and retry with bounded backoff. Safety
failures such as contradictory chain state or execution evidence still pause
automatic execution until operator review.

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

> Use a dedicated low-balance signer, begin on Sepolia, keep dry-run logs, and
> supervise pool health. Assumed pool open interest
> remains an economic obligation even when the fixed liquidation bonus is
> positive.
