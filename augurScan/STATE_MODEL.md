# augurScan state model

The state dashboard is an event-derived view of the canonical chain through the selected network's indexed block. It never overwrites raw log evidence. Every projection row retains its block-hash occurrence and canonical flag, so a reorganization preserves the orphaned observation while removing it from the current view.

## Operations evidence model

The schema stores replayable domain projections for OpenOracle reports, escalation games, truth auctions, AMM activity, pool/question registrations, universe forks, and protocol migrations. The same decoded event also produces a `protocol_timeline_entries` row with entity identity, semantic event kind, source contract, source event, related addresses, transaction/log position, and canonical block occurrence. Reorg rewind marks affected projection and timeline rows noncanonical; replay uses the source log position as its idempotency key. Raw logs remain the retained evidence layer within the current database. Ordered schema migrations upgrade supported prior layouts in one transaction, backfill newly classified rows from retained raw logs, and leave an audit row. A schema marker is accepted only when a catalog fingerprint confirms the exact supported tables, identity sequences, column definitions, constraints, and indexes and finds no unexpected public objects, user triggers or rules, or row-level-security policies or flags. The migrated layout is verified before the new marker commits; incomplete, altered, extended, markerless, and unknown layouts are rejected without mutation.

`chain_reorganizations` durably records the replacement boundary, depth, reason, and detection time. An ordinary retained-ancestor reorganization includes the displaced tip/hash and common ancestor/hash. A full `chain-reorg` rewind or network-wide `manifest-reset`/`start-boundary-advanced` reset instead records `ancestor_block = -1` with no ancestor hash. A start-boundary reset can also omit the previous tip/hash when no checkpoint existed. Canonical APIs exclude replaced rows by default, while the log API and NDJSON export can explicitly select orphaned or all occurrences. From schema version 2 onward, `indexer_runs` records the schema version, application version, ABI source hash, network configuration, start time, and graceful stop time for each process run. This is process-level operational provenance: migrated version 1 evidence has no historical run record, and evidence rows do not carry an indexer-run foreign key. Raw log topics and data plus block hash, transaction hash, and log position are the row-level chain evidence. Event signatures, arguments, and summaries are stored decoder interpretations; unknown and failed decodes retain their raw evidence. Neither provenance layer replaces operator database backups.

| Value | Source classification |
| --- | --- |
| Report amounts, reporter, tokens, flags, fees, clock inputs, and round number | Direct event fields decoded from the canonical 235-byte packed report |
| Report dispute and settlement boundaries | Deterministic calculation from event fields using the indexed block or indexed timestamp selected by the report flag |
| Escalation deposits and per-outcome totals | Direct event fields plus deterministic canonical aggregation |
| Auction schedule, bids, clearing result, settlements, and refunds | Direct event fields plus deterministic canonical aggregation |
| Current values absent from events | Current contract read at the latest fully indexed canonical block, stored in `entity_state_snapshots` with method, success/failure, block hash, and observation time |
| Related addresses carried by one timeline event | Direct event fields; timeline entries do not claim cross-record inferred relationships. Risk summaries may associate approval transitions that share both an approval ID and registry, and expose that association as inferred evidence. |
| Warning or urgency | Scanner presentation state, separate from protocol state |

After indexing begins, every Operations response is anchored to the network's latest fully indexed canonical block. Its `asOf` object includes the indexed block/hash/timestamp, observed provider head, lag, phase, and last successful refresh. Before the first block is indexed, Operations endpoints return empty evidence with a synthetic zero block/timestamp boundary and `availability: "Awaiting indexed evidence"`; zero is only the loading anchor, not a claimed deployment or protocol value. A value absent from indexed events or a failed tagged read is unavailable evidence, never numeric zero.

When the indexer is caught up, it samples at most 25 least-recently observed pools, vaults, escalation games, and truth auctions per polling cycle, with four concurrent entity-snapshot jobs using the shared five-operation RPC queue. Every call is tagged to the same indexed block. The canonical block hash is checked before and after the reads and again inside the database transaction. Repeated cycles at a static head continue through unsampled entities; once every entity has a snapshot at that block, the sampler stops until the indexed boundary advances. Failed reads are retained as bounded availability evidence. A reorg marks snapshots tied to displaced blocks stale and noncanonical. A manifest-history reset marks every snapshot for that chain stale and noncanonical before canonical logs and current reads are replayed.

### OpenOracle reports

A report is identified by `(chain_id, open_oracle_address, report_id)`. `ReportSubmitted` and every `ReportDisputed` event preserve a separate round. `ReportSettled` closes the lifecycle without overwriting the last round. Flag bit 0 selects timestamp time when set and block time when clear:

