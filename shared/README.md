# Shared TypeScript packages

Runtime-neutral code lives in independently built packages. UI components and browser adapters live in `ui/coreShared`, `ui/zoltarShared`, and `ui/statoblastShared`.

| Package | Owns | Build dependencies |
| --- | --- | --- |
| `core` (`@zoltar/core-shared`) | EVM, serialization, generic address helpers, common deployment configuration | None of the protocol packages |
| `zoltar` (`@zoltar/zoltar-shared`) | REP addresses and allocations, Zoltar deployment addresses, scalar questions | Core |
| `openOracle` (`@zoltar/open-oracle-shared`) | OpenOracle state encoding and decoding | Core |
| `statoblast` (`@zoltar/statoblast-shared`) | Pool addresses, liquidation, auctions, `escalationGame/`, `initialReport/` | Core, Zoltar, OpenOracle |
| `trading` (`@zoltar/trading-shared`) | AMM quotes, positions, transaction requests | Core, Statoblast |

Each package has its own manifest, lockfile, TypeScript configuration, and generated `js/` output. Cross-package imports use explicit public exports. There is no aggregate shared package or compatibility export layer.

`tooling/repo/sharedPackages.ts` declares the allowed build dependency graph; `tooling/repo/projects.ts` incorporates it into repository tasks. `bun run check:shared-boundaries` rejects reverse imports, including type-only imports and relative-path bypasses. Manifests declare only packages directly imported by their sources; the build graph also prepares the upstream packages needed by product consumers. The root installs all five packages for dynamic build and test orchestration, so Knip exempts these root-only installation dependencies. Package-local overrides keep Bun's transitive `file:` dependencies rooted in the consuming checkout without introducing workspace dependencies.

Build one application's runtime packages with `bun tooling/repo/build-shared.mts zoltar` (or `statoblast` or `trading`). `bun run shared:build` builds every runtime package for repository-wide tasks.

`bun tooling/ui/apps.mts zoltar` builds only Zoltar's shared packages, UI libraries, and scoped contract artifacts. Statoblast includes Zoltar and OpenOracle; Trading includes Statoblast. The app commands used by `app:serve:*` and `app:watch:*` follow the same graph. Scoped Solidity output lives in `solidity/artifacts/<app>/`; Zoltar's neutral WETH and Multicall dependencies retain their imported compatibility source paths under `contracts/statoblast/`.

Reusable OpenOracle and pool-reporting UI capabilities belong to `ui/statoblastShared`. Shared scalar-question primitives consume the Zoltar runtime package. Contract artifact generation places Zoltar and neutral infrastructure artifacts in `ui/coreShared`, Statoblast/OpenOracle artifacts in `ui/statoblastShared`, and Trading artifacts in the Trading app.
