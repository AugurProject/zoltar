# Audit Traceability Matrix

Date: 2026-06-18

This matrix maps each retained finding to exact code evidence, failed invariants, exploit assumptions, and confidence limits.

## H-01: Truth-Auction ETH Is Not Credited To Child Pool

Status on latest `origin/main`: Fixed by commit `8d2a2aa0103138bd706e2664af6dfb90c9e73e4b`.

### Original Evidence

| Claim | Evidence |
| --- | --- |
| Truth auctions send finalized ETH to `owner`. | `UniformPriceDualCapBatchAuction.finalize()` sets `ethToSend` and calls `payable(owner).call{ value: ethToSend }('')` at `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol:125-149`. |
| Child truth auctions are owned by the forker. | `UniformPriceDualCapBatchAuction` constructor comments identify the owner as `SecurityPoolForker`; child deployment passes `address(securityPoolForker)` as auction owner in `SecurityPoolFactory.deployChildSecurityPool()`. |
| Original vulnerable code finalized the auction but did not forward ETH to the child. | On the original vulnerable commit, `_consumeTruthAuctionRep()` called `data.truthAuction.finalize()` and read `totalRepPurchased()` but made no ETH transfer. Latest `origin/main` now forwards `ethReceived` to `address(securityPool)` at `solidity/contracts/peripherals/SecurityPoolForker.sol:485-491`. |
| Child collateral is computed from the child pool balance only. | `_captureUnclaimedCollateralForAuction()` reads `address(securityPool).balance` and calls `securityPool.setPoolFinancials(collateralAmount, ...)` at `solidity/contracts/peripherals/SecurityPoolForker.sol:491-501`. |
| Forker can receive auction ETH only from trusted auctions. | `SecurityPoolForker.receive()` only checks `trustedAuctionAddresses[msg.sender]`; latest `origin/main` forwards ETH received during finalization immediately to the child pool. |

### Broken Invariant

For every finalized child truth auction:

```text
auction ETH raised by winning bids
  == ETH credited to child pool collateral
   + bidder refunds
   + explicitly accounted protocol fees
```

On the original vulnerable commit, winning auction ETH could instead remain in `SecurityPoolForker`. Latest `origin/main` forwards that ETH to the child pool before collateral capture.

### Executable PoC

`solidity/ts/tests/auditFindings.test.ts`, test `H-01 regression: finalized truth-auction ETH is forwarded to the child pool`.

Validation command: `bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000`

Result on latest `origin/main`: H-01 regression passes and confirms the fixed behavior. M-01 still passes as a vulnerable-behavior PoC and remains open.

### Confidence

High. The issue follows directly from a value-transfer path and absence of a forwarding path in the reviewed code. It does not depend on oracle behavior or race conditions.

### Limits

The exact loss distribution depends on child-branch auction parameters and how much REP/collateral migrated before auction finalization.

## M-01: Staged Liquidation Can Be Invalidated And Consumed

### Evidence

| Claim | Evidence |
| --- | --- |
| Liquidations snapshot target state at queue time. | Snapshot fields are captured in `requestPriceIfNeededAndStageOperation()` at `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:211-235`. |
| The code comment explicitly intends to prevent target escape by state mutation. | The comment at `SecurityPoolOracleCoordinator.sol:211-215` states the target cannot escape by depositing REP or reducing allowance after staging. |
| Non-pending operations are recorded for later manual execution. | The non-pending branch records the operation but does not execute it at `SecurityPoolOracleCoordinator.sol:251-256`. |
| Execution consumes the staged operation before the pool call. | `_consumeActiveStagedOperation(operationId)` and `stagedOperations[operationId].initiatorVault = address(0)` run before the external call at `SecurityPoolOracleCoordinator.sol:267-276`. |
| Execution catches failed liquidation calls instead of reverting consumption. | The liquidation `try/catch` emits failure and does not restore operation state at `SecurityPoolOracleCoordinator.sol:277-296`. |
| `performLiquidation()` uses snapshot values for liquidatability but mutates live vault fields. | Snapshot-derived `vaultsRepDeposit`, `snapshotTargetAllowance`, and `debtToMove` are used at `SecurityPool.sol:382-399`; live target/caller fields are overwritten or incremented at `SecurityPool.sol:407-411`. |
| Target can reduce allowance with a valid price. | `performSetSecurityBondsAllowance()` subtracts old allowance from `totalSecurityBondAllowance` and sets the new amount at `SecurityPool.sol:442-471`. |
| Target can withdraw REP after reducing allowance. | `performWithdrawRep()` uses live `securityBondAllowance` and global checks at `SecurityPool.sol:276-308`. |

### Broken Invariant

A queued liquidation that intentionally snapshots target state should satisfy one of these:

```text
target cannot mutate snapshotted debt/collateral before liquidation execution
```

or:

```text
if target state mutation makes the snapshot stale, the liquidation is not consumed as a terminal failed execution
```

The reviewed implementation satisfies neither for manually executed staged liquidations.

### Executable PoC

`solidity/ts/tests/auditFindings.test.ts`, test `M-01 PoC: target-controlled stale liquidation failure is consumed`.

Validation command: `bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000`

Result on latest `origin/main`: M-01 PoC passes and confirms the issue remains open.

### Confidence

Medium-high. The consumed-on-failure path is direct. The practical exploit depends on operation ordering and enough pool-wide allowance/collateral capacity for the target to mutate state before manual liquidation execution.

### Limits

The issue is narrower than a universal liquidation bypass because the pending auto-execute slot may execute first, and allowance reduction can be blocked when the pool has no surplus over `completeSetCollateralAmount`.

## Cross-Finding Invariant Set

These invariants should be added to CI to prevent regressions:

- `address(securityPoolForker).balance == 0` after truth-auction finalization, unless a future design explicitly tracks forker-held funds.
- Child pool `completeSetCollateralAmount + totalFeesOwedToVaults <= address(childPool).balance` after every fork migration and auction settlement step.
- Sum of all active vault `securityBondAllowance` values equals `SecurityPool.totalSecurityBondAllowance()`.
- A staged operation can only be consumed after successful execution, explicit user cancellation, expiry handling, or a failure reason that cannot be created by the target mutating state.
- Parent and child REP migration buckets reconcile to the migration proxy's Zoltar migration balance plus child REP swept into pools/escalation games.
