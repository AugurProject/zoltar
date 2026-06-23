# Zoltar + Augur Placeholder

This repository contains two protocol layers:

- `Zoltar`: the forkable oracle base layer
- `Augur Placeholder`: the prediction-market application layer built on top of Zoltar

The codebase is split into two main parts:

- `solidity/` contains the contracts, tests, and generated contract artifacts
- `ui/` contains the Preact frontend that reads from those contracts

Protocol documentation lives in `docs/`:

- [Zoltar visual whitepaper](./docs/whitepaper_zoltar.html)
- [Augur Placeholder visual whitepaper](./docs/whitepaper_placeholder.html)

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

Start a local chain with `anvil`, then run the setup step once and launch the app:

1. Start `anvil`
1. Run `bun run setup`
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

1. Run `bun run setup`
1. Run `bun run app:serve`
1. Open `http://localhost:12345/?simulate=1`

This mode does not require a wallet extension or `anvil`. Instead, it boots a Tevm-backed in-browser chain, seeds the QA accounts with ETH, WETH, and REP, and leaves the application contracts undeployed so the UI starts on the deploy flow.

Simulation mode details:

- The activation flag is `?simulate=1`
- The flag is intentionally not restricted to localhost or development builds; production deployments may expose it as a browser-local demo and manual-QA path
- The default seeded scenario is `?simulate=1&simScenario=baseline`
- Supported seeded scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, and `simScenario=securitypoolx2`
- The yellow simulation banner exposes developer-only controls for account switching, reset, block mining, time travel, blockchain time, block count, transaction count, and artificial transaction receipt delay
- Uniswap-backed REP pricing is intentionally disabled in simulation mode, so quote-dependent UI paths degrade instead of using mainnet liquidity
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

- `bun run setup` is the quickest way to bootstrap a fresh checkout.
- `bun install --frozen-lockfile` must be run before standalone commands like `bun run tsc` on a fresh checkout.
- `bun run tsc` is a pure typecheck for the app TypeScript, the Solidity-side TypeScript utilities, and the Bun build/dev scripts. It does not regenerate shared assets or vendor output.
- `bun run test` runs the TypeScript check first, then executes the test suite.
- `bun run test:launch-invariants` is the targeted pre-release gate for adversarial fork, truth-auction, unresolved escalation carry, and auction edge-case invariants.
- `bun run coverage` runs the fast UI and contract TypeScript coverage phases. Use `bun run coverage:full` when you also need the slower Solidity bytecode trace coverage phase.
- The legacy `ui:*` commands still exist as compatibility aliases, but `app:*` names are the clearer entrypoints because they run more than frontend-only work.
- The repo uses exact dependency versions for reproducible installs.
