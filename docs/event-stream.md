# Zoltar Event Stream Contract

The canonical event stream reconstructs economically relevant Zoltar and Placeholder state without storage reads, transaction input, traces, or undocumented assumptions during replay. Storage getters may be used after replay for auditing and recovery.

## Deployment anchor and schema version

For each chain, record the successful deployment receipt for the root `Zoltar` deployment and the addresses produced by the deployment flow. The receipt block is the inclusive protocol-schema start block. Do not begin at the first later transaction because constructor events, including initial share-token authorization, are part of the stream.

Genesis REP has a separate balance-history anchor because it exists before `Zoltar`. Discover its address from the root `UniverseInitialized` event, then load that token's standard `Transfer` history from its own deployment receipt through the protocol head and merge those logs into canonical order. Pre-discover REP token addresses from `UniverseInitialized` and `DeployChild` before reducing the ordered stream so the earlier genesis transfers are not discarded. Child REP tokens are deployed inside the protocol stream and need no earlier anchor. If a chain cannot supply the genesis token's complete event history, event-only REP balance and supply indexing on that chain is unsupported.

The prelaunch deployment using `LoggedOpenOracle` is event schema version 1. A deployment with different event signatures is a new cutover: store its deployment block and contract-address set as a separate schema segment. Never merge logs from two schema segments by event name alone.

## Ordering, identity, and rollback

Apply logs in ascending `(blockNumber, transactionIndex, logIndex)` order. The canonical idempotency key is:

```text
chainId + blockHash + transactionHash + logIndex
```

On a reorganization, remove every event whose `blockHash` became orphaned, restore the last canonical checkpoint before the removed block, and replay the replacement branch in canonical order. Transaction reverts leave no durable events.

The emitting address identifies the current pool, game, auction, token, Oracle, or coordinator. Shared factories and the forker include relationship addresses because one emitter manages several children.

## Units and value semantics

- `ethAmount` values are wei. `repAmount` and `shareAmount` use the token's smallest unit.
- Pool fee indexes and retention rates use the scales documented on their interface fields. Treat a field named `resulting...` as the authoritative post-mutation value.
- Delta fields such as `migratedRepDelta`, `collateralDelta`, and `ethRefund` describe only the current item or action. Cumulative and resulting fields replace the prior replay value.
- A conceptual burn or escrow movement is not an ERC-20 burn unless the corresponding token event says so.
- Amounts in `TokenPayoutResult` and `EthPayoutResult` are gross obligations to the named recipient. `paid = false` creates a deferred liability, except a failed `ProtocolFeeWithdrawal`, which restores an existing liability rather than creating another one.

| Field family | Denomination or scale | Gross, net, cumulative, and rounding meaning |
| --- | --- | --- |
| `ethAmount`, collateral, fees, allowances, reserves | Wei; security-bond allowances are wei-denominated obligations | `CompleteSetCreated.ethAmount` is the gross ETH supplied. Redemption `ethAmount` fields are the net wei paid after fee accrual has reduced collateral. Resulting collateral fields replace prior state. |
| `repAmount`, REP auction fills | REP token base units | Migration, consumption, and fill fields are per-action deltas unless named cumulative or resulting. |
| Oracle token payouts | Base units of the indexed `token` | Payout-result amounts are gross obligations in the named token; a failed payout becomes a liability unless its reason is `ProtocolFeeWithdrawal`. |
| `shareAmount`, `sharesMinted`, share-token supply | Share-token base units | Mint/burn amounts are deltas. `resultingShareTokenSupply` is the authoritative post-action total. Integer division in redemption rounds the wei payout down. |
| `poolOwnershipAmount` and ownership denominators | Internal pool-ownership units | Initial conversion uses `repAmount * 1e18`; later conversions preserve the current proportional ownership ratio with Solidity integer rounding. Resulting denominators replace prior totals. |
| Pool and vault `feeIndex` | `1e18` fixed-point fee-per-eligible-allowance unit | Index deltas truncate toward zero. `feeIndexRemainder` carries the allocation numerator modulo the current eligible-allowance denominator. |
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
| Oracle liabilities | `ProtocolFeeAccrued`, payout-result events, fee-withdrawal events |
| Coordinator operations | `StagedOperationQueued`, `ExecutedStagedOperation`, terminal report events |

