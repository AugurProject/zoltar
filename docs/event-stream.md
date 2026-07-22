# Zoltar Event Stream Contract

The canonical event stream reconstructs the economically relevant Zoltar-owned protocol state described below without storage reads, transaction input, traces, or undocumented assumptions during replay. Storage getters may be used after replay for auditing and recovery.

Open Oracle logging remains outside this Zoltar event-stream contract. The vendored OpenOracle 0.2.0 contract stores the active state hash and emits each report preimage as 235 packed bytes in `ReportSubmitted` and `ReportDisputed`; clients reconstruct that separate oracle state before disputing or settling. Those packed logs do not extend the Zoltar-owned schema or its payout and liability replay guarantees.

### OpenOracle packed-state reconstruction

An OpenOracle indexer must filter logs by the configured OpenOracle emitter and the `ReportSubmitted(uint256,bytes)`, `ReportDisputed(uint256,bytes)`, and `ReportSettled(uint256)` signature topics. Submitted and disputed logs are emitted with raw `log2`: topic 1 is the indexed 32-byte report ID, and `data` is exactly 235 raw packed bytes rather than ABI encoding for a dynamic `bytes` value. [`shared/ts/openOracle.ts`](../shared/ts/openOracle.ts) is the canonical field-offset decoder and state-hash helper.

Reduce those logs in canonical block, transaction, and log-index order. A submitted log creates the report preimage; every later disputed log for the same report ID replaces it. Decode the data, restore the topic-1 report ID in `PreimageHelper`, and verify the ABI preimage hash against `oracleGame[reportId]` before sending a dispute or settlement transaction.

`ReportSettled` contains only the report ID and no replacement preimage. Mark the latest reconstructed state as settled and set `settlementTimestamp` from the settlement block: use the block timestamp when the report's `TIME_TYPE` flag is set and the block number otherwise. Hashing that completed preimage reproduces the final stored state. [`ui/ts/protocol/openOracleState.ts`](../ui/ts/protocol/openOracleState.ts) implements this chronological reduction and settlement-block lookup.

## Deployment anchor and schema version

For each chain, record the successful deployment receipt for `ZoltarQuestionData` and use its block as the inclusive protocol-schema start block. Question creation is permissionless as soon as that contract exists, including before the later root `Zoltar` deployment. Also record every subsequent deployment receipt and address produced by the deployment flow. Do not begin at the root `Zoltar` receipt or the first application transaction: doing so can omit early `QuestionCreated` logs or constructor events such as initial share-token authorization.

Pool deployment requires relationship discovery before chronological reduction. First scan `DeploySecurityPool` logs from the configured `SecurityPoolFactory` to collect every pool, share token, auction, and coordinator address. Then decode and reduce the complete receipt and block range in canonical order. Constructor and setup logs from those addresses precede the factory's `DeploySecurityPool` log in the same transaction; a forward-only decoder that waits to recognize their emitters would discard initial authorization and accounting checkpoints.

Apply the same pre-pass to `EscalationGameSet` logs from recognized pools before reducing escalation-game events. A new game's `GameStarted` or `GameContinuedFromFork` lifecycle event is emitted before the pool records that game address later in the same transaction. Accept escalation signatures only from game addresses collected through this pool relationship.

Genesis REP has a separate balance-history anchor because it exists before `ZoltarQuestionData`. Discover its address from the root `UniverseInitialized` event, then load that token's standard `Transfer` history from its own deployment receipt through the protocol head and merge those logs into canonical order. Pre-discover REP token addresses from `UniverseInitialized` and `DeployChild` before reducing the ordered stream so the earlier genesis transfers are not discarded. Child REP tokens are deployed inside the protocol stream and need no earlier anchor. If a chain cannot supply the genesis token's complete event history, event-only REP balance and supply indexing on that chain is unsupported.

The prelaunch Zoltar-owned event set is schema version 1. A deployment with different event signatures is a new cutover: store its deployment block and contract-address set as a separate schema segment. Never merge logs from two schema segments by event name alone.

## Ordering, identity, and rollback

Apply logs in ascending `(blockNumber, transactionIndex, logIndex)` order. The canonical idempotency key is:

```text
chainId + blockHash + transactionHash + logIndex
```

On a reorganization, remove every event whose `blockHash` became orphaned, restore the last canonical checkpoint before the removed block, and replay the replacement branch in canonical order. Transaction reverts leave no durable events.

