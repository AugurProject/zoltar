# Trading project instructions

The root `AGENTS.md` applies. Keep all product contracts, SDK code, UI, deployment tooling, tests, and documentation inside this directory. Imports from stable root protocol sources are allowed, but do not edit core protocol behavior for trading integration.

Use `bigint` for chain quantities. The AMM trades only YES and NO. Every contract and test change must preserve a zero pair balance for INVALID, and all visible probability language must say that prices are conditional on a valid resolution.

Generated artifacts under `artifacts/`, `ts/artifacts/`, and `ui/ts/generated/` are compiler output and must not be hand-edited.
