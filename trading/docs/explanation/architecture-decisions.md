# Architecture decisions

1. **Two reserves only.** YES × NO avoids the three-way quadratic and does not price INVALID.
2. **Exact SecurityPool identity.** A pair is keyed by the pool address, validated through both factory lineage and the ShareToken’s universe mapping.
3. **One immutable fee per factory.** There is no owner, protocol fee switch, or mutable parameter.
4. **Balance-delta integration.** Complete-set creation and redemption use actual deltas because Zoltar collateral retention changes the ETH/share rate.
5. **Minimum-reserve LP scale.** Initial supply is `min(YES, NO) - 1,000`; 1,000 units are locked forever. Proportional ownership is authoritative.
6. **Donations accrue to LPs.** State-changing paths synchronize higher actual balances; balances below recorded reserves revert.
7. **No automatic fork behavior.** Parent liquidity is removed as parent shares. The user explicitly chooses migration targets and initializes distinct child pairs.
