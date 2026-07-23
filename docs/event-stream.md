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
| `shareAmount`, `sharesMinted`, share-token supply | Share-token base units | Mint/burn amounts are deltas. `resultingShareTokenSupply` is the authoritative remaining economic claim supply, including unmaterialized fork entitlements. Integer division in redemption rounds the wei payout down. |
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

Fork snapshot events require two-part provenance. First require the configured `SecurityPoolForker` as emitter. Then require the indexed parent to have been established by an earlier `SecurityPoolRegistered` event from the configured `SecurityPoolFactory`. The forker emitter alone is insufficient because its permissionless fork entrypoints accept any interface-compatible pool address. During recovery or a post-replay audit, the equivalent storage check loads `originId = getSecurityPoolOriginId(parent)` and requires `getSecurityPool(originId, parent.universeId()) == parent`.

| Relationship or state | Canonical events |
| --- | --- |
| Question, root universe, and universe fork | `QuestionCreated`, `UniverseInitialized`, `UniverseForked` |
| Child universe and child REP | `DeployChild`, `MigrationRepAdded`, `MigrationRepSplit` |
| Pool, share token, auction, and coordinator | `SecurityPoolRegistered`, `DeploySecurityPool`, and constructor/deployment events |
| Share-token permissions | `AuthorizationUpdated` |
| Parent pool fork state | `SecurityPoolForkSnapshot`, `ParentRepLocked`, `EscalationRepDrainedAtFork`, accepted only after the forker-emitter and factory-registration checks above |
| Child pool and migrated vault | `ChildPoolLinked`, `ChildRepSplit`, `ChildPoolRepSwept`, `ChildEscalationRepMaterialized`, `VaultMigrationCheckpoint` |
| Vault escalation entitlement | `EscalationMigrationEntitlementInitialized`, `EscalationMigrationEntitlementMaterialized` |
| Remaining share economic-claim supply | `ShareTokenSupplySet`; then the `resultingShareTokenSupply` field on complete-set and winning-share action events |
| Escalation continuation | `ForkCarryCheckpoint`, `InheritedThresholdTie`, `CarryDepositConsumed` |
| Pool and vault accounting | `PoolAccountingCheckpoint`, `VaultAccountingCheckpoint` |
| Auction demand and settlement | `AuctionStarted`, `BidSubmitted`, `AuctionFinalized`, `BidSettled` |
| Coordinator operations | `StagedOperationQueued`, `ExecutedStagedOperation`, terminal report events, `CoordinatorStateCheckpoint` |

Protocol-global identifiers are universe and question IDs, contract addresses, and escalation snapshot IDs. Contract-local counters are stable only as composite keys: use `(game or snapshot lineage, outcome, parentDepositIndex)`, `(sourceGame, outcome, sourceNodeId)`, `(auction emitter, tick, bidIndex)`, and `(coordinator emitter, operationId)`. Mutable labels are not identifiers.

### Discovery and migration event schemas

The events below close the discovery and fork-migration boundaries that an indexer must not infer from token transfers. Field names are listed in declaration order; indexed fields are marked `indexed`.

| Emitter and event | Fields | Reducer meaning |
| --- | --- | --- |
| `ZoltarQuestionData.QuestionCreated` | `questionId indexed`, `createdTimestamp`, `questionData`, `outcomeOptions` | Creates the immutable question record and its categorical labels. |
| `Zoltar.UniverseInitialized` | `universeId indexed`, `forkTime`, `forkQuestionId`, `forkingOutcomeIndex`, `reputationToken`, `parentUniverseId indexed`, `universeTheoreticalSupply` | Discovers the root universe and its genesis REP token and theoretical supply. The constructor emits it only for universe 0. |
| `Zoltar.DeployChild` | `deployer`, `universeId indexed`, `outcomeIndex indexed`, `childUniverseId indexed`, `childReputationToken`, `childUniverseTheoreticalSupply` | Discovers a child universe, its parent branch, child REP token, and theoretical supply. |
| `SecurityPoolFactory.SecurityPoolRegistered` | `originId indexed`, `poolId indexed`, `universeId indexed`, `securityPool` | Establishes the canonical pool lookup key. It is emitted before `DeploySecurityPool` in the same transaction. |
| `SecurityPoolFactory.DeploySecurityPool` | `securityPool indexed`, `truthAuction`, `priceOracleManagerAndOperatorQueuer`, `shareToken`, `parent indexed`, `universeId indexed`, `questionId`, `securityMultiplier`, `currentRetentionRate`, `completeSetCollateralAmount` | Discovers the pool and all of its constructed relationships. |
| `SecurityPoolForker.ChildPoolLinked` | `parent indexed`, `outcomeIndex indexed`, `child indexed`, `truthAuction` | Connects one fork branch to its canonical child pool and auction. |
| `SecurityPoolForker.ChildRepSplit` | `parent indexed`, `outcomeIndex indexed`, `childPoolRepSplit`, `pendingChildRep` | Replaces cumulative REP split and pending-to-pool accounting for that branch. |
| `SecurityPoolForker.ChildEscalationRepMaterialized` | `parentPool indexed`, `childPool indexed`, `childGame indexed`, `outcomeIndex`, `repAmount`, `resultingEscalationRepBalance` | Records child REP delivered as continuation-game backing and its resulting balance. |
| `SecurityPoolForker.ChildPoolRepSwept` | `parentPool indexed`, `childPool indexed`, `outcomeIndex indexed`, `repAmount`, `resultingChildPoolRepBalance` | Records pending child REP delivered to the pool and its resulting balance. |
| `SecurityPoolForker.EscalationMigrationEntitlementInitialized` | `parent indexed`, `vault indexed`, `sourcePrincipalByOutcome`, `currentRepByOutcome`, `totalCurrentRep` | Freezes the vault's exported unresolved-escalation entitlement once. |
| `SecurityPoolForker.EscalationMigrationEntitlementMaterialized` | `parent indexed`, `vault indexed`, `childOutcomeIndex indexed`, `child`, `childRep` | Marks that entitlement as materialized for one child branch. |

