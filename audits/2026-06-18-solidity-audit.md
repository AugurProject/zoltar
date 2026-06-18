# Zoltar Solidity Security Audit

## Target

- Repository path: `/workspace/.t3/worktrees/zoltar/t3code-c5f51db1`
- Branch: `t3code/c5f51db1`
- Reviewed commit: `a49e15922ed91b317b969a08c67391c5296c0518`
- Final branch head after merging latest `main`: `c420a3ac`
- Date: 2026-06-18
- Intended network: mainnet appears intended from `docs/mainnet-deployment-addresses.md`, while `solidity/default-config.json` only points at `https://ethereum.dark.florist`. This review treats the documented mainnet deployment manifest as the production reference and the JSON RPC URL as a local validation default.
- Solidity compiler: primary contracts use `pragma solidity 0.8.35`; `solidity/package.json` pins `solc` to `0.8.35`.
- Compiler settings: `solidity/ts/compile.ts` compiles main contracts with `viaIR: true`, optimizer enabled, `runs: 200`; no explicit EVM version is set for main contracts. OpenOracle settings use optimizer runs `50000` and EVM version `cancun`.
- Production constants reviewed: `Constants.GENESIS_REPUTATION_TOKEN = 0x221657776846890989a759BA2973e427DfF5C9bB`, `Constants.BURN_ADDRESS = 0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF`, `NUM_OUTCOMES = 3`.
- Frozen protocol config from `docs/mainnet-deployment-addresses.json`: `forkThresholdDivisor = 20`, `forkBurnDivisor = 5`, `initialEscalationGameDeposit = 1000000000000000000`.
- Expected deterministic mainnet dependencies from `docs/mainnet-deployment-addresses.json`: `openOracle = 0x51DED022c087758c187ce636aa5f6adE6B919abB`, `zoltarQuestionData = 0xeadF91d12F549786891350B3D535638713651207`, `zoltar = 0xd282Ae3cC11423c740afD608e715CD4e22831A29`, `securityPoolForker = 0x290BF23Dd1912AdEDBdfd7419b85605C66e3d24B`, `securityPoolFactory = 0x0070464ef3Fb90B5D3e128e47D5ffB20e12f24E6`.

## Executive Summary

This review originally found two critical issues in the fork and truth-auction exit paths on reviewed commit `a49e15922ed91b317b969a08c67391c5296c0518`:

- `C-01`: Truth-auction ETH is paid to `SecurityPoolForker` and never credited to the child pool, permanently stranding auction proceeds and finalizing the child pool with understated collateral.
- `C-02`: In the own-fork path, the forker moves all parent-pool and escalation-game REP to the migration proxy but `Zoltar.forkUniverse` consumes only the fork threshold. Any excess parent REP remains stranded in the proxy and is omitted from child REP allocation.

Current status on latest merged `main` at `c420a3ac`:

- `C-01`: Remediated. `SecurityPoolForker._consumeTruthAuctionRep` now forwards the ETH received from `truthAuction.finalize()` to the child security pool before collateral is captured, and the repository truth-auction test asserts this behavior.
- `C-02`: Open. The own-fork path still transfers all received REP to the migration proxy while `Zoltar.forkUniverse` only consumes `forkThreshold`; no latest-main change accounts for leftover raw parent REP in the proxy.

The remaining open issue affects a required post-fork user-exit flow and can cause permanent stranding of material REP during normal protocol operation.

## Scope Reviewed

Files explicitly reviewed:

- `audit_instructions.md`
- `solidity/default-config.json`
- `solidity/contracts/Constants.sol`
- `solidity/contracts/Zoltar.sol`
- `solidity/contracts/peripherals/SecurityPool.sol`
- `solidity/contracts/peripherals/SecurityPoolForker.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerStorage.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerTypes.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationBase.sol`
- `solidity/contracts/peripherals/SecurityPoolForkerVaultMigrationDelegate.sol`
- `solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol`
- `solidity/contracts/peripherals/EscalationGame.sol`
- `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol`
- `solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol`
- `solidity/contracts/peripherals/factories/SecurityPoolFactory.sol`
- `solidity/contracts/peripherals/factories/PriceOracleManagerAndOperatorQueuerFactory.sol`
- `solidity/contracts/peripherals/factories/ShareTokenFactory.sol`
- `solidity/contracts/peripherals/factories/UniformPriceDualCapBatchAuctionFactory.sol`
- `solidity/contracts/peripherals/factories/SecurityPoolDeployer.sol`
- `docs/mainnet-deployment-addresses.md`
- `docs/mainnet-deployment-addresses.json`
- Relevant truth-auction and fork-migration tests in `solidity/ts/tests/peripherals.test.ts` and `solidity/ts/tests/auction.test.ts`

