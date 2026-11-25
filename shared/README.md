# Shared TypeScript packages

Runtime-neutral code lives in independently built packages. UI components and browser adapters live in `ui/coreShared`, `ui/zoltarShared`, and `ui/statoblastShared`.

| Package | Owns | Build dependencies |
| --- | --- | --- |
| `core` (`@zoltar/core-shared`) | EVM, serialization, generic address helpers, common deployment configuration | None of the shared packages |
| `zoltar` (`@zoltar/zoltar-shared`) | REP addresses and allocations, Zoltar deployment addresses, scalar questions | Core |
| `openOracle` (`@zoltar/open-oracle-shared`) | OpenOracle state encoding and decoding | Core |
| `statoblast` (`@zoltar/statoblast-shared`) | Pool addresses, liquidation, auctions, `escalationGame/`, `initialReport/` | Core |
| `trading` (`@zoltar/trading-shared`) | AMM quotes, positions, transaction requests | Core |

The protocol packages depend only on Core and never on one another. An application combines several of them; the per-application sets are described below.

Each package has its own manifest and TypeScript configuration, and generated `js/` output. Cross-package imports use explicit public exports. There is no aggregate shared package or compatibility export layer.

The [repository dependency graph](../ARCHITECTURE.md#dependency-graph) describes the build order. `bun run check:shared-boundaries` enforces import direction, including type-only imports and relative paths. Internal dependencies use exact `workspace:1.0.0` constraints.

Build one application's runtime packages with `bun tooling/repo/build-shared.mts zoltar` (or `statoblast` or `trading`). `bun run shared:build` builds every runtime package for repository-wide tasks.

`bun tooling/ui/apps.mts zoltar` builds only Zoltar's shared packages, UI libraries, and the canonical contract artifacts. The Statoblast app adds the OpenOracle and Statoblast packages to Zoltar's; the Trading app adds the Trading package to Statoblast's set. The app commands used by `app:serve:*` and `app:watch:*` follow the same graph. All applications consume the canonical Solidity compilation under `solidity/artifacts/`; Zoltar's neutral WETH and Multicall dependencies retain their imported compatibility source paths under `contracts/statoblast/`.

Reusable OpenOracle and pool-reporting UI capabilities belong to `ui/statoblastShared`. Shared scalar-question primitives consume the Zoltar runtime package. Contract artifact generation places Zoltar and neutral infrastructure artifacts in `ui/coreShared`, Statoblast/OpenOracle artifacts in `ui/statoblastShared`, and Trading artifacts in the Trading app.
