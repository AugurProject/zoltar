# Zoltar Solidity Security Audit Report

Date: 2026-06-18

Auditor: Codex, Solidity security review

## Target

- Repository path: `/workspace/.t3/worktrees/zoltar/t3code-f14dcf65`
- Branch: `t3code/f14dcf65`
- Commit after merging latest `origin/main`: `c420a3ac83851dfdf873acc40ddb00fefca0e905`
- Intended network: Ethereum mainnet was inferred from `solidity/default-config.json`, `Constants.GENESIS_REPUTATION_TOKEN`, WETH wiring in deployment helpers, and the mainnet deployment scripts.
- Protocol compiler: Solidity `0.8.35` for in-scope protocol contracts.
- OpenOracle compiler pass: Solidity `0.8.28`, EVM `cancun`.
- Optimizer: viaIR enabled, 200 runs for protocol contracts; viaIR enabled, 50000 runs for OpenOracle.
- Production constants observed:
  - `GENESIS_REPUTATION_TOKEN = 0x221657776846890989a759BA2973e427DfF5C9bB`
  - `BURN_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF`
  - `NUM_OUTCOMES = 3`
  - `forkThresholdDivisor = 20`, `forkBurnDivisor = 5` in shared mainnet config
  - `initialEscalationGameDeposit = 1e18`
  - `MIGRATION_TIME = 8 weeks`, `AUCTION_TIME = 1 weeks`
  - Oracle helper constants include mainnet WETH `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2`, report gas `100000`, settlement gas `1000000`, exact REP report `26392439800`, settlement time `180`, dispute delay `0`, fee percentage `10000`, multiplier `140`, time type `true`, track disputes `false`.

## Summary

Two issues were identified in the original review. After updating to latest `origin/main`, H-01 is fixed by commit `8d2a2aa0103138bd706e2664af6dfb90c9e73e4b`; M-01 remains open and still reproduces.

Additional artifacts:

- `audits/findings-2026-06-18.json`: machine-readable findings list.
- `solidity/ts/tests/auditFindings.test.ts`: executable regression coverage for fixed H-01 and executable PoC coverage for open M-01.
- `audits/reproduction-harnesses-2026-06-18.md`: PoC execution notes, fixed-behavior assertions, and invariant additions.
- `audits/traceability-matrix-2026-06-18.md`: exact claim-to-code evidence and invariant matrix.
- `audits/coverage-checklist-2026-06-18.md`: audit-brief workflow checklist, public-surface review notes, static-analysis attempts, and residual risk register.

| ID | Severity | Status | Title |
| --- | --- | --- | --- |
| H-01 | High | Fixed on latest `origin/main` | Truth-auction proceeds were paid to the forker and never credited to the child pool |
| M-01 | Medium | Open | Staged liquidation can be invalidated and consumed after target state changes |

## Methodology

The review followed the priority order in `audit_instructions.md` and focused on externally callable paths that move or strand ETH, REP, share claims, auction funds, or escalation-game deposits. The process was manual, with targeted call-graph searches and test-suite cross-checks:

- Enumerated public/external functions, privileged setters, delegatecalls, ETH sends, token transfers, and state-machine transitions.
- Traced value movement across Zoltar migration, security-pool vault accounting, fork migration, truth auctions, staged oracle operations, and escalation-game continuation paths.
- Compared implementation behavior against comments and tests where they stated intent, especially around snapshot liquidation, auction settlement, and fork liveness.
- Re-reviewed initial candidates and removed one weak finding instead of keeping a marginal issue.
- Converted the findings into executable Bun tests. After updating to latest `origin/main`, the H-01 test was updated to assert the fixed behavior, while the M-01 test still asserts the vulnerable behavior.
- Ran the repository's deterministic auction fuzz target, `bun run test:auction-fuzz`, successfully: 2 pass, 0 fail.

## Coverage Matrix

