# Configuration reference

Environment variables used by local deployment:

| Name | Meaning | Default |
| --- | --- | --- |
| `TRADING_RPC_URL` | JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `TRADING_DEPLOYER` | Unlocked RPC account | First `eth_accounts` entry |
| `ZOLTAR_DEPLOYMENT_MANIFEST` | Existing matching core manifest | Required |
| `TRADING_FEE_BPS` | Immutable AMM fee | `30` |

`deploy:local` writes a nested deployment manifest for scripts and integration environments. Secrets do not belong in manifests or `.env.example`.

New deployments use Trading version 2. Their manifest records the V2 factory, a legacy-compatible execution router, and a separate approval-free receive router. Keeping both router addresses explicit preserves entry, liquidity, and legacy approval paths while capability-gating receive-based share operations. Version 1 manifests remain valid and omit `receiveRouter`; clients must not infer V2 support from an arbitrary successful call.

The build writes `core-deployments.json` from the root mainnet and Sepolia deployment manifests and adds each network's default public RPC URL. The live client defaults to the first supported network, computes every selected-version trading contract with the fixed 0.30% trading fee through the core deployment's canonical CREATE2 proxy, and checks each address directly. **Settings** beside the wallet selects another supported network or accepts an optional HTTPS or loopback HTTP RPC override. V1 and V2 use different factory init code and therefore remain independently predictable venues.
