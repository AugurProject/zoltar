# Zoltar Protocol Security Audit Instructions

This document is the audit brief for an independent security review of this repository. It is intentionally written for auditors who have not worked on the project before. The expected output is a written report with severity-ranked findings, exploit narratives, proof-of-concept tests where practical, and concrete remediation guidance.

## Objective

Audit the Solidity protocol for correctness, economic safety, and adversarial robustness before any production deployment or mainnet custody of value.

The test suite is not a substitute for this review. Auditors should treat all value-moving paths as in scope even when currently covered by tests, and should actively search for attacks that compose multiple protocol modules.

Because migration, redemption, auction settlement, oracle callbacks, and escalation claims are required user-exit paths, liveness failures in these flows should be treated as fund-safety issues, not merely availability issues.

## Audit Target

Before beginning the review, record the exact target being audited:

- Git commit hash and branch name.
- Intended deployment network and chain ID.
- Solidity compiler version, optimizer settings, and EVM version from the active compile configuration.
- Deployment configuration and production constants, including `solidity/default-config.json`, `solidity/contracts/Constants.sol`, and any deployment-time constructor parameters.
- Expected production addresses for external dependencies such as genesis REP, WETH, OpenOracle, Multicall, and deployment/status helpers.
- Any known feature flags, disabled flows, simulation-only settings, or test-only assumptions that must not be treated as production behavior.

Findings should identify whether they apply to the reviewed commit only, to deployment configuration, or to the protocol design independent of configuration.

Configuration sanity checks should include:

- Fork threshold divisor, fork burn divisor, genesis REP address, and burn-address assumptions.
- Security multiplier, initial escalation-game deposit, retention-rate initialization, and fee-accounting parameters.
- Auction duration, raise cap, REP sale cap, minimum bid behavior, and underfunded-auction behavior.
- Escalation activation delay, timeout length, non-decision threshold, start bond, reward-window behavior, and fork-continuation elapsed-time rules.
- Oracle settlement time, dispute delay, price-validity window, gas/bounty constants, protocol fees, WETH address, OpenOracle address, and callback gas assumptions.
- Factory/deployer salts, deterministic addresses, deployment-status oracle wiring, and constructor argument consistency across parent and child deployments.

## Repository Overview

The repository contains two protocol layers:

- `Zoltar`: a forkable oracle and REP migration base layer.
- Security pool layer: prediction-market collateral, vault, auction, liquidation, and fork-migration contracts built on top of Zoltar.

Relevant directories:

- `solidity/contracts/`: production Solidity contracts.
- `solidity/contracts/peripherals/`: security pools, auctions, forking, oracle coordination, share tokens, factories, and migration helpers.
- `solidity/contracts/peripherals/openOracle/`: vendored OpenOracle/OpenZeppelin dependencies used by the protocol.
- `solidity/contracts/test/`: Solidity test harnesses and mocks only.
- `solidity/ts/tests/`: TypeScript/Bun integration and protocol tests.
- `solidity/ts/compile.ts` and deployment/test utilities: build, ABI, deployment, and generated artifact support.
- `docs/`: protocol whitepaper material.

Generated artifacts are intentionally untracked and should not be manually edited:

- `solidity/artifacts/`
- `solidity/ts/types/contractArtifact.ts`
- `ui/ts/contractArtifact.ts`
- `ui/js/`
- `shared/js/`

## Setup And Validation Commands

Use the same toolchain as the repository:

```bash
bun install --frozen-lockfile
bun run setup
bun run tsc
bun run test
```

If tests require Anvil and `anvil` is unavailable:

```bash
bun run install:anvil
```

Auditors are encouraged to add focused tests or fuzz/invariant harnesses. Do not rely only on the existing tests.

Repository validation before handoff should also pass:

```bash
bun run format
bun run check
bun run knip
```

## Specification Review

Auditors should compare implemented behavior against the intended behavior described in:

- `docs/whitepaper_zoltar.html`
- `docs/whitepaper_placeholder.html`
- `README.md`
- Solidity comments that describe intended protocol behavior
- Existing tests that encode expected edge cases

Report any mismatch between implementation, documentation, and tests even if the implementation is internally consistent. A spec mismatch should be classified by the security or economic impact of the behavior that would occur in production.

## Audit Scope

### Primary In-Scope Contracts

Base layer:

- `solidity/contracts/Zoltar.sol`
- `solidity/contracts/ZoltarQuestionData.sol`
- `solidity/contracts/ReputationToken.sol`
- `solidity/contracts/ERC20.sol`
- `solidity/contracts/SafeERC20Ops.sol`
- `solidity/contracts/ScalarOutcomes.sol`
- `solidity/contracts/Constants.sol`
- `solidity/contracts/DeploymentStatusOracle.sol`

Security pool and market layer:

- `solidity/contracts/peripherals/SecurityPool.sol`
- `solidity/contracts/peripherals/SecurityPoolForker.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerStorage.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol`
- `solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol`
- `solidity/contracts/peripherals/EscalationGame.sol`
- `solidity/contracts/peripherals/EscalationGameForker.sol`
- `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol`
- `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol`
- `solidity/contracts/peripherals/SecurityPoolUtils.sol`
- `solidity/contracts/peripherals/MerkleMountainRange.sol`
- `solidity/contracts/peripherals/tokens/ShareToken.sol`
- `solidity/contracts/peripherals/tokens/ERC1155.sol`
- `solidity/contracts/peripherals/tokens/TokenId.sol`
- `solidity/contracts/peripherals/factories/*.sol`
- `solidity/contracts/peripherals/interfaces/*.sol`

Protocol dependencies and adapters:

- `solidity/contracts/peripherals/openOracle/OpenOracle.sol`
- OpenZeppelin files vendored under `solidity/contracts/peripherals/openOracle/openzeppelin/`
- `solidity/contracts/peripherals/WETH9.sol`
- `solidity/contracts/peripherals/Multicall3.sol`

Deployment and build-support review:

- `solidity/default-config.json`
- `solidity/ts/compile.ts`
- `solidity/ts/abi/abis.ts`
- Deployment helpers under `solidity/ts/testsuite/simulator/utils/contracts/`
- Root scripts that generate or verify contract artifacts.

### Out Of Scope Unless It Affects Solidity Safety

- UI rendering and frontend usability.
- Generated JavaScript output.
- Documentation-only files, except where they reveal intended protocol behavior or invariants.
- Test harnesses and mocks, except when they mask missing production checks or incorrect assumptions.

## Expected Threat Model

Assume adversaries can:

- Call any public or external function in arbitrary order.
- Front-run, back-run, sandwich, grief, and time transactions around auctions, oracle reports, forks, and withdrawals.
- Use contracts with custom fallback/receive behavior.
- Submit malicious ERC20/ERC1155 receivers or non-standard token behavior where the protocol accepts external tokens.
- Trigger callbacks through the OpenOracle flow.
- Force protocol state transitions at unfavorable moments.
- Split actions across many addresses and many vaults.
- Leave dust balances, partial bids, partial migrations, and unresolved escalation deposits.
- Use stale or manipulated oracle prices if protocol validation permits it.
- Exploit gas limits, unbounded iteration, pagination errors, and storage growth.
- Interact with child universes and fork-migration paths before, during, and after parent pool transitions.

## Trust Assumptions

The intended production system should not depend on any trusted actor after deployment. Do not assume honest keepers, honest bidders, honest vault owners, honest reporters, honest deployers, or synchronized offchain services.

Auditors should verify that:

- No owner, deployer, factory, keeper, or offchain service can unilaterally seize funds, mint value, block exits, choose outcomes, bypass fork rules, or rewrite accounting.
- Contracts with privileged-looking roles, such as factories, auction owners, migration delegates, oracle callbacks, and deployment helpers, are either immutable protocol components with constrained authority or are unsafe.
- OpenOracle, WETH, genesis REP, Multicall, and other external dependencies are not trusted for behavior beyond the exact interface and deployment assumptions documented for production.
- The protocol remains safe if keepers stop operating, bidders behave maliciously, vault owners grief each other, reporters choose adversarial prices within allowed oracle mechanics, or external calls revert.

