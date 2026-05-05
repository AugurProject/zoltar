# Augur Placeholder White Paper

## Abstract

Augur Placeholder is a prediction-market and oracle-security protocol built on top of Zoltar. Zoltar supplies forkable universes, question registration, outcome encoding, and REP migration across disputed branches of reality. Augur Placeholder adds question-specific security pools, ETH-collateralized complete sets, escalation-driven local resolution, and a fork-recovery path that migrates economic state into child universes and, when needed, restores missing collateral through a truth auction.

The result is a layered design. Zoltar provides the base mechanism for turning unresolved disagreement into explicit child universes. Augur Placeholder uses that substrate to let REP vaults underwrite open interest, traders hold outcome shares backed by collateral, and disputes resolve locally whenever possible before escalating into a Zoltar fork.

## 1. System Overview

The stack in this repository has two distinct protocol identities.

- `Zoltar` is the base oracle substrate.
- `Augur Placeholder` is the application layer built on top of Zoltar.

For the Zoltar substrate itself, including universes, question encoding, scalar math, and REP migration, see [whitepaper_zoltar.md](./whitepaper_zoltar.md).

Augur Placeholder is responsible for the economic system on top of that substrate:

- per-question security pools
- REP-backed underwriting
- [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) complete sets and outcome shares
- a local escalation game
- migration of pool state after a fork
- a batch auction that can restore missing collateral in a surviving branch

Contract responsibility map:

- [`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol): question-specific underwriting and collateral engine
- [`EscalationGame`](../solidity/contracts/peripherals/EscalationGame.sol): local dispute and non-decision mechanism
- [`SecurityPoolForker`](../solidity/contracts/peripherals/SecurityPoolForker.sol): pool migration across child universes
- [`UniformPriceDualCapBatchAuction`](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol): truth auction for missing collateral
- [`PriceOracleManagerAndOperatorQueuer`](../solidity/contracts/peripherals/PriceOracleManagerAndOperatorQueuer.sol): REP/ETH solvency price operations
- [`ShareToken`](../solidity/contracts/peripherals/tokens/ShareToken.sol): [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) positions and fork-aware share migration

Terminology:

- `Complete set`: one `Invalid`, one `Yes`, and one `No` share for an Augur Placeholder binary market
- `Security bond allowance`: the amount of open interest a vault chooses to underwrite
- `Non-decision`: an escalation-game state where disagreement remains unresolved and a fork path becomes available
- `Binding capital`: the median of the three escalation-game outcome balances, used to determine the effective game endpoint

```
                         +----------------------+
                         |      Zoltar          |
                         | universes, forks,    |
                         | questions, REP split |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         | Augur Placeholder    |
                         | pools, shares,       |
                         | escalation, migration|
                         | truth auction        |
                         +----------------------+
```

## 2. Architecture

Augur Placeholder is the system described by the peripheral contracts. It extends Zoltar with an underwriting and collateral system around individual questions.

At a high level, Augur Placeholder adds:

- one security pool per question per universe
- REP vaults that underwrite open interest
- ETH-backed complete sets and redeemable outcome shares
- a local escalation game that tries to settle disputes before a global fork
- migration of pool state into child universes after a Zoltar fork
- a truth auction that can sell REP for ETH when a child pool needs to rebuild missing collateral

In other words, Zoltar defines how reality branches, and Augur Placeholder defines how economic positions survive, migrate, and remain collateralized across those branches.

## 3. Core Economic Roles

Augur Placeholder introduces a set of economic roles above the Zoltar substrate.

- Question creators register questions in Zoltar question data, creating the objects around which Placeholder markets can be built.
- REP vault operators deposit REP into a security pool and provide oracle security capacity. Their deposits back open interest and earn fees extracted from collateral over time.
- Traders mint complete sets with ETH and hold outcome shares.
- Escalation-game participants stake behind `Invalid`, `Yes`, or `No` after a question ends in order to settle locally or force a non-decision.
- Fork migrators move REP, shares, and vault state from a parent universe into child universes after a Zoltar fork.
- Truth-auction bidders buy REP with ETH when a child branch needs to restore missing collateral.
- Liquidators move undercollateralized bond allowance away from unsafe vaults.
- Price reporters and settlers in the OpenOracle flow supply a REP/ETH solvency price used for bond accounting, not a truth outcome for the question itself.

These roles are separate on purpose. Zoltar handles epistemic branching; Augur Placeholder handles underwriting, collateral, and post-fork economic continuity.

## 4. Security Pools

[`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol) is the central Augur Placeholder contract. A security pool is defined for one question, one universe, and one collateral denomination. In the current implementation that denomination is ETH, and that ETH-denominated structure is not just a deployment choice but the contract design itself.

