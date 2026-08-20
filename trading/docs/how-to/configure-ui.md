# Configure the standalone UI

The standalone UI has three explicitly separated modes:

- With no mode parameter, the application reads live RPC and wallet state.
- `?demo=1` provides deterministic walletless visual fixtures for browser QA.
- `?simulate=1` boots the shared browser-local TEVM simulator with seeded contracts and balances.

Both walletless modes are labeled as simulations and are not evidence of live chain state. See [Local development](../tutorials/local-development.md) for the commands and URLs.

The build copies the canonical mainnet and Sepolia core factory and deterministic proxy addresses from the root deployment manifests, together with a default public RPC URL for each network. Open the live UI; it derives the fixed-fee trading factory and router addresses with CREATE2 and checks whether both contracts are deployed. Missing contracts open the deployment screen automatically. The UI verifies the RPC chain and core bytecode and lists each deterministic contract's deployment status. Connect a wallet to deploy the factory, then the router. After verifying both contracts, the client opens live trading without saving a separate trading deployment configuration. Use **Settings** beside the wallet to select another supported network or override its RPC URL. A custom RPC must use HTTPS or loopback HTTP and match the selected chain. Browser-led deployment uses a fixed 0.30% trading fee. Trading and trading-pool deployment surfaces present the deployed immutable fee as a percentage.

The live client discovers pools from the canonical `SecurityPoolFactory` in bounded pages, isolates individual market-read failures, and never hard-codes market addresses. The wallet must report the selected network before any submission. Entry, exit, liquidity, settlement, and fork-migration calls are simulated through the actual contracts, rejected after a block change, and simulated again immediately before submission with explicit bounds where the call accepts them.

Serve built assets from the same origin. Production code may connect only to the configured RPC, the wallet provider, and explicit explorer links. Demo and TEVM simulation modes are unmistakably labeled and must never be presented as live state.
