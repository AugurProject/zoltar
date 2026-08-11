# Router reference

`TwoWayConstantProductRouter(factory)` fixes the only eligible factory. All user mutations enforce a deadline and reentrancy guard. The router’s receiver callbacks accept only the active pool’s canonical share token and universe IDs. `receive()` accepts ETH only during redemption and only from the expected SecurityPool.

- `enterPosition(pair, longOutcome, minLongSharesOut, recipient, deadline)` is payable. It creates actual complete-set shares from `msg.value`, verifies equal INVALID/YES/NO deltas, swaps all opposite shares, and delivers long shares plus INVALID. It returns ETH spent, complete sets, swap amounts, fee, and before/after Conditional YES prices.
- `exitPosition(pair, longOutcome, completeSetSharesToRedeem, maxLongSharesIn, minEthOut, recipient, deadline)` pulls exactly `q` INVALID and `q + swapInput` long shares, buys exactly `q` opposite shares, and redeems `q`. It measures the operation's ETH balance delta, requires the delta to be positive and at least `minEthOut`, forwards exactly that delta to `recipient`, and returns it as `ethOut`.
- `redeemCompleteSet(pool, completeSetSharesToRedeem, minEthOut, recipient, deadline)` validates the exact canonical SecurityPool and pulls an explicit INVALID/YES/NO complete set from the caller. It measures the operation's ETH balance delta, requires the delta to be positive and at least `minEthOut`, forwards exactly that delta to `recipient`, and returns it as `ethOut`.
- `createPairAndInitializeWithEth(pool, conditionalYesBps, minLiquidity, recipient, deadline)` creates/reuses the deterministic pair and requires it to be uninitialized before atomically seeding it.
- `initializeWithEth(pair, conditionalYesBps, minLiquidity, recipient, deadline)` initializes an already created canonical pair.
- `addLiquidityWithEth(pair, minLiquidity, recipient, deadline)` creates complete sets, deposits the authoritative proportional maximum, and returns INVALID and unused shares.
- `removeLiquidity(pair, liquidity, minYesOut, minNoOut, recipient, deadline)` pulls LP and returns raw YES/NO directly to the recipient.
- `factory()` exposes the immutable factory.
- ERC-1155 callback methods and `supportsInterface` exist only for tightly scoped operations.

Successful share-custody operations assert that all three router balances equal their starting values, preserving pre-existing forced shares. Both insured exits and standalone complete-set redemptions calculate and forward only ETH received during that operation, so pre-existing forced ETH remains untouched and cannot increase a user's payout.
