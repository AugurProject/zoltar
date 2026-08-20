# Trading project instructions

The root `AGENTS.md` applies. Keep Trading contracts, SDK code, deployment tooling, their tests, and documentation inside this directory. The browser application and its tests live in `ui/trading`, beside the Zoltar and Statoblast applications, and consume shared UI primitives from `ui/coreShared`.

Use `bigint` for chain quantities. The AMM trades only YES and NO. Every contract and test change must preserve a zero pair balance for INVALID, and all visible probability language must say that prices are conditional on a valid resolution.

Generated artifacts under `artifacts/`, `ts/artifacts/`, and `js/` are compiler output and must not be hand-edited. The relocated browser package has its own instructions in `../ui/trading/AGENTS.md`.
