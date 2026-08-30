# augurScan API reference

All routes are read-only. The UI supplies its selected `chainId`; direct clients should do the same when they need a single network. Request `chainId` values and constructed camel-case response fields such as top-level `chainId` are JSON numbers. Database-backed `chain_id` fields, PostgreSQL `bigint`/`numeric` values, and on-chain integer quantities are lossless decimal strings. `log_index`, `transaction_index`, `tick_spacing`, page limits/offsets, and bounded integer counts are JSON numbers. Exact totals are JSON numbers unless a route documents a lossless decimal string. Addresses, hashes, opaque cursors, and domain identifiers are strings.

## Health and operations

- Liveness: `GET /health/live`
- Database readiness: `GET /health/ready`
- Indexer freshness, ownership diagnostics, and the current integrity audit: `GET /health/indexers`. An empty `integrityIssues` means the checkpoint, log cursors, and canonical parent continuity pass from the greater of the configured start block and `indexed_block - 10000`; older retained continuity is not re-audited by this endpoint. The issue array caps at 100 ordered chain/code records without a total, truncation flag, or continuation. `status: degraded` can also reflect a stale indexer.
- Prometheus request, rate-limit, lag, last-success, and failure metrics: `GET /metrics`
- Network status: `GET /api/v1/networks`
- Operations overview with an `asOf` envelope: `GET /api/v1/operations?chainId=:chainId&atBlock=:canonicalBlock`
- Report, escalation, auction, risk, fork, market, and chain-integrity catalogs: `GET /api/v1/state/{reports|escalations|auctions|risk|forks|trading|integrity}?chainId=:chainId`
- Report detail: `GET /api/v1/state/reports/:chainId/:openOracleAddress/:reportId`
- Escalation and auction detail: `GET /api/v1/state/{escalations|auctions}/:chainId/:contractAddress`
- Pool and vault risk detail: `GET /api/v1/state/risk/pools/:chainId/:poolAddress` and `GET /api/v1/state/risk/vaults/:chainId/:poolAddress/:vaultAddress`
- Fork detail: `GET /api/v1/state/forks/:chainId/:universeIdentity`
- AMM market catalog: `GET /api/v1/state/trading?chainId=:chainId&q=:search`
- AMM swaps, liquidity events, LP-token ownership, exact price impact, volume, fees, reserve-sync TWAP coverage, and hourly candles: `GET /api/v1/state/trading/:chainId/:marketAddress`
- Filterable cross-protocol semantic timeline: `GET /api/v1/state/timeline?chainId=:chainId&entityType=:type&event=:event&address=:address&q=:text&fromBlock=:from&toBlock=:to&canonical=:scope`
- One entity's canonical semantic timeline: `GET /api/v1/state/timeline/:chainId/:entityType/:entityIdentity`
- Append-only balance and token-metadata read attempts: `GET /api/v1/state/direct-observations?chainId=:chainId&kind=:kind&address=:address&canonical=:scope`

Set both `AUGURSCAN_ACCESS_USERNAME` and `AUGURSCAN_ACCESS_PASSWORD` to require HTTP Basic authentication on every route except liveness and readiness. Use it only behind TLS. API routes have a process-local per-client limit controlled by `API_RATE_LIMIT_PER_MINUTE`, which defaults to 600 and returns `429` with `Retry-After` when exceeded. Set it to `0` only when an upstream limiter is authoritative.

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

The Operations overview returns at most 250 report summaries, 250 escalation summaries, 250 auction summaries, 250 pools, 250 vaults, 100 fork-root summaries, 30 recent semantic changes, and the latest coordinator price. It supplies exact snapshot totals for reports, escalations, auctions, pools, vaults, and markets, plus a current all-time `reorganizations` total; it does not supply an exact fork-root total. Dedicated catalogs expose continuation controls, and the dedicated fork catalog supplies its exact root total. Every Operations `asOf` envelope includes the selected `blockNumber`, `indexedHead`, `observedHead`, `historyDepthBlocks`, and `lagBlocks`. For an `atBlock` response, `historyDepthBlocks` is the distance from the fixed historical block to the current indexed head, while `lagBlocks` is its distance to the observed provider head; `historical` is true and live refreshes do not advance the selected evidence boundary.

