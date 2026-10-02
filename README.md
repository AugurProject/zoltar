# Zoltar + Augur Statoblast

This repository contains two protocol layers:

- `Zoltar`: the forkable oracle base layer
- `Augur Statoblast`: the prediction-market application layer built on top of Zoltar

It also contains the OpenOracle price feed integration, the Statoblast Trading exchange, the augurScan explorer, and operator bots. [ARCHITECTURE.md](./ARCHITECTURE.md) maps how these pieces depend on one another and where code belongs.

## Documentation

- [Protocol documentation](https://augurproject.github.io/zoltar/docs/documentation.html): start with the [system overview](https://augurproject.github.io/zoltar/docs/explanation/system-overview.html), then follow the tutorials, how-to guides, explanations, and contract reference. Trading is documented there too.
- [Further reading](https://augurproject.github.io/zoltar/docs/reference/further-reading.html): bot operator guides, the augurScan explorer, the security regression suite, and the design-research repository.
- This README covers developer setup, local development, and repository commands.

## Glossary

The [protocol glossary](https://augurproject.github.io/zoltar/docs/reference/glossary.html) is canonical; these are the terms you meet first.

| Term | Meaning |
| --- | --- |
| [Zoltar](https://augurproject.github.io/zoltar/docs/explanation/zoltar.html) | The forkable oracle ledger: it records questions, universes, REP, and forks, and never judges which answer is true. |
| [Statoblast](https://augurproject.github.io/zoltar/docs/explanation/statoblast.html) | The prediction-market layer on Zoltar: one SecurityPool per question, universe, and pool configuration, with local dispute resolution and fork migration. |
| [REP](https://augurproject.github.io/zoltar/docs/reference/glossary.html#rep) | Universe-specific reputation tokens used as reporting, dispute, and security capital. |
| [Universe](https://augurproject.github.io/zoltar/docs/reference/glossary.html#universe) | A Zoltar ledger that can branch; markets and REP balances belong to one universe, and universe 0 is the root. |
| [Security pool](https://augurproject.github.io/zoltar/docs/reference/glossary.html#security-pool) | The Statoblast contract for one question, universe, and pool configuration; it holds settlement collateral and coordinates shares, vaults, resolution, and migration. |
| [Escalation game](https://augurproject.github.io/zoltar/docs/explanation/escalation-game.html) | The local Statoblast dispute round in which REP accumulates behind Invalid, Yes, and No until one answer wins or the pool forks. |
| [Fork](https://augurproject.github.io/zoltar/docs/explanation/zoltar.html) | The split of a universe into one child universe per valid answer, each with its own REP, when a dispute cannot be settled locally. |
| [Truth auction](https://augurproject.github.io/zoltar/docs/explanation/truth-auctions.html) | A Statoblast auction that sells child REP to repair a child pool's ETH collateral shortfall; it does not select truth. |
| [OpenOracle](https://augurproject.github.io/zoltar/docs/explanation/open-oracle.html) | A contestable price-reporting contract that supplies fresh REP/ETH prices for solvency checks, never market outcomes. |

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
- Node.js 20+ on `PATH`: `bun x tsc` and other package binaries honor their `#!/usr/bin/env node` shebangs, so setup, UI builds, and TypeScript checks fail without it
- Docker, only for the container workflows (`testnetwork/`, `reth/`, bot images, and UI publishing)

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

The Sepolia deployment flow installs genesis REP before the contracts that
depend on it; WETH is Uniswap's published Sepolia contract. Initial Sepolia REP
holders and exact 18-decimal balances are defined in
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

This mode does not require a wallet extension or `anvil`. Instead, it boots a Tevm-backed in-browser chain and seeds the QA accounts with ETH, WETH, and REP. Zoltar and Statoblast scenarios control whether application contracts are already deployed. In Trading, `simScenario=deployed` deploys a seeded SecurityPool plus the Trading factory and router so its market routes are immediately usable, and the default `simScenario=trading-funded` additionally initializes pair liquidity and funds the simulation wallet with Yes, No, Invalid, and LP shares. `simScenario=trading-forked` starts from that funded market and forks its universe through the pool's own escalation game, so Settlement offers Fork migration for the wallet's parent-universe shares.

Simulation mode details:

- The activation flag is `?simulate=1`
- The flag is intentionally not restricted to localhost or development builds; production deployments may expose it as a browser-local demo and manual-QA path
- Production users should treat any `?simulate=1` URL as a local sandbox. Simulated balances, deployments, blocks, quotes, and transactions are local to the browser and are not evidence of mainnet state.
- Every app supports `simScenario=baseline` and `simScenario=deployed`. The other seeded scenarios are app-specific:
  - Zoltar: `two-questions` and `forked-categorical`
  - Statoblast: `security-pool`, `securitypoolx2`, `securitypoolx2-auction`, `ended-pool-commitment`, and `liquidation-distance`
  - Trading: `trading-funded` and `trading-forked`
- The live simulation chain is ephemeral and exists only in the current browser tab session; only states explicitly saved from the simulation banner persist in browser storage

## Common Commands

Each serve command first builds the selected app and its dependencies, then serves the app. Watch commands also rebuild the selected app and its dependencies as you edit.

| Application | Serve command                  | Watch command                  | Local URL              |
| ----------- | ------------------------------ | ------------------------------ | ---------------------- |
| Zoltar      | `bun run app:serve:zoltar`     | `bun run app:watch:zoltar`     | http://localhost:4153  |
| Statoblast  | `bun run app:serve:statoblast` | `bun run app:watch:statoblast` | http://localhost:12347 |
| Trading     | `bun run app:serve:trading`    | `bun run app:watch:trading`    | http://localhost:4163  |

### Which command do I run?

| I want to…                                        | Run                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Set up a fresh checkout                           | `bun run setup`                                                                                      |
| Develop one app                                   | `bun run app:serve:<app>` or `bun run app:watch:<app>` (`zoltar`, `statoblast`, `trading`)          |
| Regenerate contract bindings and vendor assets    | `bun run generate` (contracts only: `bun run compile-contracts`)                                    |
| Build every UI app and test bundle                | `bun run ui:build` (production bundles: `bun run ui:build:prod`)                                    |
| Type-check                                        | `bun run tsc`                                                                                        |
| Find and run the tests my change affects          | `bun run test:plan`, then the listed test paths; `bun run check:affected` runs affected project checks |
| Run the root test suite                           | `bun run test`                                                                                       |
| Lint and check what I changed                     | `bun run check:changed`                                                                              |
| Run the full lint, documentation, and repository checks | `bun run check`                                                                                |
| Format, or verify formatting                      | `bun run format`, `bun run format:check`                                                            |
| Find dead code                                    | `bun run knip`                                                                                       |
| Validate everything CI validates                  | `bun run validate` (plus preflight and browser smoke tests: `bun run test:all`)                     |

### Script families

Root scripts are grouped by prefix:

- `setup`, `generate`, `compile-contracts`, `shared:build`, `ui:vendor`, `ensure-*`: install dependencies and create generated outputs. `tooling/repo/generated-artifacts.ts` lists every generated output with the command that recreates it.
- `app:serve:<app>`, `app:watch:<app>`, `ui:build*`, `ui:browser-smoke:<app>`, `ui:publish:*`: build, serve, smoke-test, and publish the UI apps.
- `test`, `test:*`, `coverage*`: `test` runs `tsc` and then the canonical root suite (`test:run`). `test:preflight` covers the project registry and CI tooling, the `test:browser:*` and `test:integration:*` tiers run only when invoked explicitly, and the remaining `test:*` scripts run focused suites.
- `check`, `check:*`, `lint:*`, `docs:check*`, `format*`, `knip*`: static analysis. `check` runs `check:static` (Biome and custom lint rules), `docs:check`, and `check:repository`. `check:complete` adds formatting, dead-code analysis, and generated-output freshness, and is the repository's `check` task in `validate`.
- `validate`, `test:all`: the complete local validation used for CI and release parity.
- `projects:*`: run one task (`setup`, `test`, `check`, `typecheck`, `workers`) across the projects registered in `tooling/repo/projects.ts`.
- `ci:*`: entry points used by GitHub Actions jobs.
- `trading:*`: Trading-only shortcuts used by the [Trading development guide](https://augurproject.github.io/zoltar/docs/how-to/trading-set-up-development.html).

A `:current` suffix runs the same work as the unsuffixed script against the workspace as it is: it skips the preparation step, which is usually regenerating contract artifacts or shared builds (`compile-contracts:current`, `check:contract-safety:current`, `check:mainnet-deployment:current`, `docs:check:current`, `ui:build:prod:current`). `check:repository:current` instead skips the source-size and preflight steps that CI runs in a separate job, and `ci:*:current` and `tsc:solidity:current` are the names CI calls after it has restored the generated artifacts. Use `:current` only after `bun run setup` or `bun run generate` has run in the same checkout.

### Details

Changes to global, unowned, CI, or repository-tooling paths make `check:affected` select the full registered check set. Project-owned changes select the owning project and its registry dependents. When a package's canonical `check` command already covers its typecheck, lint, or tests, affected validation runs that composite once instead of repeating the covered work.

`bun run validate` runs the root suite, every independent package `check` command, formatting, repository checks, dead-code analysis, and generated-output freshness. CI component selection, dependency expansion, cache inputs, generated outputs, and local component commands come from `tooling/repo/projects.ts`. A CI failure names the same root or component command used locally. Contract-size and delegate-layout failures reproduce with `bun run check:contract-safety`; source-size failures reproduce with `bun run check:source-size`.

- `bun run tsc` prepares missing or stale contract artifacts and shared build outputs, then runs the registered project typechecks. `bun run tsc:app` also refreshes Trading vendor inputs. This command can write generated files.
- `bun run test:launch-invariants` runs the launch-focused fork, auction, and exit invariant gate.
- `bun run coverage` runs every canonically discovered TypeScript test, reports weighted coverage for UI, shared, and tooling source, counts statically identified executable lines and functions in unloaded source as zero-hit coverage, and checks product TypeScript from the `origin/main` merge base through committed, staged, unstaged, and untracked task changes. Set `COVERAGE_BASE_REF` or pass `--base-ref` to the reporter to use another comparison ref. Use `bun run coverage:full` to enforce the same policy with the slower Solidity bytecode trace phase.
- `bun run lint:fix` and `bun run knip:fix` apply automatic lint and dead-code fixes.

### Gas costs

Measure Solidity gas costs with `bun run gas-costs`. By default, it starts an isolated Anvil node. To measure against an existing local node instead, start the repository-pinned Anvil in one terminal:

```bash
bun run anvil -- --host 127.0.0.1 --port 8545 --chain-id 1 --block-base-fee-per-gas 0 --gas-price 0 --no-priority-fee
```

Then run `gas-costs` against it from another terminal:

```bash
GAS_COST_ANVIL_RPC=http://127.0.0.1:8545 bun run gas-costs
```

Use `GAS_COST_ANVIL_RPC=http://host.docker.internal:8545 bun run gas-costs` when the command runs from a container that reaches the host through Docker routing.

## Publishing the UIs to a local IPFS node

With Docker and a local IPFS (Kubo) node running, `bun run ui:publish:local` builds Zoltar, Statoblast, and Trading in Docker and pins all three on that node. Set `IPFS_API` to the node's Kubo API multiaddress when it is not reachable at `/dns4/host.docker.internal/tcp/5001`. On Windows, double-clicking `publish.bat` runs the same command; it needs Bun and the repository dependencies installed. `bun run ui:publish:ipfs` publishes through the release publisher image instead.

## Agent configuration

- `AGENTS.md` files (root and nested) hold the repository rules for coding agents; `CLAUDE.md` points Claude Code at them.
- `.codex/` configures Codex: `config.toml` limits sub-agent threads and depth, `agents/*.toml` defines the final, visual, and documentation reviewers, and `review-contract.md` is their shared handoff and scoring contract. `bun run check:agents` validates them.
- `.agents/skills/` holds shared agent skills (currently `babysit`, which keeps a pull request current and green); `.claude/skills/` symlinks the same skills for Claude Code, and `.claude/settings.json` disables Claude commit and pull-request attribution.
- `.ci-agents/` holds the Architect, Bug Hunter, Defender, and Security prompts for automated pull-request review agents; no repository script reads them.
