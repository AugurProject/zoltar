# Statoblast Test Slices

Run every split statoblast suite from the repository root:

```bash
bun run test:statoblast
```

Run one workflow slice directly from the repository root:

```bash
bun test --timeout 300000 solidity/ts/tests/statoblast/truthAuction/settlementClaims.test.ts
bun test --timeout 300000 solidity/ts/tests/statoblast/forkMigrationVault.test.ts
```

The shared fixture in `fixture.ts` is intentionally exposed through workflow-specific hooks so new tests can import the smallest practical helper surface.