Report, escalation, auction, fork, market, integrity, and entity-detail cursors are bound to the indexed block/hash, latest invalidation ID, and applied ABI/application/projection source hashes. The integrity cursor also fixes the greatest replacement ID visible on its first page. A malformed cursor or one reused with a different chain, entity, collection, dataset, or filter scope returns `400`; correct the request. A changed indexed head or materialization generation for the same scope returns `409`; restart from the first page. Risk catalogs use independent pool-address and vault-address keysets at the same indexed boundary.

Risk endpoints return block-tagged snapshot evidence with availability, protocol state, and scanner severity. Reads sampled under schema version 2 also identify their indexer run and ABI/application/projection source hashes. Surviving snapshots migrated from version 1 have null run/source fields because that provenance was not recorded at the time. The operations overview, risk catalog, and pool/vault risk details accept `atBlock`; the block must be retained and canonical. The overview applies that boundary to every report, escalation, auction, fork, price, risk, and recent-change identity, latest-state lookup, protocol count, and protocol aggregate. `totals.reorganizations` intentionally remains current operational provenance because invalidation records describe the scanner's history rather than on-chain state at the requested block. Its `asOf` object also exposes the current invalidation ID and applied source hashes that identify the materialization generation. Directly observed bad debt remains `critical`; calculations that depend on mismatched snapshot hashes or an invalid coordinator price are unavailable rather than zero. Risk-catalog pagination includes exact `poolTotal` and `vaultTotal` values; the two cursors advance independently. Risk detail's `history.stateSnapshots` collection contains immutable schema-v2 sampling observations, including repeated attempts for the same block and method, with their run/source provenance and latest invalidation ID, primary reason, and complete cause set when applicable. The collection can also contain migrated v1 survivors with the null provenance described above.

## Pagination and bounded responses

