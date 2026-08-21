# Liquidity-provider position

Initial LP supply uses the smaller reserve as an accounting scale. The pair permanently mints 1,000 units to the zero address, then mints `min(YES, NO) − 1,000` to the initializer. At very large Zoltar share scales this avoids an overflowing geometric-mean multiplication. Absolute LP supply is arbitrary; `wallet LP / total LP` defines ownership.

```mermaid
sequenceDiagram
    actor LP
    participant Router
    participant Pool as SecurityPool
    participant Pair
    LP->>Router: addLiquidityWithEth + ETH
    Router->>Pool: createCompleteSet()
    Pool-->>Router: equal INVALID, YES, NO
    Router->>Pair: add largest proportional YES + NO
    Pair-->>LP: LP tokens
    Router-->>LP: all INVALID + unused YES/NO
```

Direct valid YES/NO donations are synchronized and accrue to existing LPs. Removal returns proportional raw shares even after trading closes. Coverage shown in the portfolio is an estimate comparing separate wallet INVALID with the LP reserve claim; the LP token itself is never called insured.
