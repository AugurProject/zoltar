# Placeholder Protocol Contracts

Despite the historical `peripherals` directory name, these contracts implement the Placeholder prediction-market layer described in the repository README: security pools, escalation, fork migration, truth auctions, share tokens, factories, and the OpenOracle integration.

The directory name remains stable because Solidity source paths are embedded in generated artifact identifiers and linked documentation. If it is renamed to `placeholder`, treat that as a dedicated artifact migration: regenerate the untracked artifacts, update handwritten imports that consume renamed generated identifiers, and update compiler warning paths, tests, and documentation links together.

`Multicall3.sol`, `WETH9.sol`, and `openOracle/OpenOracle.sol` are externally sourced compatibility contracts and remain immutable under the repository rules.