## High-Value Assets And Trust Boundaries

Assets at risk:

- REP and child-universe REP.
- ETH collateral backing complete sets.
- ETH fees owed to vaults.
- ETH bid funds in truth auctions.
- Share tokens and vault ownership accounting.
- Escalation-game REP deposits and carried deposits.

Trust boundaries:

- Zoltar versus SecurityPool and forker modules.
- Parent universes versus child universes.
- Migration proxy versus direct user migration.
- SecurityPool versus OpenOracle callback flow.
- Auction owner/forker versus bidders.
- ERC20, ERC1155, WETH, and ETH transfer boundaries.
- Factory-created contracts versus manually constructed or spoofed contracts.

## Critical Path Review Order

Prioritize manual review in this order before broadening to lower-risk surfaces:

1. REP custody, burn/mint authority, fork accounting, and user migration in `Zoltar`.
2. SecurityPool ETH, REP, vault, fee, allowance, liquidation, and share accounting.
3. SecurityPoolForker, migration proxy, delegatecall, child-pool deployment, and fork migration paths.
4. EscalationGame deposits, carried deposits, fork continuation, MMR proofs, and nullifiers.
5. Truth auction clearing, settlement, refunds, underfunded behavior, and forker integration.
6. Oracle coordinator callback authentication, stale-price handling, and staged liquidation/withdrawal execution.
7. Token transfer boundaries, initialization, access control, deployment wiring, and gas/liveness issues.

## Protocol Workflows To Trace

Auditors should trace complete cross-contract workflows, not only individual contract functions. At minimum, trace:

- Question creation, ID derivation, outcome validation, and market/security-pool creation.
- Vault lifecycle: REP deposit, ownership minting, fee-index initialization, security bond allowance changes, complete-set minting, fee accrual, REP withdrawal, fee redemption, and vault removal from active lists.
- Market lifecycle without a fork: question end, reporting/escalation, final outcome determination, share redemption, escalation deposit settlement, and REP redemption.
- Oracle-staged operations: price request, OpenOracle report creation, dispute/settlement assumptions, callback, pending-slot execution, manual staged operation execution, expiry, and failed-operation cleanup.
- Liquidation lifecycle: undercollateralized vault snapshot, oracle price update, debt/REP movement, allowance changes, and follow-up redemption or withdrawal.
- Zoltar fork lifecycle: question end, `forkUniverse`, fork-threshold burn, migration-balance creation, child universe deployment, REP split/migration, and theoretical-supply updates.
- SecurityPool fork lifecycle: parent pool freeze, fork data snapshot, migration proxy deployment, unlocked vault migration, unresolved escalation migration, child pool deployment, truth-auction transition, child-pool operational transition, and parent/child redemption paths.
- Escalation lifecycle across forks: local deposits, carried deposits, forked escrow export, MMR snapshot initialization, nullifier consumption, inherited proof claims, residual sweep, and payout ordering.
- Truth auction lifecycle: start, bid submission, pre-finalization losing-bid refunds, finalization, underfunded settlement, post-finalization bid withdrawal, auction-proceeds claim, and child-pool allowance credit.
- Multi-fork scenarios where the system has already forked more than once from different states, including:
  - A child universe or child security pool forks again while operational.
  - A fork occurs while a parent pool has an unresolved escalation game.
  - A fork occurs after escalation has resolved but before all deposits, shares, or REP have been redeemed.
  - A fork occurs during or after a truth auction but before all auction proceeds and refunds are claimed.
  - A fork occurs while oracle-staged operations are pending, expired, or awaiting manual execution.
  - A fork occurs after partial vault migration, partial unresolved escalation migration, or partial child-pool initialization.
  - Independent external forks affect pools sharing Zoltar universes but different questions, vaults, or escalation states.

