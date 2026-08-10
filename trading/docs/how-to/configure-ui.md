# Configure the standalone UI

The standalone UI has two explicitly separated modes. `?demo=1` provides walletless visual fixtures and is always labeled simulated; do not use demo screens as evidence of live chain state. Without that query parameter, the application requires a deployment manifest and reads live RPC and wallet state.

`deploy:local` emits the authoritative nested manifest under `network`, `core`, and `trading`. Copy it into the built application with:

```bash
TRADING_UI_DEPLOYMENT=/absolute/path/to/trading/deployments/local.json bun run ui:build
```

The build copies it as untracked `ui/dist/deployment.json`. The parser also accepts the documented flat schema for deliberate hand-authored configurations. The live client validates required addresses and values, discovers pools from `SecurityPoolFactory` in bounded pages, isolates individual market-read failures, and never hard-codes market addresses. The wallet must report the manifest chain before any submission. Entry, exit, liquidity, settlement, and fork-migration calls are simulated through the actual contracts, rejected after a block change, and simulated again immediately before submission with explicit bounds where the call accepts them.

Serve built assets from the same origin. Production code may connect only to the configured RPC, the wallet provider, and explicit explorer links. Demo mode is unmistakably labeled and must never be presented as live state.