```text
dispute boundary  = reportTimestamp + disputeDelay
settlement boundary = reportTimestamp + settlementTime
```

The exact boundary is inclusive for the new state: at the dispute boundary the dispute window is open, and at the settlement boundary the report is settleable. Settlement evidence takes precedence over clock-derived state.

### Auctions and escalations

Auction state uses the canonical indexed timestamp and exact `AuctionStarted`, `AuctionFinalized`, `BidSubmitted`, and `BidSettled` evidence. A finalized auction remains “bid settlements outstanding” while fewer bid settlements than submitted bids are observed. Escalation stake totals sum exact canonical `DepositOnOutcome.attoRepAmount` values by INVALID, NO, and YES; no floating-point arithmetic enters the projection.

Report, escalation, auction, and fork catalogs, together with each report's paged rounds and each escalation, auction, fork, trading, or timeline detail's paged events, are newest first and stable on `(block_number, log_index, tx_hash)`. The block-global log index preserves EVM execution order; the transaction hash is only a final deterministic tie-breaker. Other fixed detail collections document their own ordering and bounds in [API_REFERENCE.md](API_REFERENCE.md). The trading catalog instead orders by latest price block, market creation block, and pair address, then uses a snapshot-bound offset cursor. Each opaque Operations cursor is bound to the chain, domain, entity, indexed block, and indexed hash. Risk catalogs use independent pool-address and vault-address keysets at the same indexed boundary. A head change invalidates these cursor forms instead of silently mixing evidence boundaries. Live refreshes refetch the currently visible depth for paged Operations views, and append requests are serialized with refresh work so a stale continuation cannot replace canonical evidence.

### Risk and trading calculations

Liquidation approval events are retained as a separate chain-scoped lifecycle keyed by the registry and approval ID (or receiver-vault nonce identity for nonce invalidations). Set, reserve, release, consume, revoke, and nonce-invalidation transitions remain canonical evidence and are linked into risk responses and semantic timelines. `consumedDebtAttoEth` is the debt moved by a consumed reservation. `releasedDebtAttoEth` is the unused part of that same reservation returned to the approval's available balance; it is not a separate release action. The resulting available, reserved, and consumed balances remain direct fields from that event. Approval events describe authorization state; they are not inferred liquidation executions.

Pool capacity remains visible as an exact tagged value, but it is marked unusable for risk decisions when `protocolValid` is false and either settlement collateral or current minting capacity is nonzero. Vault health is unavailable when its open interest is nonzero and the coherent pool snapshot has the same invalid price. These invalid-price responses expose price provenance and remain unavailable until the protocol price becomes valid. Directly observed pool or vault bad debt takes precedence and remains a critical protocol state because it is not derived from price. Separately, vault risk is unavailable when the pool and vault snapshots have different block hashes; that response exposes both snapshot boundaries until coherent sampling catches up. Scanner severity does not reinterpret an expired protocol price as healthy or liquidatable.

Pool capacity is the exact current minting capacity less settlement collateral, floored at zero; utilization retains the exact basis-point integer. Vault health reproduces both `SecurityPoolUtils.isVaultHealthyAtFactor` constraints: associated backing includes dispute-staked REP, while the migration-safety constraint uses only pool-held backing and the greater of the half-excess security multiplier or liquidation-bonus multiplier. Protocol state (`healthy`, `liquidatable`, or `bad-debt`) is stored separately from the scanner's named 12,000-bps warning band.

For an AMM `Swap`, pre-swap reserves are reconstructed from emitted post-swap reserves and exact input/output amounts. Spot, execution price, and price impact remain numerator/denominator pairs; basis points are a display derivative. The 24-hour and seven-day volume and fee summaries aggregate exact event integers. TWAP and candles use the pair's authoritative `Sync` reserve observations, covering initialization, liquidity changes, direct reserve synchronization, and swaps without double-counting the `Swap` emitted after the same reserve update. TWAP integrates exact reserve ratios over the selected wall-clock window and reports covered seconds separately; the observation immediately before the window supplies its opening price. A partial window is labeled partial rather than extrapolated. Hourly candles retain exact rational OHLC values and observation counts.

One trading response reads at most 10,001 newest price candidates and calculates TWAP and candles from at most 10,000. The candidates include one optional observation before the seven-day window so TWAP can establish its opening price. `observationsTruncated: true` means that oldest candidate was omitted; it does not by itself prove that an in-window observation was omitted. Consumers should inspect `observationRange` and the TWAP coverage state, while candles describe every retained in-window observation. Volume, fee, swap-count, and liquidity-event summaries use independent SQL aggregates over every canonical event in their stated window and remain complete even when price candidates are truncated.

