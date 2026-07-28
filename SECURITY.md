# Security and Release Readiness

Zoltar and Statoblast are immutable protocol contracts. A successful source
review is necessary but is not deployment approval. Releases must use the exact
reviewed source, pass executable security properties, and publish verifiable
provenance.

## Release security gate

Set `ZOLTAR_AUDITED_COMMIT` to the full commit SHA covered by the final
independent audit, then run the release gate from a clean checkout:

```bash
bun install --frozen-lockfile
(cd ui && bun install --frozen-lockfile)
(cd solidity && bun install --frozen-lockfile)
ZOLTAR_AUDITED_COMMIT=<full-40-character-sha> bun run security:release-gate
```

The gate fails unless `HEAD` exactly matches the audited commit and the tracked,
staged, unstaged, and untracked worktree is clean. It then regenerates and
checks artifacts, typechecks, runs the full test suite, runs repository and
dead-code checks, and audits all three dependency lockfiles.

## Ten release controls

1. **Exact audit target:** Record the full audited commit in the release record.
   Never approve a branch name, abbreviated SHA, or worktree containing local
   changes.
2. **Reproducible build:** Install all three Bun workspaces from their lockfiles.
   The release gate compiles the contracts and rejects stale generated
   artifacts.
3. **Fork conservation:** Keep the model-backed lifecycle and fork-migration
   tests in `test:launch-invariants`. They reconcile REP, escrow, pool
   collateral, child state, and migration balances across partial migrations.
4. **Escalation exclusivity:** Keep direct-claim, aggregate entitlement,
   continuation, late-child, and recursive-fork tests in the launch suite. Any
   source deposit must remain single-use within each intended branch.
5. **Adversarial auctions:** Exercise settlement order, underfunding, rounding,
   failed ETH pushes, deferred refunds, reentrancy, and double-claim rejection.
6. **No premature capacity:** Preserve tests proving that unclaimed
   truth-auction allowance cannot secure open interest or earn fees before it is
   assigned to a vault.
7. **Oracle exposure:** Treat uncapped aggregate notional and paid report
   sponsorship as explicit launch risks. Before deployment, governance and the
   independent auditors must approve operational exposure assumptions or
   require contract-level caps in a newly audited commit.
8. **Staged-operation invalidation:** Exercise allowance, ownership, lifecycle,
   expiry, report, and liquidation mutations between staging and execution.
9. **Deployment integrity:** Preserve delegate storage-layout tests and verify
   deterministic addresses, constructor wiring, runtime bytecode, and the
   published deployment manifest for the audited commit. The release gate
   strictly rejects a stale manifest without rewriting it.
10. **Independent launch review:** Obtain an independent audit of the exact
    release commit, resolve its findings, rerun this gate, publish known
    limitations, fund a bug bounty, and prepare monitoring and incident
    communications before an initially capped launch.

Steps 7 and 10 require an explicit human security decision and external
coordination. Step 9 automates source, layout, generated-address, and manifest
freshness checks, but verifying constructor wiring and runtime bytecode at the
actual deployed addresses remains a human release task. Automation
intentionally cannot mark those external obligations complete.

## Vulnerability reports

Do not disclose an unpatched vulnerability in a public issue. Contact the
maintainers privately through the security-reporting channel published for the
release. Include the affected commit, contracts, prerequisites, impact, and the
smallest reproducible sequence available.
