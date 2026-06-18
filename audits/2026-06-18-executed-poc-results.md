# Zoltar Audit Executed PoC Results

Date: 2026-06-18

Target commit: `a49e15922ed91b317b969a08c67391c5296c0518`

## Setup Performed

The checkout initially had no `node_modules` directories and no generated contract artifacts. To execute the audit PoCs, the following setup was performed:

```bash
bun install --frozen-lockfile
cd solidity && bun install --frozen-lockfile
bun run ensure-contract-artifacts
```

`bun run ensure-contract-artifacts` regenerated shared build output and Solidity/UI contract artifacts needed by the test harness. These generated outputs are intentionally excluded from the audit report source review per repository policy.

## Temporary Test Execution

Two temporary tests were inserted into `solidity/ts/tests/peripherals.test.ts` using the code from `audits/2026-06-18-poc-tests.md`, then removed after execution. The tests asserted the vulnerable behavior directly:

- `audit PoC C-01: truth auction ETH is stranded in the forker`
- `audit PoC C-02: own fork strands parent REP above fork threshold in the migration proxy`

Command executed:

```bash
bun test --timeout 300000 solidity/ts/tests/peripherals.test.ts -t "audit PoC C-0"
```

Observed output:

```text
bun test v1.3.13 (bf2e2cec)

solidity/ts/tests/peripherals.test.ts:
(pass) Peripherals Contract Test Suite > audit PoC C-01: truth auction ETH is stranded in the forker [330.99ms]
(pass) Peripherals Contract Test Suite > audit PoC C-02: own fork strands parent REP above fork threshold in the migration proxy [83.42ms]

 2 pass
 124 filtered out
 0 fail
Ran 2 tests across 1 file. [1295.00ms]
```

## Interpretation

The passing PoC tests confirm both reported issues reproduce on the reviewed checkout:

- C-01: filled truth-auction ETH increases `SecurityPoolForker` balance, while the child pool balance and child `completeSetCollateralAmount` exclude the auction proceeds.
- C-02: after own-fork setup with REP above the fork threshold, `SecurityPoolMigrationProxy` retains old-universe parent REP while `forkData.auctionableRepAtFork` reflects only the Zoltar migration ledger.

The temporary tests asserted vulnerable behavior on the reviewed commit, so they were not kept in the production test suite. During remediation, the same scenarios should be converted into regression tests with inverted assertions:

- C-01 should require auction proceeds to reach the child pool before `setPoolFinancials`.
- C-02 should require zero unaccounted raw parent REP in the migration proxy after own-fork setup, unless a documented recovery bucket is implemented and tested.