These child and entitlement event families are declared in migration base, interface, or delegate modules but are emitted from the recognized `SecurityPoolForker` address because the implementation executes them through `delegatecall`. Accepting the same signature from a helper, delegate, or event-emitter address would allow false protocol history.

`ReputationToken.TheoreticalSupplySet(totalTheoreticalSupply)`, `Mint(account indexed, value)`, and `Burn(account indexed, value, totalTheoreticalSupply)` explain the theoretical-supply changes around the standard ERC-20 `Transfer` stream. The ERC-20 transfer remains authoritative for balances and actual supply; `Burn.totalTheoreticalSupply` is the authoritative post-burn ceiling.

Pool migration setters have exact replacement events: `AwaitingForkContinuationSet(awaitingForkContinuation)`, `OwnershipDenominatorSet(poolOwnershipDenominator)`, `ShareTokenSupplySet(shareTokenSupply)`, and `SystemStateSet(systemState)`. Apply them only from the affected recognized pool. `configureVault` and `setPoolFinancials` instead end in the authoritative vault or pool checkpoints described below.

Escalation escrow bookkeeping uses `VaultEscrowUpdated(vault indexed, escrowedRepByVault, totalEscrowedRep)`, `ForkedEscrowRecorded(depositor indexed, outcome indexed, sourcePrincipalTotal, childRepTotal, escrowedRepByVault, totalEscrowedRep, outcomeBalance)`, `VaultUnresolvedTotalsExported(vault indexed, repReceiver, principalByOutcome, principalToTransfer, transferredRep)`, and `ForkedEscrowExported(vault indexed, repReceiver, sourcePrincipalByOutcome, childRepByOutcome, totalChildRepToTransfer, transferredRep)`. The ABI also declares `ForkedEscrowClaimed`, but the current implementation never emits it; reducers must not wait for or synthesize that event.

Standard ERC-20 `Transfer` and `Approval`, plus ERC-1155 `TransferSingle`, `TransferBatch`, and `ApprovalForAll`, may be indexed for wallet balances and authorization, but they do not replace a Zoltar lifecycle or accounting field. The ERC-1155 ABI declares `URI`, but the current implementation never emits it; indexers must not wait for or synthesize that event. ERC-20 `Approval` is not an authoritative allowance reducer: a finite `transferFrom` spend decreases allowance without emitting `Approval`, while infinite allowance is neither decreased nor re-emitted. OpenOracle's `InternalApproval` likewise tracks only its separate internal-balance allowance and is not part of the packed report-state reducer. The imported `IAugur` event declarations are compatibility types; Zoltar contracts do not emit an Augur event stream.

`DeploymentStatusOracle.DeploymentAddressesSet(address[])` is a constructor event for deployment tooling, not part of the economic reducer. It records the exact ordered address list whose positions are queried by `getDeploymentMask()`; see [Deployment Status Oracle](./deployment-status.html).

## Canonical reducers

Pool accounting is checkpoint based. Replace all eleven fields whenever `PoolAccountingCheckpoint` is observed. Replace the named vault record, including `vaultFeeRemainder`, and its global denominators on `VaultAccountingCheckpoint`. Action events explain cause; checkpoint values are authoritative when both appear.

