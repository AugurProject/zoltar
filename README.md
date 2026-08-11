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
- `bots/` contains liquidator and open oracle arbitrager bots

Inside `ui/ts`, route-specific code belongs under `features/<domain>`, cross-feature UI primitives remain in `components`, application composition belongs in `app`, and contract reads and writes belong in `protocol`.

Protocol documentation lives in [docs/documentation.html](https://augurproject.github.io/zoltar/docs/documentation.html)

## Prerequisites

- Bun 1.3+
- Node.js 20+ for the repository-wide TypeScript check

## Setup

On a fresh checkout, start with the root dependency install:

```bash
bun install --frozen-lockfile
```

Then run the full bootstrap:

```bash
bun run setup
```

Important:

- `bun run setup` is the fastest way to get to a working repo after the root install.
- The root install includes the repository-pinned native Anvil binary on supported platforms. Set `ANVIL_BIN` to another installation only when overriding it intentionally.
- Standalone commands like `bun tsc`, `bun run tsc`, and `bun run test` assume the root dependencies are already installed.
- If you skip the initial `bun install --frozen-lockfile`, fresh checkouts can fail with missing packages such as `bun-types`.

## Local Development

After completing [Setup](#setup), start a local chain and launch the app:

1. Start the repository-pinned local chain with `bun run anvil`
1. Run `bun run app:serve`

If you are iterating on the app and want rebuilds, use:

```bash
bun run app:watch
```

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
[`shared/ts/sepoliaRepAllocations.ts`](./shared/ts/sepoliaRepAllocations.ts).
Changing that list also changes the deterministic genesis REP address and every
dependent deployment address.

## Testnet deployment

The testnet deployer installs the complete deterministic infrastructure. It is
safe to rerun: existing contracts are skipped only when their runtime bytecode
matches, and an unexpected contract at a target address stops the deployment.

### Before you deploy

- Complete [Setup](#setup).
- Use a dedicated testnet account and fund it with enough testnet ETH for the
  remaining steps.
- Use an HTTPS RPC endpoint. Loopback HTTP endpoints are accepted for local test
  networks.
- Ensure the deployer account has no pending transactions.

Sepolia is the default target (chain ID `11155111`). A different testnet must
support EIP-1559, the Cancun opcodes used by Zoltar and Uniswap V4, and the Osaka
`CLZ` opcode used by the compiled contracts. The deployer rejects Ethereum
mainnet (chain ID `1`).

### Deploy with GitHub Actions

Use the [`Deploy Testnet Contracts`](./.github/workflows/deploy-testnet.yml)
workflow for a deployment from `main`:

1. Create a protected GitHub environment named `testnet-deployment`.
1. Add the deployer's private key as the environment secret
   `TESTNET_DEPLOYER_PRIVATE_KEY`.
1. Open **Actions → Deploy Testnet Contracts → Run workflow**.
1. Select `main`, complete the inputs, and enter `DEPLOY` as the confirmation.
1. Review the job summary for each planned deployment's result and address. It
   includes transaction hashes for contracts deployed during the run.

Use a public RPC URL without credentials. Workflow inputs are stored in GitHub
metadata and are not secret.

### Deploy locally

Load `PRIVATE_KEY` from a secret manager or hidden prompt. Never paste the key
into a command because it may be saved in shell history. For example, in Bash:

```bash
read -rsp 'Testnet deployer private key: ' PRIVATE_KEY && echo && export PRIVATE_KEY
```

Run the deployer with an explicit RPC endpoint and spending limits:

```bash
bun run deploy:testnet -- --rpc-url=https://rpc.example --chain-id=11155111 --max-fee-per-gas-gwei=100 --max-total-cost-eth=20
```

Remove the key from the shell when the command finishes:

```bash
unset PRIVATE_KEY
```

The deployer reads the exported `PRIVATE_KEY` automatically. You can instead
pass the key directly, but the complete command—and therefore the key—may be
saved in shell history:

```bash
bun run deploy:testnet -- --private-key=0x... --rpc-url=https://rpc.example --chain-id=11155111 --max-fee-per-gas-gwei=100 --max-total-cost-eth=20
```

Run `bun run deploy:testnet -- --help` for all options. Options other than
`--private-key` also accept uppercase arguments after `--` or environment
variables.

| Input | Default | Purpose |
| --- | --- | --- |
| `RPC_URL` / `--rpc-url` | Required | RPC endpoint for the target network |
| `CHAIN_ID` / `--chain-id` | `11155111` | Expected decimal chain ID |
| `MAX_FEE_PER_GAS_GWEI` / `--max-fee-per-gas-gwei` | `100` | Rejects higher RPC fee suggestions |
| `MAX_TOTAL_COST_ETH` / `--max-total-cost-eth` | `20` | Caps the conservative preflight estimate and transaction budget |
| `PRIVATE_KEY` / `--private-key` | Required | `0x`-prefixed 32-byte deployer key |

The defaults are authorization limits, not a spend forecast or a required
balance. Before sending a transaction, the command checks the RPC chain ID, EVM
features, EIP-1559 support, canonical deployer compatibility, expected bytecode,
and fee limits. It then estimates only the missing deployment steps. If the
conservative estimate exceeds `MAX_TOTAL_COST_ETH`, it exits before funding or
deploying anything. Per-transaction checks enforce the same budget while the
deployment runs.

If a run is interrupted, wait for all pending transactions to settle and rerun
the same command. The deployer revalidates completed contracts and resumes with
the first missing step. A testnet that rejects the fixed legacy transactions for
the canonical deployers must provide both deployers as predeploys.

A successful local run exits with status `0` after logging each planned contract
as `deployed` or `skip` and verifying the bootstrap support contracts.

### Deployed infrastructure

Every deployment includes:

- deterministic WETH and genesis REP
- the canonical CREATE2 deployer and Permit2
- a deterministic Uniswap V3 factory, SwapRouter, and QuoterV2
- a Uniswap V4 PoolManager and Quoter
- the Zoltar and Augur Statoblast protocol factories and their bootstrap support
  contracts

The command does not create Uniswap pools or add liquidity. Protocol factories
create market-specific security pools, share tokens, oracle coordinators,
auctions, escalation games, delegates, and child-universe contracts later, when
those features are used.

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
- Supported seeded scenarios are `simScenario=baseline`, `simScenario=deployed`, `simScenario=security-pool`, `simScenario=securitypoolx2`, and `simScenario=securitypoolx2-auction`
- The live simulation chain is ephemeral and exists only in the current brow

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
ANVIL_RPC=http://127.0.0.1:8545 bun run gas-costs
```

Use `ANVIL_RPC=http://host.docker.internal:8545 bun run gas-costs` when the command runs from a container that reaches the host through Docker routing.

## Notes

- `bun run tsc` is a pure typecheck for the app TypeScript, the Solidity-side TypeScript utilities, and the Bun build/dev scripts. It does not regenerate shared assets or vendor output.
- `bun run test` runs the TypeScript check first, then executes the test suite.
- `bun run coverage` runs every canonically discovered TypeScript test, reports weighted coverage for UI, shared, and tooling source, counts statically identified executable lines and functions in unloaded source as zero-hit coverage, and checks product TypeScript from the `origin/main` merge base through committed, staged, unstaged, and untracked task changes. Set `COVERAGE_BASE_REF` or pass `--base-ref` to the reporter to use another comparison ref. Use `bun run coverage:full` to enforce the same policy with the slower Solidity bytecode trace phase.