Tools used:

- Manual source review
- `rg`, `sed`, `nl`, `git`

Review focus:

- Zoltar fork initiation, migration balances, child universe deployment, and security-pool migration proxy use.
- Parent and child security-pool ETH/REP accounting across `Operational`, `PoolForked`, `ForkMigration`, and `ForkTruthAuction`.
- Truth-auction finalization, bid settlement, and child-pool ownership allocation.
- Escalation-game non-decision, fork continuation, carried deposits, and unresolved escrow export.
- Oracle-staged operations, liquidation snapshots, pending slots, and one-time coordinator initialization.

No symbolic execution was performed. No production contract code changes were made by this audit. Copy-ready proof-of-concept test snippets are available in `audits/2026-06-18-poc-tests.md`, executed PoC results are available in `audits/2026-06-18-executed-poc-results.md`, accounting invariants plus remediation acceptance criteria are available in `audits/2026-06-18-invariant-checklist.md`, fuzz and invariant sweep results are available in `audits/2026-06-18-fuzz-invariant-results.md`, remediation verification is available in `audits/2026-06-18-remediation-verification.md`, and QA results are available in `audits/2026-06-18-qa-results.md`.

Machine-readable findings are available in `audits/2026-06-18-findings.json`.

## Findings

### C-01: Truth auction proceeds are sent to `SecurityPoolForker` and never credited to the child pool

Severity: Critical

Status: Valid on reviewed commit `a49e15922ed91b317b969a08c67391c5296c0518`; verified remediated on final branch head `c420a3ac`.

Impacted contracts and functions:

- `UniformPriceDualCapBatchAuction.finalize`
- `SecurityPoolForker._consumeTruthAuctionRep`
- `SecurityPoolForker._captureUnclaimedCollateralForAuction`
- `SecurityPoolForker.receive`

#### Summary

This finding documents the vulnerable behavior on reviewed commit `a49e15922ed91b317b969a08c67391c5296c0518`. It is verified fixed on final branch head `c420a3ac`; see `audits/2026-06-18-remediation-verification.md`.

Truth-auction ETH proceeds are paid to the auction `owner`, which is the `SecurityPoolForker`. The forker accepts ETH from trusted auction contracts, but it has no function that forwards those proceeds into the child `SecurityPool`. Immediately after finalizing the auction, the forker computes the child pool's collateral from `address(securityPool).balance`, which does not include the ETH just paid to the forker.

As a result, winning bidders can pay ETH into the truth auction and receive child-pool REP ownership, while the ETH that should collateralize the child pool remains permanently stuck in the forker. The child pool is finalized with too little `completeSetCollateralAmount`, causing share redemptions and pool accounting to be undercollateralized.

#### Evidence

`UniformPriceDualCapBatchAuction.finalize` transfers the filled auction ETH to `owner`:

```solidity
(bool sent, ) = payable(owner).call{ value: ethToSend }('');
require(sent, 'Failed to send Ether');
```

In protocol-created truth auctions, the auction owner is the `SecurityPoolForker`:

```solidity
truthAuction = uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(
    address(securityPoolForker),
    securityPoolSalt
);
```

`SecurityPoolForker._consumeTruthAuctionRep` finalizes the auction but does not collect or forward the ETH to the child pool:

```solidity
if (data.truthAuction.auctionStarted() != 0) {
    data.truthAuction.finalize();
    repPurchased = data.truthAuction.totalRepPurchased();
}
securityPool.setSystemState(SystemState.Operational);
```

The next step, `_captureUnclaimedCollateralForAuction`, computes child collateral using only the child pool's ETH balance:

```solidity
uint256 balance = address(securityPool).balance;
uint256 feesOwed = securityPool.totalFeesOwedToVaults();
uint256 collateralAmount = balance >= feesOwed ? balance - feesOwed : 0;
securityPool.setPoolFinancials(collateralAmount, parentTotalSecurityBondAllowance);
```

The forker can receive the ETH:

```solidity
receive() external payable {
    require(trustedAuctionAddresses[msg.sender], 'fa');
}
```

However, no reviewed function transfers the received auction ETH from `SecurityPoolForker` to the child `SecurityPool`. The tests also only assert that authorized auction ETH can increase the forker balance; they do not assert that finalized auction ETH becomes child collateral.

Relevant source locations:

- `solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol:113-150`
- `solidity/contracts/peripherals/SecurityPoolForker.sol:467-501`
- `solidity/contracts/peripherals/SecurityPoolForker.sol:717-719`
- `solidity/contracts/peripherals/factories/SecurityPoolFactory.sol:101-104`

#### Preconditions and attacker capabilities

- A parent security pool has forked.
- A child pool reaches `ForkTruthAuction`.
- A bidder submits a winning or partially winning bid.
- Anyone calls `finalizeTruthAuction` after the auction duration.

No privileged access or malicious external dependency is required.

#### Exploit or failure scenario

1. Users create complete sets in a parent pool, producing collateral that must be represented in the winning child pool after fork migration and truth auction settlement.
2. The parent pool forks and a child pool is created for one outcome.
3. Not all parent REP migrates into the child pool, so `startTruthAuction` starts a truth auction to sell child REP for the missing ETH collateral.
4. A bidder submits a bid that clears the auction.
5. After the auction ends, `SecurityPoolForker.finalizeTruthAuction(childPool)` calls `truthAuction.finalize()`.
6. `truthAuction.finalize()` sends `ethToSend` to the forker because the forker is the auction owner.
7. The forker does not forward this ETH to the child pool.
8. `_captureUnclaimedCollateralForAuction` sets the child pool's `completeSetCollateralAmount` from `address(childPool).balance`, excluding the auction proceeds.
9. Auction bidders can still claim purchased REP ownership through `claimAuctionProceeds`, but the ETH they paid is not backing child-pool shares or collateral accounting.
10. The ETH remains stuck in `SecurityPoolForker`, and child-pool share holders face permanent undercollateralization.

#### Impact

- Permanent loss or stranding of all ETH raised by a truth auction.
- Child pool finalizes with understated collateral.
- Winning auction bidders receive REP ownership without their ETH being credited to pool collateral.
- Share redemption and post-fork accounting can become materially insolvent.

This is critical because it affects a required fork-exit path and can permanently strand significant ETH under normal protocol operation.

#### Recommended remediation

Make auction proceeds flow directly into the child pool's collateral before `setPoolFinancials` is called. Suitable fixes include:

- Change the truth auction recipient so `finalize()` sends filled ETH directly to the child `SecurityPool`.
- Or have `SecurityPoolForker._consumeTruthAuctionRep` measure the forker's ETH balance delta from `truthAuction.finalize()` and immediately transfer that delta to the `securityPool`.

After the transfer, assert the accounting invariant:

```solidity
address(securityPool).balance >= securityPool.totalFeesOwedToVaults() + expectedCollateral
```

Also add an explicit no-stranded-ETH invariant for `SecurityPoolForker`, or a narrowly scoped recovery path that can only forward auction proceeds to the correct child pool.

#### Proof-of-concept test guidance

Copy-ready test code is provided in `audits/2026-06-18-poc-tests.md`. Executed PoC results are recorded in `audits/2026-06-18-executed-poc-results.md`. The reproduction extends `solidity/ts/tests/peripherals.test.ts` around the existing `simple truth auction: participant buys rep and can claim proceeds` scenario:

1. Record `forkerBalanceBefore`, `childBalanceBefore`, and `expectedEthToBuy`.
2. Submit a bid that fully or partially clears the truth auction.
3. Call `finalizeTruthAuction`.
4. Assert the vulnerable behavior:
   - `getETHBalance(forkerAddress) - forkerBalanceBefore == auctionEthRaised`
   - `getETHBalance(yesSecurityPool.securityPool) - childBalanceBefore == 0` or otherwise excludes auction proceeds
   - `getCompleteSetCollateralAmount(yesSecurityPool.securityPool)` does not include `auctionEthRaised`