| Area | Coverage | Notes |
| --- | --- | --- |
| Zoltar REP burn, migration, child deployment | Manual review | No reportable issue retained. Migration split semantics intentionally duplicate burned migration balance into selected children. |
| SecurityPool vault, fee, REP, share accounting | Manual review | Finding M-01 retained for staged liquidation state drift. |
| SecurityPoolForker and migration proxy | Manual review and retest | H-01 is fixed on latest `origin/main`; finalized truth-auction ETH is forwarded to the child pool before collateral capture. |
| EscalationGame local and forked deposits | Partial manual review | Main claim/export paths reviewed; MMR/nullifier proof algebra was not exhaustively proven. |
| UniformPriceDualCapBatchAuction | Manual review plus deterministic fuzz target | Standalone auction refund/fill paths reviewed; integration issue retained in H-01. `test:auction-fuzz` covered 2,000 deterministic tick cases plus out-of-domain rejection. |
| Oracle coordinator and staged operations | Manual review | Snapshot/consumption behavior reviewed; M-01 retained. |
| ERC20/ERC1155/WETH transfer boundaries | Manual review | No reportable issue retained. Reentrancy appears constrained by state updates before external sends in reviewed paths, but no formal reentrancy harness was run. |
| Factories and deterministic deployment | Manual review | One initial retention-rate candidate was discarded after re-review. |
| Gas bounds and pagination | Partial manual review | Large-list gas risks remain residual; no concrete required-flow permanent DoS was proven. |

## Findings

Current open finding count on `c420a3ac83851dfdf873acc40ddb00fefca0e905`: one Medium.

### H-01: Truth-auction proceeds are paid to the forker and never credited to the child pool

Severity: High

Status on latest `origin/main`: Fixed. Commit `8d2a2aa0103138bd706e2664af6dfb90c9e73e4b` forwards ETH received during truth-auction finalization from `SecurityPoolForker` to the child `SecurityPool` and adds regression assertions in `solidity/ts/tests/peripherals.test.ts`.

Severity rationale: this affects a required fork-exit path and can permanently strand ETH paid by auction bidders while finalizing the child pool with missing collateral. The issue does not require privileged access once the protocol reaches the auction state.

Impacted contracts and functions:

- `UniformPriceDualCapBatchAuction.finalize`
- `SecurityPoolForker._consumeTruthAuctionRep`
- `SecurityPoolForker._captureUnclaimedCollateralForAuction`
- `SecurityPoolForker.receive`

#### Description

Original issue: child security pools rely on the truth auction to raise ETH collateral for the child branch after a fork. However, `UniformPriceDualCapBatchAuction.finalize()` sends filled ETH to `owner`, and child truth auctions are owned by `SecurityPoolForker`.

```solidity
(bool sent, ) = payable(owner).call{ value: ethToSend }('');
```

On the vulnerable commit, `SecurityPoolForker._consumeTruthAuctionRep()` called `data.truthAuction.finalize()` and recorded `repPurchased`, but it did not forward the ETH just received by the forker into the child `SecurityPool`.

Immediately after that, `_captureUnclaimedCollateralForAuction()` derives the child pool collateral from `address(securityPool).balance`, not from the ETH held by the forker:

```solidity
uint256 balance = address(securityPool).balance;
uint256 feesOwed = securityPool.totalFeesOwedToVaults();
uint256 collateralAmount = balance >= feesOwed ? balance - feesOwed : 0;
securityPool.setPoolFinancials(collateralAmount, parentTotalSecurityBondAllowance);
```

The latest `origin/main` implementation now measures `address(this).balance` before and after `data.truthAuction.finalize()` and forwards any ETH received to `address(securityPool)` before `_captureUnclaimedCollateralForAuction()` computes child collateral.

#### Preconditions and attacker capabilities

- A parent security pool has forked.
- At least one child pool reaches `ForkTruthAuction`.
- The child branch is not fully funded through migrated REP/collateral, so a truth auction starts and receives winning bids.
- Anyone can later call `finalizeTruthAuction()` after the auction duration.

No privileged access is required.

#### Exploit or failure scenario