### Vault deposits and pool ownership

REP vault operators call `depositRep` to transfer REP into the pool. In return they receive internal pool-ownership accounting rather than a separate token. Pool ownership tracks each vault’s claim on the REP held by the pool.

Each vault can choose a `securityBondAllowance`. This is the amount of open interest that the vault is willing to underwrite. The pool enforces both local and global solvency conditions using the REP/ETH price from `PriceOracleManagerAndOperatorQueuer`.

At the vault level, the solvency condition enforced by operations such as `performWithdrawRep` is:

`remaining REP backing * PRICE_PRECISION >= securityBondAllowance * REP/ETH price`

Here the oracle price is oriented as:

`REP/ETH price = REP * PRICE_PRECISION / ETH`

At the liquidation boundary, the system uses the stronger condition that includes the pool’s chosen security multiplier:

`vault is liquidable if securityBondAllowance * securityMultiplier * REP/ETH price > REP backing * PRICE_PRECISION`

The contract applies related conditions both at the vault level and at the whole-pool level before allowing operations such as `performWithdrawRep`, `performLiquidation`, and `performSetSecurityBondsAllowance`.

### Traders and complete sets

Traders call `createCompleteSet` with ETH. The pool mints a complete set of [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) shares through `ShareToken`, one unit each of `Invalid`, `Yes`, and `No` for the current universe. The deposited ETH becomes `completeSetCollateralAmount`.

Before finalization, a full complete set can be burned with `redeemCompleteSet` to recover its pro rata share of collateral.

### Fee extraction and retention rate

The pool gradually converts part of complete-set collateral into fees owed to REP vaults. This is tracked through:

- `completeSetCollateralAmount`
- `totalFeesOwedToVaults`
- `feeIndex`
- `currentRetentionRate`

The retention rate is updated as utilization changes. The current curve in [`SecurityPoolUtils.calculateRetentionRate`](../solidity/contracts/peripherals/SecurityPoolUtils.sol) is heuristic: it begins at a high retention rate, declines linearly until 80% utilization, and then bottoms out at a lower rate.

The utilization proxy is:

`utilization = completeSetCollateralAmount / totalSecurityBondAllowance`

and the collateral base decays over time approximately as:

`collateral(t + dt) = collateral(t) * retentionRate^dt`

with the lost portion becoming fees owed to REP vaults.

### Solvency operations

REP withdrawal, liquidation, and bond-allowance updates depend on a valid REP/ETH price. Those operations are executed only when the pool remains solvent after the proposed change.

### Liquidation

Liquidation in Augur Placeholder is a transfer of risk, not a direct sale of collateral. When a vault becomes undercollateralized relative to its `securityBondAllowance`, oracle price, and `securityMultiplier`, another vault can call `performLiquidation` through the queued-oracle path. The contract snapshots the target vault’s state at queue time, then uses that snapshot when the operation executes so that later state changes cannot trivially invalidate the liquidation attempt.

Economically, liquidation moves some amount of debt and a corresponding amount of REP-backed ownership from the target vault to the caller vault. The receiving vault must remain solvent after taking on that additional debt, and both sides must still satisfy the minimum deposit requirements enforced by the pool. In the current implementation, this mechanism is intentionally strict: it is designed to move underwriting responsibility away from an unsafe vault and into one that can still support it.

Security pools are therefore an Augur Placeholder feature, not a Zoltar feature. They turn REP into underwriting capacity for a collateral-backed outcome market.

## 5. Shares and Complete Sets

[`ShareToken`](../solidity/contracts/peripherals/tokens/ShareToken.sol) is an [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) contract used by Augur Placeholder to represent outcome positions.

For each complete set:

- one `Invalid` share is minted
- one `Yes` share is minted
- one `No` share is minted

The token id encodes both universe id and outcome. This makes the same question’s positions fork-aware across universes.

Before finalization, a user who holds a complete set can burn all three legs and recover collateral through the parent security pool. After finalization, a user can redeem only the winning outcome through `redeemShares`.

At the implementation level, `redeemShares` burns the winning token id and pays `sharesToCash(amount)` out of the pool’s current collateral accounting. In the healthy case, this should correspond to a clean `1:1` redemption outcome against the economic meaning of a complete-set claim, subject to the pool’s collateral accounting remaining intact through migration and any required auction repair. The important edge case is fork recovery: if a child pool emerges from migration with incomplete collateral, the truth auction exists to sell REP for ETH so that the child branch can restore the collateral base needed for clean redemption.