The emitting address identifies the current pool, game, auction, token, or coordinator. Shared factories and the forker include relationship addresses because one emitter manages several children.

## Units and value semantics

- `ethAmount` values are wei. `repAmount` and `shareAmount` use the token's smallest unit.
- Pool fee indexes and retention rates use the scales documented on their interface fields. Treat a field named `resulting...` as the authoritative post-mutation value.
- Delta fields such as `migratedRepDelta`, `collateralDelta`, and `ethRefund` describe only the current item or action. Cumulative and resulting fields replace the prior replay value.
- A conceptual burn or escrow movement is not an ERC-20 burn unless the corresponding token event says so.

| Field family | Denomination or scale | Gross, net, cumulative, and rounding meaning |
| --- | --- | --- |
| `ethAmount`, collateral, fees, allowances, reserves | Wei; security-bond allowances are wei-denominated obligations | `CompleteSetCreated.ethAmount` is the gross ETH supplied. Redemption `ethAmount` fields are the net wei paid after fee accrual has reduced collateral. Resulting collateral fields replace prior state. |
| `repAmount`, REP auction fills | REP token base units | Migration, consumption, and fill fields are per-action deltas unless named cumulative or resulting. |
| `shareAmount`, `sharesMinted`, share-token supply | Share-token base units | Mint/burn amounts are deltas. `resultingShareTokenSupply` is the authoritative post-action total. Integer division in redemption rounds the wei payout down. |
| `poolOwnershipAmount` and ownership denominators | Internal pool-ownership units | Initial conversion uses `repAmount * 1e18`; later conversions preserve the current proportional ownership ratio with Solidity integer rounding. Resulting denominators replace prior totals. |
| Pool and vault `feeIndex` | `1e18` fixed-point fee-per-eligible-allowance unit | Index deltas truncate toward zero. `feeIndexRemainder` carries the allocation numerator modulo the current eligible-allowance denominator. |
| `vaultFeeRemainder` | Sub-wei numerator with denominator `1e18` | Carries one vault's fractional entitlement into its next `VaultAccountingCheckpoint`. It is authoritative even when `unpaidEthFees` does not change. |
| `totalFeesOwedRemainder` | Sub-wei numerator with denominator `1e18` | Carries truncated global fee accrual into the next checkpoint and is always below `1e18`. |
| `currentRetentionRate` | `1e18` fixed-point per-second multiplier | Applied with integer exponentiation and division; lower values retain less collateral over time. |
| Coordinator REP/ETH `price` | `(REP base units * 1e18) / ETH wei` | Truncates toward zero. A larger value means more REP is required per ETH. |
| Auction ETH fields | Wei | `grossEthAccepted` is the accepted ETH transferred to the auction owner. Per bid, `ethUsed + ethRefund = originalEthAmount`; REP fills use token base units. |
| Timestamps and BPS parameters | Unix seconds; basis points use denominator `10_000` | Timestamps are resulting lifecycle times. BPS multiplication uses Solidity integer division and therefore truncates unless a field explicitly documents ceiling behavior. |

## Discovery and relationships

Use protocol events, not transfer inference, to discover relationships:

| Relationship or state | Canonical events |
| --- | --- |
| Question and universe fork | question events, `UniverseForked` |
| Child universe and child REP | `DeployChild`, `MigrationRepAdded`, `MigrationRepSplit` |
| Pool, share token, auction, and coordinator | `DeploySecurityPool` and constructor/deployment events |
| Share-token permissions | `AuthorizationUpdated` |
| Parent pool fork state | `SecurityPoolForkSnapshot`, `ParentRepLocked`, `EscalationRepDrainedAtFork` |
| Child pool and migrated vault | child-link events, `VaultMigrationCheckpoint` |
| Escalation continuation | `ForkCarryCheckpoint`, `CarryDepositConsumed` |
| Pool and vault accounting | `PoolAccountingCheckpoint`, `VaultAccountingCheckpoint` |
| Auction demand and settlement | `AuctionStarted`, `BidSubmitted`, `AuctionFinalized`, `BidSettled` |
| Coordinator operations | `StagedOperationQueued`, `ExecutedStagedOperation`, candidate/report lifecycle events, `PriceConsumed`, `CoordinatorStateCheckpoint` |

Protocol-global identifiers are universe and question IDs, contract addresses, and escalation snapshot IDs. Contract-local counters are stable only as composite keys: use `(game or snapshot lineage, outcome, parentDepositIndex)`, `(sourceGame, outcome, sourceNodeId)`, `(auction emitter, tick, bidIndex)`, and `(coordinator emitter, operationId)`. Mutable labels are not identifiers.

