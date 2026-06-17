# Augur Placeholder White Paper

## Abstract

Augur Placeholder is a prediction-market and oracle-security protocol built on top of Zoltar. Zoltar supplies forkable universes, question registration, outcome encoding, and post-fork REP splitting across disputed child universes. Augur Placeholder adds question-specific security pools, ETH-collateralized complete sets, escalation-driven local resolution, and a fork-recovery path that migrates economic state into child universes and, when needed, restores missing collateral through a truth auction.

In practice, REP vaults underwrite open interest, users mint ETH-backed outcome shares, disputes try to resolve locally, and Zoltar forks are used only when local resolution fails.

## 1. System Overview

The stack in this repository has two distinct protocol identities.

- `Zoltar` is the base oracle substrate.
- `Augur Placeholder` is the application layer built on top of Zoltar.

For the Zoltar substrate itself, including universes, question encoding, scalar math, and post-fork REP splitting, see [whitepaper_zoltar.md](./whitepaper_zoltar.md) or the visual HTML edition at [whitepaper_zoltar.html](./whitepaper_zoltar.html). This paper focuses on the market, underwriting, and collateral system layered above it.

Augur Placeholder is responsible for the economic system on top of that substrate:

- per-question security pools
- REP-backed underwriting
- [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) complete sets and outcome shares
- a local escalation game
- migration of pool state after a fork
- a batch auction that can restore missing collateral in a surviving child universe

What it does not add is an exchange venue. Users can receive `Invalid`, `Yes`, and `No` shares from complete sets and can transfer those [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) positions to other users, but secondary-market trading is left outside Placeholder itself.

Protocol flow in one pass:

1. A question is registered in Zoltar and a Placeholder security pool is deployed for that question in one universe.
2. REP vaults fund underwriting capacity and users mint ETH-backed complete sets.
3. After question end, disputes first try to resolve locally through the escalation game.
4. If local resolution fails and the system reaches non-decision, Zoltar forks and Placeholder migrates pool state into child universes.
5. If a child pool is missing ETH collateral after migration, it can sell child-universe REP through a truth auction to repair that collateral gap.
6. The child pool in the economically dominant child universe resumes operation and users settle or redeem positions there.

Lifecycle state machine:

```
Operational parent pool
        |
        v
 Question ends
        |
        v
 Escalation game
   |            |
   | resolves   | non-decision
   v            v
 Finalization   Zoltar fork
                     |
                     v
          Parent pool migration
                     |
                     v
            Child pool created
                     |
                     v
      Truth auction only if collateral is short
                     |
                     v
          Operational child pool
```

Contract responsibility map:

- [`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol): question-specific underwriting and collateral engine
- [`EscalationGame`](../solidity/contracts/peripherals/EscalationGame.sol): local dispute and non-decision mechanism
- [`SecurityPoolForker`](../solidity/contracts/peripherals/SecurityPoolForker.sol): pool migration across child universes
- [`UniformPriceDualCapBatchAuction`](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol): truth auction for missing collateral
- [`SecurityPoolOracleCoordinator`](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol): REP/ETH solvency price operations
- [`ShareToken`](../solidity/contracts/peripherals/tokens/ShareToken.sol): [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) positions and fork-aware share migration

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

Augur Placeholder is the system described by the peripheral contracts. Architecturally, it wraps each Zoltar question with a question-specific underwriting, collateral, dispute, migration, and collateral-repair system. The sections below unpack those pieces in contract terms rather than repeating the overview list above.

### Glossary

- `universe`: a Zoltar fork domain. A parent universe can split into multiple child universes after a fork.
- `pool`: an Augur Placeholder `SecurityPool` for one question in one universe.
- `vault`: a pool-specific REP account whose owner provides underwriting capacity.
- `complete set`: one `Invalid`, one `Yes`, and one `No` share minted together against ETH collateral.
- `escalation game`: the local dispute process that tries to pick a single winning outcome before a fork.
- `non-decision`: the unresolved escalation state that opens the Zoltar fork path.
- `migration`: the process that moves REP, shares, collateral accounting, and eligible escalation positions from a parent pool into child pools.
- `truth auction`: the batch auction that lets a child pool sell child-universe REP for ETH when migrated collateral is incomplete.
- `migrated REP`: REP backing that has been carried from a parent universe into a child universe and is available to support the child pool.

## 3. Core Economic Roles

Augur Placeholder introduces a set of economic roles above the Zoltar substrate.

- Question creators register questions in Zoltar question data, creating the objects around which Placeholder markets can be built.
- REP vault operators deposit REP into a security pool and provide oracle security capacity. Their deposits back open interest and earn fees extracted from collateral over time.
- Users mint complete sets with ETH and hold outcome shares.
- Escalation-game participants stake behind `Invalid`, `Yes`, or `No` after a question ends in order to settle locally or force a non-decision, meaning an unresolved state that opens the fork path.
- Fork migrators move REP, shares, and vault state from a parent universe into child universes after a Zoltar fork.
- Truth-auction bidders buy REP with ETH when a child pool in a child universe needs to restore missing collateral.
- Liquidators move undercollateralized bond allowance away from unsafe vaults.
- Price reporters and settlers in the OpenOracle flow supply a REP/ETH solvency price for bond accounting, not a truth outcome for the question itself.

## 4. Security Pools

[`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol) is the central Augur Placeholder contract. A security pool is defined for one question, one universe, and one collateral denomination. In the current implementation that denomination is ETH, and that ETH-denominated structure is the contract design itself.

