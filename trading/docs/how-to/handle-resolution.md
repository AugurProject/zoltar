# Handle resolution

When an authoritative outcome exists, swaps and liquidity additions are closed while LP removal remains available.

- Remove LP into raw YES and NO.
- If the wallet already holds complete sets and the pool permits the operational path, redeem them explicitly.
- Redeem the winning share through `SecurityPool.redeemShares`.
- On INVALID, only INVALID is the winning share. Raw YES/NO balances—including pair fee accrual—must not be described as valuable merely because balances remain nonzero.

The UI must show the exact YES, NO, or INVALID result and never infer it from reserve prices.
