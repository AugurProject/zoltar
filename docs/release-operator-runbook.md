# Release and Operator Runbook

This runbook covers release preparation and operator-facing checks for Zoltar and Placeholder. It does not assume contracts can be paused, upgraded, rolled back, or disabled after deployment; publish verifiable provenance instead.

## Release Inputs

Collect these inputs before tagging a release:

- final commit SHA and planned `v*` tag
- deterministic deployment address diff, if contracts or deployment config changed
- validation command results
- production UI artifact hash after the IPFS workflow completes
- audit status from [audit-status.md](./audit-status.md)
- known limitations and operator notes

## Pre-Release Validation

From a fresh dependency install, run:

```bash
bun install --frozen-lockfile
(cd ui && bun install --frozen-lockfile)
(cd solidity && bun install --frozen-lockfile)
bun run check:generated-clean
bun run format
git diff --exit-code -- .
git diff --check
bun run tsc
bun run ui:build:prod:optimized
bun run test:run -- --bail=1
bun run check
bun run knip
bun audit && (cd ui && bun audit) && (cd solidity && bun audit)
```

Run `bun run test:launch-invariants` for launch-candidate protocol releases and record the result in the release notes.

## Generated Artifact Review

Generated build outputs and protocol artifacts are intentionally untracked. `bun run check:generated-clean` is the release freshness check; do not commit regenerated outputs unless the generated artifact policy is changed in the same release.

Expected generated-output side effects:

- `bun run setup` installs dependencies and refreshes Solidity artifacts/types, UI contract artifact and ABI copies, shared JavaScript, UI vendor assets, emitted UI JavaScript, and generated UI test JavaScript.
- `bun run generate` refreshes Solidity artifacts/types, UI contract artifact and ABI copies, shared JavaScript, and UI vendor assets.
- `bun run compile-contracts` refreshes shared JavaScript, Solidity artifacts/types, and the UI contract artifact and ABI copies derived from those artifacts.
- `bun run tsc` may refresh shared JavaScript through its shared-build preflight, then type-checks. It does not refresh contract artifacts, UI vendor assets, emitted UI JavaScript, or generated UI test JavaScript.

## Deployment Address Review

When Solidity contracts, deployment config, or deterministic address derivation changes:

1. Run `bun run check:mainnet-deployment`.
2. Review [mainnet-deployment-addresses.json](./mainnet-deployment-addresses.json) and [mainnet-deployment-addresses.md](./mainnet-deployment-addresses.md).
3. Explain expected address changes in the release notes.
4. If an address changes unexpectedly, stop the release until the derivation, artifact, or config change is understood.

## Tagging and Publishing

1. Confirm CI Gate is green on the final commit.
2. Push the `v*` tag from that final commit.
3. Wait for the `Build and Push to IPFS` workflow.
4. Record the IPFS hash from the GitHub release created by the workflow.
5. Confirm the published release body links to the expected IPFS gateways.
6. Publish release notes with the final commit, tag, validation summary, deterministic address status, IPFS hash, audit status, and known limitations.

## Operator Checks

Before directing users to a production UI:

- Verify the UI release hash matches the GitHub release.
- Verify the UI points at expected mainnet deployment addresses.
- Confirm `?simulate=1` is described as a browser-local sandbox only.
- Confirm quote-dependent flows block or degrade when live RPC data or Uniswap liquidity is unavailable.
- Review [operator-reference.md](./operator-reference.md), [auction-design.md](./auction-design.md), and [escalation-game-architecture.md](./escalation-game-architecture.md) for any changed operational assumptions.

## Incident Response Notes

For immutable deployments, do not document UI changes as contract-level emergency controls. Use public advisories, release notes, verified UI updates, warnings, or migration/redeployment plans as appropriate. Follow [../SECURITY.md](../SECURITY.md) for private intake and coordinated disclosure.