### Vault deposits and pool ownership

REP vault operators call `depositRep` to transfer REP into the pool. In return they receive internal pool-ownership accounting rather than a separate token. Pool ownership tracks each vault’s claim on the REP held by the pool.

Each vault can choose a `securityBondAllowance`. This is the amount of open interest that the vault is willing to underwrite. The pool enforces both local and global solvency conditions using the REP/ETH price from `SecurityPoolOracleCoordinator`.

```
Vault operator
    |
    | depositRep(REP)
    v
+----------------------+
| SecurityPool         |
| holds pooled REP     |
+----------------------+
    |
    +--> internal pool ownership accounting
    |
    +--> securityBondAllowance chosen by vault
              |
              v
      open-interest underwriting capacity
              |
              v
   solvency checks gate:
   - withdraw REP
   - raise allowance
   - liquidation status
```

At the vault level, the solvency condition enforced by operations such as `performWithdrawRep` is:

$$
\text{remainingRepBacking} \cdot \text{pricePrecision} \geq \text{securityBondAllowance} \cdot \text{repPerEthPrice}
$$

Here `repPerEthPrice` is oriented as:

$$
\text{repPerEthPrice} = \frac{\text{repAmount} \cdot \text{pricePrecision}}{\text{ethAmount}}
$$

At the liquidation boundary, the system uses a stronger condition that includes the pool’s chosen security multiplier:

$$
\text{vaultIsLiquidable if } \text{securityBondAllowance} \cdot \text{securityMultiplier} \cdot \text{repPerEthPrice} > \text{repBacking} \cdot \text{pricePrecision}
$$

The contract applies related conditions both at the vault level and at the whole-pool level before allowing operations such as `performWithdrawRep`, `performLiquidation`, and `performSetSecurityBondsAllowance`.

### Users and complete sets

Users call `createCompleteSet` with ETH. The pool mints a complete set, meaning one `Invalid`, one `Yes`, and one `No` [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) share, through `ShareToken` for the current universe. The deposited ETH becomes `completeSetCollateralAmount`.

Complete-set lifecycle:

- before finalization, a full complete set can be burned with `redeemCompleteSet` to recover its pro rata share of collateral
- after finalization, users redeem only the winning outcome through `redeemShares`, as described in Section 5

### Fee extraction and retention rate

The pool gradually converts part of complete-set collateral into fees owed to REP vaults. This is tracked through:

- `completeSetCollateralAmount`
- `totalFeesOwedToVaults`
- `feeIndex`
- `currentRetentionRate`

```
time -->
+----------------------------------------------+
| completeSetCollateralAmount                  |
| starts higher, then decays gradually         |
+----------------------------------------------+
                    |
                    | retained portion shrinks
                    v
+----------------------------------------------+
| totalFeesOwedToVaults                        |
| starts lower, then grows over time           |
+----------------------------------------------+

utilization rises
    ->
retention rate falls
    ->
collateral decays faster into vault fees
```

The retention rate is updated as utilization changes. The current curve in [`SecurityPoolUtils.calculateRetentionRate`](../solidity/contracts/peripherals/SecurityPoolUtils.sol) is heuristic: it begins at a high retention rate, declines linearly until 80% utilization, and then bottoms out at a lower rate. The intent is to charge more aggressively for security as utilization rises and available underwriting slack falls.

When `totalSecurityBondAllowance > 0`, the utilization proxy is:

$$
\text{utilization} = \frac{\text{completeSetCollateralAmount}}{\text{totalSecurityBondAllowance}}
$$

and the collateral base decays over time approximately as:

$$
\text{collateralAtLaterTime} = \text{collateralAtCurrentTime} \cdot \text{retentionRate}^{\text{elapsedTime}}
$$

with the lost portion becoming fees owed to REP vaults.

### Solvency operations

REP withdrawal, liquidation, and bond-allowance updates depend on a valid REP/ETH price. Withdrawal and allowance changes check backing against allowance, while liquidation applies the stronger `securityMultiplier`-adjusted liquidability condition.

### Liquidation

Liquidation in Augur Placeholder is a transfer of risk, not a direct sale of collateral. When a vault becomes undercollateralized relative to its `securityBondAllowance`, oracle price, and `securityMultiplier`, another vault can call `performLiquidation` through the queued-oracle path. The contract snapshots the target vault’s state at queue time, then uses that snapshot when the operation executes so that later target-vault manipulation cannot trivially invalidate the liquidation attempt.

