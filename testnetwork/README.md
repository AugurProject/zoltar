# Local test network

This directory builds and runs the repository-pinned Anvil node as a local Sepolia-compatible test network. It uses chain ID `11155111`, the Osaka hardfork, zero gas pricing, and Anvil's standard funded development accounts. The RPC port is published only on host loopback.

On Windows, run `start.bat`. On any platform, the equivalent commands are:

```bash
cd testnetwork
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

The examples below use the default host port `8545`. Set `ANVIL_RPC_PORT` before starting Compose to publish another host port, and replace `8545` in every host or browser URL with that port. The container URL remains `http://anvil:8545`.

## RPC endpoints

Use the endpoint appropriate to where the client runs:

| Client location | RPC URL |
| --- | --- |
| Host applications, browser applications, wallets, and command-line tools | `http://localhost:8545` |
| Compose services attached to the external `zoltar` network | `http://anvil:8545` |

The node is intentionally ephemeral. `docker compose down` stops it, and starting it again creates a clean chain with the same funded accounts. Never use Anvil's public development keys on a real network.

## Connect repository tools

- **Zoltar UI:** from the repository root, run `bun run app:serve`, then open `http://localhost:12345/?network=sepolia&rpcUrl=http%3A%2F%2Flocalhost%3A8545`. Connect a wallet configured for chain ID `11155111` and RPC URL `http://localhost:8545`.
- **testnet deployer:** from the repository root, pass one of the development keys printed by Anvil. This cross-platform example uses the first standard Anvil account:

  ```bash
  bun run deploy:testnet -- --private-key=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url=http://localhost:8545 --chain-id=11155111
  ```

  This well-known key is safe only for local development. The deployer checks and installs all deterministic protocol infrastructure needed by the other tools.
- **augurScan:** after deploying the protocol, refresh its checked-in contract manifest from the current deterministic deployment data before building the image:

  ```bash
  cd augurScan
  bun install --frozen-lockfile
  bun run metadata:snapshot
  ```

  In `augurScan/.env`, set `NETWORKS=sepolia`, `SEPOLIA_RPC_URL=http://anvil:8545`, and `SEPOLIA_START_BLOCK=0`, then run `docker compose up --build --force-recreate`. Set the optional Sepolia AMM and Uniswap environment addresses only after deploying those contracts.
- **trading UI:** from `trading/`, run `docker compose up --build --force-recreate`, then open `http://localhost:4163/#/deploy`. Use chain ID `11155111` and `http://localhost:8545` in its live deployment setup. Host-side deployment commands use `TRADING_RPC_URL=http://localhost:8545`; a deployment manifest shown in the browser must also contain the browser-reachable host URL.
- **liquidator:** from the repository root, run `cd bots/liquidator` and `docker compose up --build --force-recreate`, then open `http://127.0.0.1:4183`. Select Sepolia in **Chain and RPC connectivity**, enter `http://anvil:8545` for the primary and public RPC URLs, save, and run `docker compose restart`. Keep execution disabled unless its deployment addresses and signer are configured for this chain.
- **open-oracle arbitrager:** from the repository root, run `cd bots/open-oracle-arbitrager` and `docker compose up --build --force-recreate`, then open `http://127.0.0.1:4173`. Select Sepolia in **Chain and RPC connectivity**, enter `http://anvil:8545` for the primary and public RPC URLs, save, and run `docker compose restart`. Keep execution disabled unless its deployment manifest, contract addresses, and signer are configured for this chain.

The bots require independently operated quorum endpoints for live execution. A single local Anvil node supports development and dry-run connectivity, but it does not satisfy that production safety requirement.