1. A parent security pool forks and a child pool is deployed.
2. Not enough parent REP migrates into the child branch, so `SecurityPoolForker.startTruthAuction(child)` starts the child truth auction.
3. Bidders submit ETH bids.
4. After one week, anyone calls `SecurityPoolForker.finalizeTruthAuction(child)`.
5. `_consumeTruthAuctionRep()` calls `truthAuction.finalize()`.
6. The auction sends filled ETH to `SecurityPoolForker`, because the forker is the auction owner.
7. `_captureUnclaimedCollateralForAuction()` computes child collateral from the child pool's ETH balance. The ETH that just arrived at the forker is excluded.
8. The child pool becomes `Operational` with understated or zero `completeSetCollateralAmount`.
9. Winning share holders redeem against missing collateral, while auction ETH is permanently stuck in the forker.

#### Impact

On the original vulnerable commit, winning bidders' ETH could be permanently stranded in `SecurityPoolForker`, and child pools could finalize without the collateral the auction was supposed to raise. This created insolvency and redemption failure for the fork branch. Latest `origin/main` fixes this by forwarding finalized auction ETH to the child pool.

#### Remediation status

Implemented on latest `origin/main`.

Patch summary:

- `SecurityPoolForker._consumeTruthAuctionRep()` records the forker ETH balance before finalization.
- After `truthAuction.finalize()`, it computes `ethReceived`.
- If `ethReceived > 0`, it sends that ETH to the child pool and requires success.
- Regression tests assert the child pool receives auction ETH, collateral accounting includes it, and the forker does not retain it.

Residual note: the fix uses a raw ETH call to the child pool. The child pool `receive()` authorizes the forker, so this is consistent with the existing trust boundary.

#### Proof of concept

Executable regression test: `solidity/ts/tests/auditFindings.test.ts`, test `H-01 regression: finalized truth-auction ETH is forwarded to the child pool`.

Validation command:

```bash
bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000
```

Result on latest `origin/main`: pass, confirming the fixed behavior. The test:

1. Create a parent pool and complete sets.
2. Fork and deploy a child pool with insufficient migrated REP.
3. Start a truth auction and submit a bid that fills non-zero ETH.
4. Advance past `AUCTION_TIME`.
5. Call `finalizeTruthAuction(child)`.
6. Observe:
   - `address(securityPoolForker).balance` does not increase by `truthAuction.ethRaised()`;
   - `address(child).balance` increases by that amount;
   - `child.completeSetCollateralAmount()` includes the auction proceeds.

Primary code references:

- `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol:125-150`
- `solidity/contracts/peripherals/SecurityPoolForker.sol:480-506`
- `solidity/contracts/peripherals/SecurityPoolForker.sol:717-719`

### M-01: Staged liquidation can be invalidated and consumed after target state changes

Severity: Medium

Severity rationale: this is a realistic liveness and accounting issue for a specific staged-operation ordering, but it requires the liquidation not to be auto-executed first and requires enough surplus capacity for the target to reduce allowance before execution.

Impacted contracts and functions:

- `SecurityPoolOracleCoordinator.requestPriceIfNeededAndStageOperation`
- `SecurityPoolOracleCoordinator.executeStagedOperation`
- `SecurityPool.performLiquidation`
- `SecurityPool.performSetSecurityBondsAllowance`
- `SecurityPool.performWithdrawRep`

#### Description

Liquidations are queued through `SecurityPoolOracleCoordinator` using a snapshot of the target vault's ownership, allowance, pool REP balance, and ownership denominator:

```solidity
stagedOperations[operationId] = StagedOperation({
    operation: operation,
    initiatorVault: msg.sender,
    targetVault: targetVault,
    amount: amount,
    queuedAt: block.timestamp,
    validForSeconds: validForSeconds,
    snapshotTargetOwnership: snapshotTargetOwnership,
    snapshotTargetAllowance: snapshotTargetAllowance,
    snapshotTotalRep: snapshotTotalRep,
    snapshotDenominator: snapshotDenominator
});
```

The coordinator comments state that liquidation intentionally uses this snapshot so the target cannot escape by changing allowance or REP after the request is staged. However, `performLiquidation()` still mutates the target's live `poolOwnership` and `securityBondAllowance` without validating that the live values still match the snapshot and without adjusting `totalSecurityBondAllowance` for any intervening allowance changes:

```solidity
securityVaults[targetVaultAddress].securityBondAllowance = snapshotTargetAllowance - debtToMove;
securityVaults[targetVaultAddress].poolOwnership -= ownershipToMove;
securityVaults[callerVault].securityBondAllowance += debtToMove;
securityVaults[callerVault].poolOwnership += ownershipToMove;
```