Economically, liquidation moves some amount of debt and a corresponding amount of REP-backed ownership from the target vault to the caller vault. The receiving vault must remain solvent after taking on that additional debt, and both sides must still satisfy the minimum deposit requirements enforced by the pool. In the current implementation, this mechanism is intentionally strict: it is designed to move underwriting responsibility away from an unsafe vault and into one that can still support it.

```
Before liquidation

Unsafe vault                     Liquidator vault
- REP backing: too low          - REP backing: sufficient
- bond allowance: too high      - bond allowance: can absorb more
- at liquidation boundary

                performLiquidation
                         |
                         v

After liquidation

Unsafe vault                     Liquidator vault
- less debt / less ownership    - more debt / more ownership
- reduced risk                  - increased underwriting role
```

## 5. Shares and Complete Sets

[`ShareToken`](../solidity/contracts/peripherals/tokens/ShareToken.sol) is an [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) contract used by Augur Placeholder to represent outcome positions.

Those positions are transferable with the standard [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) token mechanics, so users can move shares to other users.

For each complete set:

- one `Invalid` share is minted
- one `Yes` share is minted
- one `No` share is minted

The token id encodes both universe id and outcome. This makes the same question’s positions fork-aware across universes.

```
User sends ETH
    |
    v
createCompleteSet
    |
    v
receives one full set:
[Invalid] [Yes] [No]

Before finalization:
[Invalid] + [Yes] + [No]
            |
            v
    redeemCompleteSet
            |
            v
        collateral back

After finalization:
hold winning leg only
            |
            v
       redeemShares
            |
            v
   winning payout only
```

Because the legs are ERC-1155 positions, they can be transferred between users before either redemption path is exercised.

Before finalization, a user who holds a complete set can burn all three legs and recover collateral through the parent security pool. After finalization, a user can redeem only the winning outcome through `redeemShares`.

At the implementation level, `redeemShares` burns the holder’s full balance of the winning token id and pays `sharesToCash(amount)` out of the pool’s current collateral accounting. In the healthy case, this should correspond to a clean `1:1` redemption outcome against the economic meaning of a complete-set claim, subject to the pool’s collateral accounting remaining intact through migration and any required auction repair. The important edge case is fork recovery: if a child pool emerges from migration with incomplete collateral, the truth auction exists to sell REP for ETH so that the child pool can restore the collateral base needed for clean redemption.

Shares can also migrate across forks. `ShareToken.migrate` burns a parent-universe token id and mints corresponding child-universe token ids for one or more target outcomes, provided the target outcomes are valid and non-malformed for the fork question. If multiple target outcomes are selected, the holder’s full burned balance is reproduced into each selected child universe. This colored-coin style duplication behavior depends directly on Zoltar’s universe and fork state, which is described in [whitepaper_zoltar.md](./whitepaper_zoltar.md).

## 6. Escalation Resolution

Augur Placeholder does not require every dispute to become a Zoltar fork. Instead it first attempts local resolution through [`EscalationGame`](../solidity/contracts/peripherals/EscalationGame.sol).

### Basic structure

The escalation game becomes available after the question end time. It is started lazily on first use and currently uses a fixed initial bond parameter in `SecurityPool.depositToEscalationGame`.

Participants stake behind one of three outcomes:

- `Invalid`
- `Yes`
- `No`

The required attrition cost rises from `startBond` to `nonDecisionThreshold` over a seven-week interval. The contract computes this curve from an exponential form and exposes both forward and inverse calculations.

Using descriptive names for the contract’s escalation parameters, the intended cost curve is:

$$
\text{requiredEscalationCost}(\text{elapsedTime}) = \text{startingBondAmount} \cdot \exp\left(\ln\left(\frac{\text{nonDecisionThresholdAmount}}{\text{startingBondAmount}}\right) \cdot \frac{\text{elapsedTime}}{\text{fullEscalationInterval}}\right)
$$

This gives the expected endpoint behavior:

- `requiredEscalationCost(0) = startingBondAmount`
- `requiredEscalationCost(fullEscalationInterval) = nonDecisionThresholdAmount`
- monotonic growth between those endpoints

### Resolution rule

At any point, the contract tracks three outcome balances. Two related but distinct thresholds matter.

- Against the current running `totalCost()`, if two or more outcomes are above threshold, `getQuestionResolution()` returns `None`. This means the game is still unresolved at the current point in time.
- Against the fixed `nonDecisionThreshold`, if two or more outcomes reach that level, `hasReachedNonDecision()` becomes true. That is the stronger condition that marks genuine non-decision and opens the fork path.
- If time expires without that stronger non-decision condition, the uniquely highest balance wins.

This distinguishes between a contest that is still live at the current running threshold and a stronger non-decision state that opens the fork path.

The same balances are compared against two different thresholds for two different purposes.

