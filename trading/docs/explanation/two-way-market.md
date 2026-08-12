# The two-way market

The [project mental model](../index.md#mental-model) defines the Zoltar contracts and complete-set lifecycle used below.

The pair maintains `k = YES reserve × NO reserve`. A trader entering YES creates a complete set, keeps INVALID, keeps the base YES, and exchanges all NO for additional YES. Entering NO is symmetric.

```mermaid
sequenceDiagram
    actor User
    participant Router
    participant Pool as SecurityPool
    participant Pair
    User->>Router: enterPosition(pair, YES) + ETH
    Router->>Pool: createCompleteSet{value: ETH}()
    Pool-->>Router: q INVALID + q YES + q NO
    Router->>Pair: swap q NO for YES
    Pair-->>Router: additional YES
    Router-->>User: q INVALID + total YES
```

Example: reserves are 1,000 YES and 1,000 NO, fee is zero, and 100 complete-set shares are created. Contract math uses attoShares, where one displayed share is `10^18` attoShares. Swapping 100 NO therefore yields `90.909090909090909090` YES after flooring the result to an integer number of attoShares. The wallet receives `190.909090909090909090` YES and 100 INVALID; reserves become `909.090909090909090910` YES and 1,100 NO. Flooring the output favors existing liquidity providers.

A NO purchase simply reverses the reserves. No position record is created: wallet YES, NO, INVALID, and LP balances are the complete accounting state.
