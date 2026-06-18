# Zoltar Test Suite Audit

Audited commit: `ad4f9d66f45a48875ecd31c83f95b61d0947fa0b`
Branch: `t3code/77d59343`
Date: 2026-06-18
Scope: tests and test commands being run. This is not a Solidity implementation audit.

## Executive Summary

The default test gate is materially weaker than it appears. The repository has substantial scenario coverage, especially around auctions, escalation games, forking, and UI state, but several important checks are either outside the default gate, dependent on live mutable infrastructure, skipped, or written in a way that can pass while the intended security property is broken.

The highest-confidence issue is that `bun run test` does not discover the existing Solidity fuzz harness. The most misleading issue is the repeated use of `assert.rejects(..., 'expected revert')`, which reads like a revert-reason assertion but is only an assertion failure message in Node's `assert` API.

I also performed a direct-coverage scan across production Solidity contract names. The heaviest direct test attention is concentrated on `SecurityPool`, `Zoltar`, `EscalationGame`, `OpenOracle`, and the auction. Factory/deployment contracts, migration delegates, WETH, and several small protocol libraries have little or mostly indirect test coverage.

## Methodology

Reviewed:

- Test command configuration in `package.json`, `bunfig.toml`, and `solidity/bunfig.toml`.
- Solidity test files under `solidity/ts/tests/`.
- Solidity fuzz file under `solidity/ts/fuzz/`.
- UI test files under `ui/ts/tests/` where they affect the default test gate.
- Simulation scenario definitions under `ui/ts/simulation/`.
- Audit brief requirements in `audit_instructions.md`, especially suggested attack simulations, recommended invariants, and report requirements.

Tools and commands used:

- `rg` and `find` for test discovery, skipped tests, broad revert assertions, TODOs, and invariant/property-test searches.
- `bun test --help` to confirm Bun test discovery behavior.
- `bun test --pass-with-no-tests --timeout 1000 ./solidity/ts/fuzz/` to confirm the fuzz directory is not discovered by default naming rules.
- `node -e "const assert=require('assert'); assert.rejects(Promise.reject(new Error('wrong')), 'expected'); console.log('passed broad string matcher')"` to confirm string arguments to `assert.rejects` are not error matchers.

Limitations:

- I did not execute the full test suite because the task was to audit the tests, not retest a code patch. I also observed the workspace lacks installed dependencies for some direct Bun runs, so full execution would require setup first.
- I did not audit Solidity production code for exploitable contract bugs.

## Findings

### High - Default `bun run test` does not run the existing Solidity fuzz harness

Impacted area: root test gate; auction tick/price math testing.

Evidence:

- `package.json:57`: `bun run test` runs `bun test --parallel=4 --timeout 300000`.
- `package.json:58`: the fuzz harness is only run by a separate `test:auction-fuzz` script.
- `solidity/ts/fuzz/auctionTickMath.fuzz.ts:35`: the fuzz suite exists.
- `solidity/ts/fuzz/auctionTickMath.fuzz.ts:17`: `FUZZ_CASES = 2_000`.

Reproduction:

```bash
bun test --pass-with-no-tests --timeout 1000 ./solidity/ts/fuzz/
```

Observed result:

```text
The following filters did not match any test files:
 ./solidity/ts/fuzz/
note: Tests need ".test", "_test_", ".spec" or "_spec_" in the filename
```

Failure scenario:

1. A change breaks `UniformPriceDualCapBatchAuction.tickToPrice` for an edge tick or deterministic random tick.
2. The existing fuzz harness would catch it if run.
3. The required `bun run test` gate passes because Bun does not discover `*.fuzz.ts` in normal directory discovery.

Impact:

Auction tick/price math feeds value-moving auction behavior. Omitting the only deterministic fuzz harness for that surface lets economic regressions pass the default CI/local gate.

Recommendation:

Rename the file to `auctionTickMath.fuzz.test.ts`, or add the explicit fuzz path to the root `test` script. Keep `test:auction-fuzz` as a focused command if useful, but do not leave it outside the mandatory full-suite gate.

### Medium - Several revert tests use `assert.rejects` strings as if they matched revert reasons

Impacted area: Solidity tests for auction access control, auction state guards, and REP redemption guards.

Evidence:

- `solidity/ts/tests/auction.test.ts:833`: `assert.rejects(..., 'Auction ended')`
- `solidity/ts/tests/auction.test.ts:846`: `assert.rejects(..., 'invalid')`
- `solidity/ts/tests/auction.test.ts:871`: `assert.rejects(..., 'invalid')`
- `solidity/ts/tests/auction.test.ts:879`: `assert.rejects(..., 'finalized')`
- `solidity/ts/tests/auction.test.ts:890`: `assert.rejects(..., 'not finalized')`
- `solidity/ts/tests/auction.test.ts:1304`: `assert.rejects(..., 'only owner')`
- `solidity/ts/tests/auction.test.ts:1308`: `assert.rejects(..., 'already started')`
- `solidity/ts/tests/auction.test.ts:1501` and `1504`: `assert.rejects(..., 'Only owner can call')`
- `solidity/ts/tests/peripherals.test.ts:668` and `3591`: string second arguments used for redeem-blocking tests.

Node's `assert.rejects` treats a string second argument as the assertion message, not an expected error matcher. I confirmed with:

```bash
node -e "const assert=require('assert'); assert.rejects(Promise.reject(new Error('wrong')), 'expected'); console.log('passed broad string matcher')"
```

Failure scenario:

1. A guard intended to revert with `Only owner can call` is accidentally removed.
2. The transaction still reverts for a different reason, such as malformed setup, insufficient balance, wrong state, or an unrelated panic.
3. The test still passes because the string did not constrain the error.

Impact:

These tests give false confidence over access-control and state-machine guards. This is especially risky in auction and redemption paths because the difference between "right guard fired" and "something reverted" matters for fund safety and liveness.

Recommendation:

Use regular expressions or validation objects, for example `await assert.rejects(fn, /Only owner can call/)` or `await assert.rejects(fn, { message: /Only owner can call/ })`. Add post-state assertions where revert data is unavailable.

### Medium - Default tests depend on live mainnet RPC and mutable Uniswap liquidity

Impacted area: default UI test gate; Uniswap quote tests.

Evidence:

- `ui/ts/tests/uniswapQuoter.integration.test.ts:4-6`: documents that these tests hit real Ethereum mainnet RPC.
- `ui/ts/tests/uniswapQuoter.integration.test.ts:14`: hard-coded RPC URL `https://ethereum.dark.florist`.
- `ui/ts/tests/uniswapQuoter.integration.test.ts:42-44`: assumes no REP V4 pools exist "at time of writing".
- `ui/ts/tests/uniswapQuoter.integration.test.ts:47`, `51`, `61`, `68`, `78`: broad `rejects.toThrow()` assertions.
- `ui/ts/tests/uniswapQuoter.integration.test.ts:85-90`: live REP/WETH V3 price plausibility bound.

Failure scenario:

1. The public RPC is down, rate limited, censored, or returns transient errors.
2. Or mainnet liquidity changes, such as a REP V4 pool being created.
3. The default `bun run test` fails or passes for the wrong reason, independent of repository correctness.

Impact:

Default tests become nondeterministic and externally mutable. The broad throw assertions also allow provider failures to masquerade as successful "pool missing" checks.

Recommendation:

Move live-mainnet tests behind an explicit opt-in command such as `test:integration:mainnet`, require `MAINNET_RPC_URL`, and pin fork state to a known block where possible. In the default suite, use mocked clients or a local fork fixture. For expected missing pools, assert a specific quoter/pool-missing error, not any thrown error.

### Medium - No enforced invariant/property-test gate for protocol-wide accounting

Impacted area: REP/ETH accounting, migration, auction, escalation, vault, and claim/refund testing.

Evidence:

- `audit_instructions.md:451-466` explicitly recommends invariant coverage for total REP reconciliation, total ETH reconciliation, auction accounting, state-machine transitions, no double claims, vault accounting, escalation accounting, pagination metadata, and deployment/factory invariants.
- Searches for invariant/property tooling found no project-level invariant test framework or default invariant command. There is one deterministic fuzz harness under `solidity/ts/fuzz/`, but it is not in `bun run test` as noted above.
- Existing tests contain valuable scenario checks, such as auction payout assertions and selected pool accounting checks, but they are not a systematic invariant/property harness across generated action sequences.

Failure scenario:

1. A cross-module sequence of deposits, escalation locks, fork migration, auction claims, and redemption creates a small REP/ETH accounting drift or double-claim opportunity.
2. Hand-written examples do not cover that exact interleaving.
3. The suite passes because there is no randomized/stateful invariant harness asserting conservation and no-double-claim properties across sequences.

Impact:

This does not prove an implementation bug exists, but it leaves the highest-value accounting surfaces under-tested relative to the protocol's risk profile and its own audit brief. For a forkable value-moving protocol, lack of enforced accounting invariants is a meaningful test-suite weakness.

Recommendation:

Add stateful invariant tests that generate sequences across the core workflows. Minimum useful invariants:

- REP conservation across wallets, pools, escalation games, auctions, migration balances, burned REP, and child tokens.
- ETH conservation across complete-set collateral, fees, auction balances, refunds, and withdrawals.
- No double-claim for every claim/refund/migration/withdraw path.
- State-machine invariant that functions from prior phases cannot mutate accounting after transitions.
- Auction accounting invariant that submitted ETH equals owner proceeds plus refunds plus unclaimed balances.

Run these in the mandatory test gate, or in a required CI job if runtime is too high for every local test run.

### Medium - Seeded security-pool simulation invariants are skipped

Impacted area: browser-local simulation QA for security-pool and liquidation workflows.

Evidence:

- `ui/ts/tests/activeEnvironment.test.ts:519-531`: default seeded-scenario test checks only that bootstrapping does not revert and `pools.length > 0`.
- `ui/ts/tests/activeEnvironment.test.ts:534`: stronger invariant test is skipped.
- `ui/ts/tests/activeEnvironment.test.ts:547-553`: skipped assertions check exact scenario, one pool, vault count, REP deposit, and security-bond allowance.
- `ui/ts/simulation/scenarios.ts:38-39`: scenario description promises one seeded market, one security pool, one funded vault, and active security-bond allowance for liquidation workflows.

Failure scenario:

1. A regression seeds the wrong vault, wrong REP deposit, wrong allowance, or wrong pool count.
2. The default seeded-scenario test still passes because at least one pool exists.
3. Manual QA and UI tests operate on a simulation state that no longer matches its intended liquidation/security-pool scenario.

Impact:

The local simulation harness is an important practical QA path for complex workflows. If its seeded state silently drifts, liquidation and pool workflow testing becomes misleading.

Recommendation:

Unskip the invariant test or replace it with a stable version that verifies the exact seeded pool/vault state for each seeded scenario. If the reason for skipping is flakiness or runtime, address that directly instead of disabling the assertion.

### Medium - Factory and deployment wiring is mostly covered by smoke tests, not adversarial/direct tests

Impacted area: deterministic deployment, constructor argument wiring, factory salts, and factory access control.

Evidence:

- Direct test-name/reference scan shows little direct test coverage for several production deployment components:
  - `EscalationGameFactory`: no direct test references by contract name.
  - `PriceOracleManagerAndOperatorQueuerFactory`: no direct test references by contract name.
  - `ShareTokenFactory`: no direct test references by contract name.
  - `SecurityPoolDeployer` and `SecurityPoolDeploymentWorker`: no direct test references by contract name.
  - `UniformPriceDualCapBatchAuctionFactory`: referenced mostly through deployment helpers and `deploymentStatusOracle.test.ts`.
- These contracts are not passive metadata. They set critical constructor arguments and salts:
  - `solidity/contracts/peripherals/factories/EscalationGameFactory.sol:24-27`: deploys escalation games with `salt: bytes32(0)` and derives the security pool from `msg.sender`.
  - `solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol:53-74`: forwards WETH, OpenOracle gas, settlement, fee, multiplier, and dispute configuration into each oracle coordinator.
  - `solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol:37` and `82`: enforce deployer/factory caller restrictions.
  - `solidity/contracts/peripherals/factories/SecurityPoolFactory.sol:85-183`: creates child/origin pools, share tokens, truth auctions, oracle coordinators, and records deployment metadata.

Existing tests do exercise deployment workflows indirectly through `ensureInfraDeployed`, `deployOriginSecurityPool`, simulation bootstrap, and deployment-status checks. That is useful, but it is not the same as targeted tests that mutate deployment parameters, verify salts/address determinism across parent/child deployments, and assert every constructor argument on deployed children.

Failure scenario:

1. A factory salt or constructor argument is changed incorrectly.
2. End-to-end tests still deploy a pool and perform a happy-path action.
3. A production deployment later produces a child pool with an unexpected deterministic address, wrong oracle configuration, wrong factory authority, wrong WETH/OpenOracle dependency, or inconsistent deployment metadata.

Impact:

Deployment wiring errors can strand workflows before users can safely migrate, claim, auction, or operate child pools. The audit brief explicitly calls out factory/deployer salts, deterministic addresses, deployment-status wiring, and constructor consistency as configuration sanity checks.

Recommendation:

Add direct factory/deployment tests that:

- Assert predicted addresses and salts for origin pools, child pools, share tokens, truth auctions, oracle coordinators, and escalation games.
- Assert every constructor argument on deployed child/origin components matches production configuration.
- Test unauthorized direct calls to `SecurityPoolDeployer.deploy`, `SecurityPoolDeploymentWorker.deploy`, and child-pool factory functions.
- Test duplicate deployment behavior and deployment metadata pagination after multiple origin and child deployments.

### Low - Some security-sensitive rejection tests accept any revert with no post-state invariant

