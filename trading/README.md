# Zoltar two-way trading

This self-contained project implements the two-reserve constant-product alternative described in [How To Build: Augur Constant Product with Invalid Insurance](https://micah-zoltu.medium.com/augur-constant-product-with-invalid-insurance-385fca7efbc7), adapted to the current local Zoltar protocol.

The pair trades only YES and NO. Every ETH entry creates a complete set, swaps the opposite directional share, and returns the matching INVALID share to the user. INVALID never enters the pair. Prices are therefore **conditional on a valid resolution**; the AMM contains no estimate of invalidity.

## Project map

- `contracts/` — immutable-fee factory, ERC-20 LP pair, stateless router, full-precision math, interfaces, and harnesses.
- `ts/sdk/` — exact bigint quote math, maximum insured-exit search, transaction builders, simulations, and result extraction.
- `ts/compiler/` — Solidity 0.8.35 compiler and project-local artifact generation.
- `ts/deploy/` — deployment from an existing Zoltar core manifest.
- `ui/` — standalone Preact application and walletless demo mode.
- `docs/` — tutorials, task guides, reference, and design explanation.
- `deployments/` — local and reviewed network manifests; no invented public addresses.

## Quick setup

```bash
cd trading
bun install --frozen-lockfile
bun run compile
bun run test
bun run ui:build
bun run ui:serve
```

Open `http://localhost:12346/?demo=1#/markets`. Demo mode is prominently labeled and makes no live-chain claims.

For live use, build with a reviewed deployment manifest and open the same routes without `?demo=1`:

```bash
TRADING_UI_DEPLOYMENT=/absolute/path/to/trading/deployments/local.json bun run ui:build
```

The live client validates the manifest, discovers canonical SecurityPools and their exact pairs, displays pool settings and status, connects an injected wallet, and obtains authoritative router simulations before entry, exit, and liquidity transactions. It rejects a quote after the chain advances and re-simulates immediately before wallet submission.

For a local deployment, first deploy Zoltar core to Anvil, then:

```bash
cp .env.example .env
ZOLTAR_DEPLOYMENT_MANIFEST=/absolute/path/to/core.json bun run deploy:local
```

The script verifies that the configured core `SecurityPoolFactory` has bytecode on the selected chain, deploys a factory with an immutable fee, deploys the router, and writes `deployments/local.json`.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run setup` | Frozen install, compile, and UI build |
| `bun run compile` / `generate` | Compile contracts and produce local JSON/TypeScript artifacts |
| `bun run tsc` | Type-check SDK, tooling, and UI |
| `bun run test` | Compile, type-check, and run SDK/UI tests |
| `bun run coverage` | Bun coverage for TypeScript tests |
| `bun run check` | Formatting, types, and tests |
| `bun run format:check` / `format` | Check or apply project formatting |
| `bun run ui:build` / `ui:serve` | Build or serve the standalone UI |
| `bun run deploy:local` | Deploy against an existing local Zoltar manifest |
| `bun run gas-costs` | Report bytecode sizes and funded-fixture operation gas |
| `bun run ci` | Run the AMM-local frozen install, build, tests, formatting, and dependency audit |

Root aliases use the `trading:*` prefix.

## Architecture

`SecurityPool address → factory → one deterministic pair` is the market identity. Parent and child branch pools always map to different pairs even when they share one `ShareToken`. The pair derives token IDs from its pool’s universe using the local ordering `Invalid`, `Yes`, `No`.

The pair synchronizes valid YES/NO donations before mutations, rejects INVALID and foreign shares in ERC-1155 callbacks, uses `uint256` reserves, and keeps fees in reserves. Initial LP supply uses `min(yesReserve, noReserve)` as an accounting scale and permanently locks 1,000 units. Ownership ratios—not the absolute token count—are authoritative.

The router creates and redeems complete sets using observed balance and attoETH deltas. It never assumes a fixed attoETH-to-attoShares ratio, preserves pre-existing forced ETH and token balances, and restores its starting share balances before completing an operation.

## Documentation

- [Start here](docs/index.md)
- [First market](docs/tutorials/first-market.md) and [first trade](docs/tutorials/first-trade.md)
- [Contract reference](docs/reference/contracts.md), [router reference](docs/reference/router.md), and [SDK reference](docs/reference/sdk.md)
- [Two-way design](docs/explanation/two-way-market.md), [INVALID insurance](docs/explanation/invalid-insurance.md), and [security model](docs/explanation/security-model.md)

## MVP limitations

There is no INVALID market, invalidity oracle, TWAP, flash swap, protocol fee, governance parameter, upgrade path, automatic fork migration, automatic branch selection, insured-position NFT, or per-user position record. Spot prices are manipulable and must not be used as protocol oracles. Early ETH exits are limited by wallet INVALID, directional shares, and opposite-reserve liquidity. The project has not been audited; see [SECURITY.md](SECURITY.md).
