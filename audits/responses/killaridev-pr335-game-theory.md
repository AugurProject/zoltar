# Response To KillariDev Game-Theory Audit PR #335

Auditor: KillariDev

## Summary

Accepted. The two active findings were reproducible against the current branch and are fixed in this pass.

## Finding Responses

| ID | Response |
| --- | --- |
| R-01 | Confirmed already fixed before this pass. Truth-auction ETH is forwarded to the child pool before collateral accounting. |
| H-02 | Fixed. `UniformPriceDualCapBatchAuctionFactory` now domains CREATE2 salts by `msg.sender`, preventing an untrusted account from deploying at the exact future child-auction address reserved for `SecurityPoolFactory`. Address derivation helpers were updated accordingly. |
| H-03 | Fixed. The coordinator now rejects a liquidation if the target's live ownership decreased below the queued snapshot or if allowance changed after staging, consumes the stale operation with a failure event, and requires the liquidator to restage against current vault state. Extra target REP deposits still do not block the original snapshot. Expired and failed liquidation operations are also consumed so active-operation paging does not retain unexecutable entries. |

## Regression Coverage

- `auditRemediations.test.ts`: `child truth-auction address cannot be reserved by an untrusted caller`
- `auditRemediations.test.ts`: `stale liquidation is consumed without executing after target state changes`