Protocol-global identifiers are universe and question IDs, contract addresses, and escalation snapshot IDs. Contract-local counters are stable only as composite keys: use `(game or snapshot lineage, outcome, parentDepositIndex)`, `(sourceGame, outcome, sourceNodeId)`, `(auction emitter, tick, bidIndex)`, `(Oracle emitter, reportId)`, and `(coordinator emitter, operationId)`. Mutable labels are not identifiers.

## Canonical reducers

Pool accounting is checkpoint based. Replace all eleven fields whenever `PoolAccountingCheckpoint` is observed. Replace the named vault record and its global denominators on `VaultAccountingCheckpoint`. Action events explain cause; checkpoint values are authoritative when both appear.

For escalation, append each `LocalDepositAppended` leaf under its stable deposit index. `ForkCarryCheckpoint` fixes the roots, counts, unresolved totals, and resolution balances written to the child. Apply each `CarryDepositConsumed` by its explicit reason and resulting roots/totals. Do not reconstruct a peak array from storage.

For auctions, create a bid on every `BidSubmitted`. The stable identity is `(auction emitter, tick, bidIndex)`, including same-tick FIFO bids. Replace that bid's settlement fields on `BidSettled`. Batch calls emit one settlement event per affected bid.

For `LoggedOpenOracle`, add `ProtocolFeeAccrued` and failed payout amounts to the recipient's token or ETH liability, except when a failed token payout has reason `ProtocolFeeWithdrawal`: that result restores the liability which already existed. Subtract only successful `TokenFeesWithdrawn` and `EthFeesWithdrawn` events. A failed ETH withdrawal reverts and has no durable event.

## Standard token events

Use ERC-20 `Transfer` and ERC-1155 `TransferSingle`/`TransferBatch` to reconstruct token balances and supply. They do not establish protocol cause. Attribute minting, migration, escrow, auction purchase, fork locking, sweeping, and redemption with the corresponding Zoltar-specific event. Receipt decoders must also verify the emitter address before accepting a matching signature.

## Lifecycle example

1. Replay question creation and `DeploySecurityPool` to discover the origin pool, share token, auction, and coordinator. Include the share token's constructor `AuthorizationUpdated`.
2. Apply `DepositRep`, its vault checkpoint, `CompleteSetCreated`, and its pool checkpoint. Token transfer events update balances; the Zoltar events explain why they moved.
3. Append local escalation deposits and their stable leaf identities until the game resolves or reaches non-decision.
4. On a universe or own-game fork, freeze the parent from `SecurityPoolForkSnapshot`; apply the cause-specific REP locking and draining events.
5. Discover two parallel child universes and pools independently. Initialize each continuation from its `ForkCarryCheckpoint`; never treat one child's consumption as the other's.
6. Apply every `VaultMigrationCheckpoint`, including zero-collateral migrations, using its deltas and resulting parent/child totals.
7. Replay the truth auction from `AuctionStarted` through every indexed bid and per-bid settlement. Apply auction-claim pool checkpoints to fee eligibility.
8. Consume winning, losing, exported, direct-parent, and forked-escrow continuation deposits by their explicit reasons and resulting commitments.
9. Finish with complete-set, winning-share, REP, fee, and Oracle-liability withdrawals. The final replayed checkpoints should match the corresponding storage getters when audited.

The generated [Contract Interaction Reference](./contract-interaction-reference.md) maps transaction entrypoints to their primary events. The [Operator Reference](./operator-reference.md) documents lifecycle guardrails and recovery paths.