```
Three tracked balances:
- Invalid
- Yes
- No

Compare against running totalCost():
- two or more above threshold -> resolution stays None
- one side uniquely leads     -> contest may still resolve locally

Compare against fixed nonDecisionThreshold:
- two or more above threshold -> true non-decision
                                 -> fork path opens
```

The contract also tracks the `binding capital`, which is the median of the three balances. This determines the effective end date of the game when the system times out naturally instead of reaching non-decision.

The median matters because the game is trying to detect whether disagreement remains live across multiple sides rather than merely whether one side has accumulated the most stake. In that sense, `binding capital` measures the level at which the contest is still jointly sustained by competing outcomes, which is why it is the relevant quantity for timeout and payout logic.

### Payout rule

Winning deposits are paid by `claimDepositForWinning`, and the payout depends on where that deposit sits relative to the final `binding capital`.

```
Winning deposit position relative to final binding capital

0 ---------------- binding capital -------- reward-eligible cap -------->

Case 1: below binding capital
[======== deposit ========]
payout = principal + pro-rata share of the reward pool

Case 2: safety boundary
                         [======== deposit ========]
payout = principal + pro-rata share of the same reward pool

Case 3: excess
                                                   [==== deposit ====]
payout = 1.0x on entire deposit
```

- The binding-capital region defines a fixed reward pool.
- `40%` of that binding-capital region is burned or retained, so the remaining `60%` becomes the reward pool.
- All winning capital in the reward-eligible window shares that fixed reward pool pro rata.
- The reward-eligible window extends to `bindingCapitalAmount + floor(bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR)`.
- The region between `bindingCapitalAmount` and that cap is the `safety boundary`.
- Winning capital above the reward-eligible cap is excess and gets principal back with no additional reward.

In code terms, the contract computes an `amountToWithdraw` from the winning deposit record and emits that result through `ClaimDeposit`. The security pool or pool forker then uses that amount in the relevant withdrawal or migration path. The key point is that the reward is pooled: the first `150%` of winning depth shares the same fixed bonus pool, while anything above that is excess and receives principal only.

Example:

- Suppose the final `binding capital` is `10 REP`.
- The reward-eligible cap is therefore `15 REP`, so the `safety boundary` is the interval `(10 REP, 15 REP]`.
- The reward pool is `10 * 3 / 5 = 6 REP`.
- If the winning side contributes `15 REP` inside that reward-eligible window, then each `5 REP` deposit in `[0,15]` receives `5 + 5 * 6 / 15 = 7 REP`.
- If a later winning deposit sits above `15 REP`, it is excess and receives principal back with no share of the `6 REP` reward pool.

```
binding capital = 10 REP
reward-eligible window = [0,15]
safety boundary = (10,15]
reward pool = 6 REP

all winning depth in [0,15] -> shares the 6 REP reward pool pro rata
winning depth above 15      -> returned at par
```

After that, one more adjustment can apply. If the actual Zoltar fork threshold for the universe is lower than the escalation game’s configured `nonDecisionThreshold`, the payout is scaled down proportionally by `actualForkThreshold / nonDecisionThreshold`.

If the game resolves locally without a fork, users withdraw through `SecurityPool.withdrawFromEscalationGame`, which applies the winning payout on the parent pool and adjusts the vault’s pool ownership by the gain or loss relative to the original locked REP. If the game reaches non-decision and the pool forks, the parent pool does not pay those winnings out directly in operational mode. Instead, `SecurityPoolForker.migrateFromEscalationGame` calls `claimDepositForWinning` for the selected child outcome, credits the resulting REP amount into the child pool as new ownership, and migrates proportional parent collateral alongside it.

If an unrelated external Zoltar fork interrupts the local escalation game before it resolves, those unresolved escalation deposits stop being withdrawable on the parent pool. The vault owner must move them into the child universe selected for that vault's migration by calling `migrateVaultWithUnresolvedEscalation`. That call moves two things together in one transaction:

- the vault’s unresolved escalation deposits
- the rest of the vault’s pool state into the same child pool in that universe

The child pool in that child universe then continues the unresolved escalation game with those migrated deposits. The call must migrate all of that vault's remaining unresolved parent escalation locks for the chosen child universe; a partial migration reverts. This migration must happen before the normal fork-migration deadline. If a vault does not migrate in time, its unresolved escalation position is left behind and is burned under the same fork-migration rules that burn other non-migrated parent-pool state.

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

At the Zoltar layer, universes fork and REP holders split post-fork claims across selected child universes. At the Augur Placeholder layer, the parent `SecurityPool` and its economic state must also move.

The pool states are:

- `Operational`
- `PoolForked`
- `ForkMigration`
- `ForkTruthAuction`

[`SecurityPoolForker`](../solidity/contracts/peripherals/SecurityPoolForker.sol) coordinates this transition.

State-machine view:

| State | Meaning | Typical transition out |
| --- | --- | --- |
| `Operational` | normal pool operation outside the explicit fork/migration lifecycle | question resolution does not itself create a separate terminal state, or the pool may activate fork handling |
| `PoolForked` | parent pool has stopped normal operation after fork | child pools begin migration setup |
| `ForkMigration` | child pool is receiving migrated vaults, REP-derived state, and collateral | migration window ends |
| `ForkTruthAuction` | child pool is repairing missing collateral with REP sale | auction finalizes and pool returns to `Operational` |

This is a subtle but important point: `SystemState` is primarily a fork-and-migration state machine, not a generic question-resolution state machine.

After a Zoltar fork:

- the parent pool enters fork mode
- child security pools are created in child universes
- vaults can call `migrateVault` to move pool ownership and bond allowance when they do not have unresolved external-fork escalation locks
- vaults with unresolved external-fork escalation locks call `migrateVaultWithUnresolvedEscalation`, as described in the continuation section below
- escalation-game winnings can migrate into child pools through `migrateFromEscalationGame`
- parent collateral is partially transferred into child pools in proportion to migrated REP
- shares migrate independently through `ShareToken.migrate`

This separation is important. Post-fork REP splitting is a Zoltar primitive, described in [whitepaper_zoltar.md](./whitepaper_zoltar.md). Vault migration, collateral transfer, and child-pool initialization are Augur Placeholder primitives built on top of it.

### External-Fork Continuation of Unresolved Escalation

When a pool forks while its escalation game is still unresolved, the parent forker snapshots the unresolved game’s `startBond`, `nonDecisionThreshold`, and elapsed escalation time at the moment of fork. The child pool in the child universe then continues that unresolved escalation game from the fork snapshot rather than starting a separate fresh game.

The first time the relevant child pool is created in a child universe, it immediately deploys a child continuation escalation game in paused fork-continuation mode. That child continuation game preserves:

- the original escalation side for each unresolved deposit
- the original parent deposit index for payout ordering
- the elapsed escalation time at the moment of fork

The continuation game remains paused during the migration window so that child deployment and vault migration do not silently consume escalation time. While the child pool is still waiting for continuation processing, `SecurityPool.depositToEscalationGame` rejects new live child deposits through the `awaitingForkContinuation` guard. In user terms, no participant can open fresh child escalation deposits until the child pool clears that wait marker and resumes the continuation game.

The unresolved-carry path is therefore:

1. the parent pool forks and snapshots unresolved escalation state
2. the child pool is created in the selected child universe and marks itself as awaiting fork continuation
3. the child continuation escalation game is deployed immediately, but remains paused
4. affected vaults migrate unresolved parent locks through `migrateVaultWithUnresolvedEscalation`
5. after the migration window and any required truth auction, the child pool becomes operational, clears the wait marker, and resumes the paused continuation game

This makes unresolved external-fork escalation migration part of the vault-migration flow itself. Parent-side resolution for those unresolved positions is migration into the child continuation game.

### Worked Example: Child-Universe Collateral Repair

Suppose a parent pool has:

- `50 ETH` of collateral supporting clean redemption
- `200 REP` worth of child-universe-defining security capital at fork time

Now suppose a fork happens and REP claims are split as follows:

- `190 REP` is split into the child universe that a given user treats as truthful
- `10 REP` is split into the false child universe

If parent-side collateral follows the same proportion into child pools, then:

- the user-preferred child pool begins with `47.5 ETH`
- the false child pool begins with `2.5 ETH`

The child universe that a user expects to preserve economically meaningful claims is also the child universe where that user expects the child pool to continue supporting clean redemption. On those numbers, that child pool is short by:

$$
\text{ethCollateralToBuy} = 50 \text{ ETH} - 47.5 \text{ ETH} = 2.5 \text{ ETH}
$$

The truth auction then sells that child universe's REP for `2.5 ETH`. If bidders supply that ETH, the user-preferred child pool returns to the full `50 ETH` collateral base and can continue operating cleanly. The false child universe, by contrast, keeps only its `2.5 ETH` and whatever universe-local economic activity it can attract.

In contract terms, Zoltar first handles the universe fork and the splitting of post-fork REP claims into child universes. The Placeholder parent pool then separately enters its own fork lifecycle through `initiateSecurityPoolFork` and `activateForkMode`; the Zoltar fork and the pool-fork transition are related, but they are not the same contract step. Augur Placeholder creates the relevant child pool, migrates vault state and eligible escalation-game positions through `migrateVault`, `migrateVaultWithUnresolvedEscalation`, and `migrateFromEscalationGame`, and starts `startTruthAuction` only if the child pool still lacks its intended collateral base. If bidders supply the missing ETH, the child pool resumes operation with repaired collateral. If the auction is underfunded, the child universe still continues, but collateral repair is incomplete.

## 8. Truth Auction

After migration, a child pool may still hold less ETH than participants in that child universe would want for clean redemption. The truth auction is the repair mechanism for that gap: the child pool sells some child-universe REP for ETH.

Key points:

