# Zoltar Game-Theory Audit

## Target

- Repository: `/workspace/.t3/worktrees/zoltar/t3code-59758301`
- Branch: `t3code/59758301`
- Commit: `c420a3ac6481799f213d1d9ef4f873f7c189a58c`
- Intended deployment: mainnet-style configuration from `docs/mainnet-deployment-addresses.json`; `solidity/default-config.json` points to `https://ethereum.dark.florist`.
- Compiler: Solidity `0.8.35`.
- Main compiler settings: `viaIR: true`, optimizer enabled, `runs: 200`.
- OpenOracle compiler settings: `viaIR: true`, optimizer enabled, `runs: 50000`, `evmVersion: cancun`.
- Production constants reviewed: `GENESIS_REPUTATION_TOKEN = 0x221657776846890989a759BA2973e427DfF5C9bB`, `BURN_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF`, `NUM_OUTCOMES = 3`.
- Deployment config reviewed: `forkBurnDivisor = 5`, `forkThresholdDivisor = 20`, `initialEscalationGameDeposit = 1e18`.

## Scope

This review focused on game-theory and economic-safety paths in the Solidity protocol, especially truth auctions, fork migration, liquidation, fee accounting, and oracle-staged operations. Findings below are limited to issues with concrete exploitability or accounting impact.

## Executive Summary

After updating to latest `origin/main`, the previously reported truth-auction proceeds issue is fixed by commit `8d2a2aa0` and no longer appears as an active finding. The current audit contains two active High severity issues in mandatory fork and liquidation paths. Both active issues are independently reproducible with executable PoC tests in `solidity/ts/tests/auditFindings.test.ts`.

| ID | Severity | Area | Primary impact | PoC |
| --- | --- | --- | --- | --- |
| H-02 | High | Deterministic deployment | Any account can predeploy a future child truth-auction address and block child-pool creation. | `H-02 PoC: predeploying the deterministic child truth auction blocks child pool creation` |
| H-03 | High | Liquidation and fees | Stale liquidation snapshots can make vault-level allowances exceed `totalSecurityBondAllowance`. | `H-03 PoC: stale liquidation snapshot leaves local allowances above total allowance` |

The most important remaining remediation theme is conservation accounting and deterministic deployment rights. Live vault allowances and child-auction deployment rights should each have one authoritative owner and one invariant-enforced update path.

Recommended remediation order:

1. Fix H-02 first because it can permanently block the fork path before users can reach the settlement phase.
2. Fix H-03 before any fee-bearing deployment because it breaks the global allowance denominator used by fee distribution.

## Severity Model

Severity was assigned using the following criteria:

- **High:** A reachable bug in a value-moving or mandatory exit path that can strand funds, undercollateralize redemptions, permanently block fork/migration settlement, or break protocol-wide accounting invariants.
- **Medium:** A reachable bug with bounded value impact, recoverable liveness degradation, or meaningful but non-systemic accounting distortion.
- **Low:** A correctness, defensive-programming, or operational issue without a demonstrated direct economic path.

Only findings that met the High bar and were backed by executable PoCs are included as issues. Hypotheses that looked suspicious but did not meet that bar are listed under Reviewed Non-Findings.

## Methodology

The audit traced the following invariants across contracts:

- Auction proceeds, migrated collateral, and child-pool `completeSetCollateralAmount` should reconcile after fork truth-auction settlement.
- `totalSecurityBondAllowance` should equal the sum of live vault allowances after deposits, withdrawals, staged operations, liquidations, migrations, and auction claims.
- REP sold in auctions or migrated through Zoltar should have corresponding pool ownership or wallet ownership.
- Escalation deposits should not be withdrawable twice across local deposits, carried proofs, and forked escrow.
- Share-token fork migration should match the documented fork model rather than silently minting claims against unbacked child pools.
- Deterministic factory deployments should not be preemptable by untrusted callers when they gate fork exits.

The review combined manual call-graph tracing, invariant checks, test/spec comparison, targeted adversarial scenario analysis, and executable PoC tests. The PoCs are in `solidity/ts/tests/auditFindings.test.ts`.

## Coverage Checklist

The following protocol areas were reviewed for concrete economic and game-theory failures:

| Area | Coverage result |
| --- | --- |
| Parent and child `SecurityPool` accounting | Prior H-01 is fixed; active H-03 remains. |
| `SecurityPoolForker` vault/share migration and truth-auction finalization | Prior H-01 is fixed; active H-02 remains. |
| `UniformPriceDualCapBatchAuction` clearing and settlement | Prior H-01 is fixed; underfunded-threshold manipulation reviewed as non-finding. |
| Deterministic deployment factories | Found H-02. |
| Oracle-staged operations and liquidation interleavings | Found H-03. |
| Fee index accrual and redemption | H-03 impacts fee solvency; permissionless redemption reviewed as non-finding. |
| Share-token migration across forked universes | Reviewed as non-finding. |
| Escalation deposit carry/nullifier flow | Reviewed; no concrete issue identified. |

## Reproduction

Run all audit PoCs:

```bash
bun test solidity/ts/tests/auditFindings.test.ts
```

Expected result:

```text
3 pass
0 fail
```

The three tests now include two active issue PoCs plus one regression check confirming that the prior H-01 truth-auction proceeds issue is fixed on the current commit.

Run the full repository validation:

```bash
bun run tsc
bun run test
bun run format
bun run check
bun run knip
```

Full repository validation after updating to latest `origin/main` completed with `1316 pass`, `1 skip`, and `0 fail`.

## Resolved Prior Finding

### R-01: Truth-auction ETH is now forwarded to the child pool

**Prior severity:** High

**Status:** Fixed in current `origin/main`.

The earlier audit version reported that filled child truth-auction ETH was paid to `SecurityPoolForker` and then omitted from child-pool collateral. Latest `origin/main` includes commit `8d2a2aa0` (`Forward finalized truth-auction ETH to child security pool`), which fixes the issue in `SecurityPoolForker._consumeTruthAuctionRep()`.

Current code at `solidity/contracts/peripherals/SecurityPoolForker.sol:485` records the forker ETH balance before `data.truthAuction.finalize()`, computes `ethReceived` at `solidity/contracts/peripherals/SecurityPoolForker.sol:487`, forwards that ETH to the child `securityPool` at `solidity/contracts/peripherals/SecurityPoolForker.sol:489`, and only then captures child collateral from `address(securityPool).balance` at `solidity/contracts/peripherals/SecurityPoolForker.sol:502`.

The audit test `Resolved H-01 regression: funded truth auction proceeds are forwarded to the child pool` confirms:

- the forker balance does not retain the auction proceeds;
- the child pool balance increases by the filled ETH amount;
- `completeSetCollateralAmount()` includes the forwarded auction proceeds.

## Active Findings

### H-02: Public auction factory allows deterministic child-auction address squatting and blocks fork exits

**Severity:** High

**Impact:** Any account can predeploy the exact truth-auction contract that a future child pool will need. When the forker later tries to create that child pool, `deployChildSecurityPool()` attempts to deploy the same auction with the same CREATE2 salt and constructor argument, causing deployment to revert. Because child-pool deployment is required for vault migration, share migration, truth-auction processing, and final child exits, this is a permanent liveness failure for the affected fork outcome.

**Affected code:**

- `UniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction()` is permissionless and accepts arbitrary `owner` and `salt` at `solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol:6`.
- The legitimate child-pool deployment computes `securityPoolSalt = keccak256(abi.encode(parent, universeId, questionId, securityMultiplier))` and deploys the auction with `owner = address(securityPoolForker)` at `solidity/contracts/peripherals/factories/SecurityPoolFactory.sol:95`.
- `_getOrDeployChildPool()` calls `deployChildSecurityPool()` before it records `childrenByPoolAndOutcome`, so a revert blocks child creation and all downstream migration for that outcome at `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol:63`.

**Exploit narrative:**

1. A parent pool is expected to fork, or has already entered `PoolForked`.
2. The attacker computes the child `universeId` from `(parent.universeId(), outcomeIndex)` and the `securityPoolSalt` from `(parent, childUniverseId, parent.questionId(), parent.securityMultiplier())`.
3. Before any honest user creates that child pool, the attacker calls:

```text
UniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(
  address(securityPoolForker),
  securityPoolSalt
)
```

4. Later, the legitimate forker path calls `SecurityPoolFactory.deployChildSecurityPool()` with the same auction owner and salt.
5. The auction factory attempts to create the same contract address and reverts due to the CREATE2 collision.
6. The child pool is never deployed, so users cannot migrate vaults or settle that outcome's fork path through the intended child pool.

**Why this is high severity:**

The audit brief treats liveness failures in migration, redemption, auction settlement, and exit paths as fund-safety issues. This issue lets an untrusted party permanently block one or more fork outcome branches without owning REP, ETH collateral, or shares.

**Proof of concept:**

