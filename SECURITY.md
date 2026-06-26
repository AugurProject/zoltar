# Security Policy

## Supported Scope

The active security scope is the current `main` branch and any tagged release intended for production use. Security-sensitive areas include Solidity contracts, deterministic deployment tooling, generated artifact policy, release workflows, UI transaction construction, RPC/read behavior, simulation boundaries, and documentation that operators rely on during launch or incident response.

## Reporting a Vulnerability

Do not open a public issue with vulnerability details. Report privately through GitHub Security Advisories for this repository when available, or contact the repository maintainers privately through the AugurProject GitHub organization. If neither private channel is available, open a public issue titled `Security contact request` that contains no vulnerability details and asks maintainers to establish a private reporting channel.

Include:

- affected commit, tag, contract address, or UI release hash when known
- impact and attacker capability
- reproduction steps or proof-of-concept details
- suggested fix or mitigation when available
- whether the report has been shared with anyone else

Maintainers should acknowledge credible reports promptly, keep the reporter informed while triage is active, and publish public details only after a fix or operational mitigation is available.

## Disclosure Policy

Coordinated disclosure is expected. Public disclosure should wait until maintainers have had a reasonable opportunity to validate impact, prepare a fix or mitigation, and notify users or operators. For immutable contract deployments, the response may be documentation, UI routing, user warnings, or a migration/redeployment plan rather than an on-chain pause or upgrade.

## Bug Bounty Status

No standing paid bug bounty is documented in this repository. Maintainers may still accept responsible reports under the disclosure process above. Add bounty scope, reward ranges, eligibility rules, and safe-harbor language here before advertising any paid bounty.

## Audit Status

Current audit status is tracked in [docs/audit-status.md](./docs/audit-status.md). Do not describe the protocol as audited unless that file links to the completed report and identifies the reviewed commit, scope, and unresolved findings.
