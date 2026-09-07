# Remove liquidity

Preview the proportional YES/NO outputs, set `minYesOut` and `minNoOut`, and call the pair's direct `removeLiquidity`. The first-party UI uses this path, so it does not request a router allowance. V2 pairs also bind an on-chain deadline.

Integrations that need router-based removal from a V2 pair can use `removeLiquidityWithPermit` with an exact-amount ERC-2612 signature. Ordinary exact allowances remain available for already submitted permits, Safes, legacy pairs, and clients without signature support. Do not grant a permanent or implicit infinite allowance.

Removal remains available after end, resolution, fork, migration, and truth-auction phases. It returns raw YES and NO. It does not inspect or consume wallet INVALID, redeem complete sets, settle winning shares, select a child branch, or migrate liquidity.