Shares can also migrate across forks. `ShareToken.migrate` burns a parent-universe token id and mints corresponding child-universe token ids for one or more target outcomes, provided the target outcomes are valid and non-malformed for the fork question. If multiple target outcomes are selected, the holder’s full burned balance is reproduced into each selected child branch. This colored-coin style branching behavior depends directly on Zoltar’s universe and fork state, which is described in [whitepaper_zoltar.md](./whitepaper_zoltar.md).

## 6. Escalation Resolution

Augur Placeholder does not require every dispute to become a Zoltar fork. Instead it first attempts local resolution through [`EscalationGame`](../solidity/contracts/peripherals/EscalationGame.sol).

### Basic structure

The escalation game becomes available after the question end time. It is started lazily on first use and currently uses a fixed initial bond parameter in `SecurityPool.depositToEscalationGame`.

Participants stake behind one of three outcomes:

- `Invalid`
- `Yes`
- `No`

The required attrition cost rises from `startBond` to `nonDecisionThreshold` over a seven-week interval. The contract computes this curve from an exponential form and exposes both forward and inverse calculations.

If `s` is `startBond`, `n` is `nonDecisionThreshold`, `t` is elapsed time, and `T` is the full escalation interval, the intended cost curve is:

`cost(t) = s * exp( ln(n / s) * t / T )`

This gives:

- `cost(0) = s`
- `cost(T) = n`
- monotonic growth between those endpoints

### Resolution rule

At any point, the contract tracks three outcome balances. Two related but distinct thresholds matter.

- Against the current running `totalCost()`, if two or more outcomes are above threshold, `getQuestionResolution()` returns `None`. This means the game is still unresolved at the current point in time.
- Against the fixed `nonDecisionThreshold`, if two or more outcomes reach that level, `hasReachedNonDecision()` becomes true. That is the stronger condition that marks genuine non-decision and opens the fork path.
- If time expires without that stronger non-decision condition, the uniquely highest balance wins.

Economically, the contract distinguishes between “the contest is still live” and “local capital failed to converge strongly enough that the system should escalate toward a fork.” The paper should preserve that distinction because the contracts do.

The contract also tracks the `binding capital`, which is the median of the three balances. This determines the effective end date of the game when the system times out naturally instead of reaching non-decision.

The median matters because the game is trying to detect whether disagreement remains live across multiple sides rather than merely whether one side has accumulated the most stake. In that sense, `binding capital` measures the level at which the contest is still jointly sustained by competing outcomes, which is why it is the relevant quantity for timeout and payout logic.

### Payout rule

Winning deposits are not paid out uniformly.

- Deposits above the binding capital can be returned at par.
- Deposits crossing the binding-capital boundary can receive mixed treatment.
- Deposits fully inside the binding region can be doubled and then haircut.

The current winning-side payout logic can therefore return more than the original deposit for some winning positions. It can also reduce payouts through a burn or haircut mechanism. Finally, payouts are scaled down if the actual Zoltar fork threshold is lower than the game-level `nonDecisionThreshold`.

The escalation game is thus an Augur Placeholder mechanism layered on top of Zoltar to avoid unnecessary global forks while still providing a path to fork when disagreement remains unresolved.

```
Question end
    |
    v
+-------------------------+
| Placeholder             |
| EscalationGame          |
+-----------+-------------+
            |
            +--------------------> unique winner before/at timeout
            |                      -> local finalization
            |
            +--------------------> non-decision
                                   -> Zoltar fork path
```

## 7. Forks and Migration Across Layers

Fork handling spans both layers.

At the Zoltar layer, universes fork and REP migrates into child branches. At the Augur Placeholder layer, the parent `SecurityPool` and its economic state must also move.

The pool states are:

- `Operational`
- `PoolForked`
- `ForkMigration`
- `ForkTruthAuction`

[`SecurityPoolForker`](../solidity/contracts/peripherals/SecurityPoolForker.sol) coordinates this transition.

State-machine view:

| State | Meaning | Typical transition out |
| --- | --- | --- |
| `Operational` | normal pool operation outside the explicit fork/migration lifecycle | the question may resolve locally without entering a dedicated terminal `SystemState`, or the pool may activate fork handling |
| `PoolForked` | parent pool has stopped normal operation after fork | child pools begin migration setup |
| `ForkMigration` | child pool is receiving migrated vaults, REP-derived state, and collateral | migration window ends |
| `ForkTruthAuction` | child pool is repairing missing collateral with REP sale | auction finalizes and pool returns to `Operational` |