5. After remediation, invert the assertions so the auction ETH is credited to the child pool and the forker balance does not retain it.

The violated ETH-conservation invariant and fix acceptance criteria are documented in `audits/2026-06-18-invariant-checklist.md`.

Remediation verification for the latest merged `main` branch is documented in `audits/2026-06-18-remediation-verification.md`.

### C-02: Own-fork path strands parent REP above the Zoltar fork threshold in the migration proxy

Severity: Critical

Status: Open on final branch head `c420a3ac`.

Impacted contracts and functions:

- `SecurityPoolForker.forkZoltarWithOwnEscalationGame`
- `SecurityPool.activateForkMode`
- `SecurityPoolMigrationProxy.forkUniverse`
- `SecurityPoolMigrationProxy.lockRep`
- `Zoltar.forkUniverse`

#### Summary

This finding remains open on final branch head `c420a3ac`.

The own-fork path transfers all REP held by the parent `SecurityPool` and all REP drained from the non-decision `EscalationGame` into a `SecurityPoolMigrationProxy`. The proxy then calls `Zoltar.forkUniverse`, but `Zoltar.forkUniverse` burns only `forkThreshold` REP and credits only `forkThreshold - forkThreshold / forkBurnDivisor` to the proxy's migration balance.

If the parent pool plus escalation game hold more REP than the current Zoltar fork threshold, the excess parent REP remains in the migration proxy as the old-universe token. That excess is not added to Zoltar's migration ledger, is not included in `auctionableRepAtFork`, is not split to any child universe, and has no reviewed recovery path. Vault owners and escalation participants are then allocated child REP only from the reduced `auctionableRepAtFork` amount, while the remaining parent REP is permanently stranded.

This is not limited to a contrived state. Existing test setups commonly deposit more than the fork threshold into the security pool before triggering an own fork, and production pools are expected to accumulate arbitrary vault REP above the minimum fork-triggering amount.

#### Evidence

`SecurityPool.activateForkMode` sends the parent pool's entire REP balance to the forker:

```solidity
IERC20(address(repToken)).safeTransfer(msg.sender, repToken.balanceOf(address(this)));
```

`SecurityPoolForker.forkZoltarWithOwnEscalationGame` also drains all escalation-game REP, then transfers all REP received by the forker into the migration proxy:

```solidity
uint256 poolRepToFork = rep.balanceOf(address(securityPool));
securityPool.activateForkMode();
uint256 escalationRepToFork = escalationGame.drainAllRep(address(this));
...
uint256 repToFork = repBalanceAfter - repBalanceBefore;
if (repToFork > 0) IERC20(address(rep)).safeTransfer(address(migrationProxy), repToFork);
migrationProxy.forkUniverse(securityPool.questionId());
```

`Zoltar.forkUniverse`, called through the proxy, consumes only `forkThreshold` REP and credits only the post-burn threshold amount to the caller's migration balance:

```solidity
uint256 forkThreshold = getForkThreshold(universeId);
burnRep(universes[universeId].reputationToken, msg.sender, forkThreshold);
...
migrationRepBalances[msg.sender][universeId].migrationRepBalance =
    forkThreshold - forkThreshold / forkBurnDivisor;
```

After the call returns, the forker records only the migration ledger amount as `auctionableRepAtFork` and derives vault and escalation child-REP buckets from that amount:

```solidity
uint256 auctionableRepAtFork = zoltar.getMigrationRepBalance(
    address(migrationProxy),
    securityPool.universeId()
);
uint256 totalRepBeforeBurn = poolRepToFork + escalationRepToFork;
uint256 vaultRepAtFork =
    totalRepBeforeBurn == 0 ? 0 : (poolRepToFork * auctionableRepAtFork) / totalRepBeforeBurn;
```

`SecurityPoolMigrationProxy` has a `lockRep` method that could add post-fork REP to the migration balance, but it is `onlyOwner`, and the reviewed `SecurityPoolForker` exposes no post-own-fork entry point that calls it for the leftover parent REP.