The executable PoC `H-02 PoC: predeploying the deterministic child truth auction blocks child pool creation` predeploys the child truth auction through the public factory with the legitimate `securityPoolForker` owner and salt, then asserts that `createChildUniverse()` reverts for that outcome.

**Recommendation:**

Restrict `UniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction()` to the trusted `SecurityPoolFactory` or derive the owner from `msg.sender` rather than accepting it as an arbitrary argument. A robust pattern is to make the factory deployment permissioned and include a domain separator that only the legitimate caller can supply, or to deploy auctions inside `SecurityPoolFactory` directly.

Fix validation should assert:

- An untrusted account cannot deploy an auction at the address reserved for a future child pool.
- Legitimate child-pool creation remains deterministic.
- Existing deployment address derivation helpers are updated if the domain separator or constructor arguments change.

### H-03: Stale liquidation snapshots can desynchronize vault allowances from total allowance and overpay fees

**Severity:** High

**Impact:** A staged liquidation can execute against a snapshot after the target vault has already changed its live security-bond allowance. `performLiquidation()` mutates the target and caller vaults from the snapshot values, but it never adjusts `totalSecurityBondAllowance`. If the target reduces allowance after the snapshot and before liquidation execution, the later liquidation can add the old allowance to the liquidator while the global denominator remains reduced. Fee accounting then distributes fees using `totalSecurityBondAllowance`, while vault claims use inflated per-vault `securityBondAllowance`, allowing overpayment and potential fee-pool insolvency or redemption reverts.

**Affected code:**

- `SecurityPoolOracleCoordinator.requestPriceIfNeededAndStageOperation()` snapshots `snapshotTargetAllowance` and related values at queue time at `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:218`.
- `SecurityPoolOracleCoordinator.executeStagedOperation()` later passes those stored values into liquidation at `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:279`.
- `SecurityPool.performLiquidation()` uses `snapshotTargetAllowance` for liquidatability and then sets/moves per-vault allowance at `solidity/contracts/peripherals/SecurityPool.sol:390` and `solidity/contracts/peripherals/SecurityPool.sol:407`.
- `SecurityPool.performSetSecurityBondsAllowance()` independently changes `totalSecurityBondAllowance` when a vault changes live allowance at `solidity/contracts/peripherals/SecurityPool.sol:449`.
- Fees are indexed by `totalSecurityBondAllowance`, but paid by each vault's local `securityBondAllowance`, at `solidity/contracts/peripherals/SecurityPool.sol:234` and `solidity/contracts/peripherals/SecurityPool.sol:254`.

**Exploit narrative:**

1. A liquidatable target vault has allowance `A` when a liquidation is staged. The coordinator stores `snapshotTargetAllowance = A`.
2. The liquidation can remain manually executable rather than auto-executed because the coordinator has a single pending slot. If another operation already occupies `pendingOperationSlotId`, additional operations are recorded as active operations without requesting their own price at `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol:243`.
3. After a fresh oracle report makes the price valid, the target executes `SetSecurityBondsAllowance(0)`. This reduces `totalSecurityBondAllowance` by `A`.
4. The old liquidation is executed while still within its validity window.
5. `performLiquidation()` sets the target allowance from the old snapshot and adds `debtToMove` to the caller vault, but does not increase `totalSecurityBondAllowance`.
6. The sum of vault-level allowances is now greater than `totalSecurityBondAllowance`.
7. Future fee accrual computes `feeIndex += delta / totalSecurityBondAllowance`, then the inflated liquidator vault claims `securityBondAllowance * feeIndex`. This can pay more than its conserved share and can make `totalFeesOwedToVaults -= fees` underflow for later redeemers.

This is economically exploitable by a colluding target/liquidator pair or by any workflow where a stale non-pending liquidation remains executable after the target changes live allowance. The coordinator explicitly supports multiple active staged operations, and only one operation auto-executes in the pending slot.

**Proof of concept outline:**

The executable PoC `H-03 PoC: stale liquidation snapshot leaves local allowances above total allowance` stages a liquidation, reduces the target's live allowance to zero, executes the stale liquidation, and asserts that the liquidator's vault-level allowance is restored while `totalSecurityBondAllowance` remains zero.

```text
Initial:
  honest total allowance = H
  target allowance = A
  totalSecurityBondAllowance = H + A

Queue liquidation against target:
  snapshotTargetAllowance = A

Target executes SetSecurityBondsAllowance(0):
  totalSecurityBondAllowance = H
  target allowance = 0

Execute old liquidation:
  caller allowance += A
  target allowance = 0
  totalSecurityBondAllowance remains H

Fee accrual:
  feeIndex increases by delta / H
  caller can claim A * delta / H extra fees despite A not being in the denominator.
```

