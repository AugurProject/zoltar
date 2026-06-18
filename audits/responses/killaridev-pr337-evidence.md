# Response To KillariDev Audit Evidence PR #337

Auditor: KillariDev

## Summary

Accepted. The fixed H-01 status is confirmed, and the open M-01 liquidation issue is fixed in this pass.

## Finding Responses

| ID | Response |
| --- | --- |
| H-01 | Confirmed already fixed before this pass. The truth-auction ETH forwarding behavior remains covered by existing fork/auction tests and the audit response notes. |
| M-01 | Fixed. Target ownership decreases or allowance changes after staging are rejected before liquidation execution, then consumed with a failure event so the operation cannot linger. Extra target REP deposits still do not block liquidation. Failed and expired staged executions are also consumed terminally; liquidators must restage if current state still supports liquidation. |

## Regression Coverage

- `auditRemediations.test.ts`: `stale liquidation is consumed without executing after target state changes`

## Residual Notes

The recommendation to add broader operation-queue invariants is accepted as future hardening beyond this focused remediation.
