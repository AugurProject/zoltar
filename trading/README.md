# Statoblast trading

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

From this directory, build and start the live UI:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

Open `http://localhost:4163/#/markets`. When trading contracts are not configured, the deployment screen automatically selects the canonical Zoltar deployment and its default public RPC. Connect a wallet, then deploy the trading factory and router in order. The **Settings** control beside the wallet lets you override the network, RPC URL, or immutable fee without making configuration part of the setup steps. The repository's public-network manifests contain planned deterministic addresses; the UI verifies the required code and shows each contract's status before it offers a deployment transaction. SecurityPools remain browseable without a trading pool; deploy and initialize one from the selected pool when needed.

On Windows, run `start.bat` from this directory to start the same Compose command. The final image runs as an unprivileged user and exposes a health check at `/`.

### Local development and demo

```bash
bun install --frozen-lockfile
bun run compile
bun run test
bun run ui:build
bun run ui:serve
```

Open `http://localhost:4163/?demo=1#/markets`. Demo mode is prominently labeled and makes no live-chain claims.

The Docker image copies the canonical mainnet and Sepolia core deployment addresses from the root documentation manifests. The live UI uses the installed core deployment's deterministic proxy to deploy the two-way factory and router in two wallet transactions. It verifies the RPC chain, core contracts, deterministic addresses, immutable fee, and router-to-factory link before enabling trading.

To use an existing reviewed trading deployment instead, first copy its manifest into `trading/deployments/`. Then set its project-local path at build time:

```bash
cp /absolute/path/to/reviewed.json deployments/reviewed.json
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
TRADING_UI_DEPLOYMENT=deployments/reviewed.json docker compose up --build --force-recreate
```

### Live deployment

Without Docker, `bun run ui:build` includes the same wallet deployment setup. To use an existing reviewed deployment manifest instead:

```bash
TRADING_UI_DEPLOYMENT=/absolute/path/to/trading/deployments/local.json bun run ui:build
```

The live client validates the manifest, discovers canonical SecurityPools in bounded pages, displays their exact pairs, settings, and status, and obtains authoritative simulations before entry, exit, liquidity, settlement, and explicit fork-migration transactions. Fork migration loads the fork question and supports labeled categorical branches or arbitrary scalar ticks, including multi-branch migration for each INVALID, YES, or NO source balance. Each simulation is pinned to a canonical block hash; the client rejects a quote when either its block number or hash changes, including a same-height block replacement, and re-simulates immediately before wallet submission.

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
| `bun run docker:build` / `docker:run` | Build or run the standalone UI container from `trading/` |
| `bun run gas-costs` | Report bytecode sizes and funded-fixture operation gas |
| `bun run ci` | Run the AMM-local frozen install, build, tests, formatting, and dependency audit |

Root aliases use the `trading:*` prefix.

## Architecture

`SecurityPool address → factory → one deterministic pair` is the market identity. Parent and child branch pools always map to different pairs even when they share one `ShareToken`. The pair derives token IDs from its pool’s universe using the local ordering `Invalid`, `Yes`, `No`.

The pair synchronizes valid YES/NO donations before mutations, rejects INVALID and foreign shares in ERC-1155 callbacks, uses `uint256` reserves, and keeps fees in reserves. Its constructor quarantines canonical shares maliciously or accidentally sent to the predictable CREATE2 address before deployment. Initial LP supply uses `min(yesReserve, noReserve)` as an accounting scale and permanently locks 1,000 units. Ownership ratios—not the absolute token count—are authoritative.

The router creates and redeems complete sets using observed balance and attoETH deltas. It never assumes a fixed attoETH-to-attoShares ratio, preserves pre-existing forced ETH and token balances, and restores its starting share balances before completing an operation.

## Documentation

- [Start here](docs/index.md)
- [First market](docs/tutorials/first-market.md) and [first trade](docs/tutorials/first-trade.md)
- [Contract reference](docs/reference/contracts.md), [router reference](docs/reference/router.md), and [SDK reference](docs/reference/sdk.md)
- [Market design](docs/explanation/two-way-market.md), [INVALID insurance](docs/explanation/invalid-insurance.md), and [security model](docs/explanation/security-model.md)

## MVP limitations

There is no INVALID market, invalidity oracle, TWAP, flash swap, protocol fee, governance parameter, upgrade path, automatic fork migration, automatic branch selection, insured-position NFT, or per-user position record. Spot prices are manipulable and must not be used as protocol oracles. Early ETH exits are limited by wallet INVALID, directional shares, and opposite-reserve liquidity. The project has not been audited; see [SECURITY.md](SECURITY.md).
