# augurScan API reference

All routes are read-only. The UI supplies its selected `chainId`; direct clients should do the same when they need a single network. Request `chainId` values and constructed camel-case response fields such as top-level `chainId` are JSON numbers. Database-backed `chain_id` fields, PostgreSQL `bigint`/`numeric` values, and on-chain integer quantities are lossless decimal strings. `log_index`, `transaction_index`, `tick_spacing`, page limits/offsets/totals, and bounded integer counts are JSON numbers. Addresses, hashes, opaque cursors, and domain identifiers are strings.

## Health and operations

- Liveness: `GET /health/live`
- Database readiness: `GET /health/ready`
- Indexer freshness, ownership diagnostics, and the current integrity audit: `GET /health/indexers`. An empty `integrityIssues` means the checkpoint, log cursors, and canonical parent continuity pass from the greater of the configured start block and `indexed_block - 10000`; older retained continuity is not re-audited by this endpoint. The issue array caps at 100 ordered chain/code records without a total, truncation flag, or continuation. `status: degraded` can also reflect a stale indexer.
- Network status: `GET /api/v1/networks`
- Operations overview with an `asOf` envelope: `GET /api/v1/operations?chainId=:chainId`
- Report, escalation, auction, risk, fork, market, and chain-integrity catalogs: `GET /api/v1/state/{reports|escalations|auctions|risk|forks|trading|integrity}?chainId=:chainId`
- Report detail: `GET /api/v1/state/reports/:chainId/:openOracleAddress/:reportId`
- Escalation and auction detail: `GET /api/v1/state/{escalations|auctions}/:chainId/:contractAddress`
- Pool and vault risk detail: `GET /api/v1/state/risk/pools/:chainId/:poolAddress` and `GET /api/v1/state/risk/vaults/:chainId/:poolAddress/:vaultAddress`
- Fork detail: `GET /api/v1/state/forks/:chainId/:universeIdentity`
- AMM market catalog: `GET /api/v1/state/trading?chainId=:chainId&q=:search`
- AMM swaps, liquidity events, LP-token ownership, exact price impact, volume, fees, reserve-sync TWAP coverage, and hourly candles: `GET /api/v1/state/trading/:chainId/:marketAddress`
- Canonical semantic timeline: `GET /api/v1/state/timeline/:chainId/:entityType/:entityIdentity`

The Operations overview returns at most 250 report summaries, 250 escalation summaries, 250 auction summaries, 250 pools, 250 vaults, 100 fork-root summaries, 30 recent semantic changes, and the latest coordinator price. It supplies exact totals for reports, escalations, auctions, pools, vaults, markets, and reorganizations; it does not supply an exact fork-root total. Dedicated catalogs expose continuation controls, and the dedicated fork catalog supplies its exact root total.

Report, escalation, auction, fork, market, integrity, and entity-detail cursors are bound to the indexed block and hash. A changed head returns `409`; restart from the first page. Risk catalogs use independent pool-address and vault-address keysets at the same indexed boundary.

Risk endpoints return block-tagged snapshot evidence with availability, protocol state, and scanner severity. Directly observed bad debt remains `critical`; calculations that depend on mismatched snapshot hashes or an invalid coordinator price are unavailable rather than zero. Risk-catalog pagination includes exact `poolTotal` and `vaultTotal` values; the two cursors advance independently.

## Pagination and bounded responses

