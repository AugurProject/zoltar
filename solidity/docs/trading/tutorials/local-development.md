# Local development

1. From the repository root, confirm dependencies with `test -d node_modules`. Use the repository’s frozen setup if absent.
2. Run `bun run trading:compile`. The main Solidity artifact, shared JavaScript, and `ui/trading/ts/generated/contractArtifact.ts` are generated and must not be edited.
3. Run `bun run trading:test` and `bun run trading:ui:build`.
5. Start `bun run app:serve:trading`, then open `http://localhost:4163/?simulate=1#/markets` for the shared TEVM simulator or `http://localhost:4163/?demo=1#/markets` for deterministic visual fixtures.

For transaction testing against an external node, start Anvil and create a complete local Zoltar deployment with an operational binary SecurityPool. Export its manifest path as `ZOLTAR_DEPLOYMENT_MANIFEST`, then run `bun run trading:deploy:local` for script and integration testing. The live UI uses the canonical networks copied from the root deployment manifests; `?simulate=1` instead boots the same browser-local TEVM environment used by Zoltar and Statoblast.
