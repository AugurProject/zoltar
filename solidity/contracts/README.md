# Contract architecture

The production contracts keep stable source paths because paths participate in artifact identities, deployment tooling, and documentation links.

- Root contracts own Zoltar universe identity, REP, common token interfaces, and deployment-status primitives.
- `statoblast/` owns SecurityPool settlement, reporting, escalation, migration, auctions, shares, and its public interfaces.
- `trading/` is an optional subsystem. It consumes Statoblast through `statoblast/interfaces`, the shared outcome type, and the already-vendored math library; Statoblast core never depends on Trading.
- `vendor/` and `statoblast/openOracle/` contain pinned upstream or upstream-derived sources with provenance records beside the code.
- `test/` and `trading/test/` contain harnesses and mocks and may never be imported by production contracts.

Run `bun run check:contract-boundaries` after changing imports. Delegate storage-layout and deployment-size compatibility are enforced separately by `bun run check:contract-safety`.

Audit findings and exploit regressions remain close to their owning fixtures under `solidity/ts/tests`, but are also collected by the discoverable `bun run test:security-regressions` suite.
