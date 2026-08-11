# Trading documentation

## Mental model

A Zoltar `SecurityPool` holds ETH collateral for one question in one universe branch. Its canonical `ShareToken` is ERC-1155: creating one complete set mints equal INVALID, YES, and NO shares for that pool’s universe-specific token IDs; redeeming a complete set burns those three shares and returns collateral at the pool’s current dynamic rate.

The trading factory maps the exact SecurityPool address to one immutable-fee pair. The pair is both the YES/NO constant-product reserve and the transferable LP token; it never accepts INVALID. The stateless router coordinates complete-set creation or redemption, pair swaps, and bounded asset delivery. Users and liquidity providers retain INVALID separately in their wallets.

Trading and added liquidity are open only while the question has not ended, the pool is operational, its universe has not forked, no continuation is pending, and no outcome is final. Raw LP removal remains available after closure. Parent and child SecurityPools are distinct markets and therefore use distinct pairs.

This documentation follows four reading modes:

- **Tutorials:** [local development](tutorials/local-development.md), [first market](tutorials/first-market.md), and [first trade](tutorials/first-trade.md).
- **How-to:** [deployment](how-to/deploy.md), [UI configuration](how-to/configure-ui.md), [alternative initial odds](how-to/seed-alternative-odds.md), [exiting](how-to/exit-a-position.md), [liquidity removal](how-to/remove-liquidity.md), [resolution](how-to/handle-resolution.md), and [forks](how-to/handle-a-fork.md).
- **Reference:** [contracts](reference/contracts.md), [router](reference/router.md), [events](reference/events.md), [SDK](reference/sdk.md), [configuration](reference/configuration.md), [deployment manifests](reference/deployment-manifests.md), and [units and rounding](reference/units-and-rounding.md).
- **Explanation:** [two-way markets](explanation/two-way-market.md), [INVALID insurance](explanation/invalid-insurance.md), [pricing](explanation/pricing.md), [LP positions](explanation/liquidity-provider-position.md), [early-exit bounds](explanation/early-exit-limit.md), [security](explanation/security-model.md), [forks and resolution](explanation/forks-and-resolution.md), [architecture decisions](explanation/architecture-decisions.md), and [limitations](explanation/limitations.md).

The invariant to remember is:

```text
shareToken.balanceOf(pair, invalidTokenId) == 0
```

“Conditional YES price” always means the YES share among valid outcomes. It is not an unconditional probability and says nothing about the chance of INVALID.