## Canonical reducers

Pool accounting is checkpoint based. Replace all eleven fields whenever `PoolAccountingCheckpoint` is observed. Replace the named vault record, including `vaultFeeRemainder`, and its global denominators on `VaultAccountingCheckpoint`. Action events explain cause; checkpoint values are authoritative when both appear.

For the Zoltar-owned oracle coordinator, replace pending and candidate report IDs, pending report sponsor, pending operation slot and counts, latest price and settlement time, last accepted report ID, and remaining WETH/REP exposure capacities whenever `CoordinatorStateCheckpoint` is observed. The associated report and operation IDs identify the cause; zero means that cause has no corresponding ID. Candidate, report, consumption, and operation action events retain lifecycle history, while the checkpoint is the authoritative resulting state. Open Oracle's internal payouts and liabilities remain outside this contract.

For escalation, append each `LocalDepositAppended` leaf under its stable deposit index and retain the live event-derived MMR peaks and leaves for every game. When `SecurityPoolForkSnapshot` records an unresolved escalation, resolve its source game from the pool relationship and `EscalationRepDrainedAtFork`, then preserve an immutable copy of the current roots, counts, peaks, and leaves under `escalationSnapshotId`; later source consumption updates only the live version. On `ForkCarryCheckpoint`, select that historical version by `snapshotId`, verify its source game and each checkpoint count/root, then clone the frozen peaks and leaves into the child before applying child-local deposits. The checkpoint fixes the roots, counts, unresolved totals, and resolution balances written to that child. Apply each `CarryDepositConsumed` by its explicit reason and resulting roots/totals. Reconstruct and maintain peaks from events; never read them from contract storage.

For auctions, create a bid on every `BidSubmitted`. The stable identity is `(auction emitter, tick, bidIndex)`, including same-tick FIFO bids. Replace that bid's settlement fields on `BidSettled`. Batch calls emit one settlement event per affected bid.

## Standard token events

Use ERC-20 `Transfer` and ERC-1155 `TransferSingle`/`TransferBatch` to reconstruct token balances and supply. For `TransferBatch`, require `ids.length == values.length` and apply each `(ids[i], values[i])` pair in array order, updating the balance and per-token-ID supply independently. A zero `from` mints that item and a zero `to` burns it.

Token events do not establish protocol cause. Attribute minting, migration, escrow, auction purchase, fork locking, sweeping, and redemption with the corresponding Zoltar-specific event. Array-taking protocol calls expand into one cause event per affected item, including `MigrationRepSplit`, `Migrate`, `CarryDepositConsumed`, and `BidSettled`; this is distinct from one array-valued `TransferBatch`. Receipt decoders must also verify the emitter address before accepting a matching signature.

## Lifecycle example

1. Pre-discover the origin pool, share token, auction, and coordinator from the configured factory's `DeploySecurityPool`, then replay the complete deployment receipt in canonical order. This retains the share token's earlier constructor `AuthorizationUpdated` and the initial coordinator and pool checkpoints.
2. Apply `DepositRep`, its vault checkpoint, `CompleteSetCreated`, and its pool checkpoint. Token transfer events update balances; the Zoltar events explain why they moved.
3. Pre-discover each game from its pool's `EscalationGameSet`, then append local escalation deposits and their stable leaf identities until the game resolves or reaches non-decision.
4. On a universe or own-game fork, freeze the parent from `SecurityPoolForkSnapshot`; apply the cause-specific REP locking and draining events.
5. Discover two parallel child universes and pools independently. Initialize each continuation from its `ForkCarryCheckpoint`; never treat one child's consumption as the other's.
6. Apply every `VaultMigrationCheckpoint`, including zero-collateral migrations, using its deltas and resulting parent/child totals.
7. Replay the truth auction from `AuctionStarted` through every indexed bid and per-bid settlement. Apply auction-claim pool checkpoints to fee eligibility.
8. Consume winning, losing, exported, direct-parent, and forked-escrow continuation deposits by their explicit reasons and resulting commitments.
9. Finish with complete-set, winning-share, REP, and pool-fee withdrawals. The final replayed checkpoints should match the corresponding storage getters when audited.

The generated [Contract Interaction Reference](./contract-interaction-reference.md) maps transaction entrypoints to their primary events. The [Operator Reference](./operator-reference.md) documents lifecycle guardrails and recovery paths.