`executeStagedOperation()` consumes the staged operation before calling the pool and catches any revert:

```solidity
_consumeActiveStagedOperation(operationId);
stagedOperations[operationId].initiatorVault = address(0);
try securityPool.performLiquidation(...) { ... } catch ...
```

Therefore, if the target changes live state before a non-auto-executed liquidation is executed, the liquidation can fail once and be permanently consumed. If the target reduces allowance before execution but still has enough live ownership to avoid underflow, the function can also move allowance to the caller without increasing `totalSecurityBondAllowance`, because the earlier allowance reduction already reduced the total. The sum of vault allowances can then exceed `totalSecurityBondAllowance`, weakening global bond checks and fee-retention calculations that rely on the aggregate.

#### Preconditions and attacker capabilities

- A target vault is liquidatable at the oracle price used for the staged liquidation snapshot.
- The liquidation is not the pending auto-executed operation, or the target can otherwise act before the liquidation is manually executed while the oracle price remains valid.
- There is enough pool-wide surplus allowance that the target can reduce its own allowance without violating `totalSecurityBondAllowance >= completeSetCollateralAmount`.

No privileged access is required.

#### Exploit or failure scenario

1. A target vault is undercollateralized at the current or next oracle price.
2. A liquidator stages a liquidation, capturing the target's current `poolOwnership` and `securityBondAllowance`.
3. The liquidation does not occupy the single pending auto-execute slot, for example because another operation already occupies it.
4. Once a fresh price is valid, the target stages or executes `SetSecurityBondsAllowance` to reduce its allowance, and then stages or executes `WithdrawRep` to withdraw now-unencumbered REP.
5. A later call to `executeStagedOperation(liquidationId)` calls `performLiquidation()` with the old snapshot.
6. If the live ownership is now lower than `ownershipToMove`, `performLiquidation()` reverts from underflow; the coordinator catches the revert and the liquidation is permanently consumed.
7. If live ownership is still sufficient but live allowance changed, the liquidation can complete while leaving `totalSecurityBondAllowance` inconsistent with the sum of vault allowances.

This contradicts the snapshot design intent and gives target vaults a practical ordering-based liquidation escape route.

#### Impact

Affected liquidations can be permanently skipped after one failed execution attempt. In the successful-but-stale case, aggregate allowance accounting can become inconsistent, which affects global solvency checks, retention-rate calculations, and complete-set capacity. The issue is narrow because it depends on operation ordering and enough surplus pool allowance for the target to reduce its own allowance.

#### Recommended remediation

Make queued liquidations bind the target's state or make stale executions fail without consuming the operation. Options include:

- Require the target's live `poolOwnership` and `securityBondAllowance` to equal the snapshot at liquidation execution, and leave the staged operation active if they do not.
- Alternatively, reserve the snapshotted allowance/ownership when the liquidation is queued so the target cannot withdraw or reduce it before execution.
- If stale snapshots are allowed, update `totalSecurityBondAllowance` by the live deltas actually applied, not by an assumed target-to-caller transfer from the snapshot.
- Do not consume a staged liquidation before a successful execution unless failure is known to be terminal and not caused by target-controlled state changes.

Tests should include a liquidation queued behind another pending operation, target allowance reduction and REP withdrawal while the price is valid, then an attempted execution of the original liquidation.

#### Proof of concept

Executable PoC: `solidity/ts/tests/auditFindings.test.ts`, test `M-01 PoC: target-controlled stale liquidation failure is consumed`.

Validation command:

```bash
bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000
```

Result on latest `origin/main`: pass, confirming the vulnerable behavior still exists. The test:

1. Give the target vault REP and a high allowance.
2. Give another vault enough allowance so the pool remains above `completeSetCollateralAmount` after the target reduces its allowance.
3. Queue any operation as the pending oracle slot.
4. Queue a liquidation against the target; it is recorded as an active staged operation but is not the pending auto-execute slot.
5. Settle a fresh oracle price that makes the target liquidatable.
6. Have the target execute `SetSecurityBondsAllowance(target, 0)` and then `WithdrawRep(target, targetRep)`.
7. Execute the original liquidation. It fails and is consumed, or completes with stale allowance data and leaves `totalSecurityBondAllowance` lower than the sum of live vault allowances.

