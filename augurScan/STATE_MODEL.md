# augurScan state model

The state dashboard is an event-derived view of the canonical chain through the selected network's indexed block. It never overwrites raw log evidence. Every projection row retains its block-hash occurrence and canonical flag, so a reorganization preserves the orphaned observation while removing it from the current view.

## Operations evidence model

Migration 008 adds append-only domain evidence for OpenOracle reports, escalation games, truth auctions, AMM activity, forks, and migrations. The same decoded event also produces a `protocol_timeline_entries` row with entity identity, semantic event kind, source contract, source event, related addresses, transaction/log position, and canonical block occurrence. Reorg rewind marks all affected domain and timeline rows noncanonical; replay uses the source log position as its idempotency key.

| Value | Source classification |
| --- | --- |
| Report amounts, reporter, tokens, flags, fees, clock inputs, and round number | Direct event fields decoded from the canonical 235-byte packed report |
| Report dispute and settlement boundaries | Deterministic calculation from event fields using the indexed block or indexed timestamp selected by the report flag |
| Escalation deposits and per-outcome totals | Direct event fields plus deterministic canonical aggregation |
| Auction schedule, bids, clearing result, settlements, and refunds | Direct event fields plus deterministic canonical aggregation |
| Current values absent from events | Unavailable in the current event-only projection; `entity_state_snapshots` reserves a reorg-aware schema for a future tagged-read sampler but is not populated yet |
| Related addresses carried by one event | Direct event fields; augurScan does not currently claim cross-record inferred relationships |
| Warning or urgency | Scanner presentation state, separate from protocol state |

Every Operations response is anchored to the network's latest fully indexed canonical block. Its `asOf` object includes the indexed block/hash/timestamp, observed provider head, lag, phase, and last successful refresh. A value absent from indexed events is unavailable evidence, never numeric zero. Risk responses therefore expose unavailable protocol and scanner state until a tagged-read sampler is implemented.

### OpenOracle reports

A report is identified by `(chain_id, open_oracle_address, report_id)`. `ReportSubmitted` and every `ReportDisputed` event preserve a separate round. `ReportSettled` closes the lifecycle without overwriting the last round. Flag bit 0 selects timestamp time when set and block time when clear:

```text
dispute boundary  = reportTimestamp + disputeDelay
settlement boundary = reportTimestamp + settlementTime
```

The exact boundary is inclusive for the new state: at the dispute boundary the dispute window is open, and at the settlement boundary the report is settleable. Settlement evidence takes precedence over clock-derived state.

### Auctions and escalations

Auction state uses the canonical indexed timestamp and exact `AuctionStarted`, `AuctionFinalized`, `BidSubmitted`, and `BidSettled` evidence. A finalized auction remains “bid settlements outstanding” while fewer bid settlements than submitted bids are observed. Escalation stake totals sum exact canonical `DepositOnOutcome.attoRepAmount` values by INVALID, NO, and YES; no floating-point arithmetic enters the projection.

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

Pool charts plot the bounded checkpoint history returned by the state API for collateral, REP-denominated capacity ownership, and claimable fees. The history response defaults to 1,000 records, is capped at 2,000, and reports when it is truncated; the database retains the full canonical series. Exact attoETH and attoREP values remain stored and the UI displays them in ETH and REP respectively. Because the series have different magnitudes, each chart line is independently scaled from its minimum to maximum observed checkpoint; the graph compares trend shapes, not absolute heights or percentage returns. Points are spaced by checkpoint order rather than elapsed time, while their endpoint labels show actual dates.

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

Vault charts plot REP backing units, capacity ownership, and claimable fees. REP backing units are protocol accounting units and are not mislabeled as an ERC-20 balance; capacity ownership is an attoREP-denominated accounting amount. Each line is independently scaled to its observed range and points are spaced by checkpoint order, so slopes are not rates and line heights cannot be compared as absolute quantities.

## Known addresses and balances

The rich list records transaction senders plus ABI-typed addresses referenced by protocol calls and events. Address-shaped text in titles, descriptions, or other string fields is not participant evidence. Each observation retains its transaction, canonical block occurrence, and role. A pool association means only that the address and pool occurred in the same indexed protocol transaction; it does not prove ownership of the pool or a vault position. Vault positions are reported separately from the latest canonical accounting checkpoint for that vault address and pool. Reorganizations preserve orphaned observations but remove them from current counts.

When a polling cycle begins with no block left to index, augurScan refreshes a bounded batch of addresses, prioritizing addresses that are missing a known asset. Block ingestion takes priority, so a cycle that starts behind advances canonical history without also refreshing balances. A caught-up refresh reads ETH (SepoliaETH on Sepolia), WETH, genesis REP, and every discovered child REP token at one canonical block and stores the exact balance snapshot. REP balances remain separate because tokens from different universes do not share interchangeable semantics. A newly discovered token remains absent until that address rotates through the queue, and an address with no snapshot is pending rather than known to hold zero. The API returns sampled and known token counts with bounded per-token REP and WETH records plus the network's native balance; a response reports when a 100-record asset detail is truncated, and the UI marks incomplete rows as partial. Rows can have different balance blocks, and the UI reports the oldest represented block instead of implying one atomic global snapshot.

## Zoltar universes

`UniverseInitialized` establishes genesis identity and `DeployChild` establishes a child universe's deterministic lineage. Fork and supply events update the live state.

| Immutable lineage                                        | Changes over time                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Universe ID, parent universe, forking outcome, REP token | Fork time/question/initiator, fork threshold, fork initiator's migration balance immediately after the fork, theoretical REP supply, child count, linked pool count |

The supply chart uses `UniverseInitialized`, `DeployChild`, `UniverseForked`, `MigrationRepAdded`, and `RepBurned`. Unlike multi-series pool and vault charts, its y-axis is the absolute theoretical REP amount; points remain spaced by checkpoint order. The displayed migration balance belongs only to the fork initiator at the moment `UniverseForked` was emitted. augurScan does not currently aggregate later caller-specific migration balances. The lineage graph connects each returned canonical universe to its returned parent. The catalog defaults to 500 universes and caps requests at 1,000; the global network selector keeps the graph scoped to one chain and the UI reports when that chain's result is truncated.