| Surface | Required scope and filters | Page contract | Consistency boundary |
| --- | --- | --- | --- |
| `logs` | `chainId`; optional `event`, `address`, `decoded`; `canonical` defaults to `canonical` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is unavailable. | Indexed block/hash, invalidation/source generation, and exact filter scope; change returns `409` |
| `reorgs` | `chainId` | `limit` defaults to 50 and caps at 250; pass top-level `nextCursor` as `cursor` until absent. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, and the greatest replacement ID visible on the first page; a later replacement returns `409` |
| `export` | `chainId`; `dataset=logs|timeline|reorgs`; optional block range; `canonical` filters only logs and timeline, while reorganization rows have no canonical/orphan classification | `limit` defaults to 5,000 and caps at 50,000; pass `x-augurscan-next-cursor` as `cursor` until absent. Legacy `offset` is rejected. A `start-boundary-advanced` sentinel is always included in a reorganization export because it records a coverage reset rather than an on-chain block. | Indexed block/hash, latest invalidation ID, exact total, filter scope, and source hashes; changed snapshot returns `409` |
| Report, escalation, auction, and fork catalogs | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Fork responses also return exact `data.total`. | Indexed block/hash plus invalidation/source generation; changed snapshot returns `409` |
| Risk catalog | `chainId` | `limit` defaults to 100 and caps at 250; compare the returned pools/vaults with exact `data.pagination.poolTotal`/`vaultTotal`, and continue each independently with `poolNextCursor`/`vaultNextCursor` | Indexed block/hash plus invalidation/source generation; changed snapshot returns `409` |
| Trading catalog | `chainId`; also accepts `q` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Its encoded offset accepts every non-negative safe integer and has no artificial 100,000-row ceiling. | Indexed block/hash, invalidation/source generation, and exact search filter; changed snapshot returns `409` |
| Integrity catalog | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Its encoded offset accepts every non-negative safe integer and has no artificial 100,000-row ceiling. | Indexed block/hash, invalidation/source generation, and greatest replacement ID visible on the first page; a later invalidation returns `409` |
| Global timeline catalog | `chainId`; optional entity, event, address, text, block range, and canonical filters | `limit` defaults to 100 and caps at 250; `data.total` is an exact lossless decimal string and `data.nextCursor` continues `(block_number, log_index, tx_hash, block_hash, entity_type, entity_identity)` | Indexed block/hash, invalidation/source generation, and exact filter set; changed snapshot returns `409` |
| Report, escalation, auction, fork, trading, and timeline details | Path identity and chain | `limit` defaults to 100 and caps at 250; continue the nested event collection with its `nextCursor` while `hasMore`. Report details page coordinator evidence independently with `decisionLimit` and `decisionCursor` in `data.coordinatorDecisions`. | Indexed block/hash plus invalidation/source generation; changed snapshot returns `409` |
| Direct read observations | `chainId`; `kind=all|address-balance|token-metadata`; optional address and canonical scope | `limit` defaults to 100 and caps at 250; `data.total` is exact and `data.nextCursor` continues a snapshot that fixes the greatest visible ID for each observation kind. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, exact filters, and first-page observation IDs; changed snapshot returns `409` |
| Pool/vault risk details | Path identity and chain; optional `atBlock` | `limit` defaults to 250 and caps at 1,000; pass `data.history.nextCursor` as `cursor` while `truncated`. Raw `offset` is rejected. | Selected block/hash, invalidation/source generation, and exact risk identity; changed history returns `409` |
| Pool, vault, question, and universe history | Path identity and chain; optional `fromBlock`/`toBlock` | `limit` defaults to 1,000 and caps at 2,000; pass `coverage.nextCursor` as `cursor` while present. Raw `offset` is rejected. | Indexed block/hash, invalidation/source generation, exact identity and block range, and scanner start; changed history returns `409` |
| Address transactions | `chainId` and `address` | `limit` defaults to 50 and caps at 100; pass top-level `nextCursor` as `cursor` until absent | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Rich list | Optional `chainId`; `address` requires it; `sort=transactions|eth|weth` | `limit` defaults to 50 and caps at 100; increase `offset` until `offset + items.length >= total`; offset caps at 100,000 | Live offset |
| State catalog | Optional `chainId` | `limit` defaults to 500 and caps at 1,000 per class; exact totals cover questions, pools, vaults, and universes, while truncation flags cover those four plus `poolStates`; no continuation exists | Current request |
| Address interactions | `chainId` and `address` | `limit` defaults to 20 and caps at 100; returns exact `total` and top-level `nextCursor` | Snapshot block/hash, total, and invalidation/source generation; change returns `409` |
| Actions | `chainId` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent | Indexed block/hash, invalidation/source generation, and chain scope; change returns `409` |
| Provenance | None; migrations and runs are global | All migration records plus up to 100 runs by default, capped at 250; follow top-level `nextCursor` while `runsTruncated` | Live `(started_at, id)` keyset; new runs do not move the older continuation |
| Rich-list nested collections | One returned rich-list address | Pool associations and vault positions cap at 100 and can be compared with `pool_count`/`vault_count`; REP/WETH balances cap at 100 and expose sampled/returned counts plus truncation flags; escalation and auction claims cap at latest 100 with no total or truncation signal | Current request |
| Address portfolio nested collections | `chainId` and `address` | Each request returns at most 100 records per collection. `data.portfolioPagination.{lp,forks,reports}` supplies an exact total, offset, `hasMore`, and its own `nextCursor`; pass that cursor as `lpCursor`, `forkCursor`, or `reportCursor` without advancing the other collections. | Indexed block/hash, invalidation/source generation, and collection total; changed history returns `409` |
| Operations overview and risk-catalog evidence | `chainId` and optional risk catalog cursors | `recentLiquidations` contains the latest 25 and `approvalEvents` the latest 100; neither has a total, truncation flag, or continuation, and the pool/vault cursors do not advance them | Indexed-block response |
| Pool/vault risk-detail approvals | Path identity and chain | `approvalEvents` contains the latest 100 matching approvals with no total, truncation flag, or continuation; `history.nextCursor` advances only the four history arrays | Current request |
| Auction-detail demand curve | Path identity and chain | `demandCurve` aggregates at most 1,000 bid ticks; `demandCurveTruncated` signals omitted ticks, but there is no continuation | Indexed-block response |
| Trading-detail analytics | Path identity and chain | `lpPositions` contains at most the 250 largest nonzero balances with no total, truncation flag, or continuation. TWAP/candles calculate from at most 10,000 Sync candidates drawn from the last seven days and an optional earlier opening observation; `observationLimit`, `observationsTruncated`, and `observationRange` expose that bound, but there is no observation continuation | Indexed-block response |

