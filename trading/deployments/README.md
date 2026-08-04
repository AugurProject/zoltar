# Deployment manifests

`deploy:local` writes `local.json` here. It records the chain, input core `SecurityPoolFactory`, immutable fee, deployed trading factory and router, compiler settings, bytecode hashes, and transaction hashes. `local.json` is ignored because local addresses are ephemeral.

No public-network address is bundled. The current demo-only UI cannot consume this nested manifest. Use its addresses from a contract console or integration client, and see [UI configuration](../docs/how-to/configure-ui.md) for the future adapter boundary.
