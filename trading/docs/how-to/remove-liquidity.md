# Remove liquidity

Approve the router to spend the exact LP amount, preview the proportional YES/NO outputs, set `minYesOut` and `minNoOut`, and call `removeLiquidity`.

Removal remains available after end, resolution, fork, migration, and truth-auction phases. It returns raw YES and NO. It does not inspect or consume wallet INVALID, redeem complete sets, settle winning shares, select a child branch, or migrate liquidity.
