# Zoltar Audit Fuzz And Invariant Results

Date: 2026-06-18

Final branch head after merging latest `main`: `c420a3ac`

## Auction Tick-Math Fuzz

Command executed:

```bash
bun run test:auction-fuzz
```

Result:

```text
solidity/ts/fuzz/auctionTickMath.fuzz.ts:
(pass) Auction tick math fuzz > tickToPrice matches the TypeScript model across deterministic fuzz ticks [960.10ms]
(pass) Auction tick math fuzz > tickToPrice rejects ticks outside the finite domain [2112.70ms]

2 pass
0 fail
Ran 2 tests across 1 file. [3.88s]
```

Coverage:

- 2,000 deterministic fuzz ticks across the finite auction tick domain.
- Explicit rejection checks for ticks below `MIN_TICK` and above `MAX_TICK`.

## Temporary Fork-Accounting Sweep

Two temporary integration tests were inserted into `solidity/ts/tests/peripherals.test.ts`, executed, and removed. The tests asserted the vulnerable accounting behavior directly across multiple parameter values.

Command executed:

```bash
bun test --timeout 300000 solidity/ts/tests/peripherals.test.ts -t "audit accounting sweep"
```

Result:

```text
solidity/ts/tests/peripherals.test.ts:
(pass) Peripherals Contract Test Suite > audit accounting sweep C-01: truth auction ETH remains stranded across bid sizes [1091.20ms]
(pass) Peripherals Contract Test Suite > audit accounting sweep C-02: own fork leaves excess parent REP in the migration proxy [301.81ms]

2 pass
124 filtered out
0 fail
Ran 2 tests across 1 file. [2.31s]
```

### C-01 Sweep

The temporary C-01 sweep ran the truth-auction stranded-ETH reproduction across three `repAtFork` purchase sizes:

- `repAtFork / 2`
- `repAtFork / 3`
- `repAtFork / 4`

For each variant it asserted:

- `SecurityPoolForker` ETH increased by the filled auction ETH.
- The child pool ETH balance did not increase.
- The child pool `completeSetCollateralAmount` excluded the filled auction ETH.

### C-02 Sweep

The temporary C-02 sweep ran the own-fork stranded-REP reproduction across three excess parent-REP levels:

- `2 * forkThreshold`
- `4 * forkThreshold`
- `8 * forkThreshold`

The simulator account was explicitly funded for each variant using the same storage-override technique used by the repository's test setup. For each variant it asserted:

- `SecurityPoolMigrationProxy` retained old-universe parent REP.
- `forkData.auctionableRepAtFork` matched only the Zoltar migration ledger.
- The raw parent REP left in the proxy was not represented in fork accounting.

## Interpretation

The fuzz run increases confidence that the latest auction tick-domain changes are not the source of the reported auction issue. The fork-accounting sweep increases confidence that both critical findings are invariant violations rather than narrow single-parameter examples.

The temporary tests were removed after execution because they assert current vulnerable behavior. Remediation should convert these scenarios into permanent regression tests with inverted assertions.