Share economic-claim accounting is replace based. When `startTruthAuction` prepares the child after its migration window and emits `ShareTokenSupplySet`, replace that pool's remaining economic claim supply with the event value; this includes source entitlements whose child ERC-1155 balances have not materialized yet. ERC-1155 transfers and `Migrate` update materialized token balances but do not change this denominator. `CompleteSetCreated`, `CompleteSetRedeemed`, and `SharesRedeemed` subsequently replace it through `resultingShareTokenSupply`.

For the Zoltar-owned oracle coordinator, replace pending report ID and sponsor, pending operation slot and counts, base-fee guard, and latest price and settlement time whenever `CoordinatorStateCheckpoint` is observed. The associated report and operation IDs identify the cause; zero means that cause has no corresponding ID. Report and operation action events retain lifecycle history, while the checkpoint is the authoritative resulting state. Open Oracle's internal payouts and liabilities remain outside this contract.

For escalation, append each `LocalDepositAppended` leaf under its stable deposit index and retain the live event-derived MMR peaks and leaves for every game. When `SecurityPoolForkSnapshot` records an unresolved escalation, resolve its source game from the pool relationship and `EscalationRepDrainedAtFork`, then preserve an immutable copy of the current roots, counts, peaks, and leaves under `escalationSnapshotId`; later source consumption updates only the live version. On `ForkCarryCheckpoint`, select that historical version by `snapshotId`, verify its source game and each checkpoint count/root, then clone the frozen peaks and leaves into the child before applying child-local deposits. The checkpoint fixes the roots, counts, unresolved totals, and resolution balances written to that child. `NonDecisionReached` records the `Local` lifecycle state and its timestamp. `InheritedThresholdTie(sourceGame indexed)` records the inherited state without creating a local timestamp; accept it only after a `ForkCarryCheckpoint` from the same child emitter and require its indexed `sourceGame` to equal that checkpoint's source. Apply each `CarryDepositConsumed` by its explicit reason and resulting roots/totals. Reconstruct and maintain peaks from events; never read them from contract storage.

For auctions, create a bid on every `BidSubmitted`. The stable identity is `(auction emitter, tick, bidIndex)`, including same-tick FIFO bids. Replace that bid's settlement fields on `BidSettled`. Batch calls emit one settlement event per affected bid.

## Standard token events

Use ERC-20 `Transfer` and ERC-1155 `TransferSingle`/`TransferBatch` to reconstruct token balances and supply. For `TransferBatch`, require `ids.length == values.length` and apply each `(ids[i], values[i])` pair in array order, updating the balance and per-token-ID supply independently. A zero `from` mints that item and a zero `to` burns it.

Token events do not establish protocol cause. Attribute minting, migration, escrow, auction purchase, fork locking, sweeping, and redemption with the corresponding Zoltar-specific event. Array-taking protocol calls expand into one cause event per affected item, including `MigrationRepSplit`, `Migrate`, `CarryDepositConsumed`, and `BidSettled`; this is distinct from one array-valued `TransferBatch`. Receipt decoders must also verify the emitter address before accepting a matching signature.

## Lifecycle example

1. Pre-discover the origin pool, share token, auction, and coordinator from the configured factory's `DeploySecurityPool`, then replay the complete deployment receipt in canonical order. This retains the share token's earlier constructor `AuthorizationUpdated` and the initial coordinator and pool checkpoints.
2. Apply `DepositRep`, its vault checkpoint, `CompleteSetCreated`, and its pool checkpoint. Token transfer events update balances; the Zoltar events explain why they moved.
3. Pre-discover each game from its pool's `EscalationGameSet`, then append local escalation deposits and their stable leaf identities until the game resolves or reaches non-decision.
4. On a universe or own-game fork, first verify both the forker emitter and the indexed parent's factory registration, then freeze the parent from `SecurityPoolForkSnapshot` and apply the cause-specific REP locking and draining events.
5. Discover two parallel child universes and pools independently. Initialize each continuation from its `ForkCarryCheckpoint`; never treat one child's consumption as the other's.
6. Apply every `VaultMigrationCheckpoint`, including zero-collateral migrations, using its deltas and resulting parent/child totals.
7. On every `startTruthAuction`, initialize the child's remaining economic claim supply from `ShareTokenSupplySet`. If `AuctionStarted` follows, replay every indexed bid and per-bid settlement and apply auction-claim pool checkpoints to fee eligibility. On the immediate no-auction path, apply `TruthAuctionFinalized` and its pool checkpoints without expecting bids.
8. Consume winning, losing, exported, direct-parent, and forked-escrow continuation deposits by their explicit reasons and resulting commitments.
9. Finish with complete-set, winning-share, REP, and pool-fee withdrawals. The final replayed checkpoints should match the corresponding storage getters when audited.

The generated [Contract Interaction Reference](./contract-interaction-reference.md) maps transaction entrypoints to their primary events. The [Operator Reference](./operator-reference.md) documents lifecycle guardrails and recovery paths.
