# augurScan state model

The state dashboard is an event-derived view of the canonical chain through each network's indexed block. It never overwrites raw log evidence. Every projection row retains its block-hash occurrence and canonical flag, so a reorganization preserves the orphaned observation while removing it from the current view.

## Questions

`ZoltarQuestionData.QuestionCreated` contains the complete question definition. The question ID is the hash of this definition and its outcome options, and none of these fields changes afterward.

| Immutable | Derived at viewing time | Historical usage |
| --- | --- | --- |
| ID, title, description, creation/start/end timestamps, ticks, scalar display range/unit, categorical outcomes | Scheduled, open, or ended | Security-pool deployments and universe forks that reference the question |

Question pages therefore use a lifecycle timeline rather than presenting immutable metadata as a changing metric.

## Security pools

`SecurityPoolFactory.DeploySecurityPool` establishes the pool's immutable lineage and dependencies. `PoolAccountingCheckpoint` is the authoritative complete accounting snapshot after mutations. Smaller lifecycle events supply state that is not part of the accounting snapshot.

| Immutable deployment data | Changes over time |
| --- | --- |
| Pool, parent, question and universe IDs; truth auction, price coordinator, and share-token addresses; security multiplier; initial priority fee; initial retention and collateral | Settlement collateral, total and fee-eligible capacity ownership, claimable and unallocated fees, fee index and remainders, retention rate, total REP backing units, share supply, system/fork state, escalation game, child pools, vault count |

Pool charts plot the bounded checkpoint history returned by the state API for collateral, REP-denominated capacity ownership, and claimable fees. The history response defaults to 1,000 records, is capped at 2,000, and reports when it is truncated; the database retains the full canonical series. Exact attoETH and attoREP values remain stored and the UI displays them in ETH and REP respectively. Because the series have different magnitudes, each chart line is independently scaled from its minimum to maximum observed checkpoint; the graph compares trend shapes, not absolute heights or percentage returns. Points are spaced by checkpoint order rather than elapsed time, while their endpoint labels show actual dates.

## Vaults

A vault is identified by its owner address within one security pool. `VaultAccountingCheckpoint` contains the resulting state after each vault mutation.

| Identity | Changes over time |
| --- | --- |
| Network, pool, and vault address | REP backing units, REP-denominated capacity ownership, claimable fees, fee index, fee remainder, and resulting pool denominators |

Vault charts plot REP backing units, capacity ownership, and claimable fees. REP backing units are protocol accounting units and are not mislabeled as an ERC-20 balance; capacity ownership is an attoREP-denominated accounting amount. Each line is independently scaled to its observed range and points are spaced by checkpoint order, so slopes are not rates and line heights cannot be compared as absolute quantities.

## Known addresses and balances

The rich list records transaction senders plus ABI-typed addresses referenced by protocol calls and events. Address-shaped text in titles, descriptions, or other string fields is not participant evidence. Each observation retains its transaction, canonical block occurrence, and role. A pool association means only that the address and pool occurred in the same indexed protocol transaction; it does not prove ownership of the pool or a vault position. Vault positions are reported separately from the latest canonical accounting checkpoint for that vault address and pool. Reorganizations preserve orphaned observations but remove them from current counts.

When a polling cycle begins with no block left to index, augurScan refreshes a bounded batch of addresses, prioritizing addresses that are missing a known asset. Block ingestion takes priority, so a cycle that starts behind advances canonical history without also refreshing balances. A caught-up refresh reads native ETH, WETH, genesis REP, and every discovered child REP token at one canonical block and stores the exact balance snapshot. “All REP” sums only the latest available canonical snapshots; a newly discovered token remains absent until that address rotates through the queue, and an address with no snapshot is pending rather than known to hold zero. The API returns sampled and known token counts with bounded exact REP and WETH records plus exact native ETH; a response reports when a 100-record asset detail is truncated, and the UI marks incomplete rows as partial. Rows can have different balance blocks, and the UI reports the oldest represented block instead of implying one atomic global snapshot.

## Zoltar universes

`UniverseInitialized` establishes genesis identity and `DeployChild` establishes a child universe's deterministic lineage. Fork and supply events update the live state.

| Immutable lineage | Changes over time |
| --- | --- |
| Universe ID, parent universe, forking outcome, REP token | Fork time/question/initiator, fork threshold, fork initiator's migration balance immediately after the fork, theoretical REP supply, child count, linked pool count |

The supply chart uses `UniverseInitialized`, `DeployChild`, `UniverseForked`, `MigrationRepAdded`, and `RepBurned`. Unlike multi-series pool and vault charts, its y-axis is the absolute theoretical REP amount; points remain spaced by checkpoint order. The displayed migration balance belongs only to the fork initiator at the moment `UniverseForked` was emitted. augurScan does not currently aggregate later caller-specific migration balances. The lineage graph connects each returned canonical universe to its returned parent. The catalog defaults to 500 universes and caps requests at 1,000; when truncated, the UI warns the operator to select one network to narrow the graph.