Impacted area: escalation-game outcome validation, forked escalation claims, security-pool deployment validation, and ETH receive-path restrictions.

Evidence examples:

- `solidity/ts/tests/escalationGame.test.ts:499`, `505-506`: invalid escalation outcomes.
- `solidity/ts/tests/peripherals.test.ts:1254`: relayed unresolved vault migration rejection.
- `solidity/ts/tests/peripherals.test.ts:1354`, `2979`, `3099`: forked escalation deposit claim rejection.
- `solidity/ts/tests/peripherals.test.ts:4071`, `4091`, `4099`: invalid security-pool deployment inputs.
- `solidity/ts/tests/peripherals.test.ts:4705`, `4740`, `4784`: unauthorized ETH receive-path rejections.

Failure scenario:

1. The intended production guard is accidentally weakened.
2. The call still reverts because of an unrelated setup, balance, address, or state issue.
3. The test passes and does not assert that balances, escrow records, vault metadata, or deployment state remained unchanged.

Impact:

The affected tests are still useful smoke checks, but they are not strong security tests. They can conceal wrong-guard regressions in sensitive paths.

Recommendation:

For each intentional rejection, assert a specific revert selector/message when available. When unavailable, assert before/after invariants over the state that the rejection is meant to protect.

### Low - A documented exit-path TODO remains in the Solidity tests

Impacted area: user exit testing after a Zoltar fork following question end.

Evidence:

- `solidity/ts/tests/peripherals.test.ts:3594`: `TODO test that users can claim their stuff (shares+rep) even if zoltar forks after question ends`.

Adjacent tests cover parts of this area, for example `redeemShares stays available after an unrelated late fork once the question has finalized`, but the source still documents a missing combined shares-plus-REP exit test.

Failure scenario:

1. A question ends and users hold both shares and REP-related claims.
2. Zoltar forks after the question ends.
3. A later change breaks one combined exit path, while adjacent single-path tests still pass.

Impact:

The audit brief treats migration, redemption, auction settlement, and escalation claims as fund-safety paths. A documented missing exit-path test should be closed or removed with justification.

Recommendation:

Add the TODO test as a full workflow assertion, or replace the TODO with references to existing tests that prove the same combined property.

### Informational - Several production modules have little direct test coverage

This is not a standalone vulnerability, but it answers the explicit coverage question and should guide future test work.

Very little direct coverage observed:

- `solidity/contracts/peripherals/WETH9.sol`: used as test infrastructure and oracle plumbing, but no dedicated WETH behavior tests for deposit, withdraw, allowance, max allowance, or transfer failure paths.
- `solidity/contracts/peripherals/MerkleMountainRange.sol`: tested indirectly through escalation carry/proof workflows, but no direct harness for `hashLeaf`, `hashParent`, and `bagPeaks` edge cases such as empty peak arrays and peak-order sensitivity.
- `solidity/contracts/peripherals/BinaryOutcomes.sol`: enum-only library, low risk by itself, but no direct test documenting enum numeric stability even though many paths cast raw integers into outcomes.
- `solidity/contracts/peripherals/EscalationGameForker.sol` and `SecurityPoolForkerVaultMigrationDelegate.sol`: heavily exercised through `SecurityPoolForker` workflows, but no direct tests by contract boundary for delegate/wrapper access assumptions.
- `solidity/contracts/peripherals/factories/*.sol`: covered mostly through successful deployments, not direct adversarial tests as described above.

Recommendation:

Add small focused tests or harnesses for low-level utilities where numeric stability, hashing, or wrapper authorization matters. For simple enum/library files, document intentional indirect coverage if direct tests would be noise.

## Additional Observations

- No skipped Solidity tests were found via `test.skip`/`describe.skip`; the skipped test found is in UI simulation coverage.
- Coverage commands exist (`coverage:ui`, `coverage:contracts:ts`, `coverage:contracts:bytecode`), but no coverage threshold or required coverage gate was observed.
- The suite contains many valuable scenario tests. The main weakness is not a total absence of tests, but that the default gate and some assertions do not reliably enforce the highest-risk properties.

## Recommended Remediation Order

1. Put `solidity/ts/fuzz/auctionTickMath.fuzz.ts` into the mandatory test gate.
2. Replace string second arguments to `assert.rejects` with regex/object matchers where they are intended to check revert reasons.
3. Move live-mainnet Uniswap tests out of the default suite and make them opt-in/pinned.
4. Unskip seeded simulation invariants.
5. Add direct factory/deployment wiring tests for salts, addresses, constructor arguments, and unauthorized callers.
6. Add stateful invariant/property tests for REP, ETH, auction, migration, escalation, and no-double-claim accounting.
7. Close the documented post-question-end fork exit TODO.