## Required Review Areas

### 1. Zoltar Fork And REP Migration

Review `Zoltar.sol`, `ReputationToken.sol`, and `ZoltarQuestionData.sol`.

Focus on:

- `forkUniverse`, `deployChild`, `addRepToMigrationBalance`, and `splitMigrationRep` preserve intended REP supply and migration accounting.
- Child universe IDs remain collision-resistant under `uint248` truncation and cannot overwrite or confuse existing state.
- `migrationRepBalances` and `childMigrationRepAmounts` cannot duplicate, over-mint, or misattribute REP.
- Users cannot migrate more REP than they burned or mint into unintended child universes.
- Malformed answer handling is complete for binary, scalar, and categorical questions.
- Forking any ended question in any universe is intentional and economically safe.
- Genesis REP special handling via transfer-to-burn-address matches the intended custody and supply assumptions.
- Theoretical supply snapshots and fork burn divisor logic cannot underflow, round unexpectedly, or bias outcomes.
- Permissionless child deployment does not enable griefing or permanent bad state.

Key invariants:

- Non-genesis REP can only be minted and burned by Zoltar.
- A child universe cannot be deployed twice for the same parent/outcome.
- Fork migration must not create spendable parent REP and child REP from the same burned REP beyond the protocol's explicitly intended split semantics.
- Theoretical supply must remain consistent with burn, mint, fork, and migration rules.

### 2. Security Pool Accounting

Review `SecurityPool.sol`, `SecurityPoolUtils.sol`, factories, and share token integration.

Focus on:

- ETH accounting across `completeSetCollateralAmount`, `totalFeesOwedToVaults`, vault unpaid fees, redeemable shares, and raw contract balance.
- REP accounting across deposits, withdrawals, bond allowance, liquidations, escrowed escalation-game REP, and fork migration.
- Rounding direction and cumulative rounding loss in fee accrual, retention-rate updates, share redemption, liquidation, and pool-ownership calculations.
- No path can make a vault undercollateralized without liquidation, over-withdraw fees, or redeem more ETH/REP than owned.
- State transitions around `Operational`, `ForkMigration`, `TruthAuction`, and `PoolForked` are complete and irreversible where intended.
- `isOperational` correctly freezes parent pools after Zoltar forks.
- Parent and child pool initial parameters are set once and cannot be spoofed.
- Active-vault linked-list pagination remains correct under deposit, withdrawal, liquidation, and migration edge cases.
- `receive`/ETH transfer flows cannot desynchronize internal collateral accounting from actual ETH balance.

Key invariants:

- `completeSetCollateralAmount + protocol/accounted fees` must never exceed actual ETH available for those claims.
- Sum of vault ownership claims must not exceed `poolOwnershipDenominator`.
- Sum of security bond allowances must match `totalSecurityBondAllowance`.
- Vault fee claims must be monotonic and cannot be double-counted.
- Pool state transitions must not allow old-state functions to execute after a fork, auction, or resolution boundary.

### 3. Escalation Game And Fork Continuation

Review `EscalationGame.sol`, `EscalationGameForker.sol`, `MerkleMountainRange.sol`, and all forked escalation migration paths.

Focus on:

- Deposit ordering, payout ordering, cumulative amounts, and partial withdrawal logic.
- `start`, `startFromFork`, activation timing, elapsed-at-fork accounting, and continuation after fork.
- Winning outcome determination, non-decision threshold behavior, and edge cases at exact thresholds.
- Merkle Mountain Range proof verification and nullifier consumption.
- Carried deposits cannot be claimed twice across parent/child games or local/inherited proof paths.
- Unresolved local deposit export and forked escrow export preserve REP and ownership accurately.
- Forked child escalation games cannot be initialized with inconsistent snapshots or resolution balances.
- `MAX_UNRESOLVED_EXPORT_REFS`, `NULLIFIER_DEPTH`, and peak limits cannot be used for griefing or denial of service.
- Residual REP sweep behavior cannot steal or strand funds.

