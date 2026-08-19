# Local development

1. From the repository root, confirm dependencies with `test -d node_modules`. Use the repository’s frozen setup if absent.
2. Run `cd trading && bun install --frozen-lockfile`.
3. Run `bun run compile`. Generated artifacts appear in `artifacts/`, `ts/artifacts/`, and `ui/ts/generated/` and must not be edited.
4. Run `bun run test` and `bun run ui:build`.
5. Start `bun run ui:serve`, then open `http://localhost:4163/?demo=1#/markets`.

For transaction testing, start Anvil and create a complete local Zoltar deployment with an operational binary SecurityPool. Export its manifest path as `ZOLTAR_DEPLOYMENT_MANIFEST` and run `bun run deploy:local` for script and integration testing. The standalone live UI uses the canonical networks copied from the root deployment manifests; demo mode remains the walletless visual-testing path.
