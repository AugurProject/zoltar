# Security policy

This project has not been audited. Tests and internal reviews are not substitutes for an independent security assessment.

Report a suspected vulnerability through [GitHub private vulnerability reporting](https://github.com/AugurProject/zoltar/security/advisories/new). Include the affected commit, contracts and functions, prerequisites, a minimal reproduction, expected impact, and whether funds or deployment keys may be at immediate risk. If private reporting is unavailable, open a public issue asking maintainers to establish a private channel, but do not include vulnerability details. Do not exploit a live deployment or publish details before maintainers have had a reasonable opportunity to respond.

## Assumptions

- The configured Zoltar `SecurityPoolFactory`, pool, `ShareToken`, forker, question data, and universe state are canonical and behave as implemented in the matching local core release.
- Users set realistic slippage and deadlines and obtain a fresh simulation in the current block immediately before submission.
- Wallets and RPC endpoints accurately report account, chain, balances, approvals, and receipts.
- ERC-1155 recipients can execute arbitrary code. Pair and router accounting therefore uses reentrancy guards and updates from authoritative balances after callbacks.
- Direct valid YES/NO donations accrue to current LPs. Direct INVALID and foreign token IDs are rejected.
- Forced ETH can remain in the router; an exit forwards only its measured operation delta.

## Known risks

Constant-product spot prices are manipulable and expose users to front-running and sandwiches. There is no TWAP or manipulation-resistant oracle. A lifecycle transition, fork, resolution, reserve donation, retention update, or intervening trade can invalidate a quote; contract guards and slippage bounds make the transaction revert rather than promise execution. Initial liquidity determines the starting conditional price and should be initialized atomically. LP tokens cover only YES/NO reserves; separately held INVALID can be lost, transferred, or insufficient. A valid-resolution LP can suffer directional loss, and YES/NO reserves may have no redemption value after an INVALID result.

The immutable factory fee is a deployment choice, not a claim of economic optimality.
