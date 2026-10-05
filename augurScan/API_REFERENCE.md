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
| `/api/v1/networks` | Network status. |
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
| `/api/v1/state/risk/vaults/:chainId/:poolAddress/:vaultAddress` | Vault risk detail. |
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
| `/api/v1/richlist?chainId=:chainId` | Bounded address rankings with native currency and per-token REP/WETH breakdowns. |
| `/api/v1/address-transactions?chainId=:chainId&address=:address` | Snapshot-bound sent transactions. |
| `/api/v1/address-interactions?chainId=:chainId&address=:address` | Snapshot-bound transactions that reference an address without using it as sender. |
| `/api/v1/address-identity?chainId=:chainId&address=:address` | Known protocol identity. |
| `/api/v1/state/address-portfolio?chainId=:chainId&address=:address` | Reconstructed AMM LP balances, per-market trading profit and loss, and fork/report participation. |

### Historical state routes

| Endpoint | Returns |
| --- | --- |
| `/api/v1/state/catalog?chainId=:chainId` | Pools, questions, vaults, and universes. |
| `/api/v1/state/pools/:chainId/:poolAddress?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Pool history, including AMM, coordinator REP/ETH, OpenOracle, and Uniswap price series. |
| `/api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Vault history. |
| `/api/v1/state/questions/:chainId/:questionId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Question usage. |
| `/api/v1/state/universes/:chainId/:universeId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit` | Universe history. |

## Access control and rate limits

The website and API do not require authentication. API routes have a process-local per-client limit controlled by `API_RATE_LIMIT_PER_MINUTE`, which defaults to 600 and returns `429` with `Retry-After` when exceeded. Set it to `0` only when an upstream limiter is authoritative.

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

**Status.** `status: degraded` can also reflect a stale indexer or an ownership state other than `owned` or `standby`.

### `GET /metrics`

Returns bounded Prometheus request, rate-limit, indexer-lag, last-success, and failure metrics. It is not subject to the API rate limit.

## Search and chain evidence

### `GET /api/v1/search`

| Parameter | Required | Meaning |
| --- | --- | --- |
| `q` | yes | 1–128 characters. |
| `chainId` | no | Without it, the search covers every configured network. |
| `limit` | no | Defaults to 10 and caps at 25, so later candidates may be omitted. |

The response has `items` and `query`, plus `chainId` when supplied. Each item provides `type`, `label`, and an internal `href`.

- Exact address queries can yield an address shortcut and a matching canonical pool; pool results precede address shortcuts within each network.
- Canonical transaction hashes, block hashes and numbers, question IDs, and report IDs also match.
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

Durable commit, reorg, and status notifications with seven-day `Last-Event-ID` replay. A stream cursor older than seven days receives a reset event so the client reloads current state. A client that remains backpressured longer than `LIVE_BACKPRESSURE_TIMEOUT_MS` (60 seconds by default) is closed by polling or heartbeat maintenance so it cannot permanently occupy a stream slot.

## Operations

### Operations overview

The Operations overview returns at most 250 report summaries, 250 escalation summaries, 250 auction summaries, 250 pools, 250 vaults, 100 fork-root summaries, 30 recent semantic changes, and the latest coordinator price. It supplies exact snapshot totals for reports, escalations, auctions, pools, vaults, and markets, plus a current all-time `reorganizations` total; it does not supply an exact fork-root total. Dedicated catalogs expose continuation controls, and the dedicated fork catalog supplies its exact root total. Every Operations `asOf` envelope includes the selected `blockNumber`, `indexedHead`, `observedHead`, `historyDepthBlocks`, and `lagBlocks`. For an `atBlock` response, `historyDepthBlocks` is the distance from the fixed historical block to the current indexed head, while `lagBlocks` is its distance to the observed provider head; `historical` is true and live refreshes do not advance the selected evidence boundary.

Operations overview is also bounded without continuation. Its available exact totals link clients to dedicated catalogs; fork clients use the dedicated catalog's exact `data.total`. A response without a documented continuation field or completeness signal cannot be made complete by inventing an offset.

### Cursors

Report, escalation, auction, fork, market, integrity, and entity-detail cursors are bound to their selected block/hash, latest invalidation ID, and applied ABI/application/projection source hashes. The live indexed head may advance while a cursor is followed: continuation responses remain anchored to the cursor block, report `historical: true`, and expose the newer `indexedHead`. The selected block becoming noncanonical or the invalidation/source generation changing returns `409`; restart from the first page. The integrity cursor also fixes the greatest replacement ID visible on its first page, so a later replacement returns `409`. A malformed cursor or one reused with a different chain, entity, collection, dataset, filter scope, or explicit `atBlock` returns `400`; correct the request. Risk catalogs use independent pool-address and vault-address keysets at the same selected boundary.

### Risk

Risk endpoints return block-tagged snapshot evidence with availability, protocol state, and scanner severity. Reads sampled under schema version 2 also identify their indexer run and ABI/application/projection source hashes. Surviving snapshots migrated from version 1 have null run/source fields because that provenance was not recorded at the time. The operations overview, risk catalog, and pool/vault risk details accept `atBlock`; the block must be retained and canonical. The overview applies that boundary to every report, escalation, auction, fork, price, risk, and recent-change identity, latest-state lookup, protocol count, and protocol aggregate. `totals.reorganizations` intentionally remains current operational provenance because invalidation records describe the scanner's history rather than on-chain state at the requested block. Its `asOf` object also exposes the current invalidation ID and applied source hashes that identify the materialization generation. Directly observed bad debt remains `critical`; calculations that depend on mismatched snapshot hashes or an invalid coordinator price are unavailable rather than zero. Risk-catalog pagination includes exact `poolTotal` and `vaultTotal` values; the two cursors advance independently. Risk detail's `history.stateSnapshots` collection contains immutable schema-v2 sampling observations, including repeated attempts for the same block and method, with their run/source provenance and latest invalidation ID, primary reason, and complete cause set when applicable. The collection can also contain migrated v1 survivors with the null provenance described above.

### Report detail

Each report-detail round contains `comparison.state`, the previous round/block identity when available, and a sorted `changes` array. Every change identifies its dotted field path, `added|changed|removed` kind, and the available `before`/`after` values. The comparison baseline is the next older canonical evidence row, including across a page boundary. `data.coordinatorDecisions` is a separate page: follow its `nextCursor` as `decisionCursor` without advancing the report-round cursor.

### Direct read observations

`chainId` is required. `kind` defaults to `all` and accepts `all`, `address-balance`, or `token-metadata`. `canonical` defaults to `canonical` and also accepts `orphaned` or `all`. For balance observations, `address` matches either the balance owner or the asset contract; for metadata observations, it matches the token contract. `limit` defaults to 100 and caps at 250.

The response contains `chainId`, the standard Operations `asOf` boundary, and `data` with `items`, exact numeric `total`, `limit`, `offset`, `hasMore`, and `nextCursor` when another page exists. The endpoint supports at most `Number.MAX_SAFE_INTEGER` matching observations in one snapshot; a larger set returns `400` and asks the caller to narrow `kind`, `address`, or `canonical` so neither the total nor its cursor position can be rounded. Every item contains:

| Field | Meaning |
| --- | --- |
| `observation_kind`, `observation_id` | Variant and append-only identity |
| `chain_id`, `block_hash`, `block_number`, `block_timestamp`, `observed_at` | Tagged chain position and scanner observation time |
| `address`, `asset_address`, `asset_kind` | Owner/token identity; metadata rows have null asset fields |
| `read_status`, `read_failure_reason`, `result` | `success` or `failed`, a bounded failure description when failed, and variant data |
| `indexer_run_id`, `abi_source_hash`, `application_source_hash`, `projection_source_hash` | Process and source provenance; migrated version 1 rows can be null |
| `canonical`, `evidence_status` | Current canonicality and `canonical`, `chain-orphaned`, `manifest-superseded`, `coverage-reset`, or `noncanonical-unknown` classification |
| `invalidation_id`, `invalidation_reason`, `invalidation_causes`, `invalidated_at` | Latest replacement provenance, null while canonical |

An address-balance `result` contains `balance` as a decimal string on success or `readFailureReason` on failure. A token-metadata `result` contains the available `name`, `symbol`, and `decimals`; failed rows also contain `readError`. Raw `offset` is rejected. Continue only with the returned cursor because it binds both observation-kind maxima, all filters, the exact total, and the `asOf` generation.

### Semantic state and coverage

Escalation catalog stake fields are the latest canonical tagged `getOutcomeBalancesAttoRep` read through the response boundary, with `balance_block_number` and `balance_read_status`. They are null when no read is available, not cumulative deposits. The getter returns INVALID, YES, and NO; `None` is a resolution value, not a fourth balance. Question pool history includes `escalation_address`, the tagged `read_result`, and `resolution_block` for each pool's universe.

Address portfolios add `share_positions` (`items`, `truncated`, `basis`), `pending_refunds`, and `escalation_positions`. The latter two arrays cap at 250 and expose `pending_refunds_truncated` and `escalation_positions_truncated`. These collections have no continuation. Share positions aggregate canonical ERC-1155 transfers by token, universe, and holder; market details expose the same bounded structure as `sharePositions`. Complete sets are the minimum of INVALID, YES, and NO balances. Migration mints count once, and `migration_locked` identifies source positions with indexed migration evidence. Balances are partial if deployment history is incomplete.

Escalation positions retain indexed local-deposit history. Portfolios additionally expose `escalation_payouts`: `items` carry a game address, snapshot block/hash, and a `position` with local/inherited kind, status, original/source/retained principal, auction haircut, reward interval, payable REP, protocol burn allocation, calculation inputs, and inherited proof. Membership and sparse-nullifier roots are checked against the tagged contract state. Recursive allocation uses `getInheritedClaimAllocation`; payout arithmetic preserves Solidity integer-division order and the fork-threshold haircut. Pending, losing, parent-claimed, and mismatched-resolution positions do not expose payable amounts.

Escalation snapshot `read_result.claimEvidence` contains the same positions and an availability status. Reconstruction is bounded to 1024 unique reads, 32 games along the ancestry chain (including the sampled game), 256 local leaves per game/outcome, and 256 inherited snapshot leaves; exceeding these limits or failing proof verification marks claim evidence unavailable while preserving the basic game snapshot. Positions cap at 250 per game, with `truncated`. Portfolio results also cap at 250 with `truncated`; `unavailable_games`, `truncated_games`, and `sampled_games` describe chain-wide latest sampled escalation coverage, not only the requested depositor. Unsampled games cannot supply payout evidence.

Each [inherited carry proof](../docs/reference/merkle-mountain-range.html#proofs) is independent against the snapshot's nullifier root, not sequentially valid as a batch. Refresh after settlement or a canonical-chain change. [Payouts and haircut allocations](../docs/explanation/escalation-game.html#payouts) credit the immutable depositor claim bundle; they do not quote the wallet owner's transferable balance. Refund balances subtract indexed withdrawals from indexed credits.

Operations overview includes `feeEconomics`: credited fees summed from accrual-checkpoint reserve increases, pool count, and missing opening-checkpoint count. Integrity includes `decodeCoverage` for the selected chain and snapshot: observed/decoded/undecoded calls, up to 100 destination/selector groups with `truncated`, selected/traced transaction counts, and the latest 100 reverted transactions. Trace counts cover selected transactions, not the fraction of all chain activity observed. Newly ingested transaction receipts identify `selectionSource: "protocol-log"`. `callTraceStatus` is `not-requested` by default, `available` when optional selected-transaction tracing succeeds, or `unavailable` / `unavailable-historical-state` when the provider cannot supply it. Available traces include a call tree. Failed and eventless calls are outside new indexing coverage; retained older evidence may include them.

## Pagination and bounded responses

| Surface | Required scope and filters | Page contract | Consistency boundary |
| --- | --- | --- | --- |
| `logs` | `chainId`; optional `event`, `address`, `decoded`; `canonical` defaults to `canonical` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is unavailable. | Selected block/hash, invalidation/source generation, and exact filter scope; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| `reorgs` | `chainId` | `limit` defaults to 50 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, and the greatest replacement ID visible on the first page; a later replacement returns `409` |
| `export` | `chainId`; `dataset=logs\|timeline\|reorgs`; optional block range; `canonical` filters only logs and timeline, while reorganization rows have no canonical/orphan classification | `limit` defaults to 5,000 and caps at 50,000; pass `x-augurscan-next-cursor` as `cursor` until absent. Raw `offset` is rejected. See [`GET /api/v1/export`](#get-apiv1export). | Indexed block/hash, latest invalidation ID, exact total, filter scope, and source hashes; changed snapshot returns `409` |
| Report, escalation, auction, and fork catalogs | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Fork responses also return exact `data.total`. | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Risk catalog | `chainId` | `limit` defaults to 100 and caps at 250; compare the returned pools/vaults with exact `data.pagination.poolTotal`/`vaultTotal`, and continue each address keyset independently with `poolNextCursor`/`vaultNextCursor` | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Trading catalog | `chainId`; also accepts `q` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Its encoded offset accepts every non-negative safe integer and has no artificial 100,000-row ceiling. | Selected block/hash, invalidation/source generation, and exact search filter; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Integrity catalog | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Replacements continue by `(detected_at, id)` keyset; `data.offset` is a display count rather than a database offset. | Selected block/hash, invalidation/source generation, and greatest replacement ID visible on the first page; a later invalidation returns `409` |
| Global timeline catalog | `chainId`; optional entity, event, address, text, block range, and canonical filters | `limit` defaults to 100 and caps at 250; `data.total` is an exact lossless decimal string and `data.nextCursor` continues `(block_number, log_index, tx_hash, block_hash, entity_type, entity_identity)` | Selected block/hash, invalidation/source generation, and exact filter set; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Report, escalation, auction, fork, trading, and timeline details | Path identity and chain | `limit` defaults to 100 and caps at 250; continue the nested event collection with its `nextCursor` while `hasMore`. Report details page coordinator evidence independently with `decisionLimit` and `decisionCursor` in `data.coordinatorDecisions`. | Selected block/hash plus invalidation/source generation; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Direct read observations | `chainId`; `kind=all\|address-balance\|token-metadata`; optional address and canonical scope | `limit` defaults to 100 and caps at 250; `data.total` is exact and `data.nextCursor` continues by `(observed_at, kind, id)` within a snapshot that fixes the greatest visible ID for each observation kind. Raw `offset` is rejected. | Selected block/hash, invalidation/source generation, exact filters, and first-page observation IDs; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Pool/vault risk details | Path identity and chain; optional `atBlock` | `limit` defaults to 250 and caps at 1,000; pass `data.history.nextCursor` as `cursor` while `truncated`. The state, accounting, lifecycle, and liquidation histories use independent keyset positions in that cursor. Raw `offset` is rejected. | Selected block/hash, invalidation/source generation, and exact risk identity; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Pool, vault, question, and universe history | Path identity and chain; optional `fromBlock`/`toBlock` | `limit` defaults to 1,000 and caps at 2,000; pass `coverage.nextCursor` as `cursor` while present. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, exact identity and block range, and scanner start; changed history returns `409` |
| Address transactions | `chainId` and `address` | `limit` defaults to 50 and caps at 100; pass top-level `nextCursor` as `cursor` until absent | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Rich list | Optional `chainId`; `address` requires it; `sort=transactions\|eth\|weth\|rep`. REP sorting uses each address's largest individual sampled REP holding, normalized by the token's indexed decimals or 18 when metadata is unavailable; distinct REP tokens are not summed. | `limit` defaults to 50 and caps at 100; increase `offset` until `offset + items.length >= total`; offset caps at 100,000 | With `chainId`, the selected canonical block and invalidation/source generation; continuation invalidation returns `409`. Without `chainId`, live offset. |
| State catalog | Optional `chainId` and `q`; see [Historical state](#historical-state) for selection and paging | See [Historical state](#historical-state) | Current request |
| Address interactions | `chainId` and `address` | `limit` defaults to 20 and caps at 100; returns exact `total` and top-level `nextCursor` | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Actions | `chainId` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent | Selected block/hash, invalidation/source generation, and chain scope; a newer head is allowed, while invalidation or loss of the retained boundary returns `409` |
| Provenance | None; migrations and runs are global | All migration records plus up to 100 runs by default, capped at 250; follow top-level `nextCursor` while `runsTruncated` | Live `(started_at, id)` keyset; new runs do not move the older continuation |
| Rich-list nested collections | One returned rich-list address | Pool associations and vault positions cap at 100 and can be compared with `pool_count`/`vault_count`; REP/WETH balances cap at 100 and expose sampled/returned counts plus truncation flags; escalation and auction claims cap at latest 100 with no total or truncation signal | Current request |
| Address portfolio LP, fork, and report collections | `chainId` and `address` | Each request returns at most 100 LP positions, fork-participation records, and report-participation records per collection. Other portfolio collections use the separate bounds in [Semantic state and coverage](#semantic-state-and-coverage). `data.portfolioPagination.{lp,forks,reports}` supplies an exact total, offset, `hasMore`, and its own `nextCursor`; pass that cursor as `lpCursor`, `forkCursor`, or `reportCursor` without advancing the other collections. | Selected block/hash, invalidation/source generation, and collection total; a newer head is allowed, while invalidation, source change, or a changed selected history returns `409` |
| Operations overview and risk-catalog evidence | `chainId` and optional risk catalog cursors | `recentLiquidations` contains the latest 25 and `approvalEvents` the latest 100; neither has a total, truncation flag, or continuation, and the pool/vault cursors do not advance them | Indexed-block response |
| Pool/vault risk-detail approvals | Path identity and chain | `approvalEvents` contains the latest 100 matching approvals with no total, truncation flag, or continuation; `history.nextCursor` advances only the four history arrays | Current request |
| Auction-detail demand curve | Path identity and chain | `demandCurve` aggregates at most 1,000 bid ticks; `demandCurveTruncated` signals omitted ticks, but there is no continuation | Indexed-block response |
| Trading-detail analytics | Path identity and chain | `lpPositions` contains at most the 250 largest nonzero balances with no total, truncation flag, or continuation. TWAP/candles calculate from at most 10,000 Sync candidates drawn from the last seven days and an optional earlier opening observation; `observationLimit`, `observationsTruncated`, and `observationRange` expose that bound, but there is no observation continuation | Indexed-block response |


## Evidence and export

### `GET /api/v1/export`

A snapshot-bound newline-delimited JSON export. Use it for durable audit files with per-page proofs.

| Parameter | Required | Meaning |
| --- | --- | --- |
| `chainId` | yes | The network. |
| `dataset` | yes | `logs`, `timeline`, or `reorgs`. |
| `fromBlock`, `toBlock` | no | Block range. |
| `canonical` | no | `canonical`, `orphaned`, or `all` for logs or timeline. Reorganization records are durable replacements rather than canonical/orphan rows, so the parameter does not filter them. |
| `limit` | no | Defaults to 5,000 and cannot exceed 50,000. |
| `cursor` | no | The previous response's `x-augurscan-next-cursor`. |

| Response header | Meaning |
| --- | --- |
| `x-augurscan-returned` | The row count. |
| `x-augurscan-truncated` | Whether another page exists. |
| `x-augurscan-next-cursor` | The continuation, when truncated. |

Snapshot block/hash, invalidation ID, exact total, and the selected network's applied ABI/application/projection source hashes are repeated in response headers and encoded in the cursor. The applied hashes are updated only when the process that owns that network's indexer lease successfully seeds its configuration and replay decision; starting a standby process does not change them. An indexed replacement or a change to any applied source marker returns `409` instead of mixing pages.

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

For address portfolios, follow the three collection cursors independently. Each cursor is bound to the chain, address, collection name, selected block/hash, latest invalidation ID, applied source hashes, exact collection total, and offset. A newer head is allowed and the continuation stays on the selected block. An invalidation/source-generation change or loss of that canonical block returns `409 Indexed state changed; restart pagination`; a total change within the same generation returns `409 Portfolio history changed; restart pagination`.

### Trading volume, activity, and profit and loss

Trading amounts derive from indexed events only: pool `CompleteSetCreated`, `CompleteSetRedeemed`, and `SharesRedeemed`; pair `Swap`, liquidity, and LP `Transfer`; and share-token `TransferSingle`/`TransferBatch`. The trading router is not a tracked emitter, so its own events are not used. A pool complete-set event whose minter or redeemer also sent the pair's `Swap` in the same transaction is a router `enter` (exact-input swap) or `exit` (exact-output swap); one whose minter also added liquidity is ETH-funded `add-liquidity`. A minter or redeemer whose share balance the transaction leaves unchanged is a pass-through, and the action belongs to the one account it forwarded shares to or received shares from. Remaining pair events are `swap`, `add-liquidity`, or `remove-liquidity` actions without an ETH amount; `SharesRedeemed` is `settlement`.

- Catalog items and the detail `summary` add `eth_volume_atto_eth`, `eth_volume_24h_atto_eth`, `eth_volume_7d_atto_eth`, `eth_trade_count`, and `eth_trade_count_24h`. ETH volume is the ETH paid into router enters plus the ETH returned by router exits; share-for-share swaps carry no ETH amount and are counted only in the share-denominated `input_volume_*` fields.
- The detail `activity` page lists actions newest first with `kind`, `side` (the outcome bought, held, or sold, when applicable), `account`, `shares` (long shares, LP tokens, complete sets, or winning shares by kind), `eth_in_atto_eth`, `eth_out_atto_eth`, `timestamp_seconds`, block, transaction, and log position. `activityLimit` defaults to 50 and caps at 250; follow `activity.nextCursor` as `activityCursor`. It is bound like the event cursor and independent of it.

**Portfolio `trading_pnl`.** `trading_pnl.items` has one entry per market where the address has attributed ETH flows or current shares or LP tokens, capped at 250 with `truncated`.

| Field | Meaning |
| --- | --- |
| `cost_basis_atto_eth` | ETH paid into the pool for complete sets minted for the address, directly or through the router. |
| `proceeds_atto_eth` | ETH returned when its shares were redeemed, exited through the router, or settled. |
| `holdings_value_atto_eth` | While the pair still trades, the ETH an exit would return at the latest indexed reserves and complete-set exchange rate: LP tokens removed pro rata, complete sets redeemed, then the largest router insured exit of INVALID plus one long outcome. |
| `valuation.partial`, `valuation.unvalued_*` | Shares that cannot reach ETH that way. They count as zero, so unrealized and net results are then lower bounds. |
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

- Router actions are attributed to the account whose shares were minted or burned. Router events are not indexed, so a router `recipient` or `payoutRecipient` that differs from that account is not observable.
- A resolution that has no redemption yet and is not reflected in a sampled pool or escalation read is not observable from events, so until that sampling catches up the valuation can still assume an open market.
- Shares received by plain transfer carry no cost basis.
- Fee accrual after the latest indexed pool accounting event is not reflected.

## Historical state

**State catalog selection.** Without `q`, pass `selectedType=pools|questions|vaults|universes` and `selectedIdentity` to `/api/v1/state/catalog` to include one matching canonical entity even when it falls beyond the bounded catalog page. Selection does not add an entity to filtered results. A vault identity is `poolAddress:vaultAddress`.

Every history response includes `coverage` with the requested range, scanner start, indexed-through block/hash, per-series returned counts, page offset, `complete`, and an opaque `nextCursor` when older rows remain. `complete: true` requires the requested range to be inside scanner coverage, the first page, and every series to fit. Rows are chronological within a page and use their actual indexed timestamps. Snapshot-bound state histories and keyset exports use the full retained occurrence identity as their final ordering key, so competing hashes, multiple events in one block, and multiple semantic entities from one log do not produce an ambiguous page order. A state-history cursor is valid only for the exact endpoint identity and block range at the original indexed block/hash, scanner start, materialization generation, and applied source hashes; restart from the first page after HTTP 409.

State catalog pages default to 500 and cap at 1,000 rows per entity class. Use `offset` to continue beyond a page while the class's `truncated` flag is true; keep the same `chainId`, `q`, and `limit`. The `q` filter searches questions by title or ID, pools by address or question title, vaults by vault or pool address, and universes by ID. Supporting `poolStates` rows cover the returned pools. The response includes exact unfiltered `totals`, the page `offset`, per-class `truncated` flags, and a `catalogVersion` digest of canonical entity identities, ordering fields, and question titles for the selected chain. Restart at offset zero if the version differs between pages. Without `q`, a selected entity is appended only if it is absent from the bounded page. History endpoints default to 1,000 and cap at 2,000 records per series. For history, `truncated: true` means at least one series has more records; continue with `coverage.nextCursor`, narrow the block range, or use the export endpoint.

Pool history returns:

- `market`: indexed Augur pair identity and fee, when present
- `ammPrices`: exact YES/NO reserves and complementary conditional spot prices
- `repEthPrices`: coordinator initialization and accepted settlement observations
- `uniswapRepEthPrices`: venue-attributed REP/WETH, REP/USDC, or REP/native-ETH spot observations and raw liquidity evidence
- `openOracleHistory`: coordinator-linked OpenOracle lifecycle evidence

These are event-time observations. AMM and Uniswap spot series are not presented as manipulation-resistant oracle values. See [STATE_MODEL.md](STATE_MODEL.md) for the retained-evidence model, field provenance, and completeness rules.
