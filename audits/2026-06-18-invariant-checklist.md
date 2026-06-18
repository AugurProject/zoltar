# Zoltar Audit Invariant Checklist

This checklist records the accounting invariants used to validate the two reported findings and to judge whether a proposed remediation is complete. It is scoped to the reviewed fork, migration, and truth-auction flows.

## C-01: Truth-Auction ETH Conservation

### Broken invariant

After `finalizeTruthAuction(childPool)` completes, all filled truth-auction ETH must be either:

- credited to the child pool's ETH balance and included in `completeSetCollateralAmount`, or
- refunded to bidders.

The vulnerable implementation leaves filled ETH at `SecurityPoolForker`, which is neither the child collateral holder nor a documented refund holder.

### Concrete reconciliation

Before finalization:

```text
forkerEthBefore = ETH(SecurityPoolForker)
childEthBefore = ETH(childPool)
auctionEthFilled = min(ethRaised, ethRaiseCap)
```

Required after finalization:

```text
ETH(SecurityPoolForker) == forkerEthBefore
ETH(childPool) >= childEthBefore + auctionEthFilled
completeSetCollateralAmount(childPool) >= childEthBefore + auctionEthFilled - feesOwed(childPool)
```

Observed vulnerable behavior:

```text
ETH(SecurityPoolForker) == forkerEthBefore + auctionEthFilled
ETH(childPool) == childEthBefore
completeSetCollateralAmount(childPool) excludes auctionEthFilled
```

### Existing test anchor

`solidity/ts/tests/peripherals.test.ts` has `simple truth auction: participant buys rep and can claim proceeds`. That test already:

- creates open interest,
- triggers an external security-pool fork,
- migrates the parent vault into the `Yes` child,
- starts a truth auction,
- submits a clearing bid,
- finalizes the auction,
- verifies the bidder receives child-pool ownership.

It does not assert where the filled ETH went. The C-01 PoC adds exactly that missing assertion.

### Fix acceptance criteria

A complete fix should make all of these true:

- `finalizeTruthAuction` cannot leave filled auction ETH in `SecurityPoolForker`.
- The child pool receives filled auction ETH before `setPoolFinancials`.
- The child pool's `completeSetCollateralAmount` includes the received proceeds net of fees.
- Any recovery path for stranded ETH is child-pool-specific and cannot redirect proceeds to an arbitrary receiver.

## C-02: Own-Fork REP Conservation

### Broken invariant

After `forkZoltarWithOwnEscalationGame(parentPool)` completes, every unit of parent-universe REP taken from the parent pool or escalation game must be represented in one of these buckets:

- burned by `Zoltar.forkUniverse`,
- credited to `Zoltar` migration balance,
- retained in parent-pool accounting with a documented redemption path,
- or assigned to an explicit recovery bucket with a tested owner and destination.

The vulnerable implementation sends all pool and escalation REP to `SecurityPoolMigrationProxy`, but `Zoltar.forkUniverse` consumes only `forkThreshold`. Excess old-universe REP remains as a raw token balance in the proxy and is not included in `auctionableRepAtFork`.

### Concrete reconciliation

Before own fork:

```text
poolRepToFork = REP(parentPool)
escalationRepToFork = REP(escalationGame)
totalRepSentToProxy = poolRepToFork + escalationRepToFork
forkThreshold = Zoltar.getForkThreshold(parentUniverse)
postBurnMigrationRep = forkThreshold - forkThreshold / forkBurnDivisor
```

Required after own fork:

```text
REP(parentUniverse, migrationProxy) == 0
auctionableRepAtFork >= postBurnMigrationRep
all REP sent to proxy is either burned, migration-ledgered, or recoverably accounted
```

Observed vulnerable behavior when `totalRepSentToProxy > forkThreshold`:

```text
REP(parentUniverse, migrationProxy) == totalRepSentToProxy - forkThreshold
auctionableRepAtFork == postBurnMigrationRep
leftover proxy REP is omitted from vaultRepAtFork and escalation child-REP buckets
```

### Existing test anchor

`solidity/ts/tests/peripherals.test.ts` has `migration proxy balances match the expected lock and sweep flow`, which correctly checks that external-fork initiation does not leave parent REP in the proxy after `lockRep`.

Own-fork tests such as `own-fork unlocked vault migration values child ownership against the vault REP bucket` already create the more dangerous setup with extra vault REP and escalation REP, but they validate only internal bucket consistency after the reduced `auctionableRepAtFork` has been recorded. The C-02 PoC adds the missing proxy parent-REP balance assertion immediately after `forkZoltarWithOwnEscalationGame`.

### Fix acceptance criteria

A complete fix should make all of these true:

- `SecurityPoolMigrationProxy` has zero raw parent-universe REP after own-fork setup, unless the remainder is in an explicit tested recovery bucket.
- `auctionableRepAtFork` includes every non-burned unit of REP that should be split into child pools.
- `vaultRepAtFork + unallocatedEscrowChildRep` reconciles to the accounted child-REP amount after burn treatment and rounding.
- Own-fork and external-fork migration proxy tests both assert zero unaccounted parent REP after setup.

## Cross-Flow Regression Tests

Add or keep regression tests covering:

- External fork, partial migration, truth auction with a clearing bid, then finalization and auction proceeds claim.
- Own fork with `poolRepToFork + escalationRepToFork > forkThreshold`, then immediate proxy-balance reconciliation.
- Own fork with all vault REP migrated to one child, then child REP and child ETH reconciliation.
- Own fork with split escalation claims in multiple orders, verifying child REP allocation is order independent and globally conserved.
- Recursive child fork after a parent truth auction, verifying no ETH or REP remains stranded in the old forker or proxy contracts.
