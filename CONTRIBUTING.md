# Contributing

This repository contains immutable protocol contracts, TypeScript tooling, and the Preact UI. Keep changes scoped, review generated-output side effects explicitly, and prefer the existing contract, UI, and test patterns over new abstractions.

## Local Setup

Use Bun 1.3+ and Foundry Anvil. From a fresh checkout:

```bash
bun install --frozen-lockfile
bun run setup
```

Install Anvil when it is not already available:

```bash
bun run install:anvil
```

## Development Workflow

For contract, shared, or UI changes, start from the TypeScript source and Solidity source. Do not edit generated `js/` trees or generated contract artifacts directly.

Common entrypoints:

- `bun run app:serve` refreshes Solidity artifacts/types, UI contract artifact and ABI copies, shared JavaScript, UI vendor assets, emitted UI JavaScript, and generated UI test JavaScript before serving locally.
- `bun run app:watch` performs the same refresh/build side effects as `app:build`, then starts the watcher.
- `bun run app:build` refreshes Solidity artifacts/types, UI contract artifact and ABI copies, shared JavaScript, UI vendor assets, emitted UI JavaScript, and generated UI test JavaScript.
- `bun run generate` refreshes Solidity artifacts/types, UI contract artifact and ABI copies, shared JavaScript, and UI vendor assets.
- `bun run compile-contracts` refreshes shared JavaScript, Solidity artifacts/types, and the UI contract artifact and ABI copies derived from those artifacts.
- `bun run tsc` type-checks after ensuring generated shared JavaScript is present and current. It can refresh `shared/js` when those outputs are missing or stale, but it does not regenerate contract artifacts, UI vendor assets, emitted UI JavaScript, or generated UI test JavaScript.

## Validation

Pick validation based on the files touched by the change. For broad code changes, a common local sequence is:

```bash
bun run tsc
bun run test
bun run format
bun run check
bun run knip
```

For docs-only changes, TypeScript, tests, and knip are normally out of scope. Run formatting and checks for the changed Markdown/docs paths, plus `git diff --check`.

For release readiness or CI parity, use [docs/release-operator-runbook.md](./docs/release-operator-runbook.md), which includes generated-artifact freshness, production UI build validation, dependency audits, and worktree cleanliness gates.

## Generated Output Policy

Generated build outputs and protocol artifacts are intentionally untracked. Keep these paths out of source review unless the artifact policy is intentionally changed in the same pull request:

- `ui/js`
- `shared/js`
- `ui/vendor`
- `solidity/artifacts`
- `ui/ts/contractArtifact.ts`
- `solidity/ts/types/contractArtifact.ts`

Local generation also refreshes ignored helper copies such as `ui/ts/abis.ts` and `solidity/types/contractArtifact.ts`. They are generated outputs too; do not commit them unless the artifact policy is intentionally expanded.

If a local command refreshes these files, review the tracked diff before committing. Regenerate only when a workflow explicitly needs current generated output or a required check reports a missing generated artifact.

## Pull Request Checklist

- Link the issue, design note, or operator need that motivated the change.
- Summarize behavior changes and any generated-output side effects.
- Note validation commands and skipped checks with scope-based reasons.
- Update [SECURITY.md](./SECURITY.md), [docs/audit-status.md](./docs/audit-status.md), or [docs/release-operator-runbook.md](./docs/release-operator-runbook.md) when the change affects launch posture, disclosure policy, deployment, or release operations.
