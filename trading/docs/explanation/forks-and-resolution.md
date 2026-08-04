# Forks and resolution

Swaps, initialization, and added liquidity close at question end, when the pool is non-operational or awaiting continuation, when its universe has forked, or when the forker exposes a final outcome. LP removal deliberately has none of those lifecycle guards.

```mermaid
sequenceDiagram
    actor LP
    participant ParentPair
    participant ShareToken
    participant ChildPool
    participant Factory
    LP->>ParentPair: removeLiquidity()
    ParentPair-->>LP: parent YES + NO
    LP->>ShareToken: migrate(fromId, chosen outcomes)
    ShareToken-->>LP: selected child shares
    Note over LP,ChildPool: Wait for migration/truth auction to become Operational
    LP->>Factory: createPair(exact child pool)
    Factory-->>LP: isolated child pair
```

A fork does not select a branch or migrate LP. Parent and child pools may share one ShareToken contract but have different universe-specific IDs and different pair addresses.

```mermaid
sequenceDiagram
    participant Forker
    participant Pair
    actor Holder
    participant Pool as SecurityPool
    Forker-->>Pair: authoritative outcome becomes YES/NO/INVALID
    Pair-->>Pair: swaps/additions closed
    Holder->>Pair: removeLiquidity remains available
    Pair-->>Holder: raw YES + NO
    Holder->>Pool: redeemShares() for winning token
    Pool-->>Holder: current collateral value
```

On INVALID, matching wallet INVALID is the settlement insurance. Pair YES/NO fee growth does not create INVALID-branch redemption value.