Primary code references:

- `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:211-235`
- `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:267-318`
- `solidity/contracts/peripherals/SecurityPool.sol:368-435`
- `solidity/contracts/peripherals/SecurityPool.sol:442-471`
- `solidity/contracts/peripherals/SecurityPool.sol:276-308`

## Files Reviewed

- `audit_instructions.md`
- `solidity/default-config.json`
- `solidity/ts/compile.ts`
- `shared/ts/protocolConfig.ts`
- `solidity/contracts/Constants.sol`
- `solidity/contracts/Zoltar.sol`
- `solidity/contracts/ZoltarQuestionData.sol`
- `solidity/contracts/ReputationToken.sol`
- `solidity/contracts/ERC20.sol`
- `solidity/contracts/SafeERC20Ops.sol`
- `solidity/contracts/ScalarOutcomes.sol`
- `solidity/contracts/DeploymentStatusOracle.sol`
- `solidity/contracts/peripherals/SecurityPool.sol`
- `solidity/contracts/peripherals/SecurityPoolForker.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerStorage.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerTypes.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol`
- `solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol`
- `solidity/contracts/peripherals/EscalationGame.sol`
- `solidity/contracts/peripherals/EscalationGameForker.sol`
- `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol`
- `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol`
- `solidity/contracts/peripherals/SecurityPoolUtils.sol`
- `solidity/contracts/peripherals/MerkleMountainRange.sol`
- `solidity/contracts/peripherals/tokens/ShareToken.sol`
- `solidity/contracts/peripherals/tokens/ERC1155.sol`
- `solidity/contracts/peripherals/tokens/TokenId.sol`
- `solidity/contracts/peripherals/factories/SecurityPoolFactory.sol`
- `solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol`
- `solidity/contracts/peripherals/factories/ShareTokenFactory.sol`
- `solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol`
- `solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol`
- `solidity/contracts/peripherals/factories/EscalationGameFactory.sol`
- `solidity/contracts/peripherals/interfaces/ISecurityPool.sol`
- `solidity/contracts/peripherals/interfaces/IUniformPriceDualCapBatchAuction.sol`
- `solidity/ts/testsuite/simulator/utils/contracts/deployPeripherals.ts`
- `solidity/ts/testsuite/simulator/utils/contracts/auction.ts`
- `solidity/ts/tests/auction.test.ts`
- `solidity/ts/tests/peripherals.test.ts`
- `solidity/ts/tests/priceOracleSecurity.test.ts`
- `solidity/ts/fuzz/auctionTickMath.fuzz.ts`
- `audits/reproduction-harnesses-2026-06-18.md`
- `audits/traceability-matrix-2026-06-18.md`
- `audits/coverage-checklist-2026-06-18.md`

## Discarded Candidates and Non-Findings

These items were explicitly considered and not reported as findings:

- Origin-pool retention-rate capture: `deployOriginSecurityPool()` accepts `currentRetentionRate`, but origin pools start with zero collateral and zero allowance. The first successful non-zero allowance update calls `updateRetentionRate()`, which recalculates the value from live collateral and allowance before open interest fees accrue. This does not support the high-impact exploit originally drafted.
- Zoltar child universe ID truncation: child IDs use `uint248(keccak256(...))`. A collision would be catastrophic but is not realistically exploitable under the reviewed threat model.
- Genesis REP burn address: the implementation intentionally transfers genesis REP to a burn address because REPv2 cannot be burned by Zoltar. This is a deployment/trust assumption rather than an implementation bug at this commit.
- ShareToken migration duplication: share migration intentionally burns parent outcome tokens and mints equivalent tokens in selected child universes, mirroring fork semantics.
- Auction standalone ETH refund reentrancy: auction bid state is marked claimed and accounting is updated before ETH refunds in reviewed refund/withdraw paths. No reentrancy issue was retained.
- OpenOracle callback spoofing: `openOracleCallback()` checks both `msg.sender == openOracle` and `reportId == pendingReportId`; no direct spoof path was found.