- the child pool computes an ETH repair target
- the auction can sell only up to a fixed REP inventory
- bidders compete on a discrete ETH/REP price ladder
- the child pool resumes with repaired collateral if enough ETH is raised, or with partially repaired collateral if demand is weak

The reason this repair step exists is that complete-set obligations and collateral were economically attached to the parent universe, while only some fraction of REP-backed vault state may migrate into a given child universe. A child pool can therefore arrive with enough state to exist, but not enough ETH to preserve the collateral level users would want in that universe.

The repair auction is implemented by [`UniformPriceDualCapBatchAuction`](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol).

In the actual `startTruthAuction` logic, the ETH repair target, when `repAtForkAmount > 0` and the child has not already migrated all fork REP, is:

$$
\text{ethCollateralToBuy} = \text{parentCollateralAmount} - \frac{\text{parentCollateralAmount} \cdot \text{migratedRepAmount}}{\text{repAtForkAmount}}
$$

This is the contract’s direct statement of the gap: `ethCollateralToBuy` is the missing ETH collateral after accounting for the fraction of REP-backed state that has already migrated into the child universe.

If `repAtForkAmount` is zero, the contract does not evaluate this division path. It finalizes immediately because `migratedRepAmount >= repAtForkAmount` already holds.

### Auction mechanics

- The auction is started by `SecurityPoolForker` on behalf of the child security pool.
- `startAuction` sets two caps:
  - `ethRaiseCap`: how much ETH the child pool wants to raise to repair collateral
  - `maxRepBeingSold`: the maximum REP inventory the child pool is willing to sell
- Bidders submit ETH at discrete ticks. A tick is an integer price level on a multiplicative grid:

$$
\text{priceAtTick} = 10^{18} \cdot 1.0001^{\text{tick}}
$$

The contract stores prices in `1e18` fixed-point units, so:

- tick `0` means `1 ETH/REP`
- positive ticks mean higher ETH per REP
- negative ticks mean lower ETH per REP

Equivalently, the conceptual inverse relation is:

$$
\text{tick} \approx \frac{\ln(\text{priceInWeiPerRep} / 10^{18})}{\ln(1.0001)}
$$

In other words, a bid at a higher tick is simply a bid willing to pay a higher ETH/REP price.
- Finalization then walks bids from the highest ETH/REP price to the lowest ETH/REP price and stops at the first price where one of two constraints binds:
  - the auction has raised enough ETH to hit `ethRaiseCap`
  - the ETH collected so far, at that price, would buy all `maxRepBeingSold`

Normal clearing:

- bids above the clearing tick win in full
- bids below the clearing tick lose and receive full ETH refunds
- bids exactly at the clearing tick are filled in submission order until the remaining capacity at that tick is exhausted

Underfunded clearing:

- the auction cannot discover a standard clearing tick
- the contract computes an `underfundedThreshold = ethRaised / maxRepBeingSold`
- only bids strictly above that threshold count as winners
- all winning ETH collectively buys the full REP inventory
- each winning bidder receives REP pro rata to that bidder’s share of the winning ETH
- bids at or below the threshold lose and are refunded in full

This is why the auction is dual-capped: it is trying to repair up to a target amount of ETH collateral without selling more than the allowed REP inventory.

```
Auction inputs

    Child pool needs ETH repair
                |
                v
     +-----------------------+
     | startAuction sets     |
     | ethRaiseCap           |
     | maxRepBeingSold       |
     +-----------------------+
                |
                v
     Bidders post ETH at ticks
                |
                v
     Sort demand high price -> low price
                |
                v
     Stop when one cap binds first
        |                     |
        |                     |
        v                     v
  ETH cap or REP cap      No standard clear
  binds during sweep      after all bids
        |                     |
        v                     v
   Normal clearing         Underfunded path
```

```
Underfunded intuition

REP for sale: 100
Total winning ETH above threshold: 10

Alice bids 4 ETH above threshold  -> gets 40 REP
Bob   bids 6 ETH above threshold  -> gets 60 REP

Bids at or below threshold -> full ETH refund
```

### Worked clearing example

Suppose the child pool starts a truth auction with:

- `ethRaiseCap = 20 ETH`
- `maxRepBeingSold = 4 REP`

Now suppose three bidders participate:

- Alice bids `3 ETH` at a tick corresponding to `5 ETH/REP`
- Bob bids `4 ETH` at a tick corresponding to `4 ETH/REP`
- Carol bids `6 ETH` at a tick corresponding to `3 ETH/REP`

Walking from highest price to lowest price:

1. Alice contributes `3 ETH` at `5 ETH/REP`.
2. Adding Bob brings cumulative demand to `7 ETH` at `4 ETH/REP`, still below the `4 REP` sale cap.
3. Adding Carol reaches the first price where the remaining REP inventory is exhausted.
   - At `3 ETH/REP`, selling `4 REP` requires `12 ETH`.
   - The auction already has `7 ETH` from Alice and Bob, so only `5 ETH` of Carol’s `6 ETH` bid is used.

So the outcome is:

- clearing price: `3 ETH/REP`
- Alice: fully filled for `3 ETH`, receives `1 REP`
- Bob: fully filled for `4 ETH`, receives `4/3 REP`
- Carol: partially filled for `5 ETH`, receives `5/3 REP`, and gets `1 ETH` refunded

The total settlement is exactly:

- total ETH raised: `12 ETH`
- total REP sold: `4 REP`

If “profit” is measured as execution surplus relative to each bidder’s own limit price, then:

- Alice was willing to pay `5 ETH/REP` but pays the uniform clearing price of `3 ETH/REP`
  - execution surplus: `1 REP * (5 - 3) ETH/REP = 2 ETH`
- Bob was willing to pay `4 ETH/REP` and also pays `3 ETH/REP`
  - execution surplus: `(4/3 REP) * (4 - 3) ETH/REP = 4/3 ETH`
- Carol bid exactly at the clearing price
  - execution surplus on the filled portion: `0 ETH`
  - refund on the unfilled portion: `1 ETH`

Higher-priced bids establish priority, but everyone who clears pays the same effective ETH/REP execution price, except that the marginal price level may be only partially filled. At the clearing tick, earlier bids at that same tick are filled before later bids at that tick.

The purpose of this auction is to let a child Augur Placeholder pool reassemble collateral completeness after a Zoltar fork. REP is sold here because it is the child-universe scarce asset that migrated into the child universe along with that universe's security claims. The auction converts part of that security capital back into the ETH collateral required for the child market to continue operating cleanly. Put differently, it monetizes child-universe REP, not trader share balances or direct vault claims.

```
Fork repair path with the auction in context

Parent pool
  collateral: parent collateral amount
  REP-at-fork: total REP at fork
        |
        | migrate a child pool with migrated REP
        v
Child pool before auction
  migrated collateral ~= parent collateral amount * migrated REP / total REP at fork
  missing collateral  = parent collateral amount - migrated collateral
        |
        | sell child-universe REP for ETH
        v
Truth auction
  raise up to missing collateral
  sell up to auction REP inventory
        |
        v
Child pool after auction
  operational with repaired-or-partially-repaired collateral
```

## 9. REP/ETH Price Oracle

The REP/ETH oracle subsystem is narrow in purpose and should not be confused with market-truth resolution.

[`SecurityPoolOracleCoordinator`](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) uses [`OpenOracle`](../solidity/contracts/peripherals/openOracle/OpenOracle.sol) to request a fresh REP/ETH price when needed. This price is used only for solvency-sensitive security-pool operations such as:

- liquidation
- REP withdrawal
- setting security bond allowance

If the last price is stale, these operations can be queued until a valid report is settled. The manager then replays the pending operation against the fresh price.

This is therefore not the oracle for determining whether a question resolves `Yes`, `No`, or `Invalid`. That truth path is handled by the escalation game and, if necessary, the Zoltar fork system. The REP/ETH oracle exists only to price security backing against ETH collateral.

## 10. Assumptions and Security Model

Augur Placeholder adds external collateral, underwriting, and auction-based repair on top of Zoltar. Its security argument therefore depends on stronger assumptions than the base Colored Coins substrate alone.

### Protocol assumptions

- the economic value of REP backing remains larger than the value of the obligations that REP is securing
- users accept that, after a fork, the protocol may sell part of a child universe's REP backing in the truth auction to refill missing ETH collateral

### Market and liquidity assumptions

- the child-universe truth auction can attract enough demand for child-universe REP to repair missing ETH collateral when repair is needed
- REP and ETH can be exchanged with sufficient liquidity and price discovery that collateral repair and solvency operations do not fail purely because markets are too thin

### Coordination assumptions

- users who want clean resolution continue in the child universe they expect other users to keep valuing

### Operational failure modes

- if truth-auction demand is weak, a child pool can resume with only partial collateral repair
- if REP/ETH liquidity is thin or price discovery is poor, solvency-sensitive operations become less trustworthy
- if users and capital split across multiple child universes, no single child universe may recover the dominant economic value assumed by the simpler fork story

The key inequality behind the design is:

$$
\text{REP value securing the system} > \text{value of the obligations secured by that REP}
$$

Zoltar forks only create child universes, and Placeholder carries underwriting state, collateral state, and outcome shares into them. If a participant drags value into a child universe they expect others to abandon, they may capture some local advantage but also destroy the value of the child-universe REP and underwriting base they rely on there. If users and bidders instead coordinate on the child universe they expect to keep using, REP migration, proportional collateral migration, and truth-auction repair can rebuild a usable market state in that child universe.

## 11. Current Parameter Values

