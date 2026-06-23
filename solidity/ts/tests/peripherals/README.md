# Peripherals Test Slices

Run every split peripheral suite:

```bash
bun run test:peripherals
```

Run one workflow slice directly:

```bash
bun test --timeout 300000 solidity/ts/tests/peripherals/truthAuction.test.ts
bun test --timeout 300000 solidity/ts/tests/peripherals/forkMigration.test.ts
```

The shared fixture in `fixture.ts` is intentionally exposed through workflow-specific hooks so new tests can import the smallest practical helper surface.