## Suggested Regression Tests

Detailed harness sketches are also included in `audits/reproduction-harnesses-2026-06-18.md`. Exact evidence mapping is included in `audits/traceability-matrix-2026-06-18.md`.

### H-01 test sketch

Add a fork integration test that starts a truth auction, submits a filling bid, finalizes the child auction, and asserts that auction-raised ETH is credited to the child pool:

```ts
const forkerBalanceBefore = await getETHBalance(client, securityPoolForker)
const childBalanceBefore = await getETHBalance(client, childPool)

await finalizeTruthAuction(client, childPool)

const auctionRaised = await getEthRaised(client, truthAuction)
assert.equal(await getETHBalance(client, securityPoolForker), forkerBalanceBefore)
assert.equal(await getETHBalance(client, childPool), childBalanceBefore + auctionRaised)
assert.equal(await getCompleteSetCollateralAmount(client, childPool), expectedCollateralIncludingAuction)
```

This fixed-behavior test passes on latest `origin/main`.

### M-01 test sketch

Add an oracle-staging test where a liquidation is queued behind another pending operation, then the target changes live state before manual execution:

```ts
await requestPriceIfNeededAndStageOperation(otherVault, manager, OperationType.SetSecurityBondsAllowance, otherVault.address, otherAllowance)
await requestPriceIfNeededAndStageOperation(liquidator, manager, OperationType.Liquidation, target.address, targetAllowance)
await handleOracleReporting(client, mockWindow, manager, liquidationPrice)

await requestPriceIfNeededAndStageOperation(target, manager, OperationType.SetSecurityBondsAllowance, target.address, 0n)
await requestPriceIfNeededAndStageOperation(target, manager, OperationType.WithdrawRep, target.address, withdrawableRep)
await executeStagedOperation(client, manager, liquidationOperationId)

const operation = await getStagedOperation(client, manager, liquidationOperationId)
assert.notEqual(operation.initiatorVault, zeroAddress, 'stale target-controlled liquidation failure should not be consumed')
```

The exact assertion depends on the chosen fix. If stale target state should invalidate the liquidation, the operation should remain active or revert without consumption; if snapshot liquidation remains intended, target state-changing operations should be blocked or reserved until liquidation completes.

## Tools Used

- Manual review of Solidity state machines and value flows.
- `rg` for call graph and value-transfer search.
- `nl`, `sed`, and repository tests as specification references.
- Executable PoC tests in `solidity/ts/tests/auditFindings.test.ts`.
- Deterministic auction tick fuzzing through `bun run test:auction-fuzz`.
- Automated static analyzer attempt: `slither` was not installed and `python3 -m pip` is unavailable in this environment, so Slither was not run. No symbolic execution was run.

## Partial Review and Residual Risk

The review prioritized value-moving and liveness-critical paths requested in the audit brief: REP migration, security-pool accounting, forking, truth auctions, staged oracle operations, escalation-game migration, and token transfer boundaries.

The following areas remain only partially reviewed and should receive dedicated follow-up:

- Full invariant testing of REP reconciliation across repeated forks.
- Full invariant testing of ETH reconciliation across parent pools, child pools, auctions, and fees.
- Escalation-game MMR/nullifier proof edge cases under multi-fork continuation.
- Gas-bound analysis for large vault sets, large bid sets, and large carried-deposit proof histories.
- OpenOracle economic assumptions and dispute dynamics.

## Validation

Validation was run after updating the findings to latest `origin/main`:

- `bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000`: 2 pass, 0 fail. H-01 fixed-regression passes; M-01 vulnerable-behavior PoC still passes.
- `bun run test:auction-fuzz`: 2 pass, 0 fail.
- `bun run tsc`: pass.
- `bun run test`: 1315 pass, 1 skip, 0 fail across 144 files after updating to `c420a3ac83851dfdf873acc40ddb00fefca0e905`.
- `bun run format`: pass, no final changes.
- `bun run check`: pass.
- `bun run knip`: pass.

The root package metadata was updated to list the local `@zoltar/shared` dependency so `bun run knip` has zero unlisted-dependency warnings.
