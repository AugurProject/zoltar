# Trading UI instructions

The root and `ui/AGENTS.md` instructions apply. This package owns the Trading browser application and its tests. Trading contracts live under `solidity/contracts/trading`, reusable SDK math lives under `shared/ts/trading`, and contract-facing deployment tooling and tests live under `solidity/ts`.

Consume shared UI primitives and the active chain environment from `ui/coreShared`. Trading may depend on Zoltar and Statoblast, but those packages must not import Trading. Use the shared active backend for every simulated chain read or write instead of creating an HTTP-only client.

Use `bigint` for chain quantities. The AMM trades only YES and NO. Visible probability language must say that prices are conditional on a valid resolution. Generated artifacts under `js/`, `vendor/`, `dist/`, and `ts/generated/` are build output and must not be hand-edited.
