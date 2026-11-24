# augurScan API reference

All routes are read-only. The UI supplies its selected `chainId`; direct clients should do the same when they need a single network. Request `chainId` values and constructed camel-case response fields such as top-level `chainId` are JSON numbers. Database-backed `chain_id` fields, PostgreSQL `bigint`/`numeric` values, and on-chain integer quantities are lossless decimal strings. `log_index`, `transaction_index`, `tick_spacing`, page limits/offsets, and bounded integer counts are JSON numbers. Exact totals are JSON numbers unless a route documents a lossless decimal string. Addresses, hashes, opaque cursors, and domain identifiers are strings.

## Contents

- [Endpoint index](#endpoint-index)
- [Access control and rate limits](#access-control-and-rate-limits)
- [Health and metrics](#health-and-metrics)
- [Search and chain evidence](#search-and-chain-evidence)
- [Operations](#operations)
- [Pagination and bounded responses](#pagination-and-bounded-responses)
- [Evidence and export](#evidence-and-export)
- [Address and contract views](#address-and-contract-views)
- [Historical state](#historical-state)

## Endpoint index

All routes use `GET`. Limits, cursors, and consistency boundaries for every paged route are in [pagination and bounded responses](#pagination-and-bounded-responses).

### Health and metrics routes

| Endpoint | Returns |
| --- | --- |
| `/health/live` | Liveness. |
| `/health/ready` | Database readiness. |
| [`/health/indexers`](#get-healthindexers) | Indexer freshness, durable ownership diagnostics, and the current integrity audit. |
| [`/metrics`](#get-metrics) | Prometheus request, rate-limit, lag, last-success, and failure metrics. |

### Search and chain evidence routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/networks` | Network status, including retained networks. Each item has an `enabled` flag from the server network configuration. |
| [`/api/v1/search?q=:query&chainId=:optionalChainId&limit=:limit`](#get-apiv1search) | Global search. |
| [`/api/v1/transactions/:chainId/:hash`](#get-apiv1transactionschainidhash) | Internal transaction evidence. |
| [`/api/v1/blocks/:chainId/:number`](#get-apiv1blockschainidnumber) | Internal block evidence. |
| [`/api/v1/stream`](#get-apiv1stream) | Durable commit, reorg, and status notifications. |

### Operations routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/operations?chainId=:chainId&atBlock=:canonicalBlock` | [Operations overview](#operations-overview) with an `asOf` envelope. |
| `/api/v1/state/{reports\|escalations\|auctions\|risk\|forks\|integrity}?chainId=:chainId` | Report, escalation, auction, risk, fork, and chain-integrity catalogs. |
| `/api/v1/state/trading?chainId=:chainId&q=:search` | AMM market catalog with ETH volume. |
| `/api/v1/state/reports/:chainId/:openOracleAddress/:reportId` | [Report detail](#report-detail). |
| `/api/v1/state/{escalations\|auctions}/:chainId/:contractAddress` | Escalation and auction detail. |
| `/api/v1/state/risk/pools/:chainId/:poolAddress` | Pool risk detail. |
| `/api/v1/state/capital?chainId=:chainId&ledger=:ledger&owner=:owner` | Capital ledgers and owner capital positions, most at risk first. |
| `/api/v1/state/capital/:chainId/:ledgerAddress/:ownerAddress` | One owner's capital position: latest read, read history, and capital and liquidation events. |
| `/api/v1/state/liquidations?chainId=:chainId&ledger=:ledger&owner=:owner` | Commitment take-overs, cures, and report operations, newest first. |
| `/api/v1/state/fees?chainId=:chainId` | Fee economics per security pool universe and the current fee stream of each question. |
| `/api/v1/state/forks/:chainId/:universeIdentity` | Fork detail. |
| `/api/v1/state/trading/:chainId/:marketAddress` | AMM swaps, liquidity events, LP-token ownership, exact price impact, share and ETH volume, fees, reserve-sync TWAP coverage, hourly candles, and [recent market activity](#trading-volume-activity-and-profit-and-loss). |
| `/api/v1/state/timeline?chainId=:chainId&entityType=:type&event=:event&address=:address&q=:text&fromBlock=:from&toBlock=:to&canonical=:scope` | Filterable cross-protocol semantic timeline. |
| `/api/v1/state/timeline/:chainId/:entityType/:entityIdentity` | One entity's canonical semantic timeline. |
| `/api/v1/state/direct-observations?chainId=:chainId&kind=:kind&address=:address&canonical=:scope` | Append-only balance and token-metadata read attempts; see [direct read observations](#direct-read-observations). |

### Evidence and export routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/logs?chainId=:chainId&canonical=:scope` | Paginated logs, including replaced-chain evidence with `canonical=orphaned\|all`. |
| `/api/v1/logs/:chainId/:blockHash/:txHash/:logIndex` | Full log occurrence; add `canonical=all` to open an orphan directly. |
| `/api/v1/reorgs?chainId=:chainId&limit=:limit&cursor=:cursor` | Snapshot-bound reorganization inspection. |
| `/api/v1/provenance` | Process-level schema, application, ABI, and network-configuration provenance. |
| [`/api/v1/export?chainId=:chainId&dataset=:dataset&fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`](#get-apiv1export) | Snapshot-bound newline-delimited JSON export for `logs`, `timeline`, or `reorgs`. |
| `/api/v1/actions?chainId=:chainId` | Top-level actions from receipts selected by protocol sources, tracked REP-token logs, or configured Uniswap filters. |

### Address and contract routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/contracts?chainId=:chainId` | System contract registry and deployment evidence. |
| `/api/v1/contracts/:chainId/:address` | Contract identity. |
| `/api/v1/richlist?chainId=:chainId` | Bounded address rankings with native currency and per-token REP/WETH breakdowns, pool associations, and `capital_positions`. |
| `/api/v1/address-transactions?chainId=:chainId&address=:address` | Snapshot-bound sent transactions. |
| `/api/v1/address-interactions?chainId=:chainId&address=:address` | Snapshot-bound transactions that reference an address without using it as sender. |
| `/api/v1/address-identity?chainId=:chainId&address=:address` | Known protocol identity. |
| `/api/v1/state/address-security-pool?chainId=:chainId&address=:address` | Reconstructed AMM LP balances, per-market trading profit and loss, fork/report participation, and the address's `capital_positions`. |

### Historical state routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/state/catalog?chainId=:chainId` | Pools, questions, and universes. |
| `/api/v1/state/pools/:chainId/:poolAddress?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Pool history, including AMM, coordinator REP/ETH, OpenOracle, and Uniswap price series. |
| `/api/v1/state/questions/:chainId/:questionId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Question usage. |
| `/api/v1/state/universes/:chainId/:universeId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Universe history. |

## Access control and rate limits

The website and API do not require authentication. API routes have a process-local per-client limit controlled by `API_RATE_LIMIT_PER_MINUTE`, which defaults to 600 and returns `429` with `Retry-After` when exceeded. Set it to `0` only when an upstream limiter is authoritative. A client is an IPv4 address or an IPv6 /64 network. Behind a reverse proxy, every user shares the proxy's quota unless `TRUSTED_PROXY_ADDRESSES` lists it; see [Operations](OPERATIONS.md).

## Health and metrics

### `GET /health/indexers`

Returns indexer freshness, durable ownership diagnostics, and the current integrity audit. The route returns HTTP 503 when `status` is not `healthy`.

**Ownership.** Ownership is reconciled with the actual PostgreSQL advisory-lock backend, so it remains useful when the API and indexer run in separate processes. Conditional ownership writes prevent a standby or an older release from replacing a current lock holder. Each configured network reports one state, together with the observed backend PID, durable heartbeat, and owning run when available:

| State | Notes |
| --- | --- |
| `owned` | Does not degrade `status`. |
| `standby` | Does not degrade `status`. |
| `release-failed` | Takes precedence while its recorded backend still owns the lock. |
| `stale-owner` | A conflicting lock. |
| `unknown` | Also reported for every network when the health query itself fails. |

A lease is recorded as released only after unlock is confirmed, or after the exact expected backend is terminated and independently observed without the lock.

**Integrity issues.**

- An empty `integrityIssues` means the checkpoint, log cursors, and canonical parent continuity pass from the greater of the configured start block and `indexed_block - 10000`. Older retained continuity is not re-audited by this endpoint.
- The array caps at 100 ordered chain/code records without a total, truncation flag, or continuation.

**Status.** `status: degraded` can also reflect a stale indexer, an ownership state other than `owned` or `standby`, or an enabled network whose indexer has never recorded it, which `missingNetworks` lists by `id` and `chainId`. Only the networks that `NETWORKS` enables are reported; retained rows of a disabled network do not affect `status`.

### `GET /metrics`

Returns bounded Prometheus request, rate-limit, indexer-lag, last-success, and failure metrics. It is not subject to the API rate limit.

## Search and chain evidence

### `GET /api/v1/search`

| Parameter | Required | Meaning |
| --- | --- | --- |
| `q` | yes | 1–128 characters. |
| `chainId` | no | Without it, the search covers every network that `NETWORKS` enables. A disabled network's retained history is searched only when its `chainId` is supplied. |
| `limit` | no | Defaults to 10 and caps at 25, so later candidates may be omitted. |

The response has `items` and `query`, plus `chainId` when supplied. Each item provides `type`, `label`, and an internal `href`.

- Exact address queries can yield an address shortcut and a matching canonical pool; pool results precede address shortcuts within each network.
- Canonical transaction hashes, block hashes and numbers, question IDs, and report IDs also match. Question and report IDs match in decimal or in the `0x`-prefixed hexadecimal form that question pages display.
- Question title matching requires at least two characters.

### `GET /api/v1/transactions/:chainId/:hash`

Returns `{ transaction, logs }`: a canonical indexed transaction, its decoded action summary when available, and its canonical logs. Transaction receipts expose `callTraceStatus` and a call tree when available. The route returns `404` for retained orphaned evidence.

### `GET /api/v1/blocks/:chainId/:number`

Returns `{ block, transactions, hasMore, sampleLimit }`.

| Field | Meaning |
| --- | --- |
| `block` | The canonical block. |
| `transactions` | The first 250 indexed transactions in transaction order. |
| `hasMore` | Identifies a longer block. |
| `sampleLimit` | Reports the bound. |

The route returns `404` for retained orphaned evidence.

### `GET /api/v1/stream`

Durable commit, reorg, and status notifications with seven-day `Last-Event-ID` replay. A stream cursor older than seven days receives a reset event so the client reloads current state. The server admits `LIVE_MAX_CLIENTS` streams (256 by default), at most `LIVE_MAX_CLIENTS_PER_CLIENT` (16) per rate-limit client, and returns `503` with `Retry-After` when either limit is reached. Polling or heartbeat maintenance closes a stream once it is older than `LIVE_MAX_STREAM_LIFETIME_MS` (30 minutes) or has stayed backpressured longer than `LIVE_BACKPRESSURE_TIMEOUT_MS` (60 seconds); the browser reconnects with `Last-Event-ID` and receives the events it missed.

## Operations

### Operations overview

The Operations overview returns at most 250 report summaries, 250 escalation summaries, 250 auction summaries, 250 pools, every capital ledger (at most 250), the 100 capital positions most at risk, the latest 25 liquidation-feed entries, the fee economics of every universe, 100 fork-root summaries, 30 recent semantic changes, and the latest coordinator price. It supplies exact snapshot totals for reports, escalations, auctions, pools, and markets, plus a current all-time `reorganizations` total; it does not supply an exact fork-root total. Dedicated catalogs expose continuation controls, and the dedicated fork catalog supplies its exact root total. Every Operations `asOf` envelope includes the selected `blockNumber`, `indexedHead`, `observedHead`, `historyDepthBlocks`, and `lagBlocks`. For an `atBlock` response, `historyDepthBlocks` is the distance from the fixed historical block to the current indexed head, while `lagBlocks` is its distance to the observed provider head; `historical` is true and live refreshes do not advance the selected evidence boundary.

Operations overview is also bounded without continuation. Its available exact totals link clients to dedicated catalogs; fork clients use the dedicated catalog's exact `data.total`. A response without a documented continuation field or completeness signal cannot be made complete by inventing an offset.

### Cursors

Report, escalation, auction, fork, market, integrity, and entity-detail cursors are bound to their selected block/hash, latest invalidation ID, and applied ABI/application/projection source hashes. The live indexed head may advance while a cursor is followed: continuation responses remain anchored to the cursor block, report `historical: true`, and expose the newer `indexedHead`. The selected block becoming noncanonical or the invalidation/source generation changing returns `409`; restart from the first page. The integrity cursor also fixes the greatest replacement ID visible on its first page, so a later replacement returns `409`. A malformed cursor or one reused with a different chain, entity, collection, dataset, filter scope, or explicit `atBlock` returns `400`; correct the request. Report, escalation, auction, fork, and capital-position details accept `atBlock`, which must be a retained canonical block; a continuation that also supplies `atBlock` must name the cursor's block. The risk catalog uses a pool-address keyset at the selected boundary; capital positions have their own ledger-and-position cursor.

### Risk

Risk endpoints return block-tagged snapshot evidence with availability, protocol state, and scanner severity. Reads sampled under schema version 2 also identify their indexer run and ABI/application/projection source hashes. Surviving snapshots migrated from version 1 have null run/source fields because that provenance was not recorded at the time. The operations overview, risk catalog, and pool risk details accept `atBlock`; the block must be retained and canonical. The overview applies that boundary to every report, escalation, auction, fork, price, risk, and recent-change identity, latest-state lookup, protocol count, and protocol aggregate. `totals.reorganizations` intentionally remains current operational provenance because invalidation records describe the scanner's history rather than on-chain state at the requested block. Its `asOf` object also exposes the current invalidation ID and applied source hashes that identify the materialization generation. A pool's risk record reports its question-settlement state, and its `scanner_severity` is `unavailable`: underwriting risk belongs to the owner capital positions of the shared security pool's capital ledgers, described under [Capital positions and liquidations](#capital-positions-and-liquidations). Risk-catalog pagination includes an exact `poolTotal`. Risk detail's `history.accountingSnapshots` collection contains the pool's `QuestionAccountingCheckpoint` events: the accounting `reason`, settlement collateral, share-token supply, and last settlement security pool time as exact integer seconds on the fork-adjusted security pool clock, not a Unix timestamp. Accounting reasons are `0` (Accrual), `1` (PoolInitialization) and `2` (CollateralReconciliation). Its `history.stateSnapshots` collection contains immutable schema-v2 sampling observations, including repeated attempts for the same block and method, with their run/source provenance and latest invalidation ID, primary reason, and complete cause set when applicable. The collection can also contain migrated v1 survivors with the null provenance described above.

### Report detail

Each report-detail round contains `comparison.state`, the previous round/block identity when available, and a sorted `changes` array. Every change identifies its dotted field path, `added|changed|removed` kind, and the available `before`/`after` values. The comparison baseline is the next older canonical evidence row, including across a page boundary. `data.coordinatorDecisions` is a separate page: follow its `nextCursor` as `decisionCursor` without advancing the report-round cursor. It lists the shared price feed's `PriceRequested`, `ReportFundingAssigned`, `PriceReported`, `PriceReportRejected`, `PriceReportDeferred`, and `PendingReportRecovered` for the report, and the `ReportCompleted` its report escrow emits for that feed.

### Capital positions and liquidations

Underwriting capital is held per owner in one capital ledger per security pool universe. augurScan samples these tagged reads through the snapshot mechanism:

- `capital-ledger` (one per ledger): `securityPool`, `universeId`, `acceptedPrice`, `conservativePrice`, `liquidationPrice`, `priceValidUntil`, `priceValid`, `frozen`, `importing`, the ledger `totals()` as `pledgedAttoRep`, `commitmentAttoEth` and `healthyCommitmentAttoEth`, `demandAttoEth`, `spareCommitmentAttoEth` (commitment above demand), the universe's `fees` (see [Fee economics](#fee-economics)), `totalFreeAttoRep`, `retirementCashAttoRep`, the commitment index's `lastPositionId`, the security pool's `priceFeed` for the universe, and `collateral`.
- `capital-owner` (one per ledger and owner): `ownerCollateral(owner)` as `principalAttoRep`, `commitmentAttoEth` and `withdrawableAttoRep`; `ownerAccount(owner)` as `positionId`, `freeAttoRep` and `targetHealthFactorBps` (the target the ledger enforces: a stored zero is the default 10000); the live position's `pledgedAttoRep`, `maxHealthyPrice`, retirement fields and `liquidationStartedAt`; `unclaimedFeesAttoEth` and `unclaimedFeesAttoRep` (account fees plus the earnings the commitment index still holds); and the ledger price fields above.

`requiredAttoRep` is the commitment index's `requiredRep(commitment, liquidationPrice, securityMultiplierBps, 10000)`, and `healthFactorBps` is `pledgedAttoRep × 10000 / requiredAttoRep`, rounded down. Both are absent without a commitment or before the ledger accepts a price. `belowLiquidationPrice` is the ledger's take-over condition `maxHealthyPrice < liquidationPrice`; `takeoverPreconditionsMet` additionally requires a started take-over clock, a fresh price, and an open ledger: not frozen, not importing, and in a universe Zoltar has not forked (`universeForked`, from `zoltar.getForkTime(universeId)`), as the ledger's `_requireOpen` does. It is never set for an auction cohort, which is taken over per bid.

An owner is sampled once a capital event names it (`PrincipalDeposited`, `PrincipalWithdrawn`, `CommitmentAuthorized`, `HealthTargetSet`, `EarningsClaimed`, `RepairAuctionBidMaterialized`) or once one of its positions is read. Position ids are sequential, so a third tagged read, `capital-position` (one per ledger and id, `{ ledger, positionId, owner }` from the commitment index's `accountOf(id).owner`), is taken once for every id up to the ledger's `lastPositionId`. This finds the owners a fork imported into a child ledger without any event, and it names the owners behind `CommitmentTakenOver` and `CommitmentCured`, which carry position ids only. A position keeps its owner for life, so a successful read is never repeated and a later read identifies an earlier event's position. Until an id is read, `source_owner` or `receiver_owner` is null. The auction adapter owns an auction cohort's aggregate position; its `capital-owner` read reports that cohort position (`repairAuctionCohort: true`, `repairAuctionCohortRemainingLots`) because the ledger keeps the cohort outside the adapter's owner account.

Each position carries `protocol_state`, `scanner_severity` and `scanner_reason`:

| `protocol_state` | Meaning | `scanner_severity` |
| --- | --- | --- |
| `takeover-preconditions-met` | `takeoverPreconditionsMet` is true. This is not a promise that a take-over succeeds: the ledger first attempts an unpaid cure. If it restores health, the call succeeds with zero commitment transferred. Cure eligibility also uses the ledger's private immutable `minimumCommitmentAttoEth`; the ledger does not expose a getter for it. | `critical` |
| `under-collateralized` | `belowLiquidationPrice` is true, or the health factor is below 10000 bps, without the take-over preconditions. An auction cohort stays in this state because it is taken over per materialized bid. | `critical` |
| `healthy` | Commitment backed above the liquidation price | `warning` below a health factor of 12000 bps, otherwise `healthy`. The 12000 bps band is the scanner's, not the protocol's. |
| `uncommitted` | No commitment | `healthy` |
| `frozen` | The universe forked, or the ledger is frozen or importing fork choices | `unavailable` |
| `unavailable` | The read failed or the ledger has no price | `unavailable` |

`GET /api/v1/state/capital` returns `data.ledgers` (at most 250, each with its latest successful read, `owner_count`, the owners known from ledger events and position reads up to the snapshot block, and `latest_read_status`, `latest_read_block_number` and `latest_read_failure_reason` of its latest read attempt, so a failed sample after the successful read stays visible) and `data.positions` with `items`, exact `total`, `limit`, `offset`, `hasMore` and `nextCursor`. Positions are ordered by ascending `healthFactorBps`; positions without one follow, ordered by ledger and owner. `ledger` and `owner` filter both collections' positions; `atBlock` selects a retained block, and a ledger appears only from its discovery or deployment block.

`GET /api/v1/state/capital/:chainId/:ledgerAddress/:ownerAddress` returns the position, its `ledger`, `history.snapshots` (the latest 250 retained reads, newest first, with `truncated`), and `events`: the ledger events that name the owner together with the take-overs, cures and report operations attributed to it. Before the position's first tagged read, an owner that such events name is returned with `read_status: unsampled` and `protocol_state: unavailable` together with its events; the route returns `404` only when the snapshot block has neither a read nor an event for the owner.

`GET /api/v1/state/liquidations` returns `CommitmentTakenOver`, `CommitmentCured` and `ReportOperationAttempted` entries with `ledger_address`, `securityPool`, `universe_id`, `collateral`, `source_owner` and `receiver_owner`. A report operation is attributed to the ledger whose shared price feed emitted it and to its `sponsor`; the event does not say which ledger call the operation was. `CommitmentCured` is emitted both by a take-over's cure-first step and by an owner lowering their own commitment through `setCommitment`; the event does not say which. No entry is attributed to a question pool: a take-over moves commitment between owners of one universe's ledger. Owner attribution is not bound to the snapshot block, because a position's owner never changes: a position read that lands between two pages of an `owner`-filtered list can add entries to a later page that an earlier page did not yet match. Restart the list to see them in order.

### Fee economics

Fees are accounted per security pool universe. A universe is identified by its capital ledger; its configuration and balances come from the `fees` object of the tagged `capital-ledger` read, and its totals are sums of events up to the snapshot block.

| Field | Source |
| --- | --- |
| `fees.annualFeeBps`, `fees.purchaseFeeBps` | The security pool's `annualFeeBps()` and `purchaseFeeBps()`. |
| `fees.feeStreams`, `fees.services` | The ledger's `feeStreams()` and the security pool's `services()`: the vesting-stream contract read below, and the contract whose `PremiumFunded` is attributed to the universe. |
| `fees.vestingOutstandingAttoEth`, `fees.vestingOutstandingAttoRep`, `fees.deferredAttoEth`, `fees.deferredAttoRep`, `fees.vestingReleasedThrough`, `fees.vestingDurationSeconds` | The ledger's `SecurityPoolCapitalFeeStreams`: `outstandingEth`, `outstandingRep`, `deferredEth`, `deferredRep`, `releasedThrough`, `rewardDuration`. Outstanding amounts are funded earnings still vesting to owners; deferred amounts are stale income awaiting its burn. |
| `fees.settlementBook`, `fees.bookId`, `fees.bookCashAttoEth`, `fees.bookFeeCashAttoEth`, `fees.bookFeesEnabled` | The security pool settlement's `ledger()` and `bookIds(universeId)`, and that book's `books(bookId)`. Absent book fields mean the universe has no registered book. |
| `accrued_atto_eth`, `accrual_count` | Sum and count of `AggregateFeesAccrued.cashAttoEth` of the universe's book: the annual fee the book moved from question collateral to its fee escrow. |
| `purchase_fees_atto_eth`, `purchase_cash_atto_eth`, `purchase_count` | Sums and count of the security pool's `CompleteSetsFunded` for the universe. |
| `premium_funded_atto_eth` | Sum of the services contract's `PremiumFunded.amountAttoEth` for the universe. |
| `earnings_funded_atto_eth` | `purchase_fees_atto_eth - premium_funded_atto_eth`: the services contract funds the owners' vesting stream with the purchase fee less the resolution premium. |
| `claimed_atto_eth`, `claimed_atto_rep`, `claim_count` | Sums and count of the ledger's `EarningsClaimed`. |
| `burned_atto_eth`, `burned_atto_rep`, `burn_count` | Sums and count of the ledger's `UnassignedFeesBurned`. |

`fees` is absent and `fee_read_error` is set when the latest fee read failed, including when the whole capital-ledger read failed after the latest successful one; `latest_read_status`, `latest_read_block_number` and `latest_read_failure_reason` describe that latest attempt. The universe's book and services contract never change, so the totals then use the latest earlier read that carried them. When no read has carried them yet, `accrued_atto_eth`, `accrual_count`, `premium_funded_atto_eth` and `earnings_funded_atto_eth` are absent rather than zero, and the universe has no question streams. The settlement book is indexed from the block that registered it, so accruals before that block are not counted.

`GET /api/v1/state/fees` returns `data.universes` (at most 250) and `data.questionStreams` with `items`, `limit` (default 100, at most 250) and `truncated`. A stream item is the latest `FeeStreamReplaced` of one question in one universe's book: `rate_claim_units_per_second`, `end_timestamp`, `rate_claim_units_per_year` (the rate over a 365-day year), and `claim_unit_scale` (`"1000000000"`). The rates are internal claim units, not raw collateral amounts. Their cash value depends on the book's cash-to-claim-unit index, which these historical events do not record; dividing by the scale alone does not recover a cash rate. The browser therefore presents stream status and end time. Universe cash fee totals above remain raw collateral amounts. A rate of zero means the question has no stream. A fork copies the source book's streams into the child universe's book without an event, so an inherited stream is not listed for the child until it is replaced there. The Operations overview carries the universes as `data.feeEconomics`; its `risk` object and the risk catalog carry `feeEconomics` and the 25 most recently replaced `questionFeeStreams`.

No event or view reports how much of an accrual each owner earned: the commitment index credits fees to owners internally, so per-owner earnings are visible only as a position's `unclaimedFeesAttoEth` and as `EarningsClaimed`.

### Fork detail

`data.summary` counts the events of the forked universe: `portfolio_fork_events` counts `ForkFrozen`, `BranchChosen`, `NeutralCashRecovered`, `ReporterForkFrozen`, and `ReporterChildCreated` for the universe together with `BranchStarted` and `BranchActivated` of its child universes. `reporter_fork_frozen_count` is the number of `ReporterForkFrozen` events; `reporter_migration_atto_rep` and `reporter_protected_parent_atto_rep` are sums across those events of `migrationAttoRep` (live reporter escrow that migrates) and `protectedParentAttoRep` (REP of games finalized before the fork, which stays in the parent). `data.events` lists every event that names the universe, including `ReporterChildCreated` under both its source and its child.

### Escalation detail

`data.events` lists the game's own events and the reporter ledger's `GameRegistered` and `ReporterFinalityScheduled` for that game. The escalation catalog's `event_name` is the game's latest own event; a reporter-ledger event is reported only for a game that has none. The ledger's `ReporterBalanceChanged` names a universe and a question but no game, so it is a timeline entry of the `reporter-ledger` entity instead.

### Auction detail

Auction `AttoEth` amounts (lots, demand, proceeds, refunds and fees) are base units of the auction's collateral token, not native ETH. `data.collateral` is that token's `{ address, symbol, decimals }` from the auction's latest successful tagged read at or below the selected block, or null before a read samples it, in which case amounts are raw collateral base units. `data.snapshot` remains the latest read, which can be a failure; the token is immutable, so a failed read does not hide it. Global timeline catalog rows carry the same `collateral` for the `auction` entity; `vault`, `capital-position`, `securityPool`, `security-pool-services` and `settlement-book` rows carry the security pool's collateral token from the latest successful read of a capital ledger whose address, security pool, services or settlement book starts the row's identity; other entities carry null, and rich-list `auction_claims` entries carry it as `collateral`.

### Direct read observations

`chainId` is required. `kind` defaults to `all` and accepts `all`, `address-balance`, or `token-metadata`. `canonical` defaults to `canonical` and also accepts `orphaned` or `all`. For balance observations, `address` matches either the balance owner or the asset contract; for metadata observations, it matches the token contract. `limit` defaults to 100 and caps at 250.

The response contains `chainId`, the standard Operations `asOf` boundary, and `data` with `items`, `totalIsExact: false`, `limit`, `offset`, `hasMore`, and `nextCursor` when another page exists. It does not calculate a chain-wide total. Follow the cursor until `hasMore` is false. Cursor offsets must remain safe integers. Every item contains:

| Field | Meaning |
| --- | --- |
| `observation_kind`, `observation_id` | Variant and append-only identity |
| `chain_id`, `block_hash`, `block_number`, `block_timestamp`, `observed_at` | Tagged chain position and scanner observation time |
| `address`, `asset_address`, `asset_kind` | Owner/token identity; metadata rows have null asset fields |
| `read_status`, `read_failure_reason`, `result` | `success` or `failed`, a bounded failure description when failed, and variant data |
| `indexer_run_id`, `abi_source_hash`, `application_source_hash`, `projection_source_hash` | Process and source provenance; migrated version 1 rows can be null |
| `canonical`, `evidence_status` | Current canonicality and `canonical`, `chain-orphaned`, `manifest-superseded`, `coverage-reset`, or `noncanonical-unknown` classification |
| `invalidation_id`, `invalidation_reason`, `invalidation_causes`, `invalidated_at` | Latest replacement provenance, null while canonical |

An address-balance `result` contains `balance` as a decimal string on success or `readFailureReason` on failure. A token-metadata `result` contains the available `name`, `symbol`, and `decimals`; failed rows also contain `readError`. Raw `offset` is rejected. Continue only with the returned cursor because it binds both observation-kind maxima, all filters and the `asOf` generation.

### Semantic state and coverage

Escalation catalog stake fields are the latest canonical tagged `getOutcomeBalancesAttoRep` read through the response boundary, with `balance_block_number` and `balance_read_status`. They are null when no read is available, not cumulative deposits. The getter returns INVALID, YES, and NO; `None` is a resolution value, not a fourth balance. Question pool history includes `escalation_address`, the tagged `read_result`, and `resolution_block` for each pool's universe.

Address security pools add `share_positions` (`items`, `truncated`, `basis`), `pending_refunds`, and `escalation_positions`. The latter two arrays cap at 250 and expose `pending_refunds_truncated` and `escalation_positions_truncated`. These collections have no continuation. Each `pending_refunds` entry has `auction_address`, `pending_atto_eth` and `collateral`: the `{ address, symbol, decimals }` of the auction's collateral token from its latest successful tagged read, or null before one samples it, in which case the amount is in raw collateral base units. Share positions aggregate canonical ERC-1155 transfers by token, universe, and holder; market details expose the same bounded structure as `sharePositions`. Each item's `collateral` is the `{ address, symbol, decimals }` of the collateral token of a pool on that share token and universe, from its latest successful tagged read, or null before one samples it; outcome shares use that token's precision, and are raw base units without it. Complete sets are the minimum of INVALID, YES, and NO balances. Migration mints count once, and `migration_locked` identifies source positions with indexed migration evidence. `recovery_locked` identifies source positions whose holder spent security pool recovery rights beyond the credits received before that spend, which `ShareToken` locks against transfer. Balances are partial if deployment history is incomplete. An `escalation_positions` entry reports `consumed_block` and `consumption_reason` from its `CarryDepositConsumed`, and `retired_block` when the game's `OrdinarySettlementInitialized` chose another outcome: ordinary settlement retires every losing deposit at once without a per-deposit event.

Escalation positions retain indexed local-deposit history. Security pools additionally expose `escalation_payouts`: `items` carry a game address, snapshot block/hash, and a `position` with local/inherited kind, status, original/source/retained principal, reward interval, payable REP, protocol burn allocation, calculation inputs, and inherited proof. Membership and sparse-nullifier roots are checked against the tagged contract state. Recursive allocation uses `getInheritedClaimAllocation`; payout arithmetic preserves Solidity integer-division order and the fork-threshold haircut. Pending, losing, checkpoint-required and resolution-mismatch positions do not expose payable amounts.

Escalation snapshot `read_result.claimEvidence` contains the same positions and an availability status. Reconstruction is bounded to 1024 unique reads, 32 games along the ancestry chain (including the sampled game), 256 local leaves per game/outcome, and 256 inherited snapshot leaves; exceeding these limits or failing proof verification marks claim evidence unavailable while preserving the basic game snapshot. Positions cap at 250 per game, with `truncated`. Security pool results also cap at 250 with `truncated`; `unavailable_games`, `truncated_games`, and `sampled_games` describe chain-wide latest sampled escalation coverage, not only the requested depositor. Unsampled games cannot supply payout evidence.

Each [inherited carry proof](../docs/reference/merkle-mountain-range.html#proofs) is independent against the snapshot's nullifier root, not sequentially valid as a batch. Refresh after settlement or a canonical-chain change. [Payouts and haircut allocations](../docs/explanation/escalation-game.html#payouts) belong to the immutable depositor. A successful claim transfers the payable REP to that depositor’s wallet; the quote is not a read of its current wallet balance. Refund balances subtract indexed withdrawals from indexed credits.

Integrity includes `decodeCoverage` for the selected chain and snapshot: observed/decoded/undecoded calls, up to 100 destination/selector groups with `truncated`, selected/traced transaction counts, and the latest 100 reverted transactions. Trace counts cover selected transactions, not the fraction of all chain activity observed. Newly ingested transaction receipts identify `selectionSource: "protocol-log"`. `callTraceStatus` is `not-requested` by default, `available` when optional selected-transaction tracing succeeds, or `unavailable` / `unavailable-historical-state` when the provider cannot supply it. Available traces include a call tree. Failed and eventless calls are outside new indexing coverage; retained older evidence may include them.

## Pagination and bounded responses

| Surface | Required scope and filters | Page contract | Consistency boundary |
| --- | --- | --- | --- |
| `logs` | `chainId`; optional `event`, `address`, `decoded`; `canonical` defaults to `canonical` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is unavailable. | Selected block/hash, invalidation/source generation, and exact filter scope; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| `reorgs` | `chainId` | `limit` defaults to 50 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, and the greatest replacement ID visible on the first page; a later replacement returns `409` |
| `export` | `chainId`; `dataset=logs\|timeline\|reorgs`; optional block range; `canonical` filters only logs and timeline, while reorganization rows have no canonical/orphan classification | `limit` defaults to 5,000 and caps at 50,000; pages also stop at 8 MiB of UTF-8 NDJSON. Pass `x-augurscan-next-cursor` as `cursor` until absent. Raw `offset` is rejected. See [`GET /api/v1/export`](#get-apiv1export). | Indexed block/hash, latest invalidation ID, filter scope, and source hashes; changed snapshot returns `409` |
| Report, escalation, auction, and fork catalogs | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Fork responses also return exact `data.total`. | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Risk catalog | `chainId` | `limit` defaults to 100 and caps at 250; compare the returned pools with exact `data.pagination.poolTotal`, and pass `data.pagination.poolNextCursor` as `poolCursor` while `poolHasMore` | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Trading catalog | `chainId`; also accepts `q` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Its encoded offset accepts every non-negative safe integer and has no artificial 100,000-row ceiling. | Selected block/hash, invalidation/source generation, and exact search filter; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Integrity catalog | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Replacements continue by `(detected_at, id)` keyset; `data.offset` is a display count rather than a database offset. | Selected block/hash, invalidation/source generation, and greatest replacement ID visible on the first page; a later invalidation returns `409` |
| Global timeline catalog | `chainId`; optional entity, event, address, text, block range, and canonical filters | `limit` defaults to 100 and caps at 250; `data.totalIsExact` is false; no total is computed. Unscoped `q` needs three consecutive Unicode letters or digits for indexed substring search; other text requires an entity, event, or address filter. `data.nextCursor` continues `(block_number, log_index, tx_hash, block_hash, entity_type, entity_identity)` | Selected block/hash, invalidation/source generation, and exact filter set; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Report, escalation, auction, fork, trading, and timeline details | Path identity and chain | `limit` defaults to 100 and caps at 250; continue the nested event collection with its `nextCursor` while `hasMore`. Report details page coordinator evidence independently with `decisionLimit` and `decisionCursor` in `data.coordinatorDecisions`. | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Direct read observations | `chainId`; `kind=all\|address-balance\|token-metadata`; optional address and canonical scope | `limit` defaults to 100 and caps at 250; `data.totalIsExact` is false; no total is computed. `data.nextCursor` continues by `(observed_at, kind, id)` within a snapshot that fixes the greatest visible ID for each observation kind. Raw `offset` is rejected. | Selected block/hash, invalidation/source generation, exact filters, and first-page observation IDs; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Pool risk details | Path identity and chain; optional `atBlock` | `limit` defaults to 250 and caps at 1,000; pass `data.history.nextCursor` as `cursor` while `truncated`. The state, accounting, and lifecycle histories use independent keyset positions in that cursor. Raw `offset` is rejected. | Selected block/hash, invalidation/source generation, and exact risk identity; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Pool, question, and universe history | Path identity and chain; optional `fromBlock`/`toBlock` | `limit` defaults to 1,000 and caps at 2,000; pass `coverage.nextCursor` as `cursor` while present. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, exact identity and block range, and scanner start; changed history returns `409` |
| Address transactions | `chainId` and `address` | `limit` defaults to 50 and caps at 100; pass top-level `nextCursor` as `cursor` until absent | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Rich list | Optional `chainId`; `address` requires it; `sort=transactions\|eth\|weth\|rep`. REP sorting uses each address's largest individual sampled REP holding, normalized by the token's indexed decimals or 18 when metadata is unavailable; distinct REP tokens are not summed. | `limit` defaults to 50 and caps at 100; increase `offset` until `offset + items.length >= total`; offset caps at 100,000, so ranks past 100,100 are not reachable and the browser stops offering more rows after that offset | With `chainId`, the selected canonical block and invalidation/source generation; continuation invalidation returns `409`. Without `chainId`, live offset. |
| State catalog | Optional `chainId` and `q`; see [Historical state](#historical-state) for selection and paging | See [Historical state](#historical-state) | Current request |
| Address interactions | `chainId` and `address` | `limit` defaults to 20 and caps at 100; returns exact `total` and top-level `nextCursor` | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Actions | `chainId` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent | Selected block/hash, invalidation/source generation, and chain scope; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Provenance | None; migrations and runs are global | All migration records plus up to 100 runs by default, capped at 250; follow top-level `nextCursor` while `runsTruncated` | Live `(started_at, id)` keyset; new runs do not move the older continuation |
| Rich-list nested collections | One returned rich-list address | `capital_positions` holds the latest read of at most 100 capital positions the address owns, one per universe ledger. Pool associations cap at 100 and can be compared with `pool_count`; REP/WETH balances cap at 100 and expose sampled/returned counts plus truncation flags; escalation and auction claims cap at latest 100 with no total or truncation signal | Current request |
| Address security pool LP, fork, and report collections | `chainId` and `address` | Each request returns at most 100 LP positions, fork-participation records, and report-participation records per collection. Other security pool collections use the separate bounds in [Semantic state and coverage](#semantic-state-and-coverage). `data.securityPoolPagination.{lp,forks,reports}` supplies an exact total, offset, `hasMore`, and its own `nextCursor`; pass that cursor as `lpCursor`, `forkCursor`, or `reportCursor` without advancing the other collections. | Selected block/hash, invalidation/source generation, and collection total; a newer head is allowed, while invalidation, source change, or a changed selected history returns `409` |
| Operations overview and risk-catalog evidence | `chainId` and an optional risk catalog cursor | `capitalPositions` holds the 100 positions most at risk with exact `capitalPositionTotal`, `capitalLedgers` at most 250 ledgers, and `recentLiquidations` the latest 25 liquidation-feed entries; none has a continuation here and the pool cursor does not advance them. Use the capital and liquidation catalogs for complete lists. | Indexed-block response |
| Capital catalog | `chainId`; optional `ledger`, `owner`, `atBlock` | `limit` defaults to 100 and caps at 250; pass `data.positions.nextCursor` as `cursor` while `data.positions.hasMore`. Raw `offset` is rejected. | Selected block/hash plus invalidation/source generation |
| Capital detail and liquidation catalog | Path identity or `chainId` with optional `ledger`, `owner`, `atBlock` | `limit` defaults to 100 and caps at 250; continue `data.events` or `data` with its `nextCursor` while `hasMore`. A cursor is bound to its filters. | Selected block/hash plus invalidation/source generation |
| Auction-detail demand curve | Path identity and chain | `demandCurve` sums `BidSubmitted.lots` per `minimumAttoRepPerLot` level in fill order (lowest limit first) and returns at most the first 1,000 levels with `lots` and `cumulativeLots`; `amountAttoEth` and `cumulativeDemandAttoEth` multiply by `RepairAuctionStarted.lotAttoEth` and are present only once that event is indexed. `demandCurveTruncated` signals omitted levels, but there is no continuation | Indexed-block response |
| Trading-detail analytics | Path identity and chain | `lpPositions` contains at most the 250 largest nonzero balances with no total, truncation flag, or continuation. TWAP/candles calculate from at most 10,000 Sync candidates drawn from the last seven days and an optional earlier opening observation; `observationLimit`, `observationsTruncated`, and `observationRange` expose that bound, but there is no observation continuation | Indexed-block response |


## Evidence and export

### `GET /api/v1/export`

A snapshot-bound newline-delimited JSON export. Use it for durable audit files with per-page identity, ordering, and snapshot checks.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `chainId` | yes | The network. |
| `dataset` | no | `logs`, `timeline`, or `reorgs`; defaults to `timeline`. |
| `fromBlock`, `toBlock` | no | Block range. |
| `canonical` | no | `canonical`, `orphaned`, or `all` for logs or timeline. Reorganization records are durable replacements rather than canonical/orphan rows, so the parameter does not filter them. |
| `limit` | no | Defaults to 5,000 and cannot exceed 50,000. Each page also stops at 8 MiB of UTF-8 NDJSON; a single larger record returns `400` rather than being silently truncated. |
| `cursor` | no | The previous response's `x-augurscan-next-cursor`. |

| Response header | Meaning |
| --- | --- |
| `x-augurscan-returned` | The row count. |
| `x-augurscan-snapshot-total` | `unknown`; export does not run a full-history count. |
| `x-augurscan-truncated` | Whether another page exists. |
| `x-augurscan-next-cursor` | The continuation, when truncated. |

Snapshot block/hash, invalidation ID, and the selected network's applied ABI/application/projection source hashes are repeated in response headers and encoded in the cursor. The applied hashes are updated only when the process that owns that network's indexer lease successfully seeds its configuration and replay decision; starting a standby process does not change them. An indexed replacement or a change to any applied source marker returns `409` instead of mixing pages. Canonical rows are bounded by the snapshot checkpoint. Orphaned and all-evidence exports also include retained noncanonical logs and timeline entries above that checkpoint when an invalidation at or before the snapshot invalidation ID identifies the occurrence. This preserves displaced evidence while the canonical index catches up.

**Log rows.** Every exported log occurrence contains its raw `topics` and `data`, current decoded display fields, decode error, and its complete immutable log `interpretations` array. Each interpretation identifies its kind/key, serialized result, run, run schema/application version, ABI/application/projection source hashes, and interpretation time.

**Reorganization rows.** Every coverage-reset sentinel with `reason: start-boundary-advanced` is included regardless of the requested block range, because it records a coverage reset rather than an on-chain block. Its `ancestor_block` is `-1`; `previous_block` is null when no checkpoint existed or identifies the displaced indexed tip when history was present.

### Reorganizations, integrity, and provenance

`GET /api/v1/reorgs` is a snapshot-bound inspection view. A replacement or source-generation change returns `409`; restart at the first page. Use the `reorgs` export for durable audit files.

Noncanonical logs and timeline rows include `evidence_status`, `invalidation_id`, `invalidation_reason`, and `invalidation_causes`. Status distinguishes chain orphans, manifest supersession, coverage reset, ABI re-decode, projection rebuild, and unknown legacy invalidation. Reorganization list, integrity, and export records expose `causes`, exact per-kind `occurrence_counts`, `indexer_run_id`, and the invalidating `abi_source_hash`, `application_source_hash`, and `projection_source_hash`; `reason` remains the primary compatibility value. Records created outside a provenance-aware indexer run can have null run/source fields rather than inferred values. Log detail also returns immutable action/log interpretations with their indexer run and source hashes, so a later decoder or projection can be compared with the interpretation that originally produced a view.

`GET /api/v1/state/integrity?chainId=:chainId` is the Operations catalog, not the current continuity check. Its replacement `data.items` and `data.total` are filtered to the selected chain; follow `data.nextCursor` while `data.hasMore` is true. That cursor is bound to the indexed block/hash, materialization generation, and greatest replacement ID visible on the first page. A later invalidation returns `409` so clients restart rather than combine generations. It advances replacements only. `data.migrations` is the global schema-migration history, and `data.runs` repeats the latest 25 global process runs on every replacement page; neither is chain-filtered. The UI's **Show more indexed records** control therefore advances only replacement records and ends with **All indexed records are shown.**

`GET /api/v1/provenance` returns the same global migration history and a page of process runs. A run records schema/application versions, ABI/application/projection source hashes, whether indexing was enabled, network configuration, and start/stop times. Follow `nextCursor` while `runsTruncated` is true. `remainingTotal` is the number of rows at or after the current page boundary, not a frozen global total. Use the `reorgs` NDJSON export when an audit needs every replacement record without catalog pagination.

## Address and contract views

When `chainId` is supplied, a rich-list response includes top-level `snapshotBlock` (the selected block number as a decimal string) and `snapshotCursor` (an opaque snapshot token). Pass that token as the `snapshot` query parameter on subsequent offset pages, keeping the same `chainId`, `sort`, and `address` filter. This pins rankings while the indexed head advances. Restart from offset zero without `snapshot` if continuation returns `409`. Responses without `chainId` omit both snapshot fields and remain live; `snapshot` requires a chain-scoped request.

Follow the opaque `nextCursor` for later address-transaction or address-interaction pages. Each cursor is endpoint-specific and bound to the chain, address, snapshot block/hash, latest invalidation ID, applied source hashes, exact total, and last transaction position. A reorg, semantic rebuild, or historical insertion returns `409` with an instruction to restart that collection.

For address security pools, follow the three collection cursors independently. Each cursor is bound to the chain, address, collection name, selected block/hash, latest invalidation ID, applied source hashes, exact collection total, and offset. A newer head is allowed and the continuation stays on the selected block. An invalidation/source-generation change or loss of that canonical block returns `409 Indexed state changed; restart pagination`; a total change within the same generation returns `409 SecurityPool history changed; restart pagination`.

### Trading volume, activity, and profit and loss

Trading amounts derive from indexed events only: pool `CompleteSetCreated`, `CompleteSetRedeemed`, and `SharesRedeemed`; pair `Swap`, liquidity, and LP `Transfer`; and share-token `TransferSingle`/`TransferBatch`. Router events are also indexed and projected. This flow calculation uses the pool, security-pool-funding, pair and share events. A pool complete-set event whose minter or redeemer also sent the pair's `Swap` in the same transaction is a router `enter` (exact-input swap) or `exit` (exact-output swap); one whose minter also added liquidity is collateral-funded `add-liquidity`. A minter or redeemer whose share balance the transaction leaves unchanged is a pass-through, and the action belongs to the one account it forwarded shares to or received shares from. Remaining pair events are `swap`, `add-liquidity`, or `remove-liquidity` actions without a collateral amount; `SharesRedeemed` is `settlement`.

- Catalog items and the detail `summary` add `eth_volume_atto_eth`, `eth_volume_24h_atto_eth`, `eth_volume_7d_atto_eth`, `eth_trade_count`, and `eth_trade_count_24h`. These `eth_*` fields contain market-collateral base units: volume is collateral paid into router enters plus collateral returned by router exits; share-for-share swaps carry no collateral amount and are counted only in the share-denominated `input_volume_*` fields.
- The detail `activity` page lists actions newest first with `kind`, `side` (the outcome bought, held, or sold, when applicable), `account`, `shares` (long shares, LP tokens, complete sets, or winning shares by kind), `eth_in_atto_eth`, `eth_out_atto_eth`, `timestamp_seconds`, block, transaction, and log position. `activityLimit` defaults to 50 and caps at 250; follow `activity.nextCursor` as `activityCursor`. It is bound like the event cursor and independent of it.

**Security pool `trading_pnl`.** `trading_pnl.items` has one entry per market where the address has attributed collateral flows or current shares or LP tokens, capped at 250 with `truncated`.

| Field | Meaning |
| --- | --- |
| `cost_basis_atto_eth` | Collateral paid into the pool for complete sets minted for the address, directly or through the router, plus the purchase charge recorded in `CompleteSetsFunded`, including the resolution premium. |
| `proceeds_atto_eth` | Collateral returned when its shares were redeemed, exited through the router, or settled. |
| `holdings_value_atto_eth` | While the pair still trades, the collateral an exit would return at the latest indexed reserves and complete-set exchange rate: LP tokens removed pro rata, complete sets redeemed, then the largest router insured exit of INVALID plus one long outcome. |
| `valuation.partial`, `valuation.unvalued_*` | Shares that cannot return collateral that way. They count as zero, so unrealized and net results are then lower bounds. |
| `valuation.status`, `valuation.reason` | `unavailable` with a reason once trading closes, because settlement value is not derived. |
| `unrealized_pnl_atto_eth`, `net_pnl_atto_eth` | Omitted, together with `holdings_value_atto_eth`, when the valuation is unavailable. |

Realized profit uses cost recovery: while a position is open it is the amount by which proceeds exceed cost; a closed position realizes `proceeds − cost`.

The pair is treated as still trading while all of these hold:

- the question end time is indexed and in the future;
- there is no `UniverseForked` for the universe;
- there is no `SharesRedeemed`;
- the newer of the latest pool state event and tagged pool read is operational and not awaiting fork continuation;
- neither the tagged pool read nor the pool's sampled escalation game reports a resolution.

Limits of the reconstruction:

- Router actions are attributed to the account whose shares were minted or burned. The router's `PositionExitedByTransfer` and `CompleteSetRedeemedByTransfer` events are indexed as timeline evidence, but this reconstruction reads only share transfers and pool events, so a router `recipient` or `payoutRecipient` that differs from that account does not change the attribution.
- A resolution that has no redemption yet and is not reflected in a sampled pool or escalation read is not observable from events, so until that sampling catches up the valuation can still assume an open market.
- Shares received by plain transfer carry no cost basis.
- Collateral changes after the latest indexed pool accounting event are not reflected.

## Historical state

**State catalog selection.** Without `q`, pass `selectedType=pools|questions|universes` and `selectedIdentity` to `/api/v1/state/catalog` to include one matching canonical entity even when it falls beyond the bounded catalog page. Selection does not add an entity to filtered results.

Every history response includes `coverage` with the requested range, scanner start, indexed-through block/hash, per-series returned counts, page offset, `complete`, and an opaque `nextCursor` when older rows remain. `complete: true` requires the requested range to be inside scanner coverage, the first page, and every series to fit. Rows are chronological within a page and use their actual indexed timestamps. Snapshot-bound state histories and keyset exports use the full retained occurrence identity as their final ordering key, so competing hashes, multiple events in one block, and multiple semantic entities from one log do not produce an ambiguous page order. A state-history cursor is valid only for the exact endpoint identity and block range at the original indexed block/hash, scanner start, materialization generation, and applied source hashes; restart from the first page after HTTP 409.

State catalog pages default to 500 and cap at 1,000 rows per entity class. Use `offset` to continue beyond a page while the class's `truncated` flag is true; keep the same `chainId`, `q`, and `limit`. The `q` filter searches questions by title or ID, pools by address or question title, and universes by ID. Supporting `poolStates` rows cover the returned pools. The response includes exact unfiltered `totals`, the page `offset`, per-class `truncated` flags, and a `catalogVersion` digest of canonical entity identities, ordering fields, and question titles for the selected chain. Restart at offset zero if the version differs between pages. Without `q`, a selected entity is appended only if it is absent from the bounded page. History endpoints default to 1,000 and cap at 2,000 records per series. For history, `truncated: true` means at least one series has more records; continue with `coverage.nextCursor`, narrow the block range, or use the export endpoint.

Pool history returns:

- `market`: indexed Augur pair identity and fee, when present
- `ammPrices`: exact YES/NO reserves and complementary conditional spot prices
- `repEthPrices`: settlements the coordinator accepted, each with its report ID and settlement time
- `uniswapRepEthPrices`: venue-attributed REP/WETH, REP/USDC, or REP/native-ETH spot observations and raw liquidity evidence
- `openOracleHistory`: coordinator-linked OpenOracle lifecycle evidence

These are event-time observations. AMM and Uniswap spot series are not presented as manipulation-resistant oracle values. See [STATE_MODEL.md](STATE_MODEL.md) for the retained-evidence model, field provenance, and completeness rules.

Token display metadata is bounded to 256 UTF-8 bytes for names and 64 bytes for symbols. Contract reverts, malformed metadata and oversized responses are recorded as permanent metadata failures. Connection failures remain retryable with a bounded retry budget. Raw token addresses remain available when metadata is unavailable.