## Questions

`ZoltarQuestionData.QuestionCreated` contains the complete question definition. The question ID is the hash of this definition and its outcome options, and none of these fields changes afterward.

| Immutable                                                                                                     | Derived at viewing time   | Historical usage                                                         |
| ------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| ID, title, description, creation/start/end timestamps, ticks, scalar display range/unit, categorical outcomes | Scheduled, open, or ended | Security-pool deployments and universe forks that reference the question |

Question pages therefore use a lifecycle timeline rather than presenting immutable metadata as a changing metric.

## Security pools

`SecurityPoolFactory.DeploySecurityPool` establishes the pool's immutable lineage and dependencies. `PoolAccountingCheckpoint` is the authoritative complete accounting snapshot after mutations. Smaller lifecycle events supply state that is not part of the accounting snapshot.

| Immutable deployment data                                                                                                                                                         | Changes over time                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pool, parent, question and universe IDs; truth auction, price coordinator, and share-token addresses; security multiplier; initial priority fee; initial retention and collateral | Settlement collateral, total and fee-eligible capacity ownership, claimable and unallocated fees, fee index and remainders, retention rate, total REP backing units, share supply, system/fork state, escalation game, child pools, vault count |

Pool charts plot checkpoint history returned by the state API for collateral, REP-denominated capacity ownership, and claimable fees. The response defaults to 1,000 records per series, is capped at 2,000, accepts block ranges and offsets, and reports both scanner-range coverage and pagination completeness; the database retains the full canonical series. Exact attoETH and attoREP values remain stored and the UI displays them in ETH and REP respectively. Metrics with different units render in separate charts with actual-value axes. Points are positioned by elapsed time, so gaps and slopes reflect observation timestamps rather than checkpoint ordinal.

## Price histories

Each pool's `OpenOraclePriceCoordinator` emits `RepEthPriceSet` when its initial price is seeded and `PriceReported` after an accepted report settles. augurScan stores both as a 1e18-scaled REP-per-ETH coordinator-state series. An origin pool seeds zero, while a child pool inherits its parent's current value; neither seed has a settlement timestamp or establishes the coordinator's timestamp-based price validity. `PriceReported` observations are accepted settlements and carry that coordinator's settlement timestamp. Rejected reports are retained in the activity log but do not create price observations. The chart does not reconstruct prices from raw OpenOracle reports.

When a network config supplies its deployed Augur `TwoWayConstantProductFactory`, `PairCreated` establishes a one-pair-per-pool market identity and each pair `Sync` event supplies exact YES and NO reserves. A `Sync` with a nonzero total creates a price observation, while a zero-total event remains available only as raw activity evidence. augurScan derives the same conditional spot values as the AMM:

```text
conditional_yes_bps = floor(10,000 * NO reserve / (YES reserve + NO reserve))
conditional_no_bps  = 10,000 - conditional_yes_bps
```

The first calculation floors integer division and the second is its exact complement, so the stored values always total 10,000 basis points. Conceptually, the two ratios are NO reserve / total reserve for conditional YES and YES reserve / total reserve for conditional NO. The database retains the exact reserves and basis-point observations. The chart uses a shared 0–100% axis because the two conditional values are complementary. These values are conditional on a valid resolution and remain manipulable spot prices; historical display does not turn them into a TWAP or manipulation-resistant oracle. A configured AMM factory must be indexed from at or before its deployment to provide complete pair and reserve history.

Configured Uniswap venues add a separate universe-scoped spot-price history. V2 and V3 markets must pair the pool's exact universe REP ERC-20 with a configured WETH or USDC contract. V4 markets must pair that REP with native ETH or configured USDC, use no hook, and use one of the repository's four standard fee/tick-spacing configurations. V4 ERC-20 currencies are ordered by address when deriving the pool ID; native ETH uses the zero-address currency. This identity check prevents a parent REP pool or a sibling child-universe REP pool from supplying the displayed series, and the configured USDC identity supplies its fixed 6-decimal quote scale.

For quote-token base-unit scale `D = 10^quoteDecimals`, `Q = 2^96`, and V3/V4 `x = sqrtPriceX96`, augurScan derives a 1e18-scaled REP-per-quote value as follows. `D` is `10^18` for WETH or native ETH and `10^6` for USDC:

