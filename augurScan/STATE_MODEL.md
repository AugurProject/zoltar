# augurScan state model

augurScan separates retained evidence from the current view so an operator can tell what the chain emitted, how a scanner run understood it, what the scanner read directly, and which values are only the latest projection.

## Four evidence layers

1. **Occurrences** are the block, transaction, action, receipt, and raw log records selected by the indexer's declared coverage model. A log retains its topics, data, block hash, transaction hash, and position even when decoding fails. A reorganization changes its canonical status instead of deleting the displaced occurrence.
2. **Interpretations** record how one indexer run decoded an action or log and which semantic projections it produced. Each interpretation carries run and ABI/application/projection source provenance. A later replay appends another interpretation, so operators can compare meanings without changing the raw occurrence.
3. **Observations** are contract values read at a tagged canonical block. From schema version 2 onward, every pool, vault, escalation, auction, address-balance, or token-metadata attempt is appended with its result or failure, block hash, observation time, run, and source hashes. Migration keeps the version 1 materialized rows that still exist, but cannot reconstruct attempts already overwritten or invent their run/source provenance.
4. **Current materializations** are replaceable registries, domain projections, and latest state rows used by the UI and ordinary canonical APIs. They are convenient views of the first three layers, not independent historical evidence.

OpenOracle reports, escalation games, truth auctions, AMM activity, registrations, forks, and migrations use this same model. One decoded occurrence can create several semantic timeline entries because it can affect several entities. Current views keep stable entity and occurrence identities so replay remains idempotent.

## What a replacement changes

A chain reorganization marks occurrences and direct observations from displaced blocks noncanonical, preserves them as orphan evidence, and rebuilds the current canonical view from the common ancestor. Advancing the stored coverage floor similarly marks evidence below the new boundary noncanonical.

A manifest, ABI, application, or projection change replays retained canonical history. It preserves raw occurrences, prior interpretations, and direct observations on retained blocks while removing obsolete derived materializations and rebuilding them with the new source hashes. Later tagged reads carry the new run and source provenance.

Every replacement has an audit record. `chain_reorganizations` stores its boundary, primary reason, detection time, invalidating indexer run, and the ABI/application/projection hashes used by that run. `history_invalidation_causes` stores the complete cause set when one startup discovers several reasons, and `history_invalidation_occurrences` identifies affected blocks, transactions, logs, sampled states, address balances, and token metadata. A chain reorganization, manifest rewind, or coverage-floor change marks only observations outside the retained canonical boundary noncanonical and associates those displaced observations with the replacement. An ABI, application, or projection replay associates affected sampled entity-state observations with the replacement while leaving them canonical. Balance and token-metadata observations also remain canonical across a source replay, but receive replacement provenance only if a later reorganization, manifest rewind, or coverage reset displaces them. No path rewrites a recorded outcome or failure. Canonical APIs exclude evidence displaced from the chain or coverage boundary by default; audit surfaces return the invalidation provenance that exists for displaced or replay-associated evidence.

From schema version 2 onward, `indexer_runs` identifies the schema/application versions, source hashes, configuration, whether indexing was enabled, and process lifetime. The lease-owning indexer compares the source markers already applied to each network and records any replay plus new markers atomically. A standby cannot suppress a replay merely by starting. Migrated version 1 evidence has no invented run or interpretation provenance.

## Reading an Operations snapshot

Every Operations response after indexing begins is anchored to one fully indexed canonical block. The overview and risk surfaces accept `atBlock` for a retained canonical boundary. Their `asOf` envelope distinguishes that selected block from the current indexed and observed heads and includes the latest invalidation and applied source hashes. Before the first indexed block, Operations returns empty evidence with an explicit availability message; its zero block is only a loading anchor.

At the live head, the indexer samples bounded sets of least-recently observed pools, vaults, escalation games, and truth auctions. Every call in one entity read is tagged to the same indexed block and the block hash is checked before commit. A failure is an availability observation, never numeric zero. Repeated cycles continue until every known entity has a snapshot at that head.

The [API reference](API_REFERENCE.md) is the canonical source for collection ordering, limits, point-in-time filters, opaque cursors, completeness fields, and invalidated-continuation behavior. The browser refetches the visible depth of paged Operations views after a committed update so it does not mix materialization generations.

### Direct, derived, and presentation values

| Value | Source classification |
| --- | --- |
| Report amounts, reporter, tokens, flags, fees, clock inputs, and round number | Direct event fields decoded from the canonical 235-byte packed report |
| Report dispute and settlement boundaries | Deterministic calculation from event fields using the indexed block or indexed timestamp selected by the report flag |
| Escalation deposits and per-outcome totals | Direct event fields plus deterministic canonical aggregation |
| Auction schedule, bids, clearing result, settlements, and refunds | Direct event fields plus deterministic canonical aggregation |
| Current values absent from events | Current contract read at the latest fully indexed canonical block. `entity_state_snapshots` is the replaceable latest materialization. From schema version 2 onward, every sampling attempt is appended to `entity_state_observations` with method, success/failure, block hash, observation time, run, and source hashes. Migration preserves each version 1 snapshot row that still exists, but cannot reconstruct attempts that version 1 already overwrote or invent their run/source provenance. |
| Related addresses carried by one timeline event | Direct event fields; timeline entries do not claim cross-record inferred relationships. Risk summaries may associate approval transitions that share both an approval ID and registry, and expose that association as inferred evidence. |
| Warning or urgency | Scanner presentation state, separate from protocol state |

## One report through the four layers

An OpenOracle submission is first a raw log occurrence. The indexer then appends the decoded report interpretation and creates semantic report and timeline rows. A report detail page reads the current materialization, while its round history retains every submitted or disputed occurrence. If the decoder changes, replay adds a new interpretation and rebuilds the materialization without changing the raw log.

The same separation applies across the indexed domains:

| Surface | Retained evidence | Current materialization |
| --- | --- | --- |
| OpenOracle reports | Submitted, disputed, settled, rejected, and recovery occurrences plus coordinator decisions | Latest report round and lifecycle state |
| Escalations and auctions | Deposits, claims, bids, settlements, refunds, and lifecycle events | Current totals, outcome state, and clearing summary |
| Statoblast risk | Accounting checkpoints, liquidation approvals, and tagged pool/vault reads | Latest coherent risk snapshot and scanner assessment |
| Trading | Pair identity, reserve synchronization, swaps, liquidity events, and LP transfers | Current market summary, positions, and bounded analytics |
| Zoltar forks | Universe lineage, migration, REP burn, pool checkpoints, and escalation obligations | Current branch and migration summary |
| Addresses and tokens | Participation occurrences plus tagged balance and metadata read outcomes | Latest successful balance and metadata values |

Exact domain calculations, filters, response fields, limits, and continuation rules belong to the [API reference](API_REFERENCE.md). This page owns only the evidence model.

## Completeness and absence

History is complete only inside the selected network's configured and retrievable coverage boundary. The API exposes that boundary, the indexed block and hash, the current materialization generation, and collection-specific truncation or continuation fields. A missing row outside coverage is unknown, not zero or proof that an event never happened.

Balance and token-metadata failures are observation records, not numeric values. A successful attempt can update the current materialization; a failed attempt leaves the last successful materialization unchanged. Each balance target is recorded independently, so one failed native or token read does not erase the other outcomes from the same batch.

Use `canonical=all` when auditing replacements. A noncanonical observation identifies the replacement that displaced it and reports chain reorganization, manifest supersession, or coverage reset as its evidence status. Follow every documented cursor until completion; do not infer completeness from the first page.
