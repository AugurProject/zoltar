# Statoblast trading

This subsystem implements the two-reserve constant-product alternative described in [How To Build: Augur Constant Product with Invalid Insurance](https://micah-zoltu.medium.com/augur-constant-product-with-invalid-insurance-385fca7efbc7), adapted to the current local Zoltar protocol.

The pair trades only YES and NO. Every ETH entry creates a complete set, swaps the opposite directional share, and returns the matching INVALID share to the user. INVALID never enters the pair. Prices are therefore **conditional on a valid resolution**; the AMM contains no estimate of invalidity.

## Project map

- `../../contracts/trading/` — immutable-fee factory, ERC-20 LP pair, stateless router, full-precision math, interfaces, and harnesses compiled by the main Solidity pipeline.
- `../../../shared/ts/trading/` — exact bigint quote math, maximum insured-exit search, transaction builders, simulations, and result extraction.
- `../../ts/trading/deploy/` — deployment from an existing Zoltar core manifest.
- `../../../ui/trading/` — standalone Preact application, deterministic visual fixtures, and walletless TEVM simulation.
- This directory contains tutorials, task guides, reference, and design explanation.
- `../../deployments/trading/` contains generated local deployment manifests; no invented public addresses.

## Quick setup

From `ui/trading`, build and start the live UI after completing the repository-root setup:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

Open `http://localhost:4163/#/markets`. The client derives the trading factory and router addresses from the canonical Zoltar deployment and checks their code through the default public RPC. If either deterministic contract is missing, the deployment screen is shown automatically. Connect a wallet, then deploy the trading factory and router in order. The **Settings** control beside the wallet lets you override the network or RPC URL without making configuration part of the setup steps. SecurityPools remain browseable without a trading pool; deploy and initialize one from the selected pool when needed. Browser-led deployment uses a fixed 0.30% trading fee. Trading and trading-pool deployment surfaces show the deployed immutable fee as a percentage.

On Windows, run `ui/trading/start.bat` to start the same Compose command. The final image runs as an unprivileged user and exposes a health check at `/`.

### Local development and demo

From the repository root, install and build the complete workspace first:

```bash
bun install --frozen-lockfile
bun run setup
bun run trading:test
bun run trading:ui:build
bun run app:serve:trading
```

Open `http://localhost:4163/?simulate=1#/markets` for the shared browser-local TEVM simulator. Use `?demo=1` for the deterministic visual fixtures used by browser QA.

See [Local development](tutorials/local-development.md) for the compile and external-node workflow.

The Docker image copies the canonical mainnet and Sepolia core deployment addresses from the root documentation manifests. The live UI uses the installed core deployment's deterministic proxy to deploy the two-way factory and router in two wallet transactions. It verifies the RPC chain, core contracts, deterministic addresses, immutable fee, and router-to-factory link before enabling trading.

### Live deployment

Without Docker, `bun run trading:ui:build` includes the same deterministic wallet deployment setup. The live client derives and verifies the canonical trading contracts, discovers SecurityPools in bounded pages, displays their exact pairs, settings, and status, and obtains authoritative simulations before entry, exit, liquidity, settlement, and explicit fork-migration transactions. Fork migration loads the fork question and supports labeled categorical branches or arbitrary scalar ticks, including multi-branch migration for each INVALID, YES, or NO source balance. Each simulation is pinned to a canonical block hash; the client rejects a quote when either its block number or hash changes, including a same-height block replacement, and re-simulates immediately before wallet submission.

## Commands

| Command | Purpose |
| --- | --- |
| Root `bun run setup` | Frozen install and compile |
| Root `bun run trading:compile` | Compile contracts and reusable Trading TypeScript through the main pipelines |
| Root `bun run trading:test` | Run SDK, contract-facing, and UI Trading tests |
| Root `bun run trading:coverage:contracts` | Trace Solidity execution and require at least 99% production-contract line coverage |
| Root `bun run trading:check` | Tests plus the bigint-number-cast guard |
| Root `bun run trading:ui:build` / `app:serve:trading` | Build or serve `ui/trading` |
| Root `bun run trading:deploy:local` | Deploy against an existing local Zoltar manifest |
| `cd ui/trading && bun run docker:build` / `docker:run` | Build or run the standalone UI container |
| Root `bun run trading:gas-costs` | Report bytecode sizes and funded-fixture operation gas |

Root aliases use the `trading:*` prefix.

## Architecture

`SecurityPool address → factory → one deterministic pair` is the market identity. Parent and child branch pools always map to different pairs even when they share one `ShareToken`. The pair derives token IDs from its pool’s universe using the local ordering `Invalid`, `Yes`, `No`.

The pair synchronizes valid YES/NO donations before mutations, rejects INVALID and foreign shares in ERC-1155 callbacks, uses `uint256` reserves, and keeps fees in reserves. Its constructor quarantines canonical shares maliciously or accidentally sent to the predictable CREATE2 address before deployment. Initial LP supply uses `min(yesReserve, noReserve)` as an accounting scale and permanently locks 1,000 units. Ownership ratios—not the absolute token count—are authoritative.

The router creates and redeems complete sets using observed balance and attoETH deltas. It never assumes a fixed attoETH-to-attoShares ratio, preserves pre-existing forced ETH and token balances, and restores its starting share balances before completing an operation.

## Documentation

- [Start here](index.md)
- [First market](tutorials/first-market.md) and [first trade](tutorials/first-trade.md)
- [Contract reference](reference/contracts.md), [router reference](reference/router.md), and [SDK reference](reference/sdk.md)
- [Market design](explanation/two-way-market.md), [INVALID insurance](explanation/invalid-insurance.md), and [security model](explanation/security-model.md)

## MVP limitations

There is no INVALID market, invalidity oracle, TWAP, flash swap, protocol fee, governance parameter, upgrade path, automatic fork migration, automatic branch selection, insured-position NFT, or per-user position record. Spot prices are manipulable and must not be used as protocol oracles. Early ETH exits are limited by wallet INVALID, directional shares, and opposite-reserve liquidity. The project has not been audited; see [SECURITY.md](SECURITY.md).