```text
V2, REP is token0: floor(reserve0 * D / reserve1)
V2, REP is token1: floor(reserve1 * D / reserve0)
V3/V4, REP is token0: floor(Q^2 * D / x^2)
V3/V4, REP is token1: floor(x^2 * D / Q^2)
```

Only positive reserve or square-root-price inputs create returned chart points, and every division uses positive integer arithmetic that floors the result. Each pool and fee tier remains a distinct line. When every returned line has the same quote symbol, the lines share one numeric range. When the result mixes quote symbols, the renderer scales every line independently; labels and exact point values carry the WETH, native ETH, or USDC unit, so line height is not a cross-quote comparison.

The observations are event-time marginal prices used only for historical display. They are not inputs to the Open Oracle, the coordinator, or protocol settlement. They do not use V2 cumulative-price fields, calculate a TWAP, enforce minimum liquidity, or prove resistance to same-block manipulation. REP/WETH, REP/native ETH, and REP/USDC are explicitly labeled and are not placed on one shared numeric axis. Quote-token decimals are applied before producing the 1e18-scaled REP-per-quote ratio. The indexer retains raw reserves or square-root prices, exact emitted liquidity, event and transaction identity, token order, pool ID/address, fee, tick spacing, and hook address.

## Vaults

A vault is identified by its owner address within one security pool. `VaultAccountingCheckpoint` contains the resulting state after each vault mutation.

| Identity                         | Changes over time                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Network, pool, and vault address | REP backing units, REP-denominated capacity ownership, claimable fees, fee index, fee remainder, and resulting pool denominators |

Vault charts plot REP backing units, capacity ownership, and claimable fees. REP backing units are protocol accounting units and are not mislabeled as an ERC-20 balance; capacity ownership is an attoREP-denominated accounting amount. Metrics with different units render as separate actual-value charts, and points use elapsed-time positions.

## Known addresses and balances

The rich list records transaction senders plus ABI-typed addresses referenced by protocol calls and events. Address-shaped text in titles, descriptions, or other string fields is not participant evidence. Each observation retains its transaction, canonical block occurrence, and role. A pool association means only that the address and pool occurred in the same indexed protocol transaction; it does not prove ownership of the pool or a vault position. Vault positions are reported separately from the latest canonical accounting checkpoint for that vault address and pool. Address portfolio pages additionally reconstruct current AMM LP-token balances from pair `Transfer` events and show fork/migration and OpenOracle reporter evidence. A transfer from an address to itself contributes equal received and sent amounts and a zero net balance change. The three portfolio collections expose independent snapshot-bound cursors and exact totals so each can be read completely. These records are complete only within the scanner's configured history boundary and selected-receipt model. Reorganizations preserve orphaned observations but remove them from current counts.

When a polling cycle begins with no block left to index, augurScan refreshes a bounded batch of addresses, prioritizing addresses that are missing a known asset. Block ingestion takes priority, so a cycle that starts behind advances canonical history without also refreshing balances. A caught-up refresh reads ETH (SepoliaETH on Sepolia), WETH, genesis REP, and every discovered child REP token at one canonical block and stores the exact balance snapshot. REP balances remain separate because tokens from different universes do not share interchangeable semantics. A newly discovered token remains absent until that address rotates through the queue, and an address with no snapshot is pending rather than known to hold zero. The API returns sampled and known token counts with bounded per-token REP and WETH records plus the network's native balance; a response reports when a 100-record asset detail is truncated, and the UI marks incomplete rows as partial. Rows can have different balance blocks, and the UI reports the oldest represented block instead of implying one atomic global snapshot.

## Zoltar universes

`UniverseInitialized` establishes genesis identity and `DeployChild` establishes a child universe's deterministic lineage. Fork and supply events update the live state.

| Immutable lineage                                        | Changes over time                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universe ID, parent universe, forking outcome, REP token | Fork time/question/initiator, fork threshold, fork initiator's migration balance immediately after the fork, theoretical REP supply, child count, linked pool count |

The supply chart uses `UniverseInitialized`, `DeployChild`, `UniverseForked`, `MigrationRepAdded`, and `RepBurned`. Its y-axis is the absolute theoretical REP amount and points use elapsed-time positions. The displayed universe-state migration balance belongs only to the fork initiator at the moment `UniverseForked` was emitted. The fork operations view separately aggregates later migration splits, REP burns, distinct migrators, child branches, pool migration checkpoints, and escalation migration obligations under the stable parent-universe identity. The lineage graph connects each returned canonical universe to its returned parent. The catalog defaults to 500 universes and caps requests at 1,000; exact catalog totals and truncation metadata keep the global network-scoped result explicit.
