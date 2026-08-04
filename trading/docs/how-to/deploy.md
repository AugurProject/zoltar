# Deploy the trading contracts

Compile first with `bun run compile`. Set `ZOLTAR_DEPLOYMENT_MANIFEST` to a reviewed manifest for the same Anvil chain, optionally set `TRADING_RPC_URL`, `TRADING_DEPLOYER`, and `TRADING_FEE_BPS`, then run `bun run deploy:local`.

The script verifies code at the configured core `SecurityPoolFactory`, deploys `TwoWayConstantProductFactory(coreFactory, feeBps)`, deploys `TwoWayConstantProductRouter(factory)`, and records chain ID, inputs, outputs, transaction hashes, compiler settings, and bytecode hashes. The fee is immutable and no economically optimal value is claimed. No mainnet or Sepolia address is assumed.