Operations overview is also bounded without continuation. Its available exact totals link clients to dedicated catalogs; fork clients use the dedicated catalog's exact `data.total`. A response without a documented continuation field or completeness signal cannot be made complete by inventing an offset.

## Evidence and export

- Paginated logs, including replaced-chain evidence with `canonical=orphaned|all`: `GET /api/v1/logs?chainId=:chainId&canonical=:scope`
- Full log occurrence; add `canonical=all` to open an orphan directly: `GET /api/v1/logs/:chainId/:blockHash/:txHash/:logIndex`
- Snapshot-bound reorganization inspection: `GET /api/v1/reorgs?chainId=:chainId&limit=:limit&cursor=:cursor`. A replacement or source-generation change returns `409`; restart at the first page. Use the `reorgs` NDJSON export below for durable audit files with per-page proofs.
- Process-level schema, application, ABI, and network-configuration provenance: `GET /api/v1/provenance`
- Append-only direct read audit, including repeated attempts, run/source hashes, and reorganization, manifest, or coverage invalidation provenance: `GET /api/v1/state/direct-observations?chainId=:chainId&canonical=all`
- Snapshot-bound newline-delimited JSON export for `logs`, `timeline`, or `reorgs`: `GET /api/v1/export?chainId=:chainId&dataset=:dataset&fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`. Add `canonical=:scope` for logs or timeline; reorganization records are durable replacements rather than canonical/orphan rows, so that parameter does not filter them. Every coverage-reset sentinel with `reason: start-boundary-advanced` is included regardless of the requested block range. Its `ancestor_block` is `-1`; `previous_block` is null when no checkpoint existed or identifies the displaced indexed tip when history was present.
- Top-level actions from receipts selected by protocol sources, tracked REP-token logs, or configured Uniswap filters: `GET /api/v1/actions?chainId=:chainId`
- Durable commit, reorg, and status notifications with seven-day `Last-Event-ID` replay: `GET /api/v1/stream`

Export limits default to 5,000 and cannot exceed 50,000. `x-augurscan-returned` gives the row count, `x-augurscan-truncated` reports whether another page exists, and `x-augurscan-next-cursor` supplies the continuation when truncated. Snapshot block/hash, invalidation ID, exact total, and the selected network's applied ABI/application/projection source hashes are repeated in response headers and encoded in the cursor. The applied hashes are updated only when the process that owns that network's indexer lease successfully seeds its configuration and replay decision; starting a standby process does not change them. An indexed replacement or a change to any applied source marker returns `409` instead of mixing pages. Every exported log occurrence contains its raw `topics` and `data`, current decoded display fields, decode error, and its complete immutable log `interpretations` array. Each interpretation identifies its kind/key, serialized result, run, run schema/application version, ABI/application/projection source hashes, and interpretation time. A stream cursor older than seven days receives a reset event so the client reloads current state.

Noncanonical logs and timeline rows include `evidence_status`, `invalidation_id`, `invalidation_reason`, and `invalidation_causes`. Status distinguishes chain orphans, manifest supersession, coverage reset, ABI re-decode, projection rebuild, and unknown legacy invalidation. Reorganization list, integrity, and export records expose `causes`, exact per-kind `occurrence_counts`, `indexer_run_id`, and the invalidating `abi_source_hash`, `application_source_hash`, and `projection_source_hash`; `reason` remains the primary compatibility value. Records created outside a provenance-aware indexer run can have null run/source fields rather than inferred values. Log detail also returns immutable action/log interpretations with their indexer run and source hashes, so a later decoder or projection can be compared with the interpretation that originally produced a view.

`GET /api/v1/state/integrity?chainId=:chainId` is the Operations catalog, not the current continuity check. Its replacement `data.items` and `data.total` are filtered to the selected chain; follow `data.nextCursor` while `data.hasMore` is true. That cursor is bound to the indexed block/hash, materialization generation, and greatest replacement ID visible on the first page. A later invalidation returns `409` so clients restart rather than combine generations. It advances replacements only. `data.migrations` is the global schema-migration history, and `data.runs` repeats the latest 25 global process runs on every replacement page; neither is chain-filtered. The UI's **Show more indexed records** control therefore advances only replacement records and ends with **All indexed records are shown.**

