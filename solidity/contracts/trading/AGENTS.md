# Trading contract instructions

The root `AGENTS.md` applies. These contracts use the main Solidity compiler and generated artifact pipeline. Reusable Trading math lives under `shared/trading/ts/trading`, contract-facing TypeScript and tests live under `solidity/ts`, and the browser application lives under `ui/trading`.

Use `bigint` for chain quantities. The AMM trades only YES and NO. Every contract and test change must preserve a zero pair balance for INVALID, and all visible probability language must say that prices are conditional on a valid resolution.

Compiler outputs under `solidity/artifacts` and UI generated directories must not be hand-edited. `solidity/ts/types/index.d.ts` and `solidity/ts/types/bun-test.d.ts` are hand-written declarations.
