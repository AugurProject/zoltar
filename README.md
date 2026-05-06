# Zoltar

Zoltar is a Bun + Solidity project for building and exploring prediction markets with forked universes. The repository is split into two main parts:

- `solidity/` contains the contracts, tests, and generated contract artifacts
- `ui/` contains the Preact frontend that reads from those contracts

## Prerequisites

- Bun 1.3+
- Foundry `anvil` for local chain work

## Setup

Install dependencies, generate contract artifacts, vendor the UI dependencies, and build the frontend:

```bash
bun run setup
```

If you plan to run individual checks manually on a fresh checkout, install dependencies first:

```bash
bun install --frozen-lockfile
```

Install `anvil` if it is not already available:

```bash
bun run install:anvil
```

## Local Development

Start a local chain with `anvil`, then run the setup step once and launch the UI:

1. Start `anvil`
1. Run `bun run setup`
1. Run `bun run ui:serve`

If you are iterating on the frontend and want rebuilds, use:

```bash
bun run ui:watch
```

## Browser Simulation

The UI also supports a walletless browser-local simulation mode for manual QA.

1. Run `bun run setup`
1. Run `bun run ui:serve`
1. Open `http://localhost:12345/?simulate=1`

This mode does not require a wallet extension or `anvil`. Instead, it boots a Tevm-backed in-browser chain, seeds the QA accounts with ETH, WETH, and REP, and leaves the application contracts undeployed so the UI starts on the deploy flow.

Simulation mode details:

- The activation flag is `?simulate=1`
- The default seeded scenario is `?simulate=1&simScenario=baseline`
- The yellow simulation banner exposes developer-only controls for account switching, reset, block mining, time travel, blockchain time, block count, transaction count, and artificial transaction receipt delay
- Uniswap-backed REP pricing is intentionally disabled in simulation mode, so quote-dependent UI paths degrade instead of using mainnet liquidity
- The simulation chain is ephemeral and exists only in the current browser tab session

## Common Commands

Run the UI in development mode:

```bash
bun run ui:serve
```

Watch and rebuild the UI assets:

```bash
bun run ui:watch
```

Build the UI:

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

Run the full test suite:

```bash
bun run test
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

## Notes

- `bun run setup` is the quickest way to bootstrap a fresh checkout.
- `bun install --frozen-lockfile` must be run before standalone commands like `bun run tsc` on a fresh checkout.
- `bun run test` runs the TypeScript check first, then executes the test suite.
- The repo uses exact dependency versions for reproducible installs.
