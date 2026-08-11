# Conditional pricing

The constant-product marginal relationship prices one outcome using the opposite reserve:

```text
Conditional YES = NO reserve / (YES reserve + NO reserve)
Conditional NO  = YES reserve / (YES reserve + NO reserve)
```

The two values sum to 100% because they partition valid outcomes only. This does **not** imply INVALID has zero probability. There is no unconditional YES or NO probability in this AMM.

At 428.571 YES and 1,000 NO, Conditional YES is about 70% and Conditional NO about 30%. The larger NO reserve makes YES more expensive, explaining the apparent reversal in a 70% initialization.

The displayed before/after price is a trade-impact aid, not a manipulation-resistant oracle. Reserve spot values can be moved within a block, donated to, sandwiched, or become stale before inclusion. Protocol logic must never consume this price as an oracle; this project includes no TWAP.