Key invariants:

- A deposit, carried deposit, or forked escrow claim can be consumed at most once.
- Total REP escrowed, unresolved, carried, claimed, swept, and returned must reconcile at every transition.
- Fork continuation must preserve elapsed time and payout order from the parent game.
- Child games must not accept incompatible inherited snapshots.

### 4. Truth Auction

Review `UniformPriceDualCapBatchAuction.sol` and its integration through `SecurityPoolForker.sol`.

Focus on:

- AVL tree insertion, deletion, rotation, subtree accounting, and clearing-price search.
- Boundary ticks, zero/near-zero prices, max tick/min tick behavior, and precision loss.
- Underfunded versus cap-hit finalization paths.
- Partial fill logic at clearing tick.
- Bid refunds before finalization and withdrawals after finalization.
- `claimed` and refunded-prefix accounting prevent double refunds or double fills.
- Any auction-owner authority is held only by immutable protocol contracts and cannot custody, misattribute, delay, or grief bidder/vault claims.
- ETH sends during `finalize` and `withdrawBids` cannot reenter or block auction settlement.
- Large numbers of bids or ticks cannot make finalization, refunds, or withdrawals impractical.

Key invariants:

- ETH sent into the auction is either raised by the authorized protocol auction recipient or refunded to bidders.
- REP purchased by bidders must not exceed `maxRepBeingSold`.
- A bid cannot be both refunded and filled.
- Clearing calculation must be deterministic and independent of bid insertion order except where explicitly intended.

### 5. Oracle Coordinator And Price-Staged Operations

Review `SecurityPoolOracleCoordinator.sol` and OpenOracle callback integration.

Focus on:

- `requestPrice`, `openOracleCallback`, `requestPriceIfNeededAndStageOperation`, and `executeStagedOperation`.
- Only authentic OpenOracle reports can update price.
- `pendingReportId`, `pendingOperationSlotId`, and active operation tracking cannot be wedged or overwritten.
- Stale prices cannot authorize liquidation, REP withdrawal, or bond allowance changes.
- Queued operations snapshot target vault state and reject expired or manipulated operations.
- The one-hour price validity window is safe for all staged operations.
- Callback-driven execution cannot reenter SecurityPool functions in unsafe order.
- Bounty/refund ETH calculations cannot be griefed through basefee changes or callback failure.

Key invariants:

- A staged operation can execute at most once.
- Liquidation pricing must use the intended snapshot and price.
- A failed staged operation must not leave active-operation metadata inconsistent.
- Oracle callbacks must not allow arbitrary callers or stale report IDs to mutate protocol state.

### 6. SecurityPool Forker And Migration Proxy

Review `SecurityPoolForker.sol`, `SecurityPoolForkerVaultMigrationBase.sol`, `SecurityPoolForkerVaultMigrationDelegate.sol`, `SecurityPoolMigrationProxy.sol`, and `EscalationGameForker.sol`.

Focus on:

- Parent-pool fork preparation can run only in valid state.
- Own-fork versus external-fork accounting.
- Migration proxy CREATE2 address predictability and predeployment assumptions.
- Delegatecall boundaries and storage layout compatibility.
- Child pool deployment and initialization ordering.
- Auctionable REP, migrated REP, vault REP at fork, escalation child REP, and source REP bucket reconciliation.
- Partial migration across many calls cannot be griefed or cause permanently stuck claims.
- Vault migration cannot be front-run, repeated, or credited to the wrong vault/outcome.
- Migration to malformed, non-existent, or late-deployed child universes is blocked.

Key invariants:

- A vault can migrate each fork-relevant balance once and only once.
- Parent pool assets must either remain claimable in parent-specific paths or be credited into exactly one child path.
- Delegatecall code must not corrupt storage or bypass access checks.
- Migration proxy REP approvals and balances must not be usable outside the intended migration flow.

### 7. Token Standards And Transfer Safety

