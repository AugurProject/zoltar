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
| Pool, parent, question and universe IDs; truth auction, price coordinator, and share-token addresses; security multiplier; initial priority fee; initial retention and collateral | Settlement collateral, total and fee-eligible coverage, claimable and unallocated fees, fee index and remainders, retention rate, total REP backing units, share supply, system/fork state, escalation game, child pools, vault count |

Pool charts plot the complete checkpoint series for collateral, coverage, and claimable fees. Exact attoETH values remain stored and the UI displays current values in ETH. Because the series have different magnitudes, each chart line is independently scaled from its minimum to maximum observed checkpoint; the graph compares trend shapes, not absolute heights or percentage returns. Points are spaced by checkpoint order rather than elapsed time, while their endpoint labels show actual dates.

## Vaults

A vault is identified by its owner address within one security pool. `VaultAccountingCheckpoint` contains the resulting state after each vault mutation.

| Identity | Changes over time |
| --- | --- |
| Network, pool, and vault address | REP backing units, coverage commitment, claimable fees, fee index, fee remainder, and resulting pool denominators |

Vault charts plot REP backing units, coverage commitment, and claimable fees. REP backing units are protocol accounting units and are not mislabeled as an ERC-20 balance. Each line is independently scaled to its observed range and points are spaced by checkpoint order, so slopes are not rates and line heights cannot be compared as absolute quantities.

## Zoltar universes

`UniverseInitialized` establishes genesis identity and `DeployChild` establishes a child universe's deterministic lineage. Fork and supply events update the live state.

| Immutable lineage | Changes over time |
| --- | --- |
| Universe ID, parent universe, forking outcome, REP token | Fork time/question/initiator, fork threshold, fork initiator's migration balance immediately after the fork, theoretical REP supply, child count, linked pool count |

The supply chart uses `UniverseInitialized`, `DeployChild`, `UniverseForked`, `MigrationRepAdded`, and `RepBurned`. Unlike multi-series pool and vault charts, its y-axis is the absolute theoretical REP amount; points remain spaced by checkpoint order. The displayed migration balance belongs only to the fork initiator at the moment `UniverseForked` was emitted. augurScan does not currently aggregate later caller-specific migration balances. The lineage graph includes every canonical indexed universe on the selected network set and connects each child to its parent.