**Recommendation:**

Preserve the invariant that `totalSecurityBondAllowance` equals the sum of live vault allowances across every liquidation path. Options:

- On liquidation execution, compute the delta between current vault allowances and post-liquidation allowances and update `totalSecurityBondAllowance` accordingly.
- Alternatively, reject liquidation if the target's current allowance is lower than the snapshot allowance, and require liquidators to restage against current state.
- Add an invariant test that random staged `SetSecurityBondsAllowance` and `Liquidation` operations cannot make `sum(vault.securityBondAllowance) != totalSecurityBondAllowance`.

Also consider separating anti-grief liquidation snapshots for REP backing from live allowance conservation: using stale values to decide whether a vault was liquidatable does not require stale values to overwrite global accounting.

Fix validation should assert:

- A liquidation staged before a target allowance reduction cannot reintroduce allowance without updating `totalSecurityBondAllowance`.
- Fee accrual and `redeemFees()` remain solvent after interleavings of liquidation, allowance reduction, and manual staged-operation execution.
- Existing anti-grief behavior still prevents a target from blocking a valid liquidation only by depositing REP or reducing allowance after staging.

## Reviewed Non-Findings

The following suspicious paths were reviewed but not reported because the behavior appears intentional or the exploit hypothesis did not hold:

- **Share-token migration duplicates balances across selected child universes.** `ShareToken.migrate()` burns the parent token and mints the same amount into every selected child universe at `solidity/contracts/peripherals/tokens/ShareToken.sol:155`. This initially looks like claim inflation, but fork tests explicitly migrate all three parent outcome shares to all three child universes before child redemptions, and child collateral is handled per child pool.
- **Underfunded auction threshold manipulation.** I tested whether a bidder could submit refundable low-price bids to raise the underfunded threshold while a small high-price bid receives all REP. The auction's clearing predicate makes that strategy self-defeating: if the low-price bid is below the implied average threshold, the auction would clear at or before that tick rather than enter the underfunded branch.
- **Permissionless fee redemption.** `redeemFees(address vault)` can be called by anyone, but proceeds are sent only to `vault`, so this is a liveness feature rather than value theft.
- **Escalation fork carry snapshots.** The forked-escrow and nullifier paths are complex, but the reviewed paths consume local deposits/proofs before transfer and gate forked inherited claims through consumed parent indexes. I did not identify a concrete double-withdrawal path in the time available.

## Remediation Verification Plan

After fixes are implemented, the following checks should be added or updated before considering the remaining active issues resolved:

| Finding | Required regression coverage |
| --- | --- |
| H-02 | An untrusted account cannot reserve or collide with a child truth-auction address needed by the forker; legitimate child creation remains deterministic and repeatable. |
| H-03 | Interleavings of staged liquidation, target allowance reduction, fee accrual, and fee redemption preserve `sum(vault.securityBondAllowance) == totalSecurityBondAllowance` and cannot overdraw `totalFeesOwedToVaults`. |

The existing active PoCs should be kept as negative tests during remediation and inverted into passing regression tests after each fix. The prior H-01 PoC has already been inverted into a passing regression test on the current commit.

## Residual Risk

This was a focused game-theory audit, not a complete line-by-line formal verification. The most residual risk remains in:

- MMR/nullifier proof correctness for deeply nested escalation continuations.
- Gas/liveness limits in large auctions and large escalation proof batches.
- Rounding dust across repeated own-fork unresolved escalation migrations.
- Oracle dispute economics and OpenOracle parameterization under mainnet gas volatility.

## Confidence Assessment

Confidence is high because each active reported issue satisfies all of the following:

- It affects a value-moving or mandatory exit path.
- It is reachable by untrusted users under the documented threat model.
- It has a concrete exploit or liveness narrative.
- It is backed by an executable PoC test.
- It survived revalidation after merging latest `origin/main`.

The audit is not rated as perfect because full assurance would require formal verification or exhaustive stateful fuzzing of escalation carry proofs and recursive fork continuations.

## Notes

No production contract code was changed as part of this audit. The only code artifact added is the audit PoC test file.

Validation completed:

- `bun test solidity/ts/tests/auditFindings.test.ts` (`3 pass`, `0 fail`)
- `bun run tsc`
- `bun run test` (`1316 pass`, `1 skip`, `0 fail`)
- `bun run format`
- `bun run check`
- `bun run knip`
