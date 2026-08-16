# Deployment manifests

`deploy:local` writes `local.json` here. It records the chain, input core `SecurityPoolFactory`, immutable fee, deployed trading factory and router, compiler settings, bytecode hashes, and transaction hashes. `local.json` is ignored because local addresses are ephemeral.

No completed public trading deployment manifest is bundled. The default build includes planned mainnet and Sepolia core addresses from the root manifests, then lets the wallet deploy and verify the trading factory and router when that core code is installed. To use an existing trading manifest instead, build with `TRADING_UI_DEPLOYMENT=/absolute/path/to/local.json bun run ui:build`; the build copies it to the untracked UI output, and the live client validates it at startup. See [Deploy the trading contracts](../docs/how-to/deploy.md) for the wallet path and [UI configuration](../docs/how-to/configure-ui.md) for the complete schema and runtime requirements.
