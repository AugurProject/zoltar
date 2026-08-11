# Deployment manifests

`deploy:local` writes `local.json` here. It records the chain, input core `SecurityPoolFactory`, immutable fee, deployed trading factory and router, compiler settings, bytecode hashes, and transaction hashes. `local.json` is ignored because local addresses are ephemeral.

No public-network address is bundled. Build the live standalone UI with `TRADING_UI_DEPLOYMENT=/absolute/path/to/local.json bun run ui:build`; the build copies the manifest to the untracked UI output, and the live client validates it at startup. The client then discovers canonical pools and pairs, simulates router calls, and submits through the connected wallet. See [UI configuration](../docs/how-to/configure-ui.md) for the complete schema and runtime requirements.
