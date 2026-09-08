# Runtime-neutral TypeScript ownership

Reusable TypeScript is grouped by the domain that owns its meaning:

- `evm/` contains chain encoding, addressing, and log scanning.
- `deployment/` contains deterministic deployment inputs and network configuration.
- `oracle/` contains OpenOracle, initial-report, and escalation calculations.
- `statoblast/` contains settlement, liquidation, scalar-market, and auction calculations.
- `trading/` contains AMM and position calculations.
- `serialization/` contains general deterministic value and ordering helpers.
- `testing/` contains runtime-neutral fixtures only.

Package exports use these owned domain paths directly. Add new exports beside the implementation that owns them instead of introducing root-level forwarding modules.
