# SDK reference

All chain quantities are `bigint`.

- `quoteExactInput` and `quoteExactOutput` mirror Solidity floor/ceil behavior and return gross input, output, net input, and fee.
- `conditionalYesProbability` and `conditionalNoProbability` return exact numerator/denominator pairs.
- `quoteInitialLiquidity`, `quoteAddLiquidity`, and `quoteRemoveLiquidity` model reserve use and returned shares.
- `quoteEnterPosition` and `quoteExitPosition` model share flows after the caller supplies the authoritative complete-set share quantity.
- `maximumInsuredExit` binary-searches the greatest complete-set amount allowed by INVALID, long balance, opposite reserve, and an optional long-input ceiling.
- `minimumAfterSlippage` and `maximumAfterSlippage` build conservative bounds.
- `reserveImpact` returns before/after rational reserve shares.
- Request builders cover entry, exit, initialization, add, and remove.
- `simulateAuthoritatively` binds router return data to a block number. `requireFreshSimulation` rejects it after a block change.
- `extractEventResult` locates a typed decoded event and rejects incomplete receipts.

Pure math is a responsive preview only. Transaction summaries must simulate the actual router call, use its returned values, refresh when the block changes, and revalidate network, account, balances, approvals, reserves, deadline, and simulation immediately before wallet submission.
