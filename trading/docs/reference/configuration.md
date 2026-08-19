# Configuration reference

Environment variables used by local deployment:

| Name | Meaning | Default |
| --- | --- | --- |
| `TRADING_RPC_URL` | JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `TRADING_DEPLOYER` | Unlocked RPC account | First `eth_accounts` entry |
| `ZOLTAR_DEPLOYMENT_MANIFEST` | Existing matching core manifest | Required |
| `TRADING_FEE_BPS` | Immutable AMM fee | `30` |

The live UI directly accepts the nested `deploy:local` manifest. It also accepts a flat JSON schema with numeric `chainId` and `feeBps`, string `chainName` and `rpcUrl`, and addresses `securityPoolFactory`, `factory`, and `router`. Set `TRADING_UI_DEPLOYMENT` while building to copy a reviewed manifest to untracked `ui/dist/deployment.json`; see [UI configuration](../how-to/configure-ui.md). Secrets do not belong in manifests or `.env.example`.

Without `TRADING_UI_DEPLOYMENT`, the build writes `deployment.json` as `null` and writes `core-deployments.json` from the root mainnet and Sepolia deployment manifests, adding each network's default public RPC URL. The live setup screen defaults to a supported network and its default RPC; **Settings** beside the wallet selects another supported network or accepts an optional HTTPS or loopback HTTP RPC override. It computes the trading factory and router with the fixed 0.30% trading fee through the core deployment's canonical CREATE2 proxy, shows each contract's deployment status, verifies or deploys each contract through the wallet, and stores the completed configuration under `zoltar.trading.deployment.v1` in browser local storage.