This is a subtle but important point: `SystemState` is primarily a fork-and-migration state machine, not a generic question-resolution state machine.

After a Zoltar fork:

- the parent pool enters fork mode
- child security pools are created in child universes
- vaults can call `migrateVault` to move pool ownership and bond allowance
- escalation-game winnings can migrate into child pools through `migrateFromEscalationGame`
- parent collateral is partially transferred into child pools in proportion to migrated REP
- shares migrate independently through `ShareToken.migrate`

This separation is important. REP migration is a Zoltar primitive, described in [whitepaper_zoltar.md](./whitepaper_zoltar.md). Vault migration, collateral transfer, and child-pool initialization are Augur Placeholder primitives built on top of it.

### Example: a post-fork branch

Consider the following purely illustrative toy example for a binary Augur Placeholder market in universe `U0`:

- `100 ETH` of parent-pool collateral
- `100 ETH` of effective complete-set obligations
- a forked question whose `Yes` child universe attracts `60%` of migrated REP

The contracts do not simply say “60% of REP means exactly 60% of all collateral in every case.” This toy example is only meant to illustrate the economic shape of the problem. Suppose the `Yes` child branch ends up with only `60 ETH` of effective collateral support, even though the surviving branch would ideally like to support the full `100 ETH` of clean claims. That leaves a `40 ETH` collateral gap. In the actual contract path, the repair target is computed from parent collateral, migrated REP, and `repAtFork`, as described in Section 8.

```
Parent universe U0
    |
    | fork on disputed question
    v
+---------------------------+
| Zoltar child universe UY  |
| outcome: Yes              |
| migrated REP: 60%         |
+-------------+-------------+
              |
              v
+---------------------------+
| Placeholder child pool    |
| migrated collateral: 60 ETH |
| target collateral: 100 ETH  |
| gap: 40 ETH               |
+-------------+-------------+
              |
              v
+---------------------------+
| Truth auction             |
| sell child REP for ETH    |
+-------------+-------------+
              |
              v
+---------------------------+
| Repaired child pool       |
| resumes operation         |
+---------------------------+
```

In that case:

1. Zoltar handles the universe fork and REP migration into the `Yes` child universe.
2. The Placeholder parent pool then separately enters its own fork lifecycle through `initiateSecurityPoolFork` and `activateForkMode`. The Zoltar fork and the pool-fork transition are related, but they are not the same contract step.
3. Augur Placeholder creates the `Yes` child pool and migrates vault state and any eligible escalation-game winnings into it through `migrateVault` and `migrateFromEscalationGame`.
4. Because the child pool does not yet have the collateral base it wants, `startTruthAuction` begins a sale of child-universe REP for ETH.
5. Bidders contribute ETH. If the auction succeeds, the child pool pulls in the missing ETH and can resume operation with a repaired collateral base.
6. If the auction is underfunded, the branch still continues, but collateral repair was incomplete.

This is why the truth auction exists: not to decide truth, but to convert surviving-branch REP into the ETH needed to restore clean collateralization after a fork.

## 8. Truth Auction

The truth auction belongs to Augur Placeholder, not to Zoltar.

After migration, a child pool may still have less ETH collateral than is needed to represent the full surviving branch. This happens because migration can move less than the full parent-side economic state into that child universe.

More precisely, the parent pool may have outstanding complete-set obligations and collateral that were economically tied to the parent universe, while only some fraction of REP-backed security and vault state migrates into a given child branch. The child branch may therefore inherit a partial economic state: enough to exist, but not enough to cleanly support the level of collateralization that the surviving branch would want if it were to continue as a standalone market.

To repair that mismatch, the child pool can sell REP through [`UniformPriceDualCapBatchAuction`](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol).

In the actual `startTruthAuction` logic, the ETH repair target is:

`ethToBuy = parentCollateral - parentCollateral * migratedRep / repAtFork`

This is the contract’s direct statement of the gap: how much ETH collateral the child branch is still missing after accounting for the fraction of REP-backed state that has already migrated into it.

### Auction mechanics

- bidders submit ETH bids at ticks representing ETH/REP prices
- the auction maintains aggregate bid depth by tick
- finalization computes a clearing tick
- bids above the clearing tick win fully
- bids below the clearing tick lose and receive refunds
- bids at the clearing tick can be partially filled

