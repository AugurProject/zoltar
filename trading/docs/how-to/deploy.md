# Deploy the trading contracts

## Use an installed public-network core

The root mainnet and Sepolia manifests describe planned deterministic addresses; they do not prove that the contracts are live. Continue only after the selected network has reviewed core code at those addresses. See the root [deployment-status reference](../../../docs/reference/deployment-status.html) for that distinction.

From `trading/`, start the standalone UI:

```bash
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

Open `http://localhost:4163/#/deploy`, select the network, enter an HTTPS RPC URL and the immutable fee, then connect a wallet. The UI checks the RPC chain, canonical proxy, and core factory before enabling the first transaction. Submit the factory transaction, then the router transaction. Progress reaches `2 / 2` after both deterministic contracts and their immutable links have been verified. The flow resumes at the first missing contract if you return later.

## Use local Anvil

Return to the repository root (`cd ..` if you are still in `trading/`) and complete the root setup. Start Anvil as chain ID 1 so it uses the mainnet deterministic-address profile:

```bash
bun run anvil -- --chain-id 1 --block-base-fee-per-gas 0 --gas-price 0 --no-priority-fee
```

In another terminal, run `bun run app:serve:statoblast`, open `http://localhost:12347/?rpcUrl=http://127.0.0.1:8545#/deploy`, connect an Anvil account, and use the Statoblast deployment screen to install the core contracts and security pool factory. Wait until its deployment plan is complete.

From the repository root, start the trading Docker UI:

```bash
cd trading
docker network inspect zoltar >/dev/null 2>&1 || docker network create zoltar
docker compose up --build --force-recreate
```

Open `http://localhost:4163/#/deploy` and follow the public-network steps above with **Ethereum Mainnet · chain 1** and `http://127.0.0.1:8545`. The browser will deploy the trading factory and router through the same deterministic proxy.

For a generated trading manifest instead of browser storage, open another terminal in the repository root, enter `trading/`, and run the local deployment script against the matching root manifest:

```bash
cd trading
bun run compile
ZOLTAR_DEPLOYMENT_MANIFEST=../docs/mainnet-deployment-addresses.json \
TRADING_RPC_URL=http://127.0.0.1:8545 \
bun run deploy:local
```

The script verifies code at the configured core `SecurityPoolFactory`, deploys `TwoWayConstantProductFactory(coreFactory, feeBps)`, deploys `TwoWayConstantProductRouter(factory)`, and records chain ID, inputs, outputs, transaction hashes, compiler settings, and bytecode hashes. The fee is immutable and no economically optimal value is claimed.
