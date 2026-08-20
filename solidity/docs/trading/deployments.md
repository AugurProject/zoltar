# Deployment manifests

`deploy:local` writes `local.json` here. It records the chain, input core `SecurityPoolFactory`, immutable fee, deployed trading factory and router, compiler settings, bytecode hashes, and transaction hashes. `local.json` is ignored because local addresses are ephemeral.

No completed public trading deployment manifest is bundled or required by the client. The build includes mainnet and Sepolia core addresses from the root manifests. At startup, the client derives the fixed-fee trading factory and router through the canonical CREATE2 proxy and checks their code directly. If either contract is missing, it lets the connected wallet deploy and verify it. See [Deploy the trading contracts](../docs/how-to/deploy.md) for the wallet flow and [UI configuration](../docs/how-to/configure-ui.md) for network and RPC behavior.
