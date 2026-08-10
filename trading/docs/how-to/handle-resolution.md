# Handle resolution

When an authoritative outcome exists, swaps and liquidity additions are closed while LP removal remains available.

- Remove LP into raw YES and NO.
- If the wallet already holds complete sets and the pool permits the operational path, redeem them explicitly.
- Redeem the winning share through `SecurityPool.redeemShares`.
- On INVALID, only INVALID is the winning share. Raw YES/NO balances—including pair fee accrual—must not be described as valuable merely because balances remain nonzero.

The UI must show the exact YES, NO, or INVALID result and never infer it from reserve prices.

In the live market view, open **Settlement and fork migration**, select **Winning shares**, simulate the authoritative `redeemShares` call, and submit it before the displayed simulation block becomes stale. The action redeems the wallet’s entire winning-share balance for that exact SecurityPool. Use **Complete set** instead for an explicitly entered amount of matching INVALID, YES, and NO.
