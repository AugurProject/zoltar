# Runtime-neutral TypeScript ownership

Reusable TypeScript is grouped by the domain that owns its meaning:

- `evm/` contains chain encoding, addressing, and log scanning.
- `deployment/` contains deterministic deployment inputs and network configuration.
- `oracle/` contains OpenOracle, initial-report, and escalation calculations.
- `statoblast/` contains settlement, liquidation, scalar-market, and auction calculations.
- `trading/` contains AMM and position calculations.
- `serialization/` contains general deterministic value and ordering helpers.
- `testing/` contains runtime-neutral fixtures only.

Root modules are compatibility entry points for current package consumers. New code should import the owned domain path so those forwarding modules can be removed as consumers migrate.
