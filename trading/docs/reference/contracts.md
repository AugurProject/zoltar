# Contract reference

All contracts compile with Solidity 0.8.35 for Osaka. Revert strings are part of operational diagnostics, not stable compatibility commitments.

## TwoWayConstantProductFactory

- `constructor(ISecurityPoolFactory, uint256 feeBps)` fixes the core factory and fee; `feeBps < 10,000`.
- `createPair(ISecurityPool)` validates the exact canonical pool, deploys with CREATE2, and returns an existing canonical pair on duplicate calls.
- `getPair(ISecurityPool) → pair` maps exact pool identity to a pair.
- `isPair(address) → bool` recognizes router-eligible pairs.
- `predictPair(ISecurityPool) → address` calculates the CREATE2 address.
- `securityPoolFactory()`, `feeBps()`, and `predeploymentShareSink()` expose immutable configuration.

Canonical validation requires the pool’s own `securityPoolFactory`, the factory’s `(originId, universeId)` lookup, and `shareToken.canonicalPoolByUniverse(universeId)` all to agree.

CREATE2 pair addresses exist counterfactually before code is deployed, when ERC-1155 receiver checks cannot run. Each factory therefore deploys an ownerless `PredeploymentShareSink`. A pair constructor transfers any canonical INVALID, YES, or NO already present at its future address into that sink before returning. Those quarantined shares are permanently inaccessible; do not send shares to a predicted pair address.

## TwoWayConstantProductPair

Immutable accessors expose `factory`, `securityPool`, `shareToken`, `universeId`, `questionId`, `invalidTokenId`, `yesTokenId`, `noTokenId`, and `feeBps`. LP ERC-20 accessors are `name`, `symbol`, `decimals`, `totalSupply`, `balanceOf`, `allowance`, `approve`, `transfer`, and `transferFrom`.

- `getReserves()` returns recorded YES and NO reserves.
- `tradingStatus()` returns `Open`, `QuestionEnded`, `PoolInactive`, `AwaitingForkContinuation`, `UniverseForked`, `QuestionResolved`, or `Uninitialized`.
- `initialize(yesAmount, noAmount, minLiquidity, recipient)` pulls the first reserves, locks `MINIMUM_LIQUIDITY`, and mints the remainder once.
- `addLiquidity(maxYes, maxNo, minLiquidity, recipient)` synchronizes donations, selects the largest proportional amounts, pulls them, and mints LP.
- `removeLiquidity(liquidity, minYes, minNo, recipient)` burns caller LP and returns proportional raw shares. It has no lifecycle-close guard.
- `swapExactInput(yesForNo, amountIn, minAmountOut, recipient)` pulls the gross input and sends the floor-rounded output.
- `swapExactOutput(yesForNo, amountOut, maxAmountIn, recipient)` pulls the ceil-rounded required input and sends the exact output.
- `quoteExactInput` and `quoteExactOutput` quote against effective balances including donations.
- `sync()` records authoritative balances, reverting if balances fell below reserves or INVALID is present.
- `onERC1155Received`, `onERC1155BatchReceived`, and `supportsInterface` implement receiver discovery. Only the canonical ShareToken’s exact YES/NO IDs are accepted. Pre-initialization transfers must be initiated by the pair’s own pull.

`PredeploymentShareSink` accepts ERC-1155 transfers and has no withdrawal or administrative method. It exists only to preserve clean pair initialization and the zero-INVALID invariant after counterfactual-address poisoning attempts.

`tradingStatus()` is a concise action blocker, not an authoritative settlement summary. The first matching condition wins in this order: `Uninitialized`, `UniverseForked`, `AwaitingForkContinuation`, `PoolInactive`, `QuestionResolved`, `QuestionEnded`, then `Open`. Thus an uninitialized forked pair reports `Uninitialized`, and a finalized question reports `QuestionResolved` even after its end time. Read `SecurityPoolForker.getQuestionOutcome(pool)` when the finalized outcome itself is required.

## TwoWayConstantProductMath

The internal library provides exact-input/output quotes, ceil rounding through the repository’s full-precision `Math.mulDiv`, proportional deposits, initial odds, and conditional price basis points. Production paths do not multiply reserve products.
