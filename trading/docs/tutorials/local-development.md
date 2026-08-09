# Local development

1. From the repository root, confirm dependencies with `test -d node_modules`. Use the repository’s frozen setup if absent.
2. Run `cd trading && bun install --frozen-lockfile`.
3. Run `bun run compile`. Generated artifacts appear in `artifacts/`, `ts/artifacts/`, and `ui/ts/generated/` and must not be edited.
4. Run `bun run test` and `bun run ui:build`.
5. Start `bun run ui:serve`, then open `http://localhost:12346/?demo=1#/markets`.

For transaction testing, start Anvil and create a complete local Zoltar deployment with an operational binary SecurityPool. Export its manifest path as `ZOLTAR_DEPLOYMENT_MANIFEST` and run `bun run deploy:local`. Then build the live UI with `TRADING_UI_DEPLOYMENT=/absolute/path/to/trading/deployments/local.json bun run ui:build`, serve it, and connect a wallet on the manifest chain. The client discovers canonical pools and pairs, simulates router calls, and can submit entry, exit, and liquidity transactions. [UI configuration](../how-to/configure-ui.md) documents the manifest and revalidation rules. Demo mode remains visual-only.
