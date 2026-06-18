# Response To KillariDev Test-Suite Audit PR #334

Auditor: KillariDev

## Summary

Accepted. The audit correctly identified weaknesses in the default test gate and several misleading tests.

## Finding Responses

| ID | Response |
| --- | --- |
| TST-001 | Accepted follow-up. The auction fuzz harness remains available through `test:auction-fuzz`, but it is intentionally not included in the default local `test` command because fuzz/property checks should have a dedicated CI or focused-test gate. |
| TST-002 | Fixed for the reported cases. Broad `assert.rejects(..., 'message')` usage in the cited auction and REP redemption tests now uses regex matchers for the intended revert messages. |
| TST-003 | Fixed. The live mainnet Uniswap integration suite now requires `RUN_MAINNET_INTEGRATION_TESTS=1`, and a `test:integration:mainnet` script was added for opt-in execution. |
| TST-004 | Accepted follow-up. Focused regression tests were added for the exploitable accounting findings, but a full stateful invariant harness remains future work. |
| TST-005 | Fixed. The seeded security-pool simulation invariant test is no longer skipped. |
| TST-006 | Accepted follow-up. A direct regression now covers the child truth-auction deterministic deployment squatting case, but broader factory wiring coverage remains future work. |
| TST-007 | Accepted follow-up. The cited misleading revert-message tests were tightened, but broader state-invariant hardening remains future work. |
| TST-008 | Accepted follow-up. The documented post-fork exit-path TODO remains and should be closed in a dedicated test-coverage PR. |
| TST-009 | Accepted follow-up. Additional direct tests for utility and wrapper modules remain future coverage work. |

## Validation Added

- `solidity/ts/tests/auditRemediations.test.ts`
- The auction tick-math fuzz file remains available through `bun run test:auction-fuzz`.
- Mainnet Uniswap integration tests are opt-in.
