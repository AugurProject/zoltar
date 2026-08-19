# Configure the standalone UI

The standalone UI has two explicitly separated modes. `?demo=1` provides walletless visual fixtures and is always labeled simulated; do not use demo screens as evidence of live chain state. Without that query parameter, the application reads live RPC and wallet state.

The build copies the canonical mainnet and Sepolia core factory and deterministic proxy addresses from the root deployment manifests, together with a default public RPC URL for each network. When no complete trading deployment is bundled or saved, open the live UI; it automatically selects the canonical deployment and its default RPC. The UI verifies the RPC chain and core bytecode automatically, and lists the deterministic trading factory and router with per-contract deployment status. Connect a wallet to deploy the factory, then the router. After verifying both contracts, the browser saves the completed configuration locally and opens live trading. Use **Settings** beside the wallet to select another supported network or override its RPC URL. A custom RPC must use HTTPS or loopback HTTP and match the selected chain. Browser-led deployment uses a fixed 0.30% trading fee. Trading and trading-pool deployment surfaces present the deployed immutable fee as a percentage.

For an existing local or reviewed trading deployment, `deploy:local` emits the authoritative nested manifest under `network`, `core`, and `trading`. Copy it into the built application with:

```bash
TRADING_UI_DEPLOYMENT=/absolute/path/to/trading/deployments/local.json bun run ui:build
```

The build copies it as untracked `ui/dist/deployment.json`, which takes precedence over browser-saved configuration. The parser also accepts the documented flat schema for deliberate hand-authored configurations. The live client validates required addresses and values, discovers pools from `SecurityPoolFactory` in bounded pages, isolates individual market-read failures, and never hard-codes market addresses. The wallet must report the configured chain before any submission. Entry, exit, liquidity, settlement, and fork-migration calls are simulated through the actual contracts, rejected after a block change, and simulated again immediately before submission with explicit bounds where the call accepts them.

Serve built assets from the same origin. Production code may connect only to the configured RPC, the wallet provider, and explicit explorer links. Demo mode is unmistakably labeled and must never be presented as live state.
