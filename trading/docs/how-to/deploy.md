# Deploy the trading contracts

For mainnet or Sepolia, build and serve the UI, open the live markets route, select the core network and RPC URL, and connect a wallet. The UI verifies the canonical core deployment and submits the deterministic `TwoWayConstantProductFactory` and `TwoWayConstantProductRouter` deployments in dependency order. It resumes at the first missing contract when a deterministic deployment already exists.

For a local Anvil chain, compile first with `bun run compile`. Set `ZOLTAR_DEPLOYMENT_MANIFEST` to a reviewed manifest for the same chain, optionally set `TRADING_RPC_URL`, `TRADING_DEPLOYER`, and `TRADING_FEE_BPS`, then run `bun run deploy:local`.

The script verifies code at the configured core `SecurityPoolFactory`, deploys `TwoWayConstantProductFactory(coreFactory, feeBps)`, deploys `TwoWayConstantProductRouter(factory)`, and records chain ID, inputs, outputs, transaction hashes, compiler settings, and bytecode hashes. The fee is immutable and no economically optimal value is claimed.