Relevant source locations:

- `solidity/contracts/peripherals/SecurityPool.sol:642-647`
- `solidity/contracts/peripherals/SecurityPoolForker.sol:568-605`
- `solidity/contracts/Zoltar.sol:80-98`
- `solidity/contracts/peripherals/SecurityPoolMigrationProxy.sol:33-40`

#### Preconditions and attacker capabilities

- A security pool has an escalation game that reached non-decision.
- The pool's REP balance plus the escalation game's REP balance exceeds `Zoltar.getForkThreshold(universeId)`.
- Anyone calls `forkZoltarWithOwnEscalationGame`.

No malicious external dependency or privileged role is required. A normal vault-heavy pool is enough.

#### Exploit or failure scenario

1. Vaults deposit enough REP that the parent pool holds more than the fork threshold.
2. The escalation game reaches non-decision with additional REP escrowed.
3. Anyone calls `forkZoltarWithOwnEscalationGame`.
4. The forker moves all pool REP and all escalation-game REP into the migration proxy.
5. The proxy calls `Zoltar.forkUniverse`, which burns only `forkThreshold` and creates a migration balance of `forkThreshold - forkThreshold / forkBurnDivisor`.
6. The proxy still holds `poolRepToFork + escalationRepToFork - forkThreshold` old-universe REP.
7. `SecurityPoolForker` ignores that proxy token balance and allocates child migration buckets only from `auctionableRepAtFork`.
8. Future `migrateRepToZoltar`, `migrateVault`, and own-fork escalation claim paths split only those reduced buckets to children.
9. The excess old-universe REP remains in the migration proxy permanently, and users receive too little child REP relative to the REP taken from the pool and escalation game.

#### Impact

- Permanent stranding of parent REP in `SecurityPoolMigrationProxy`.
- Under-allocation of child REP to vault owners and escalation-game participants.
- Incorrect post-fork ownership, truth-auction sizing, collateral transfer, and escalation claim conversion because all are based on the reduced `auctionableRepAtFork`.
- The loss can be much larger than the fork threshold whenever a pool holds substantial vault REP.

This is critical because it permanently removes user REP from all normal redemption and migration paths during an intended protocol fork.

#### Recommended remediation

Do not move more parent REP into the migration proxy than the amount the path will actually burn or lock into Zoltar's migration ledger. Viable fixes include:

- Transfer only the exact `forkThreshold` REP needed for `forkUniverse`, leaving non-forking parent REP in the parent accounting path.
- Or, after `forkUniverse`, immediately call `migrationProxy.lockRep(leftoverProxyRep)` and include the resulting migration balance in `auctionableRepAtFork`.
- Or explicitly define and implement a separate recovery or redemption path for old-universe REP that remains after own-fork initiation.

After the fix, add an invariant that the migration proxy has zero parent REP balance after own-fork setup, unless every remaining token is accounted for in a documented recovery bucket.

#### Proof-of-concept test guidance

Copy-ready test code is provided in `audits/2026-06-18-poc-tests.md`. Executed PoC results are recorded in `audits/2026-06-18-executed-poc-results.md`. The reproduction adds a test around an existing own-fork setup:

1. Deposit `2 * forkThreshold` or more into the security pool.
2. Reach non-decision in the escalation game.
3. Call `forkZoltarWithOwnEscalationGame`.
4. Read `migrationProxyAddress = getMigrationProxyAddress(securityPool)`.
5. Assert the vulnerable behavior:
   - `repToken.balanceOf(migrationProxyAddress) > 0`
   - `repToken.balanceOf(migrationProxyAddress) == poolRepToFork + escalationRepToFork - forkThreshold`, ignoring any genesis burn-address transfer quirks
   - `forkData.auctionableRepAtFork == forkThreshold - forkThreshold / forkBurnDivisor`
6. After remediation, assert that any leftover proxy REP is either zero or fully represented in an explicit migration or recovery accounting bucket.

The violated REP-conservation invariant and fix acceptance criteria are documented in `audits/2026-06-18-invariant-checklist.md`.

## Areas Partially Reviewed

