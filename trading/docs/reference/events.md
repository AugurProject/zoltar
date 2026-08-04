# Events

## Factory

`PairCreated(securityPool, shareToken, universeId, pair, feeBps)` identifies one exact branch market and its immutable fee.

## Pair

- `LiquidityInitialized(provider, recipient, yesAmount, noAmount, liquidity)` records the first reserve contribution and circulating LP minted; locked minimum liquidity is separate.
- `LiquidityAdded(provider, recipient, yesAmount, noAmount, liquidity)` records proportional reserve use.
- `LiquidityRemoved(provider, recipient, yesAmount, noAmount, liquidity)` records raw-share output.
- `Swap(sender, recipient, yesForNo, exactOutput, amountIn, amountOut, feeAmount, resultingYesReserve, resultingNoReserve)` provides authoritative direction, mode, amounts, fee, and resulting state.
- `Sync(yesReserve, noReserve)` records reserves after synchronization or mutation.
- Standard ERC-20 `Transfer` and `Approval` events describe LP ownership and allowances.

For router-mediated operations, pair `provider`/`sender` fields and SecurityPool `creator`/`redeemer` fields identify the router, not the initiating wallet. Pair `recipient` identifies the explicit asset recipient. The router emits no operation-level event, so an indexer must combine the transaction sender, called router method, pair/core logs, and explicit recipient; it must not infer wallet attribution from the immediate-caller fields alone.

Router return tuples are available from authoritative call simulation. They are not stored in a mined receipt. Mined complete-set and ETH-flow evidence comes from the existing SecurityPool’s `CompleteSetCreated` and `CompleteSetRedeemed` events plus transaction logs. `extractEventResult` scans already-decoded logs and rejects a missing expected event; it cannot recover a Solidity return tuple from a receipt.