Review ERC20, ERC1155, ShareToken, SafeERC20Ops, WETH9, and all ETH transfers.

Focus on:

- Non-standard ERC20 return values, false returns, missing returns, and reverts.
- ERC1155 receiver callbacks and reentrancy exposure.
- Approval races and infinite approvals.
- Transfers to contracts with reverting fallback functions.
- Consistency between token balances and protocol accounting after failed external calls.
- All value transfers follow checks-effects-interactions or are otherwise protected.

Key invariants:

- External token/ETH callbacks cannot observe or mutate inconsistent protocol state.
- A failed transfer must revert all related accounting changes.
- Share-token balances must stay aligned with complete set creation/redemption semantics.

### 8. Access Control And Initialization

Review constructors, factories, setters, and one-time initialization functions.

Focus on:

- Each contract can only be initialized once.
- Factory-only or owner-only functions cannot be spoofed by arbitrary deployments.
- Immutable constructor arguments are validated.
- Public setters such as coordinator/pool linking are safe before and after deployment.
- Test harness patterns do not accidentally exist in production contracts.
- Hidden governance/admin assumptions or no-upgrade guarantees are documented and enforced.

### 9. Denial Of Service And Gas Bounds

Focus on:

- Unbounded loops over vaults, ticks, bids, carried deposits, child universes, staged operations, or MMR peaks.
- Pagination correctness for all list-style getters.
- State growth attacks that make required settlement, migration, or withdrawal operations too expensive.
- Worst-case auction AVL tree shape and rotation gas.
- Worst-case escalation proof sizes and nullifier depth.
- Protocol-critical functions cannot be permanently blocked by a malicious receiver reverting on ETH.

### 10. Economic And Game-Theoretic Review

Assess whether the protocol rules are incentive-compatible under adversarial timing.

Focus on:

- Fork threshold and fork burn divisor incentives.
- Permissionless child deployment incentives.
- Truth auction price discovery and underfunded outcomes.
- Liquidation incentives and stale-price risk.
- Security bond allowance incentives.
- Escalation-game deposit sizing and non-decision threshold incentives.
- Fee retention and vault reward incentives.
- Any griefing attack where the attacker loses little but forces large losses, stuck funds, or excessive gas for others.

## Suggested Attack Simulations

Auditors should build adversarial tests for at least these scenarios:

- Fork a universe immediately after a question ends, then attempt parent-pool operations in the same block/order window.
- Split migration REP across all valid outcomes, then repeat split/migration with partial balances.
- Deploy child universes before and after migration and verify identical accounting.
- Migrate a security pool with unresolved escalation deposits and then claim carried deposits in both parent and child paths.
- Run an auction with bids at min tick, max tick, clearing tick, and just below/above clearing tick.
- Refund losing bids before finalization, then finalize and withdraw remaining bid positions.
- Queue a liquidation with one price, mutate vault state, settle oracle report, and execute after the price-validity boundary.
- Use a malicious contract as bidder/vault/receiver that reenters on ETH or token callbacks.
- Create many vaults, bids, active staged operations, unresolved local deposits, or child universes and measure whether required operations remain executable.
- Force callback failure or reverting ETH refund and verify no partial accounting persists.

## Recommended Invariant Tests

The audit should include invariant or property testing for the core accounting paths. At minimum, cover:

- Total REP reconciliation across parent universe, migration balances, burned REP, child token supplies, security pools, escalation games, and auctions.
- Total ETH reconciliation across complete-set collateral, fees owed, auction balances, refunds, and withdrawn ETH.
- Auction accounting reconciliation: submitted ETH equals owner-raised ETH plus refunds plus unclaimed/refundable balances.
- State-machine invariant: functions allowed in one state cannot mutate accounting after transitioning to another state.
- No double-claim invariant for every claim/refund/migration/withdrawal path.

Additional recommended invariant coverage:

- Vault accounting reconciliation: ownership, allowances, unpaid fees, REP claim, liquidation debt, and active-vault metadata.
- Escalation accounting reconciliation: deposits equals claimed plus unresolved plus swept plus carried.
- Pagination and active-list metadata remain consistent under repeated add/remove/update operations.
- Deployment/factory invariants: deployed addresses, salts, constructor arguments, and linked dependencies match expected production configuration.

## Report Requirements

For each finding, include:

- Severity: Critical, High, Medium, Low, or Informational.
- Impacted contract and function names.
- Preconditions and attacker capabilities.
- Step-by-step exploit or failure scenario.
- Impact on funds, correctness, liveness, or governance assumptions.
- Recommended remediation.
- Proof-of-concept test or reproduction script when feasible.

Also include:

- A list of reviewed commit hashes.
- A list of files explicitly reviewed.
- Tools used, including static analyzers, fuzzers, symbolic tools, and custom scripts.
- Any areas not reviewed or only partially reviewed.
- Residual risks that remain after recommended fixes.

Expected audit artifacts:

- Final report in PDF or Markdown.
- Machine-readable findings list when available.
- Proof-of-concept tests, patches, or standalone reproduction scripts for exploitable issues.
- Any fuzz, invariant, or symbolic-analysis harnesses written during the review.
- Retest report for the patched commit after fixes are applied.

## Severity Guidance

Critical:

- Direct theft or permanent loss of significant REP/ETH.
- Unbounded minting or double-spending of REP/share claims.
- Unauthorized control of oracle, auction, migration, or pool state.
- Protocol-wide permanent insolvency or unrecoverable stuck state.
- Permanent inability for a broad class of users to migrate, redeem, withdraw, settle, or claim material funds.

High:

- Theft/loss requiring realistic preconditions.
- Incorrect fork or migration accounting for a meaningful subset of users.
- Oracle/liquidation manipulation causing material value transfer.
- Permanent denial of withdrawal, migration, auction finalization, or claim for affected users.
- Economic attacks that reliably transfer value, strand funds, or force liquidation under realistic market conditions.

Medium:

- Griefing with meaningful cost asymmetry.
- Incorrect rounding or accounting that accumulates under realistic usage.
- State desynchronization recoverable through privileged or expensive actions.
- DoS requiring large but plausible gas/storage setup.
- Temporary or narrow liveness failures affecting migration, redemption, withdrawal, auction settlement, or oracle execution.

Low/Informational:

- Code clarity, missing events, weak documentation, non-critical edge cases, and defense-in-depth improvements.

## Additional Cross-Cutting Risks

Give extra attention to risks that may not be fully exposed by contract-by-contract review:

- Recursive fork state where a pool or escalation game inherits already-inherited deposits, snapshots, or escrow.
- Rounding dust that is harmless in one transition but accumulates across migration, auction, and redemption sequences.
- Permissionless calls that are safe individually but can grief or reorder another user's multi-step workflow.
- External-call failures that strand funds even when accounting reverts correctly in simpler paths.
- Gas griefing that appears acceptable in isolated functions but blocks a required user-exit workflow when combined with state growth.

## Audit Handoff Expectations

Before or during the review, maintainers should provide the auditor with:

- The exact audit commit and intended production deployment configuration.
- A walkthrough of the architecture and the lifecycle workflows listed above.
- Clarifications for intended economics, especially where comments, tests, and documentation are ambiguous.
- A contact path for rapid questions during review, so auditors do not need to infer protocol intent from code alone.
- A final patched commit for retest after fixes are complete.

Auditors should mark any finding whose severity depends on unresolved configuration or economic intent as pending clarification until maintainers provide the production assumption.

## Final Audit Acceptance Criteria

The protocol should not be considered ready for production until:

- All Critical and High findings are fixed and retested by the auditor.
- Medium findings are fixed or explicitly accepted with a written risk rationale.
- The auditor has reviewed the final patched commit, not only the initial audit commit.
- New tests cover every fixed bug and relevant regression path.
- The repository passes:

```bash
bun run tsc
bun run test
bun run format
bun run check
bun run knip
```
