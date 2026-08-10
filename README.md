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

Deploy the complete deterministic infrastructure with an explicitly selected RPC
endpoint. First load `PRIVATE_KEY` from a protected secret manager or hidden
prompt; do not paste it into the command because shells may save it in history.
Use a dedicated testnet account funded with enough testnet ETH to finish the
remaining deployment.

```bash
bun run deploy:testnet -- \
RPC_URL=https://... MAX_FEE_PER_GAS_GWEI=100 MAX_TOTAL_COST_ETH=20
```

The chain ID defaults to Sepolia (`11155111`). Set `CHAIN_ID` for any other EVM
testnet that supports the protocol's required Cancun opcodes and Osaka `CLZ`
opcode; chain ID `1` is intentionally rejected. Older pre-Cancun or pre-Osaka
chains cannot execute the pinned protocol and Uniswap V4 bytecode. The fee ceiling
defaults to 100 gwei and the total-cost authorization defaults to 20 testnet ETH.
`RPC_URL`, `MAX_FEE_PER_GAS_GWEI`, and `MAX_TOTAL_COST_ETH` can be passed as the
uppercase command arguments shown above, as lowercase `--rpc-url=...` style
options, or as environment variables. `PRIVATE_KEY` remains environment-only so
it is not exposed in command history.

Before funding or signing, the command verifies the selected chain, required EVM
opcodes, EIP-1559 support, fee limits, and acceptance of the fixed canonical
legacy deployer transactions. It then identifies every missing step and calculates
a deliberately conservative upper-bound cost at the selected fee ceiling. The
allowances are about 50% above measured deployment gas and rounded upward; the
largest deployments use the signer's 30-million-gas transaction ceiling. Missing
canonical deployers also include their fixed raw-transaction cost and an allowance
for atomic funding. If the estimate exceeds `MAX_TOTAL_COST_ETH`, the command exits
before any funding or deployment transaction. The per-transaction budget remains
active as a second guard. Each retry estimates only contracts that are still
missing. A network that rejects the canonical transactions must provide both
canonical deployers as predeploys.

The command validates each expected runtime, skips deterministic addresses only
when their code matches, fails closed when an address contains different code,
and resumes from the first missing deployment. Atomic funding transactions refund
surplus if another process wins a deployment race. Every supported testnet plan
includes deterministic WETH and genesis REP contracts. The same plan covers the canonical CREATE2 deployer and
Permit2, a deterministic Uniswap V3 factory, SwapRouter, and QuoterV2, plus a
Uniswap V4 PoolManager and Quoter. It does not create pools or add liquidity. The deployed
protocol factories create per-market security pools, share tokens, oracle
coordinators, auctions, escalation games, delegates, and child-universe
contracts when those features are used. Constructor-created support contracts
are not separate bootstrap steps; the command verifies all twelve bootstrap
descendants after their parent factories are deployed.

The ready-to-install GitHub Actions template is
[`scripts/github-actions/deploy-testnet.yml`](./scripts/github-actions/deploy-testnet.yml).
GitHub only discovers workflows under `.github/workflows`, so copy the template
there on a trusted branch when using a credential authorized to manage Actions.
Then create and protect the `testnet-deployment` environment, add its
`TESTNET_DEPLOYER_PRIVATE_KEY` secret, and dispatch **Deploy Testnet Contracts**
from `main`. Supply the public HTTPS RPC URL, chain ID, fee ceiling, and total
budget, then enter `DEPLOY` in the confirmation input. Workflow inputs are
visible in GitHub metadata, so do not supply an RPC URL containing credentials.

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
- `bun run coverage` runs every canonically discovered TypeScript test, reports weighted coverage for UI, shared, and tooling source, counts statically identified executable lines and functions in unloaded source as zero-hit coverage, and checks product TypeScript from the `origin/main` merge base through committed, staged, unstaged, and untracked task changes. Set `COVERAGE_BASE_REF` or pass `--base-ref` to the reporter to use another comparison ref. Use `bun run coverage:full` to enforce the same policy with the slower Solidity bytecode trace phase.
