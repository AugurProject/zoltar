# Configuration reference

Environment variables used by local deployment:

| Name | Meaning | Default |
| --- | --- | --- |
| `TRADING_RPC_URL` | JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `TRADING_DEPLOYER` | Unlocked RPC account | First `eth_accounts` entry |
| `ZOLTAR_DEPLOYMENT_MANIFEST` | Existing matching core manifest | Required |
| `TRADING_FEE_BPS` | Immutable AMM fee | `30` |

`deploy:local` writes a nested deployment manifest for scripts and integration environments. Secrets do not belong in manifests or `.env.example`.

The manifest records the canonical factory and router. The router handles entry and liquidity operations as well as approval-free receive-based share exits and complete-set redemptions. The canonical pair supports ERC-2612 permits and deadline-bound direct liquidity removal.

The build writes `core-deployments.json` from the root mainnet and Sepolia deployment manifests and adds each network's default public RPC URL. The live client defaults to the first supported network, computes the trading contracts with the fixed 0.30% trading fee through the core deployment's canonical CREATE2 proxy, and checks each address directly. **Settings** beside the wallet selects another supported network or accepts an optional HTTPS or loopback HTTP RPC override.
