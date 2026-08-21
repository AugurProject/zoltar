# Trading invariants

These conditions are required at every successful external state transition. Reverting calls leave the prior state unchanged.

## Pair custody

- The pair's YES balance is greater than or equal to its stored YES reserve.
- The pair's NO balance is greater than or equal to its stored NO reserve.
- The pair's INVALID balance is exactly zero.
- An LP withdrawal cannot claim more YES or NO shares than the pair owns. Withdrawal amounts are proportional to synchronized reserves and the liquidity burned.

Unsolicited YES or NO donations can make a balance greater than its stored reserve. Before reserve-dependent mutations, the pair synchronizes stored reserves upward to those effective balances. INVALID is never a trading asset and cannot be donated through an accepted ERC-1155 callback.

## Router custody

Every successful router operation ends with the same INVALID, YES, and NO balances with which that operation began. This deliberately preserves any pre-existing balances while preventing the operation from accumulating new share residue.

## Swaps

- For every successful exact-input or exact-output swap, `k_after >= k_before`. For each snapshot, `k` is the synchronized effective YES reserve multiplied by the synchronized effective NO reserve.
- An exact-output swap delivers exactly the requested output amount.
- An exact-output swap never charges more than the caller's `maxAmountIn`.

The product comparison starts from effective reserves so a donation cannot be mistaken for swap-created growth.

## Lifecycle

- Trading cannot resume after the market lifecycle closes trading.
- Liquidity removal remains available after lifecycle closure so LP shares do not become trapped.

Terminal lifecycle closure includes question end or resolution and a universe fork. It blocks initialization, liquidity addition, and both swap forms; it does not block proportional liquidity removal. Pending fork continuation and an inactive security pool also pause those trading operations, but they are temporary safety states rather than terminal closure.
