# Audit Issue List And Remediation Plan

Date: 2026-06-18

Sources reviewed:

- PR #334: test-suite audit by KillariDev.
- PR #335: game-theory audit by KillariDev.
- PR #336: June 18 Solidity audit bundle by KillariDev.
- PR #337: June 18 audit evidence and executable coverage by KillariDev.

## Issues Collected

| Source | ID | Severity | Issue | Status |
| --- | --- | --- | --- | --- |
| #334 | TST-001 | High | Default `bun run test` omitted the Solidity fuzz harness. | Accepted as CI/focused-check follow-up |
| #334 | TST-002 | Medium | Some `assert.rejects` calls used strings as if they matched revert reasons. | Fixed for reported cases |
| #334 | TST-003 | Medium | Default tests depended on live mainnet RPC and mutable Uniswap liquidity. | Fixed |
| #334 | TST-004 | Medium | No broad enforced protocol accounting invariant gate. | Accepted follow-up |
| #334 | TST-005 | Medium | Seeded security-pool simulation invariant test was skipped. | Fixed |
| #334 | TST-006 | Medium | Factory/deployment wiring had limited adversarial direct coverage. | Accepted follow-up; one squatting regression added |
| #334 | TST-007 | Low | Some rejection tests accepted any revert without protected-state checks. | Accepted follow-up; reported broad assertions tightened |
| #334 | TST-008 | Low | A documented post-fork exit-path TODO remains. | Accepted follow-up |
| #334 | TST-009 | Info | Several production modules have little direct coverage. | Accepted follow-up |
| #335 | H-02 | High | Public auction factory allowed child truth-auction address squatting. | Fixed |
| #335 | H-03 | High | Stale liquidation snapshots could desynchronize vault allowances from total allowance. | Fixed |
| #336 | C-01 | Critical | Truth-auction ETH could be stranded in `SecurityPoolForker`. | Already fixed before this pass |
| #336 | C-02 | Critical | Own-fork path stranded parent REP above the fork threshold in the migration proxy. | Fixed |
| #337 | H-01 | High | Truth-auction ETH forwarding regression coverage. | Already fixed before this pass |
| #337 | M-01 | Medium | Staged liquidation could be invalidated and consumed after target state changes. | Fixed |

## Fix Plan

1. Preserve deterministic deployment while preventing auction squatting by scoping the auction factory CREATE2 salt to `msg.sender`.
2. Preserve liquidation accounting by rejecting liquidations whose target ownership decreased below the queued snapshot or whose allowance changed after staging.
3. Consume stale, expired, and failed liquidation operations with an execution event so active-operation paging cannot accumulate unexecutable entries; liquidators must restage against current state.
4. Lock own-fork leftover parent REP from the migration proxy into Zoltar's migration balance before child allocation snapshots are computed.
5. Strengthen the test gate by making live mainnet integration tests opt-in, unskipping the seeded simulation invariant, and tightening reported revert assertions. The auction fuzz harness remains in the focused `test:auction-fuzz` script rather than the default local `test` command.
6. Add focused regression tests for auction-squatting, stale liquidation allowance accounting, and own-fork proxy REP conservation.
7. Record auditor responses in this directory and update them after implementation.

## PR Review Follow-Up Fixes

After reviewing this remediation PR, the following adjustments were made:

| Review concern | Resolution |
| --- | --- |
| Fuzz testing in default `bun run test` is too costly for the normal local/full suite. | Removed the fuzz harness from the default `test` script and kept it in `test:auction-fuzz` for focused or CI-specific execution. |
| Stale liquidation fix left unexecutable operations active. | Stale liquidations are now consumed with a `stale liquidation` event and must be restaged against current vault state; extra target REP deposits still do not block the original liquidation snapshot. |
| Expired staged operations could remain in active-operation paging. | `executeStagedOperation` now consumes expired operations and emits `staged operation expired` instead of reverting before cleanup. |
| Coordinator comments contradicted the stale-snapshot behavior. | Updated comments to state that liquidation still permits extra target REP deposits, while allowance changes or ownership decreases make the operation stale. |
| Response docs overstated broad coverage remediations. | Reclassified broad property/factory/module coverage recommendations as accepted follow-up work, with only the implemented targeted regressions marked as addressed. |
| Liquidation execution could be made more defensive. | Liquidation operations are now consumed before the external `performLiquidation` call, matching checks-effects-interactions and the other staged operation paths. |
| Staged-operation failure events were not pinned consistently. | Stale liquidation and expired staged-operation tests now assert the `ExecutedStagedOperation` failure event details. |
| Caller-scoped salt logic was duplicated in simulator helpers. | Exported `getCallerScopedSalt` from the shared address derivation helper and reused it in simulator auction address prediction. |

## Remaining Follow-Up

The broader property-test recommendations from TST-001, TST-004, TST-006, TST-007, TST-008, and TST-009 are not fully exhausted by this pass. The current changes add targeted regressions for the reported exploitable issues, but a future follow-up should add a CI-specific fuzz/property gate and a stateful REP/ETH conservation harness across recursive fork, auction, escalation, migration, and claim workflows.
