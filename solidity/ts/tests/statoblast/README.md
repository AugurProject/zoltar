# Statoblast Test Slices

Run every split statoblast suite from the repository root:

```bash
bun run test:statoblast
```

Run one workflow slice directly from the repository root:

```bash
bun test --timeout 300000 solidity/ts/tests/statoblast/securityPoolPortfolioCollateralRepairAuction.test.ts
bun test --timeout 300000 solidity/ts/tests/statoblast/forkMigrationVault.test.ts
```

The shared fixtures (`portfolioProtocolFixture.ts`, `securityPoolPortfolioFixture.ts`, and the workflow-specific `*Fixture.ts` files beside them) are intentionally exposed through workflow-specific hooks so new tests can import the smallest practical helper surface.