If the auction is underfunded, the contract switches to threshold-based logic that allocates REP proportionally among bids above the underfunded threshold price.

The purpose of this auction is to let a child Augur Placeholder branch reassemble collateral completeness after a Zoltar fork. REP is sold here because it is the branch-native scarce asset that migrated with epistemic legitimacy into the child universe. The auction converts part of that security capital back into the ETH collateral required for the child market to continue operating cleanly. Put differently, it monetizes branch-native REP, not trader share balances or direct vault claims.

```
Zoltar fork
    |
    v
Parent Placeholder pool
    |
    +--> child pool created
    |
    +--> vaults / shares / collateral migrate
    |
    +--> if collateral is incomplete
           |
           v
      Truth auction sells REP for ETH
           |
           v
      Child pool returns to Operational
```

## 9. REP/ETH Price Oracle

The REP/ETH oracle subsystem is narrow in purpose and should not be confused with market-truth resolution.

[`PriceOracleManagerAndOperatorQueuer`](../solidity/contracts/peripherals/PriceOracleManagerAndOperatorQueuer.sol) uses [`OpenOracle`](../solidity/contracts/peripherals/openOracle/OpenOracle.sol) to request a fresh REP/ETH price when needed. This price is used only for solvency-sensitive security-pool operations such as:

- liquidation
- REP withdrawal
- setting security bond allowance

If the last price is stale, these operations can be queued until a valid report is settled. The manager then replays the pending operation against the fresh price.

This is therefore not the oracle for determining whether a question resolves `Yes`, `No`, or `Invalid`. That truth path is handled by the escalation game and, if necessary, the Zoltar fork system. The REP/ETH oracle exists only to price security backing against ETH collateral.

## 10. End-to-End Example

An end-to-end lifecycle under the current contracts looks like this:

1. A binary question is registered in [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol).
2. An Augur Placeholder origin security pool is deployed for that question through [`SecurityPoolFactory`](../solidity/contracts/peripherals/factories/SecurityPoolFactory.sol). The current implementation requires the exact categorical outcomes `Yes` and `No`.
3. REP vault operators deposit REP with `depositRep` and set bond allowance, thereby funding security capacity.
4. Traders mint ETH-backed complete sets through `createCompleteSet` and receive `Invalid`, `Yes`, and `No` [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) shares.
5. The question end time arrives.
6. Participants use the Placeholder escalation game to attempt local resolution.
7. If the escalation game converges, the question finalizes locally and winning shares can be redeemed.
8. If the escalation game reaches non-decision, a Zoltar fork path can be triggered.
9. Zoltar-side REP branching and Placeholder-side pool branching are related but distinct. The universe forks in Zoltar, and the parent pool then separately moves out of `Operational` state through `initiateSecurityPoolFork` and related logic.
10. REP migrates in Zoltar into child universes. Placeholder vaults, collateral, and shares then migrate into child pools through calls such as `migrateVault`.
11. If a child pool lacks enough ETH collateral after migration, it starts a truth auction with `startTruthAuction` and sells REP for ETH.
12. The surviving child pool resumes operation, or users redeem final payouts once the outcome becomes final in that branch.

## 11. Current Implementation Constraints

The current repository exposes several implementation constraints.

- Origin security pools currently support only the exact categorical market shape `Yes / No`, with `Invalid` added as the third Placeholder trading and resolution outcome.
- The fork threshold divisor, fork-burn divisor, escalation-game initial deposit, retention-rate bounds, retention-rate dip point, and several oracle and auction tuning parameters are fixed constants in the current implementation and should be read as current design parameters rather than as dynamically governed values.
- The retention-rate curve in [`SecurityPoolUtils`](../solidity/contracts/peripherals/SecurityPoolUtils.sol) is heuristic rather than final market design.
- Some comments acknowledge open accounting questions around child-pool complete-set behavior.
- The background design ideas are broader and more generalized than the contracts currently implemented in this repository.
- This implementation is strongest where it specifies fork handling, migration, underwriting, and collateral continuity across disputed branches.

## 12. Design Thesis

Zoltar provides the forkable oracle base, and Augur Placeholder turns that substrate into a collateralized, security-backed prediction-market system. REP vaults underwrite open interest, traders hold complete sets and outcome shares backed by ETH collateral, and disputes attempt to resolve locally through escalation before falling back to a Zoltar fork. Afterward, structured migration and truth auctions let the surviving branch rebuild a coherent economic state.