`GET /api/v1/provenance` returns the same global migration history and a page of process runs. A run records schema/application versions, ABI/application/projection source hashes, whether indexing was enabled, network configuration, and start/stop times. Follow `nextCursor` while `runsTruncated` is true. `remainingTotal` is the number of rows at or after the current page boundary, not a frozen global total. Use the `reorgs` NDJSON export when an audit needs every replacement record without catalog pagination.

## Address and contract views

- System contract registry and deployment evidence: `GET /api/v1/contracts?chainId=:chainId`
- Contract identity: `GET /api/v1/contracts/:chainId/:address`
- Bounded address rankings with native currency and per-token REP/WETH breakdowns: `GET /api/v1/richlist?chainId=:chainId`
- Snapshot-bound sent transactions: `GET /api/v1/address-transactions?chainId=:chainId&address=:address`
- Snapshot-bound transactions that reference an address without using it as sender: `GET /api/v1/address-interactions?chainId=:chainId&address=:address`
- Known protocol identity: `GET /api/v1/address-identity?chainId=:chainId&address=:address`
- Reconstructed AMM LP balances and fork/report participation: `GET /api/v1/state/address-portfolio?chainId=:chainId&address=:address`

Follow the opaque `nextCursor` for later address-transaction or address-interaction pages. Each cursor is endpoint-specific and bound to the chain, address, snapshot block/hash, latest invalidation ID, applied source hashes, exact total, and last transaction position. A reorg, semantic rebuild, or historical insertion returns `409` with an instruction to restart that collection.

For address portfolios, follow the three collection cursors independently. Each cursor is bound to the chain, address, collection name, indexed block/hash, latest invalidation ID, applied source hashes, exact collection total, and offset. An indexed-head or materialization-generation change returns `409 Indexed state changed; restart pagination`; a total change within the same generation returns `409 Portfolio history changed; restart pagination`.

Each report-detail round contains `comparison.state`, the previous round/block identity when available, and a sorted `changes` array. Every change identifies its dotted field path, `added|changed|removed` kind, and the available `before`/`after` values. The comparison baseline is the next older canonical evidence row, including across a page boundary. `data.coordinatorDecisions` is a separate page: follow its `nextCursor` as `decisionCursor` without advancing the report-round cursor.

## Historical state

- Pools, questions, vaults, and universes: `GET /api/v1/state/catalog?chainId=:chainId`
- Pool history, including AMM, coordinator REP/ETH, OpenOracle, and Uniswap price series: `GET /api/v1/state/pools/:chainId/:poolAddress?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`
- Vault history: `GET /api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`
- Question usage: `GET /api/v1/state/questions/:chainId/:questionId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`
- Universe history: `GET /api/v1/state/universes/:chainId/:universeId?fromBlock=:from&toBlock=:to&cursor=:cursor&limit=:limit`

Every history response includes `coverage` with the requested range, scanner start, indexed-through block/hash, per-series returned counts, page offset, `complete`, and an opaque `nextCursor` when older rows remain. `complete: true` requires the requested range to be inside scanner coverage, the first page, and every series to fit. Rows are chronological within a page and use their actual indexed timestamps. Snapshot-bound state histories and keyset exports use the full retained occurrence identity as their final ordering key, so competing hashes, multiple events in one block, and multiple semantic entities from one log do not produce an ambiguous page order. A state-history cursor is valid only for the exact endpoint identity and block range at the original indexed block/hash, scanner start, materialization generation, and applied source hashes; restart at page one after HTTP 409.

State catalogs default to 500 and cap at 1,000 rows per entity class. History endpoints default to 1,000 and cap at 2,000 records per series. `truncated: true` means at least one series has more records; continue with `coverage.nextCursor`, narrow the block range, or use the export endpoint.

Pool history returns:

- `market`: indexed Augur pair identity and fee, when present
- `ammPrices`: exact YES/NO reserves and complementary conditional spot prices
- `repEthPrices`: coordinator initialization and accepted settlement observations
- `uniswapRepEthPrices`: venue-attributed REP/WETH, REP/USDC, or REP/native-ETH spot observations and raw liquidity evidence
- `openOracleHistory`: coordinator-linked OpenOracle lifecycle evidence

These are event-time observations. AMM and Uniswap spot series are not presented as manipulation-resistant oracle values. See [STATE_MODEL.md](STATE_MODEL.md) for the retained-evidence model, field provenance, and completeness rules.
