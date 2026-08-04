# First market

Read the [project mental model](../index.md#mental-model) before this operational walkthrough.

Start with a current operational SecurityPool whose question has exactly `Yes` and `No` labels and has not reached its end time.

1. Discover the pool from `SecurityPoolFactory.securityPoolDeploymentsRange`.
2. Confirm the pool’s origin with `getSecurityPoolOriginId(pool)` and canonical branch with `getSecurityPool(originId, universeId)`.
3. Confirm `shareToken.canonicalPoolByUniverse(universeId) == pool`.
4. Using a contract console or integration client, choose a target Conditional YES price strictly between 0% and 100%.
5. Simulate and submit `createPairAndInitializeWithEth`. Pair creation and initialization occur atomically.

For a 70% Conditional YES price, one complete-set budget deposits approximately 30 parts YES to 70 parts NO. The NO reserve is larger because the opposite reserve determines the constant-product spot price. All INVALID and unused directional shares return to the initializer; only YES/NO reserve ownership is represented by LP tokens.

The standalone UI currently demonstrates this screen with simulated fixtures only. It is not a live deployment client; see [UI configuration](../how-to/configure-ui.md).
