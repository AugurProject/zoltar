# Zoltar + Augur Statoblast

This repository contains two protocol layers:

- `Zoltar`: the forkable oracle base layer
- `Augur Statoblast`: the prediction-market application layer built on top of Zoltar

## Documentation

- [Protocol documentation](https://augurproject.github.io/zoltar/docs/documentation.html): start with the [system overview](https://augurproject.github.io/zoltar/docs/explanation/system-overview.html), then follow the tutorials, how-to guides, explanations, and contract reference. Statoblast Trading is documented there too.
- [Further reading](https://augurproject.github.io/zoltar/docs/reference/further-reading.html): bot operator guides, the augurScan explorer, the security regression suite, and the design-research repository.
- This README covers developer setup, local development, and repository commands.

## Repository layout

| Directory                                     | Contents                                                                                                                                                                             |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `solidity/`                                   | Contracts, protocol test support, tests, and generated contract artifacts; Trading contracts live under `solidity/contracts/trading/`                                                |
| `ui/coreShared/`                              | Runtime-neutral UI primitives, wallet and chain integration, shared workflows, and the simulation engine used by all three interfaces                                                |
| `ui/zoltarShared/`, `ui/statoblastShared/`    | Reusable product libraries without application bootstrap, routing, or pages                                                                                                          |
| `ui/zoltar/`, `ui/statoblast/`, `ui/trading/` | The Zoltar oracle, Augur Statoblast market, and Statoblast Trading interfaces; each is its own package with a dev server and production build                                        |
| [`shared/`](./shared/README.md)               | Independently built Core, Zoltar, OpenOracle, Statoblast, and Trading runtime packages used by Solidity tooling and the UI; `shared/trading/ts/trading/` holds the reusable AMM math |
| `docs/`                                       | The published protocol documentation                                                                                                                                                 |
| `tooling/`                                    | Typed repository metadata plus CI, contract-safety, documentation, testing, and UI build orchestration; `scripts/` retains only the pinned Uniswap deployment artifact               |
| `bots/`                                       | Chaos, liquidator, and OpenOracle arbitrager bots                                                                                                                                    |
| [`augurScan/`](./augurScan/README.md)         | The read-only protocol explorer and indexer                                                                                                                                          |
| [`testnetwork/`](./testnetwork/README.md)     | Docker Compose setup for the repository-pinned local Anvil network                                                                                                                   |
| [`reth/`](./reth/README.md)                   | Docker Compose setup for a pruned Sepolia Reth and Lighthouse node                                                                                                                   |

The runnable packages (`ui/zoltar`, `ui/statoblast`, and `ui/trading`) are dependency leaves: they own bootstrap, routes, application composition, and tests. Reusable product capabilities live in the matching shared library, and runtime-neutral primitives live in `ui/coreShared/ts`. Package exports and the UI boundary checker prevent shared libraries from importing runnable applications or applications from importing one another.

## Prerequisites

- Bun 1.4.2 (the version pinned by `packageManager` and CI)
- Node.js 20+ for the repository-wide TypeScript check

## Setup

On a fresh checkout, run the complete bootstrap:

```bash
bun run setup
```

Important:

- `bun run setup` installs the Bun workspace from the root frozen lockfile once, generates shared contract and vendor inputs once, and builds the UI and test outputs in dependency order.
- The root install includes the repository-pinned native Anvil binary on supported platforms. Set `ANVIL_BIN` to another installation only when overriding it intentionally.
- Standalone commands like `bun tsc`, `bun run tsc`, and `bun run test` assume the root dependencies are already installed.

## Local Development

After completing [Setup](#setup), start a local chain and launch the app:

1. Start the repository-pinned local chain with `bun run anvil`
1. Choose your app's serve command from [Common Commands](#common-commands).

For rebuilds while iterating, use the corresponding watch command in that table.

## RPC Configuration

The mainnet UI read backend defaults to `https://ethereum.dark.florist`;
Sepolia defaults to its profile RPC at
`https://ethereum-sepolia-rpc.publicnode.com`. You can override the active
network's default without changing code:

- Add `?rpcUrl=https://your-rpc.example` to the app URL
- Set `localStorage['zoltar.rpcUrl']`
- Set `globalThis.__ZOLTAR_RPC_URL__` before bootstrapping the app
- Set the `ZOLTAR_RPC_URL` environment variable for environments that inject `process.env`

## Sepolia

Open the application with `?network=sepolia` in either the page query or route
query (for example, `#/deploy?network=sepolia`). The application then uses
Sepolia chain ID `11155111`, its configured public RPC, Sepolia Etherscan links,
and Sepolia-specific deterministic contract addresses.

The Sepolia deployment flow includes WETH and genesis REP before the contracts
that depend on them. Initial Sepolia REP holders and exact 18-decimal balances
are defined in
[`shared/zoltar/ts/deployment/sepoliaRepAllocations.ts`](./shared/zoltar/ts/deployment/sepoliaRepAllocations.ts).
Changing that list also changes the deterministic genesis REP address and every
dependent deployment address.

## Testnet deployment

`bun run deploy:testnet` installs the complete deterministic infrastructure on Sepolia or another compatible testnet and is safe to rerun. The full procedure, including the GitHub Actions workflow, private-key handling, spending limits, and recovery, is in [Deploy testnet contracts](https://augurproject.github.io/zoltar/docs/how-to/deploy-testnet-contracts.html).

## Browser Simulation

The UI also supports a walletless browser-local simulation mode for manual QA.
After completing [Setup](#setup):

1. Start your app with its serve command from [Common Commands](#common-commands).
1. Open `http://localhost:4153/?simulate=1`, `http://localhost:12347/?simulate=1`, or `http://localhost:4163/?simulate=1`

While a dev server is running, `UI_DEV_SERVER_URL=http://localhost:4153 bun run ui:browser-smoke:zoltar`, `UI_DEV_SERVER_URL=http://localhost:12347 bun run ui:browser-smoke:statoblast`, or `UI_DEV_SERVER_URL=http://localhost:4163 bun run ui:browser-smoke:trading` opens the app in headless Chromium and fails if it does not mount cleanly.

This mode does not require a wallet extension or `anvil`. Instead, it boots a Tevm-backed in-browser chain and seeds the QA accounts with ETH, WETH, and REP. Zoltar and Statoblast scenarios control whether application contracts are already deployed. In Trading, `simScenario=deployed` deploys a seeded SecurityPool plus the Trading factory and router so its market routes are immediately usable, and the default `simScenario=trading-funded` additionally initializes pair liquidity and funds the simulation wallet with YES, NO, INVALID, and LP shares.

Simulation mode details:

- The activation flag is `?simulate=1`
- The flag is intentionally not restricted to localhost or development builds; production deployments may expose it as a browser-local demo and manual-QA path
- Production users should treat any `?simulate=1` URL as a local sandbox. Simulated balances, deployments, blocks, quotes, and transactions are local to the browser and are not evidence of mainnet state.
- Supported seeded scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, `simScenario=securitypoolx2`, `simScenario=securitypoolx2-auction`, and `simScenario=trading-funded`
- The live simulation chain is ephemeral and exists only in the current browser tab session; only states explicitly saved from the simulation banner persist in browser storage

## Common Commands

Each serve command first builds the selected app and its dependencies, then serves the app. Watch commands also rebuild the selected app and its dependencies as you edit.

| Application | Serve command                  | Watch command                  | Local URL              |
| ----------- | ------------------------------ | ------------------------------ | ---------------------- |
| Zoltar      | `bun run app:serve:zoltar`     | `bun run app:watch:zoltar`     | http://localhost:4153  |
| Statoblast  | `bun run app:serve:statoblast` | `bun run app:watch:statoblast` | http://localhost:12347 |
| Trading     | `bun run app:serve:trading`    | `bun run app:watch:trading`    | http://localhost:4163  |

Build all UI apps:

```bash
bun run ui:build
```

Regenerate contract bindings and UI vendor assets:

```bash
bun run generate
```

Compile the Solidity contracts:

```bash
bun run compile-contracts
```

Run the root test suite:

```bash
bun run test
```

Run the normal affected-project checks and print the narrower test-plan explanation:

```bash
bun run check:affected
bun run test:plan
```

Changes to global, unowned, CI, or repository-tooling paths make `check:affected` select the full registered check set. Project-owned changes select the owning project and its registry dependents. When a package's canonical `check` command already covers its typecheck, lint, or tests, affected validation runs that composite once instead of repeating the covered work.

Run the complete local validation suite used for CI/release parity:

```bash
bun run validate
```

`bun run validate` runs the root suite, every independent package `check` command, formatting, repository checks, dead-code analysis, and generated-output freshness. CI component selection, dependency expansion, cache inputs, generated outputs, and local component commands come from `tooling/repo/projects.ts`. A CI failure names the same root or component command used locally. Contract-size and delegate-layout failures reproduce with `bun run check:contract-safety`; source-size failures reproduce with `bun run check:source-size`.

Run every local package suite and the required browser smoke tier (after the complete fresh-checkout setup above):

```bash
bun run test:all
```

Run the launch-focused fork, auction, and exit invariant gate:

```bash
bun run test:launch-invariants
```

Run coverage across every canonically discovered TypeScript test:

```bash
bun run coverage
```

Run full coverage, including the slow Solidity bytecode trace phase:

```bash
bun run coverage:full
```

Type-check the TypeScript code:

```bash
bun run tsc
```

Format the codebase:

```bash
bun run format
```

Run linting:

```bash
bun run lint
```

Auto-fix lint issues:

```bash
bun run lint:fix
```

Run dead-code analysis:

```bash
bun run knip
```

Auto-fix dead-code findings:

```bash
bun run knip:fix
```

Measure Solidity gas costs:

```bash
bun run gas-costs
```

By default, `gas-costs` starts an isolated Anvil node. To measure against an existing local node instead, start the repository-pinned Anvil in one terminal:

```bash
bun run anvil -- --host 127.0.0.1 --port 8545 --chain-id 1 --block-base-fee-per-gas 0 --gas-price 0 --no-priority-fee
```

Then run `gas-costs` against it from another terminal:

```bash
GAS_COST_ANVIL_RPC=http://127.0.0.1:8545 bun run gas-costs
```

Use `GAS_COST_ANVIL_RPC=http://host.docker.internal:8545 bun run gas-costs` when the command runs from a container that reaches the host through Docker routing.

## Notes

- `bun run tsc` prepares missing or stale contract artifacts and shared build outputs, then runs the registered project typechecks. `bun run tsc:app` also refreshes Trading vendor inputs. This command can write generated files.
- `bun run test` runs the TypeScript check first, then executes the test suite.
- `bun run coverage` runs every canonically discovered TypeScript test, reports weighted coverage for UI, shared, and tooling source, counts statically identified executable lines and functions in unloaded source as zero-hit coverage, and checks product TypeScript from the `origin/main` merge base through committed, staged, unstaged, and untracked task changes. Set `COVERAGE_BASE_REF` or pass `--base-ref` to the reporter to use another comparison ref. Use `bun run coverage:full` to enforce the same policy with the slower Solidity bytecode trace phase.
