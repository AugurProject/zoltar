# Configuration reference

Environment variables used by local deployment:

| Name | Meaning | Default |
| --- | --- | --- |
| `TRADING_RPC_URL` | JSON-RPC endpoint | `http://127.0.0.1:8545` |
| `TRADING_DEPLOYER` | Unlocked RPC account | First `eth_accounts` entry |
| `ZOLTAR_DEPLOYMENT_MANIFEST` | Existing matching core manifest | Required |
| `TRADING_FEE_BPS` | Immutable AMM fee | `30` |

The unused future UI parser defines a separate flat JSON schema with numeric `chainId` and `feeBps`, string `chainName` and `rpcUrl`, and addresses `securityPoolFactory`, `factory`, and `router`. The current application does not invoke that parser, and the nested `deploy:local` output is not compatible with it. See [UI configuration](../how-to/configure-ui.md). Secrets do not belong in manifests or `.env.example`.
