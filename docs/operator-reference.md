# Placeholder Operator Reference

This reference maps implementation guardrails to their contract sources for
operators, indexers, reviewers, and UI maintainers. The white paper explains the
protocol flow; this page keeps the operational edge cases in one place.

## Security Pool Guardrails

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Origin pool shape | Origin pools require an existing question, an unforked universe, a present universe REP token, and exactly two categorical labels in this order: `Yes`, then `No`. Placeholder adds `Invalid` as the third trading and resolution outcome. | [SecurityPoolFactory.sol](../solidity/contracts/peripherals/factories/SecurityPoolFactory.sol), [ShareToken.sol](../solidity/contracts/peripherals/tokens/ShareToken.sol), [BinaryOutcomes.sol](../solidity/contracts/peripherals/BinaryOutcomes.sol) |
| Deployment history | The factory records security-pool deployments and exposes paged deployment-history reads for indexers and UIs. | [SecurityPoolFactory.sol](../solidity/contracts/peripherals/factories/SecurityPoolFactory.sol) |
| Deterministic addresses | Origin-pool salts include the zero parent address, universe id, question id, and `securityMultiplier`; child-pool salts include the parent pool address. The share token uses a separate salt from `securityMultiplier` and question id. | [SecurityPoolFactory.sol](../solidity/contracts/peripherals/factories/SecurityPoolFactory.sol) |
| Share-token salt squatting | Direct `ShareTokenFactory` callers cannot reserve the canonical origin-pool share-token address. `CREATE2` includes constructor arguments in the init-code hash, and the share token owner is `msg.sender`, so a direct caller using the canonical salt deploys a caller-owned token at a different address than the `SecurityPoolFactory` deployment. | [ShareTokenFactory.sol](../solidity/contracts/peripherals/factories/ShareTokenFactory.sol), [ShareToken.sol](../solidity/contracts/peripherals/tokens/ShareToken.sol) |
| Complete-set minting | Complete-set minting checks the next collateral amount against available bond capacity before minting shares, then updates pool accounting before the share-token mint call. | [`SecurityPool.createCompleteSet`](../solidity/contracts/peripherals/SecurityPool.sol#L474) |
| Fee accrual clamp | Fee accrual is clamped to the question end time while the universe is unforked; after a universe fork, the accumulator is clamped to the fork time. | [SecurityPool.sol](../solidity/contracts/peripherals/SecurityPool.sol) |
| Retention-rate updates | Retention-rate updates no-op when total bond allowance is zero or when the pool is not `Operational`. | [SecurityPool.sol](../solidity/contracts/peripherals/SecurityPool.sol) |
| Escrowed REP withdrawal lock | `performWithdrawRep` rejects withdrawal while the vault still has REP escrowed in an escalation game; the vault must settle those locks first. | [SecurityPool.sol](../solidity/contracts/peripherals/SecurityPool.sol) |
| External fork withdrawal lock | If the universe forked before the local escalation game ended and non-decision was not reached, parent-pool escalation withdrawal reverts and the vault must migrate forked locks. | [SecurityPool.sol](../solidity/contracts/peripherals/SecurityPool.sol) |
| Escalation deposit wrapper | `depositToEscalationGame` deploys the game on the first valid post-end deposit, previews the accepted amount, removes vault REP ownership with round-up accounting, checks local and global solvency, transfers REP into the game, and records the deposit. | [`SecurityPool.depositToEscalationGame`](../solidity/contracts/peripherals/SecurityPool.sol#L563), [`EscalationGame.recordDepositFromSecurityPool`](../solidity/contracts/peripherals/EscalationGame.sol#L60) |
| Direct ETH receiver | The pool accepts direct ETH only from the forker, its truth auction, or its parent pool. | [SecurityPool.sol](../solidity/contracts/peripherals/SecurityPool.sol) |

## Share Migration

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Full-balance burn | `ShareToken.migrate` burns the caller's entire balance of the parent token id; callers cannot migrate only part of that token id. | [ShareToken.sol](../solidity/contracts/peripherals/tokens/ShareToken.sol) |
| Target list | The target outcome list must be non-empty, valid for the fork question, and strictly increasing. | [ShareToken.sol](../solidity/contracts/peripherals/tokens/ShareToken.sol) |
| Balance reproduction | The full burned source balance is minted into each selected child token id, so migration is reproduction across selected branches rather than a pro-rata split. | [ShareToken.sol](../solidity/contracts/peripherals/tokens/ShareToken.sol) |
| Malformed outcomes | Malformed fork outcomes are rejected using Zoltar question-data validation. | [ZoltarQuestionData.sol](../solidity/contracts/ZoltarQuestionData.sol) |

## Escalation Resolution and Deposits

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Deposit preview | The preview path expects a proposed amount of at least the current `startBond`. | [`EscalationGame.previewDepositOnOutcome`](../solidity/contracts/peripherals/EscalationGame.sol#L40) |
| Recorded deposit amount | The recorded deposit must be positive, and the accepted amount must be at least `startBond` unless it exactly fills the selected outcome to `nonDecisionThreshold`. | [`EscalationGame.recordDepositFromSecurityPool`](../solidity/contracts/peripherals/EscalationGame.sol#L60), [`EscalationGameCalculations._getAcceptedDepositAmount`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L113) |
| Outcome room | Accepted deposit amount is capped to the selected outcome's remaining room under `nonDecisionThreshold`. | [`EscalationGameCalculations._getAcceptedDepositAmount`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L113) |
| Tie adjustment | If the accepted amount would create a tie with the current maximum balance while still below non-decision, the contract reduces the accepted amount by `1 wei`; if that breaks the accepted-amount rule, the deposit is rejected. | [`EscalationGameCalculations._getAcceptedDepositAmount`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L113) |
| Unresolved resolution state | If two or more outcomes meet the current running cost, `getQuestionResolution()` returns `None`. | [`EscalationGameCalculations.getQuestionResolution`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L91) |
| Empty-game fallback | If all outcome balances are zero after the running cost is non-zero, `getQuestionResolution()` returns `Invalid`; if the running cost is still zero, the unresolved check returns `None` first. | [`EscalationGameCalculations.getQuestionResolution`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L91) |
| Strict leading fallback | A strict `Invalid` or `Yes` lead returns that outcome. If no outcome strictly leads and the game is not unresolved, the helper falls through to `No`. | [`EscalationGameCalculations.getQuestionResolution`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L91), [`EscalationGameCalculations._strictLeadingOutcome`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L250) |
| Non-decision | `hasReachedNonDecision()` becomes true when two or more outcomes reach `nonDecisionThreshold`. | [`EscalationGameCalculations.hasReachedNonDecision`](../solidity/contracts/peripherals/EscalationGameCalculations.sol#L103) |
| Carry proofs | Inherited carry uses Merkle Mountain Range peaks and nullifier roots so child games can consume proofs without replaying already-spent parent deposits. | [`EscalationGameSettlement.withdrawDeposit`](../solidity/contracts/peripherals/EscalationGameSettlement.sol#L49), [`EscalationGameCarry._verifyAndConsumeCarriedDepositProof`](../solidity/contracts/peripherals/EscalationGameCarry.sol#L242) |
| Continuation withdrawal | `withdrawForkedEscalationDeposits` settles proof-based carried deposits for one beneficiary vault per call after a child continuation resolves. | [`SecurityPool.withdrawForkedEscalationDeposits`](../solidity/contracts/peripherals/SecurityPool.sol#L538), [`EscalationGameSettlement.withdrawDeposit`](../solidity/contracts/peripherals/EscalationGameSettlement.sol#L49) |
| Local carry batching | Local unresolved export work is paged in batches of at most `MAX_UNRESOLVED_EXPORT_REFS = 64` refs per vault. | [`EscalationGameEscrow._exportVaultUnresolvedDepositBatchDetailed`](../solidity/contracts/peripherals/EscalationGameEscrow.sol#L150) |
| Residual sweep | Once a game is final, unresolved principal is cleared, and no escrow remains, residual REP in the escalation game can be swept back to the security pool. | [`EscalationGameSettlement.sweepResidualRepToSecurityPool`](../solidity/contracts/peripherals/EscalationGameSettlement.sol#L150) |

## Fork Migration

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Pool-specific migration identity | The forker lazily deploys one deterministic `SecurityPoolMigrationProxy` per parent pool. The proxy is the stable `msg.sender` for Zoltar migration accounting. | [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol), [SecurityPoolMigrationProxy.sol](../solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol) |
| Proxy authority | The migration proxy is owner-controlled by the forker and wraps `lockRep`, `forkUniverse`, `splitToChild`, and child REP sweeping. | [SecurityPoolMigrationProxy.sol](../solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol) |
| Child REP backing | During vault migration, the forker ensures the child pool is backed by enough child-universe REP for cumulative migrated REP credited to that child. | [SecurityPoolForkerVaultMigrationBase.sol](../solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol) |
| Split shortfall tracking | The forker tracks how much REP has already been split for each parent-pool/outcome pair and only splits the shortfall before sweeping child REP into the child pool. | [SecurityPoolForkerVaultMigrationBase.sol](../solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol) |
| Own-fork REP buckets | In an own fork, the forker splits auctionable child REP into a vault bucket and an unresolved-escalation bucket according to the pre-burn pool REP and escalation REP mix. | [`SecurityPoolForker.forkZoltarWithOwnEscalationGame`](../solidity/contracts/peripherals/SecurityPoolForker.sol#L570), [`SecurityPoolForkerVaultMigrationBase._initializeOwnForkRepBuckets`](../solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol#L136) |
| Forked escrow scaling | Forked escrow records source principal and child REP by original outcome; later claims scale source amounts into child REP with cumulative ceiling division. | [`EscalationGameEscrow.recordForkedEscrowForOutcome`](../solidity/contracts/peripherals/EscalationGameEscrow.sol#L17), [`EscalationGameEscrow._consumeForkedEscrow`](../solidity/contracts/peripherals/EscalationGameEscrow.sol#L97) |
| Child-pool deployment window | Child pools are created lazily for selected fork outcomes, but only while the parent pool is `PoolForked` and the eight-week migration window is still open. | [SecurityPoolForkerVaultMigrationBase.sol](../solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol), [SecurityPoolUtils.sol](../solidity/contracts/peripherals/SecurityPoolUtils.sol) |
| Own-fork child outcome | In an own-fork child, the child's outcome is fixed by the child's Zoltar outcome index. | [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol) |
| External-fork child outcome | In an external-fork child, a local escalation result is used only if that escalation ended before the universe forked. | [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol) |

## Truth Auction Operations

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Owner | Child-pool truth auctions are owned by `SecurityPoolForker`, which starts and finalizes the auction and settles bid pages into vault accounting. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol), [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol) |
| REP sale cap | The truth auction cap is the pool auctionable REP at fork minus `migratedRep / MAX_AUCTION_VAULT_HAIRCUT_DIVISOR`; if that haircut reaches the baseline, no REP is sold. | [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol), [SecurityPoolUtils.sol](../solidity/contracts/peripherals/SecurityPoolUtils.sol) |
| Bidding window | Bids are accepted only after start, before finalization, and before `auctionStarted + 1 week`. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol) |
| No bid or tick cap | The auction intentionally has no total bid cap and no active-tick cap; finalization uses aggregate ETH totals in an AVL tree keyed by tick. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol) |
| Bounded tree height | The finite tick range admits at most `1,048,577` price levels, so an AVL tree over every possible tick has maximum height `28`. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol) |
| Pre-finalization refunds | Clearly losing bids can be refunded before finalization once current demand is enough to find a clearing tick; only ticks below the found clearing tick can be withdrawn. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol) |
| Finalized settlement | After finalization, only the auction owner withdraws bid outcomes from the auction; `SecurityPoolForker` wraps that call so anyone can settle a vault's bid pages. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol), [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol) |
| Auction accounting | Settled winning REP becomes pool ownership through `repToPoolOwnership`; auctioned security-bond allowance is assigned pro rata by purchased REP, with the final claim taking integer-division remainder. | [SecurityPoolForker.sol](../solidity/contracts/peripherals/SecurityPoolForker.sol), [SecurityPoolForkerVaultMigrationBase.sol](../solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol) |
| Underfunded dust | Underfunded auctions carry division dust through `underfundedRemainder` as bid pages are withdrawn. | [UniformPriceDualCapBatchAuction.sol](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol) |

## REP/ETH Oracle Operations

| Area | Implementation behavior | Source |
| --- | --- | --- |
| Request bounty | `requestPriceEthCost = block.basefee * 4 * (callbackGasLimit + gasConsumedOpenOracleReportPrice) + 101`. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Callback gas | Callback gas is `gasConsumedSettlement * MAX_PENDING_SETTLEMENT_OPERATIONS`. With current parameters that is `1,000,000 * 4 = 4,000,000`. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Immediate execution | If a price is still valid and the operation fits the remaining price-round notional budget, the operation executes immediately and the caller's ETH is refunded. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Staging guardrails | Withdraw and liquidation amounts must be non-zero; allowance updates may set zero. Validity must be positive and no more than five minutes. Non-liquidation operations must target the caller's own vault. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Pending report bound | At most four operations are attached to one settlement callback. Operations can still be tracked as active even when they do not fit into the pending callback batch. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| High settlement basefee | The callback clears the pending report but no-ops if settlement basefee is above the stored maximum multiplier from request time. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Zero report values | A callback with zero amount, zero denominator, or a computed zero price does not update `lastPrice`. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Recovery path | Anyone can call `recoverSettledPendingReport`; it reads settlement data, clears the pending report, and consumes the associated pending operation slot. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Consumed failures | Expired operations, stale liquidations, operations over the price-round budget, and liquidations too close to threshold are consumed and emitted as failed executions rather than retried forever. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Liquidation snapshot | A staged liquidation becomes stale if target ownership decreases or target allowance changes. A target vault can deposit more REP without invalidating the staged liquidation. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
| Liquidation distance | A staged liquidation must remain at least `minLiquidationPriceDistanceBps` beyond the liquidation threshold when it executes. | [SecurityPoolOracleCoordinator.sol](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) |