### Escalation parameters

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `NUM_OUTCOMES` | `3` | Placeholder complete sets mint `Invalid`, `Yes`, and `No` shares |
| `TODO_INITIAL_ESCALATION_GAME_DEPOSIT` | `1 ether` | Fixed initial deposit used when the escalation game is first deployed |
| Escalation `nonDecisionThreshold` | `totalTheoreticalRepSupply / 40` | Deployed as `repToken.getTotalTheoreticalSupply() / (FORK_THRESHOLD_DIVISOR * 2)` |
| `EXCESS_REWARD_WINDOW_DIVISOR` | `2` | Extends the escalation reward-eligible cap to `bindingCapitalAmount + bindingCapitalAmount / 2`, so the `safety boundary` covers the extra `50%` region above binding capital |

### Migration and auction parameters

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `MIGRATION_TIME` | `8 weeks` | Fork-migration window before truth auction can start |
| `AUCTION_TIME` | `1 week` | Truth-auction duration |
| `MAX_AUCTION_VAULT_HAIRCUT_DIVISOR` | `1000000` | Small haircut divisor used when reserving a tiny amount of REP from auction sale |

### Solvency and retention parameters

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `PRICE_PRECISION` | `1e18` | Fixed-point precision for REP/ETH and retention-rate math |
| `MAX_RETENTION_RATE` | `999999996848000000` | Upper retention-rate bound, annotated in code as approximately 90% yearly retention |
| `MIN_RETENTION_RATE` | `999999977880000000` | Lower retention-rate bound, annotated in code as approximately 50% yearly retention |
| `RETENTION_RATE_DIP` | `80` | Utilization point at which the retention curve reaches its minimum |
| `MIN_SECURITY_BOND_DEBT` | `1 ether` | Minimum non-zero bond allowance a vault can carry |
| `MIN_REP_DEPOSIT` | `10 ether` | Minimum REP backing for a non-empty vault |

### Oracle parameters

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `PRICE_VALID_FOR_SECONDS` | `1 hour` | How long a settled REP/ETH price remains valid |
| `gasConsumedOpenOracleReportPrice` | `100000` | Coordinator gas estimate for report submission |
| `gasConsumedSettlement` | `1000000` | Coordinator gas estimate for settlement callback |
| OpenOracle `exactToken1Report` | `26392439800` | Hard-coded initial report liquidity parameter |
| OpenOracle `escalationHalt` | `reputationToken.totalSupply() / 100000` | Dynamic halt threshold for report escalation |
| OpenOracle `settlerReward` | `block.basefee * 2 * gasConsumedOpenOracleReportPrice` | Dynamic ETH reward paid to settler |
| OpenOracle `settlementTime` | `180` | Settlement delay encoded as `15 * 12` |
| OpenOracle `disputeDelay` | `0` | No extra waiting period after each report |
| OpenOracle `protocolFee` | `0` | Protocol fee disabled |
| OpenOracle `callbackGasLimit` | `1000000` | Settlement callback gas limit |
| OpenOracle `feePercentage` | `10000` | Fee paid to previous reporter, annotated in code as 0.1% |
| OpenOracle `multiplier` | `140` | New report amount must be 1.4x prior amount |
| OpenOracle `timeType` | `true` | OpenOracle uses block timestamps rather than block numbers |
| OpenOracle `trackDisputes` | `false` | Dispute history not stored for these reports |
| OpenOracle `keepFee` | `false` | Initial reporter reward does not stay with the initial reporter |
| OpenOracle `feeToken` | `true` | OpenOracle fees are paid in token-to-swap terms |
| Coordinator `WETH` | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | Mainnet WETH address used in REP/ETH price reports |

## 12. End-to-End Example

This section is only a recap. The canonical lifecycle is the state machine in section 1, and sections 6 through 8 contain the actual escalation, migration, and auction rules.

1. A question exists in one Zoltar universe, and Augur Placeholder creates one pool for that question in that universe.
2. Vault operators deposit REP to underwrite open interest, and users mint ETH-backed complete sets.
3. After question end, the escalation game either resolves locally or reaches non-decision.
4. If it resolves locally, users redeem against the resolved pool. If it reaches non-decision, Zoltar forks and Placeholder migrates eligible state into child pools in child universes.
5. If a child pool arrives short of ETH collateral, it runs a truth auction to sell child-universe REP for ETH.
6. Once migration and any required collateral repair finish, the child pool becomes operational and normal settlement resumes in the child universe that retains economic value.

## 13. Current Implementation Constraints

The current repository exposes several implementation constraints.

- Origin security pools currently support only the exact categorical market shape `Yes / No`, with `Invalid` added as the third Placeholder trading and resolution outcome.
- Placeholder issues transferable shares and manages their redemption and migration, but not secondary-market trading.
- The fork threshold divisor, fork-burn divisor, and escalation-game initial deposit are fixed constants in the current implementation and should be read as current design parameters rather than as dynamically governed values.
- Retention-rate bounds, the retention-rate dip point, and several oracle and auction tuning parameters are also fixed constants in the current implementation.
- The retention-rate curve in [`SecurityPoolUtils`](../solidity/contracts/peripherals/SecurityPoolUtils.sol) is heuristic rather than final market design.
- Some comments in [`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol) acknowledge open accounting questions around child-pool complete-set behavior.
