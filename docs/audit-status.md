# Audit Status

No completed third-party audit report is tracked in this repository. Treat the protocol as unaudited until this page links to a completed report and records the reviewed commit, scope, and unresolved findings.

## Current Assurance Sources

- CI runs formatting, generated-artifact freshness checks, TypeScript type checking, production UI build validation, tests, Biome/custom lint checks, dead-code analysis, and dependency audits.
- The launch invariant test target is `bun run test:launch-invariants`.
- Mainnet deployment address expectations are tracked in [mainnet-deployment-addresses.md](./mainnet-deployment-addresses.md) and [mainnet-deployment-addresses.json](./mainnet-deployment-addresses.json).
- Operator guardrails are tracked in [operator-reference.md](./operator-reference.md).
- Release steps are tracked in [release-operator-runbook.md](./release-operator-runbook.md).

## Required Audit Record

Before any release note, README, website, or operator communication describes the protocol as audited, update this page with:

- auditor name and report link
- reviewed commit and tag
- reviewed contract and UI scope
- final report date
- finding summary by severity
- unresolved findings and accepted risks
- any code, configuration, or documentation changes made after the reviewed commit

## Disclosure and Bug Bounty

Security disclosure policy and bug bounty status are tracked in [../SECURITY.md](../SECURITY.md).