- Zoltar REP fork migration was reviewed for the security-pool proxy flow. The duplicate child-REP minting across fork outcomes appears intentional and was not reported as an issue.
- Oracle coordinator initialization was reviewed for front-running. The factory sets the pool in the same transaction after deployment, so no finding was raised.
- Auction settlement was reviewed for major accounting divergence. No separate finding was raised beyond `C-01`; minor rounding-order effects in underfunded pro-rata claims were not classified as material.
- Escalation-game MMR, nullifier proof, forked escrow, and unresolved export logic were reviewed for obvious double-claim and stuck-fund paths, but not formally verified.
- No symbolic-execution campaign was run. Auction tick-domain fuzzing and temporary fork-accounting sweep tests were run; deeper recursive fork fuzzing remains a residual recommendation.

## Notable Non-Findings

- `Zoltar.splitMigrationRep` can mint the same migration balance into multiple child outcomes. This is consistent with the documented fork semantics and was not classified as an over-mint by itself.
- `SecurityPoolOracleCoordinator.setSecurityPool` is externally callable before initialization, but the reviewed factory deploys the coordinator and sets the pool in the same transaction, leaving no mempool front-run window for factory-created pools.
- `ShareToken.authorize` is broad for already-authorized callers, but the origin factory and forker-mediated child authorization model intentionally relies on authorized pools/factory components. No arbitrary external caller can mint or burn share tokens without first being authorized by an existing authorized component.
- Failed staged oracle operations are consumed after execution attempt. This is a liveness/design tradeoff already covered by tests, not a direct fund-loss issue by itself.

## Residual Risk

The protocol has complex cross-contract accounting across forks, auctions, REP migration, collateral transfer, and escalation-game carry. The findings above show that the existing test suite can validate local REP allocation while missing global ETH and REP reconciliation. Before production deployment, add end-to-end invariants for:

- Total ETH: parent pool, child pools, truth auctions, forker, refunds, and redeemed shares.
- Total REP: parent pool, migration proxy, child pools, escalation games, auction claims, and vault ownership.
- No stranded ETH or REP in coordinator/proxy contracts after finalization and migration flows.
- Fork migration conservation across own forks, external forks, unresolved escalation migration, and recursive child forks.

## Confidence Assessment

Confidence is high for the two reported findings because both are direct accounting breaks in reviewed production code paths, require no privileged attacker, and were reproduced with targeted temporary integration tests on the reviewed checkout. Additional temporary accounting sweeps reproduced the C-01 and C-02 invariant violations across multiple bid-size and excess-REP parameters, and the repository auction tick-math fuzz test passed across 2,000 deterministic ticks.

The audit remains conservative: issues reviewed but not supported by a direct fund-loss or stuck-fund path were left as non-findings. The remaining quality gap is formal depth: remediation should commit the PoC and sweep scenarios as permanent regression tests with inverted assertions, and a follow-up property campaign should cover deeper recursive fork and mixed auction/migration orderings.

## Validation

Temporary audit PoC tests were inserted into `solidity/ts/tests/peripherals.test.ts`, executed, and removed. Both PoCs reproduced the vulnerable behavior on the reviewed checkout.

Additional fuzz and invariant-style checks were run:

- `bun run test:auction-fuzz`: passed, `2 pass`, `0 fail`.
- Temporary `audit accounting sweep`: passed, `2 pass`, `0 fail`, covering three C-01 bid-size variants and three C-02 excess-REP variants.

The full repository QA sequence was run after audit artifact updates and the root package metadata fix:

- `bun run tsc`: passed.
- `bun run test`: passed, `1313 pass`, `1 skip`, `0 fail` after merging latest `main`.
- `bun run format`: passed, no fixes applied.
- `bun run check`: passed.
- `bun run knip`: passed.

The `knip` run initially exposed a root package metadata issue: UI files scanned by the root configuration import `@zoltar/shared/*`, while root `package.json` did not list the local shared package. The root manifest and `bun.lock` were updated with `"@zoltar/shared": "file:shared"`, after which `knip` passed with zero warnings.

Audit artifacts were also validated for JSON parseability, ASCII-only content, and absence of trailing whitespace.
