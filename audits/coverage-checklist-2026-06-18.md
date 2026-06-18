# Audit Coverage Checklist

Date: 2026-06-18

Target commit after merging latest `origin/main`: `c420a3ac83851dfdf873acc40ddb00fefca0e905`

This checklist records the additional review pass used to raise confidence beyond the executable PoCs. It maps `audit_instructions.md` to concrete reviewed evidence and remaining bounded risks.

## Additional Commands

- `bun test solidity/ts/tests/auditFindings.test.ts --timeout 300000`: 2 pass, 0 fail. H-01 fixed-regression passes; M-01 vulnerable-behavior PoC still passes.
- `bun run test:auction-fuzz`: 2 pass, 0 fail.
- `bun run tsc`: pass.
- `bun run test`: 1315 pass, 1 skip, 0 fail.
- `bun run format`: pass.
- `bun run check`: pass.
- `bun run knip`: pass.
- `bun -e "JSON.parse(await Bun.file('audits/findings-2026-06-18.json').text())"`: pass.
- `git diff --check`: pass.

## Static Analysis Attempt

`slither` was not installed, and `python3 -m pip` is unavailable in this environment. Because the repo uses a custom Bun/solc compilation flow with generated artifacts, I did not introduce a separate package manager or global Python installation late in the audit. Instead, the additional pass used repository-native tests, deterministic fuzzing already wired on `main`, and manual call-surface review.

Foundry is installed, but the repository does not include a Foundry project configuration. The canonical compile/test path remains the Bun toolchain from `audit_instructions.md`.

## Public Surface Reviewed

High-risk externally callable surfaces were re-enumerated with `rg` and cross-checked against fixed/open findings and non-findings:

- `Zoltar`: `forkUniverse`, `deployChild`, `addRepToMigrationBalance`, `splitMigrationRep`.
- `SecurityPool`: vault deposit/withdrawal, allowance, liquidation, complete-set mint/redeem, share redemption, escalation deposits, fork-only setters and transfer functions, `receive`.
- `SecurityPoolForker`: fork initiation, migration proxy flow, vault migration, child universe/pool deployment, truth-auction start/finalize, own-escalation fork path, `receive`.
- `SecurityPoolOracleCoordinator`: price request, callback settlement, staged operation queueing, manual execution, active-operation paging.
- `EscalationGame`: start/resume, deposit settlement, local and inherited claim/export/sweep/drain paths.
- `UniformPriceDualCapBatchAuction`: start, bid, finalize, losing-bid refunds, post-finalization withdrawals, tick paging.

## Workflow Checklist

| Audit brief workflow | Evidence and result |
| --- | --- |
| Zoltar fork lifecycle | Reviewed fork threshold burn, migration balances, child deployment, and split migration semantics. No issue retained; child ID truncation and genesis burn assumptions are documented non-findings. |
| Vault lifecycle | Reviewed REP deposit, ownership mint/burn, allowance, fees, withdrawal, liquidation, and active-vault metadata. M-01 retained for staged liquidation drift. |
| Market lifecycle without fork | Reviewed question end, escalation resolution, share redemption, fee redemption, and REP redemption paths. No separate finding retained. |
| Oracle-staged operations | Reviewed authentic callback checks, pending slot behavior, active operation list, expiry, and failed-operation cleanup. M-01 retained. |
| Liquidation lifecycle | Reviewed snapshot capture, price validity, debt transfer, REP movement, and target mutation ordering. M-01 has executable PoC coverage. |
| Zoltar and security-pool fork lifecycle | Reviewed parent freeze, migration proxy, child deployment, unlocked REP migration, escalation continuation, truth-auction transition, and operational finalization. H-01 is fixed on latest `origin/main`; M-01 remains open. |
| Escalation lifecycle across forks | Reviewed local deposits, inherited carried deposits, escrow export, nullifier consumption, and residual sweep at a manual level. No finding retained; proof algebra remains residual risk. |
| Truth auction lifecycle | Reviewed bid insertion, clearing, refunds, finalization, withdrawals, and child-pool integration. H-01 regression passes on latest `origin/main`; tick math fuzz target passed. |
| Multi-fork scenarios | Reviewed existing recursive continuation tests and migration tests. No new finding retained; full repeated-fork invariant fuzzing remains residual risk. |

## Invariant Status

| Invariant class | Status |
| --- | --- |
| Auction tick math | Deterministic fuzz target passed for 2,000 ticks and out-of-domain rejection. |
| Auction ETH conservation | Standalone refund/fill paths covered by existing tests; latest `origin/main` forwards finalized truth-auction ETH to the child pool and H-01 regression passes. |
| Security-pool allowance aggregate | Existing tests cover normal paths; M-01 documents stale-operation drift risk. |
| Staged operation single execution | Existing tests cover single-use/expiry; M-01 documents target-controlled stale failure consumption. |
| REP migration reconciliation | Existing tests cover many migration paths; full repeated-fork invariant fuzzing not performed. |
| Escalation MMR/nullifier no-double-claim | Existing tests cover many proof paths; formal proof and broad invariant fuzzing not performed. |

## Residual Risk Register

The audit is high-confidence for the fixed/open findings and primary value-moving workflows. It is not a formal verification result. Remaining risks that justify a score below 100:

- No Slither/Mythril/Manticore/Halmos-style analyzer was run in this environment.
- No custom broad stateful invariant fuzzer was added for full REP/ETH reconciliation across arbitrary repeated forks.
- Escalation-game MMR/nullifier proof correctness was reviewed through code and tests, not mathematically proven.
- Gas-bound analysis remains qualitative for very large bid/vault/proof sets.
- OpenOracle economic/dispute assumptions were reviewed at integration boundaries, not modeled economically.

## Confidence Delta

The added executable PoCs, merged-branch full QA, deterministic auction fuzzing, and workflow coverage checklist raise confidence materially. On latest `origin/main`, H-01 is fixed and M-01 remains open. The remaining audit gap is formal/property breadth, not unresolved evidence for the current open finding.
