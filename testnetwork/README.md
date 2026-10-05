# Local test network

This directory builds and runs the repository-pinned Anvil node as a local Sepolia-compatible test network. It uses chain ID `11155111`, the Osaka hardfork, one-second block production, zero gas pricing, and Anvil's standard funded development accounts. Continuous block production lets the bots complete their 12-block canonical-finality checks without unrelated transactions. The RPC port is published only on host loopback.

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

- **Zoltar UI:** from the repository root, run `bun run app:serve:zoltar`, then open `http://localhost:4153/?network=sepolia&rpcUrl=http%3A%2F%2Flocalhost%3A8545`. Connect a wallet configured for chain ID `11155111` and RPC URL `http://localhost:8545`. Deploy the contracts with the testnet deployer below before using the app.
- **Statoblast UI:** after deploying, run `bun run app:serve:statoblast` from the repository root and open `http://localhost:12347/?network=sepolia&rpcUrl=http%3A%2F%2Flocalhost%3A8545` with the same wallet configuration.
- **Testnet deployer:** from the repository root, pass one of the development keys printed by Anvil. This cross-platform example uses the first standard Anvil account:

  ```bash
  bun run deploy:testnet -- --private-key=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --rpc-url=http://localhost:8545 --chain-id=11155111
  ```

  This well-known key is safe only for local development. On a clean Anvil node the deployer first replays Uniswap's original Sepolia creation transactions through Anvil cheatcodes, so WETH, the V3 factory, QuoterV2, and the V4 contracts exist locally at their Sepolia addresses with the exact bytecode. It then checks and installs the deterministic protocol infrastructure the other tools need.
- **augurScan:** after deploying the protocol, in `augurScan/.env`, set `NETWORKS=sepolia`, `SEPOLIA_RPC_URL=http://anvil:8545`, and `SEPOLIA_START_BLOCK=0`, then run `docker compose up --build --force-recreate`; the image build generates its contract manifests from the deterministic deployment data. Leaving `SEPOLIA_UNISWAP_V3_FACTORY_ADDRESS` empty uses the built-in default, Uniswap's published Sepolia factory, which the testnet deployer installs locally; set the optional Sepolia AMM factory address only after deploying that contract.
- **Trading UI:** from `ui/trading/`, run `docker compose up --build --force-recreate`, then open `http://localhost:4163/#/deploy`. Use chain ID `11155111` and `http://localhost:8545` in its live deployment setup. Host-side deployment commands use `TRADING_RPC_URL=http://localhost:8545`; a deployment manifest shown in the browser must also contain the browser-reachable host URL.
- **Liquidator:** from the repository root run `cd bots/liquidator` and `docker compose up --build --force-recreate`. Open `http://127.0.0.1:4183`, select Sepolia and **1 · primary RPC only** in **Chain and RPC connectivity**, enter `http://anvil:8545` for **Read RPC URL** and the public submission RPC URL list, leave the independent quorum RPC list empty, and save; the settings apply to the next scan. Keep execution disabled unless its deployment addresses and signer are configured for this chain.
- **OpenOracle arbitrager:** from the repository root run `cd bots/open-oracle-arbitrager` and `docker compose up --build --force-recreate`. Open `http://127.0.0.1:4173`, select Sepolia and **1 · primary RPC only** in **Chain and RPC connectivity**, enter `http://anvil:8545` for **Read RPC URL** and the public submission RPC URL list, leave the optional independent quorum RPC list empty, and save. Keep execution disabled unless its deployment manifest, contract addresses, and signer are configured for this chain.

Both bots accept the primary RPC alone by default. To require agreement between independent readers instead, save **2 · require two agreeing independent RPCs** in either bot's chain and RPC form and add two independently operated quorum RPC URLs beside the primary read RPC; with three endpoints configured, one may be unavailable.
