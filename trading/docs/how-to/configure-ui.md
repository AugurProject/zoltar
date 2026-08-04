# Configure the standalone UI

The checked-in UI currently provides walletless visual fixtures through `?demo=1`; it does not yet load RPC state or submit wallet transactions. Do not use its screens as evidence of a live deployment.

`deploy:local` emits the authoritative nested manifest under `network`, `core`, and `trading`. The unused client configuration parser currently expects a separate flat document with `chainId`, `chainName`, `rpcUrl`, `securityPoolFactory`, `factory`, `router`, and `feeBps`; the deployment manifest is not directly consumable by the UI. A future live adapter must validate that every address belongs to the declared chain, discover pools and pairs rather than hard-coding them, simulate the actual router call, and revalidate immediately before wallet submission.

Serve built assets from the same origin. Production code may connect only to the configured RPC, the wallet provider, and explicit explorer links. Demo mode is unmistakably labeled and must never be presented as live state.