| Surface | Required scope and filters | Page contract | Consistency boundary |
| --- | --- | --- | --- |
| `logs` | Optional `chainId`, `event`, `address`, `decoded`; `canonical` defaults to `canonical` | `limit` defaults to 100 and caps at 250; pass top-level `nextCursor` as `cursor` until absent | Live cursor, not snapshot-bound; restart after a reorg |
| `reorgs` | `chainId` | `limit` defaults to 50 and caps at 250; increase `offset` until `offset + items.length >= total`; offset caps at 100,000 | Live offset |
| `export` | `chainId`; `dataset=logs|timeline|reorgs`; optional block range; `canonical` filters only logs and timeline, while reorganization rows have no canonical/orphan classification | `limit` defaults to 5,000 and caps at 50,000; pass `x-augurscan-next-offset` as `offset` until the header is absent. Every advertised offset is accepted through PostgreSQL's nonnegative `bigint` range. A `start-boundary-advanced` sentinel is always included in a reorganization export because it records a coverage reset rather than an on-chain block. | Live offset, not snapshot-bound |
| Report, escalation, auction, and fork catalogs | `chainId` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore`. Fork responses also return exact `data.total`. | Indexed block/hash; changed snapshot returns `409` |
| Risk catalog | `chainId` | `limit` defaults to 100 and caps at 250; compare the returned pools/vaults with exact `data.pagination.poolTotal`/`vaultTotal`, and continue each independently with `poolNextCursor`/`vaultNextCursor` | Indexed block/hash; changed snapshot returns `409` |
| Trading and integrity catalogs | `chainId`; trading also accepts `q` | `limit` defaults to 100 and caps at 250; pass `data.nextCursor` as `cursor` while `data.hasMore` | Indexed block/hash; changed snapshot returns `409` |
| Report, escalation, auction, fork, trading, and timeline details | Path identity and chain | `limit` defaults to 100 and caps at 250; continue the nested event collection with its `nextCursor` while `hasMore` | Indexed block/hash; changed snapshot returns `409` |
| Pool/vault risk details | Path identity and chain | `limit` defaults to 250 and caps at 1,000; pass `data.history.nextOffset` as `offset` while `truncated`; offset caps at 100,000 | Live offset; response includes its current `asOf` |
| Pool, vault, question, and universe history | Path identity and chain; optional `fromBlock`/`toBlock` | `limit` defaults to 1,000 and caps at 2,000; pass `coverage.nextOffset` as `offset` while present; offset caps at 1,000,000, so narrow the range before that ceiling | Coverage reports indexed block/hash, but offset pages are live |
| Address transactions | `chainId` and `address` | `limit` defaults to 50 and caps at 100; pass top-level `nextCursor` as `cursor` until absent | Snapshot block/hash and total; invalidation returns `409` |
| Rich list | Optional `chainId`; `address` requires it; `sort=transactions|eth|weth` | `limit` defaults to 50 and caps at 100; increase `offset` until `offset + items.length >= total`; offset caps at 100,000 | Live offset |
| State catalog | Optional `chainId` | `limit` defaults to 500 and caps at 1,000 per class; exact totals cover questions, pools, vaults, and universes, while truncation flags cover those four plus `poolStates`; no continuation exists | Current request |
| Address interactions | `chainId` and `address` | Latest 20 by default, capped at 100; returns `limit` but no total, truncation flag, or continuation | Current request |
| Actions | Optional `chainId` | Latest 100 only; no total, truncation flag, or continuation | Current request |
| Provenance | None; migrations and runs are global | All migration records plus latest 100 runs; `runsTruncated` is true only when an older run exists; no run continuation | Current request |
| Rich-list nested collections | One returned rich-list address | Pool associations and vault positions cap at 100 and can be compared with `pool_count`/`vault_count`; REP/WETH balances cap at 100 and expose sampled/returned counts plus truncation flags; escalation and auction claims cap at latest 100 with no total or truncation signal | Current request |
| Address portfolio nested collections | `chainId` and `address` | Each request returns at most 100 records per collection. `data.portfolioPagination.{lp,forks,reports}` supplies an exact total, offset, `hasMore`, and its own `nextCursor`; pass that cursor as `lpCursor`, `forkCursor`, or `reportCursor` without advancing the other collections. | Indexed block/hash and collection total; changed history returns `409` |
| Operations overview and risk-catalog evidence | `chainId` and optional risk catalog cursors | `recentLiquidations` contains the latest 25 and `approvalEvents` the latest 100; neither has a total, truncation flag, or continuation, and the pool/vault cursors do not advance them | Indexed-block response |
| Pool/vault risk-detail approvals | Path identity and chain | `approvalEvents` contains the latest 100 matching approvals with no total, truncation flag, or continuation; `history.nextOffset` advances only the four history arrays | Current request |
| Auction-detail demand curve | Path identity and chain | `demandCurve` aggregates at most 1,000 bid ticks; `demandCurveTruncated` signals omitted ticks, but there is no continuation | Indexed-block response |
| Trading-detail analytics | Path identity and chain | `lpPositions` contains at most the 250 largest nonzero balances with no total, truncation flag, or continuation. TWAP/candles calculate from at most 10,000 Sync candidates drawn from the last seven days and an optional earlier opening observation; `observationLimit`, `observationsTruncated`, and `observationRange` expose that bound, but there is no observation continuation | Indexed-block response |

Operations overview is also bounded without continuation. Its available exact totals link clients to dedicated catalogs; fork clients use the dedicated catalog's exact `data.total`. A response without a documented continuation field or completeness signal cannot be made complete by inventing an offset.

## Evidence and export

- Paginated logs, including replaced-chain evidence with `canonical=orphaned|all`: `GET /api/v1/logs?chainId=:chainId&canonical=:scope`
- Full log occurrence; add `canonical=all` to open an orphan directly: `GET /api/v1/logs/:chainId/:blockHash/:txHash/:logIndex`
- Durable reorganization history: `GET /api/v1/reorgs?chainId=:chainId&limit=:limit&offset=:offset`. Compare `offset + items.length` with `total` and continue until every row is read.
- Process-level schema, application, ABI, and network-configuration provenance: `GET /api/v1/provenance`
- Paginated newline-delimited JSON export for `logs`, `timeline`, or `reorgs`: `GET /api/v1/export?chainId=:chainId&dataset=:dataset&fromBlock=:from&toBlock=:to&offset=:offset&limit=:limit`. Add `canonical=:scope` for logs or timeline; reorganization records are durable replacements rather than canonical/orphan rows, so that parameter does not filter them. Every coverage-reset sentinel with `reason: start-boundary-advanced` is included regardless of the requested block range. Its `ancestor_block` is `-1`; `previous_block` is null when no checkpoint existed or identifies the displaced indexed tip when history was present.
- Top-level actions from receipts selected by protocol sources, tracked REP-token logs, or configured Uniswap filters: `GET /api/v1/actions`
- Durable commit, reorg, and status notifications with seven-day `Last-Event-ID` replay: `GET /api/v1/stream`

Export limits default to 5,000 and cannot exceed 50,000. `x-augurscan-returned` gives the row count, `x-augurscan-truncated` reports whether another page exists, and `x-augurscan-next-offset` supplies a retrievable nonnegative PostgreSQL-`bigint` offset when truncated. A stream cursor older than seven days receives a reset event so the client reloads current state.

`GET /api/v1/state/integrity?chainId=:chainId` is the Operations catalog, not the current continuity check. Its replacement `data.items` and `data.total` are filtered to the selected chain; follow `data.nextCursor` while `data.hasMore` is true. That cursor is bound to the indexed block/hash and advances replacements only. `data.migrations` is the global schema-migration history, and `data.runs` repeats the latest 25 global process runs on every replacement page; neither is chain-filtered. The UI's **Show more indexed records** control therefore advances only replacement records and ends with **All indexed records are shown.**

`GET /api/v1/provenance` returns the same global migration history and at most the latest 100 global process runs. It queries one extra row, so `runsTruncated: true` means at least one older process run exists. This endpoint has no continuation contract; query the retained `indexer_runs` table from a protected database connection when an audit requires those older rows. Use the `reorgs` NDJSON export when an audit needs every replacement record without catalog pagination.

## Address and contract views

- System contract registry and deployment evidence: `GET /api/v1/contracts?chainId=:chainId`
- Contract identity: `GET /api/v1/contracts/:chainId/:address`
- Bounded address rankings with native currency and per-token REP/WETH breakdowns: `GET /api/v1/richlist?chainId=:chainId`
- Snapshot-bound sent transactions: `GET /api/v1/address-transactions?chainId=:chainId&address=:address`
- Latest transactions that reference an address without using it as sender: `GET /api/v1/address-interactions?chainId=:chainId&address=:address`
- Known protocol identity: `GET /api/v1/address-identity?chainId=:chainId&address=:address`
- Reconstructed AMM LP balances and fork/report participation: `GET /api/v1/state/address-portfolio?chainId=:chainId&address=:address`

Follow the opaque `nextCursor` for later address-transaction pages. The cursor is bound to the chain, address, snapshot block and hash, and transaction total. A reorg or historical insertion returns `409 Transaction history changed; restart pagination`.

For address portfolios, follow the three collection cursors independently. Each cursor is bound to the chain, address, collection name, indexed block/hash, exact collection total, and offset. An indexed-head change returns `409 Indexed state changed; restart pagination`; a total change within the same indexed boundary returns `409 Portfolio history changed; restart pagination`.

## Historical state

- Pools, questions, vaults, and universes: `GET /api/v1/state/catalog?chainId=:chainId`
- Pool history, including AMM, coordinator REP/ETH, OpenOracle, and Uniswap price series: `GET /api/v1/state/pools/:chainId/:poolAddress?fromBlock=:from&toBlock=:to&offset=:offset&limit=:limit`
- Vault history: `GET /api/v1/state/vaults/:chainId/:poolAddress/:vaultAddress?fromBlock=:from&toBlock=:to&offset=:offset&limit=:limit`
- Question usage: `GET /api/v1/state/questions/:chainId/:questionId?fromBlock=:from&toBlock=:to&offset=:offset&limit=:limit`
- Universe history: `GET /api/v1/state/universes/:chainId/:universeId?fromBlock=:from&toBlock=:to&offset=:offset&limit=:limit`

Every history response includes `coverage` with the requested range, scanner start, indexed-through block/hash, per-series returned counts, page offset, `complete`, and `nextOffset` when older rows remain. `complete: true` requires the requested range to be inside scanner coverage, offset zero, and every series to fit. Rows are chronological within a page and use their actual indexed timestamps. Offset-backed histories and exports use the full retained occurrence identity as their final ordering key, so competing hashes and multiple events in one block do not produce an ambiguous page order.

State catalogs default to 500 and cap at 1,000 rows per entity class. History endpoints default to 1,000 and cap at 2,000 records per series. `truncated: true` means at least one series has more records; continue at `coverage.nextOffset`, narrow the block range, or use the export endpoint.

Pool history returns:

- `market`: indexed Augur pair identity and fee, when present
- `ammPrices`: exact YES/NO reserves and complementary conditional spot prices
- `repEthPrices`: coordinator initialization and accepted settlement observations
- `uniswapRepEthPrices`: venue-attributed REP/WETH, REP/USDC, or REP/native-ETH spot observations and raw liquidity evidence
- `openOracleHistory`: coordinator-linked OpenOracle lifecycle evidence

These are event-time observations. AMM and Uniswap spot series are not presented as manipulation-resistant oracle values. See [STATE_MODEL.md](STATE_MODEL.md) for field provenance, fork identity, risk semantics, and completeness rules.
