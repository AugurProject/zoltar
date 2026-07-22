# Zoltar + Augur Statoblast

This repository contains two protocol layers:

- `Zoltar`: the forkable oracle base layer
- `Augur Statoblast`: the prediction-market application layer built on top of Zoltar

The codebase is split into these main areas:

- `solidity/` contains contracts, protocol test support, tests, and generated contract artifacts
- `ui/` contains the Preact frontend, organized by application shell, feature, and protocol-client boundaries
- `shared/` contains runtime-neutral TypeScript used by Solidity tooling and the UI
- `docs/` contains the published protocol documentation
- `scripts/` contains repository-wide build, validation, and test orchestration

Inside `ui/ts`, route-specific code belongs under `features/<domain>`, cross-feature UI primitives remain in `components`, application composition belongs in `app`, and contract reads and writes belong in `protocol`.

Protocol documentation lives in `docs/`:

- [Security model](https://augurproject.github.io/zoltar/docs/security-model.html) — normative guarantees, accepted economic assumptions, loss-allocation policies, and residual risks
- [Security-review classification](https://augurproject.github.io/zoltar/docs/security-model.html#accepted-design-properties) — audit orientation for intentionally unbounded oracle notional, permissionless paid forks, and paid rolling disputes
- [Start here guide](https://augurproject.github.io/zoltar/docs/start-here.html)

The security-review classification distinguishes excluded guarantees from
vulnerabilities. It also identifies the
conditions that would turn each accepted design property into an implementation
defect or a deployment-blocking economic risk. The invariant catalog owns the
current requirement, status, and evidence for
[`EXT-05` recursive-fork gas behavior](https://augurproject.github.io/zoltar/docs/invariants.html#ext-05).

Deterministic deployment outputs live in
[`docs/mainnet-deployment-addresses.json`](./docs/mainnet-deployment-addresses.json).
The repo keeps that file as generated source-of-truth data instead of maintaining
a separate prose page for the same addresses.

## Prerequisites

- Bun 1.3+
- Foundry `anvil` for local chain work

## Setup

On a fresh checkout, start with the root dependency install:

```bash
bun install --frozen-lockfile
```

Then run the full bootstrap:

```bash
bun run setup
```

Install `anvil` if it is not already available:

```bash
bun run install:anvil
```

Important:

- `bun run setup` is the fastest way to get to a working repo after the root install.
- Standalone commands like `bun tsc`, `bun run tsc`, and `bun run test` assume the root dependencies are already installed.
- If you skip the initial `bun install --frozen-lockfile`, fresh checkouts can fail with missing packages such as `bun-types`.

## Local Development

After completing [Setup](#setup), start a local chain and launch the app:

1. Start `anvil`
1. Run `bun run app:serve`

If you are iterating on the app and want rebuilds, use:

```bash
bun run app:watch
```

## RPC Configuration

The UI read backend defaults to `https://ethereum.dark.florist`, but you can override it without changing code:

- Add `?rpcUrl=https://your-rpc.example` to the app URL
- Set `localStorage['zoltar.rpcUrl']`
- Set `globalThis.__ZOLTAR_RPC_URL__` before bootstrapping the app
- Set the `ZOLTAR_RPC_URL` environment variable for environments that inject `process.env`

## Browser Simulation

The UI also supports a walletless browser-local simulation mode for manual QA.
After completing [Setup](#setup):

1. Run `bun run app:serve`
1. Open `http://localhost:12345/?simulate=1`

This mode does not require a wallet extension or `anvil`. Instead, it boots a Tevm-backed in-browser chain, seeds the QA accounts with ETH, WETH, and REP, and leaves the application contracts undeployed so the UI starts on the deploy flow.

Simulation mode details:

- The activation flag is `?simulate=1`
- The flag is intentionally not restricted to localhost or development builds; production deployments may expose it as a browser-local demo and manual-QA path
- Production users should treat any `?simulate=1` URL as a local sandbox. Simulated balances, deployments, blocks, quotes, and transactions are local to the browser and are not evidence of mainnet state.
- The default seeded scenario is `?simulate=1&simScenario=baseline`
- Supported seeded scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, `simScenario=securitypoolx2`, and `simScenario=securitypoolx2-auction`
- The yellow simulation banner exposes developer-only controls for account switching, reset, block mining, time travel, blockchain time, block count, transaction count, and artificial transaction receipt delay
- Uniswap-backed REP pricing is intentionally disabled in simulation mode, so quote-dependent UI paths degrade instead of using mainnet liquidity
- Production quote-dependent flows rely on live RPC data and available Uniswap liquidity. If a quote is stale, unavailable, or unsupported, affected actions should remain blocked or degraded rather than falling back to simulated prices.
- The simulation chain is ephemeral and exists only in the current browser tab session

## Common Commands

Run the full app in development mode. This includes contract generation and the frontend build pipeline:

```bash
bun run app:serve
```

Watch and rebuild the full app pipeline:

```bash
bun run app:watch
```

Build the full app:

```bash
bun run app:build
```

Regenerate contract bindings and UI vendor assets:

```bash
bun run generate
```

Compile the Solidity contracts:

```bash
bun run compile-contracts
```

Run the full test suite:

```bash
bun run test
```

Run the launch-focused fork, auction, and exit invariant gate:

```bash
bun run test:launch-invariants
```

Run fast coverage checks:

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

By default, `gas-costs` starts an isolated Anvil node. To measure against an existing local node instead, start Anvil in one terminal:

```bash
anvil --host 127.0.0.1 --port 8545 --chain-id 1 --block-base-fee-per-gas 0 --gas-price 0 --no-priority-fee
```

Then run `gas-costs` against it from another terminal:

```bash
ANVIL_RPC=http://127.0.0.1:8545 bun run gas-costs
```

Use `ANVIL_RPC=http://host.docker.internal:8545 bun run gas-costs` when the command runs from a container that reaches the host through Docker routing.

## Notes

- `bun run tsc` is a pure typecheck for the app TypeScript, the Solidity-side TypeScript utilities, and the Bun build/dev scripts. It does not regenerate shared assets or vendor output.
- `bun run test` runs the TypeScript check first, then executes the test suite.
- `bun run test:launch-invariants` is the targeted pre-release gate for adversarial fork, truth-auction, unresolved escalation carry, and auction edge-case invariants.
- `bun run coverage` runs the fast UI and contract TypeScript coverage phases. Use `bun run coverage:full` when you also need the slower Solidity bytecode trace coverage phase.
- The legacy `ui:*` commands still exist as compatibility aliases, but `app:*` names are the clearer entrypoints because they run more than frontend-only work.
- The repo uses exact dependency versions for reproducible installs.
