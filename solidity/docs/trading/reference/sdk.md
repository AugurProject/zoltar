# SDK reference

The shared TypeScript package `@zoltar/trading-shared` holds the pure Trading math that the UI and the Solidity parity tests share. All chain quantities are `bigint`.

- `quoteExactOutput` (`trading/math`) mirrors the Solidity ceil behavior for an exact-output swap and returns gross input, output, net input, and fee.
- `maximumInsuredExit` (`trading/positions`) binary-searches the greatest complete-set amount allowed by INVALID, long balance, opposite reserve, and an optional long-input ceiling.

Transaction-facing helpers live in the Trading UI (`ui/trading/ts/protocol/tradeQuote.ts`): `minimumAfterSlippage` and `maximumAfterSlippage` build conservative bounds, `stableSimulation` and `requireQuoteBlock` pin a simulation to one canonical block identity (number and hash) and reject same-height replacements, and `deadlineAtBlock` derives router deadlines from the quote block.

Pure math is a responsive preview only. Transaction summaries must simulate the actual router call, use its returned values, refresh when the block changes, and revalidate network, account, balances, approvals, reserves, deadline, and simulation immediately before wallet submission.
