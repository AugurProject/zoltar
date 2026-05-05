# Augur Placeholder White Paper

## Abstract

Augur Placeholder is a prediction-market and oracle-security protocol built on top of Zoltar. Zoltar supplies forkable universes, question registration, outcome encoding, and post-fork REP splitting across disputed branches of reality. Augur Placeholder adds question-specific security pools, ETH-collateralized complete sets, escalation-driven local resolution, and a fork-recovery path that migrates economic state into child universes and, when needed, restores missing collateral through a truth auction.

The result is a layered design. REP vaults underwrite open interest, users mint and hold outcome shares backed by collateral, and disputes resolve locally whenever possible before escalating into a fork.

## 1. System Overview

The stack in this repository has two distinct protocol identities.

- `Zoltar` is the base oracle substrate.
- `Augur Placeholder` is the application layer built on top of Zoltar.

For the Zoltar substrate itself, including universes, question encoding, scalar math, and post-fork REP splitting, see [whitepaper_zoltar.md](./whitepaper_zoltar.md). This paper focuses on the market, underwriting, and collateral system layered above it.

Augur Placeholder is responsible for the economic system on top of that substrate:

- per-question security pools
- REP-backed underwriting
- [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) complete sets and outcome shares
- a local escalation game
- migration of pool state after a fork
- a batch auction that can restore missing collateral in a surviving branch

What it does not add is an exchange venue. Users can receive `Invalid`, `Yes`, and `No` shares from complete sets and can transfer those [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) positions to other users, but secondary-market trading is left outside Placeholder itself.

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

Augur Placeholder is the system described by the peripheral contracts. It adds an underwriting and collateral system around individual questions.

At a high level, Augur Placeholder adds:

- one security pool per question per universe
- REP vaults that underwrite open interest
- ETH-backed complete sets and redeemable outcome shares
- a local escalation game that tries to settle disputes before a global fork
- migration of pool state into child universes after a Zoltar fork
- a truth auction that can sell REP for ETH when a child pool needs to rebuild missing collateral

## 3. Core Economic Roles

Augur Placeholder introduces a set of economic roles above the Zoltar substrate.

- Question creators register questions in Zoltar question data, creating the objects around which Placeholder markets can be built.
- REP vault operators deposit REP into a security pool and provide oracle security capacity. Their deposits back open interest and earn fees extracted from collateral over time.
- Users mint complete sets with ETH and hold outcome shares.
- Escalation-game participants stake behind `Invalid`, `Yes`, or `No` after a question ends in order to settle locally or force a non-decision, meaning an unresolved state that opens the fork path.
- Fork migrators move REP, shares, and vault state from a parent universe into child universes after a Zoltar fork.
- Truth-auction bidders buy REP with ETH when a child branch needs to restore missing collateral.
- Liquidators move undercollateralized bond allowance away from unsafe vaults.
- Price reporters and settlers in the OpenOracle flow supply a REP/ETH solvency price for bond accounting, not a truth outcome for the question itself.

## 4. Security Pools

[`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol) is the central Augur Placeholder contract. A security pool is defined for one question, one universe, and one collateral denomination. In the current implementation that denomination is ETH, and that ETH-denominated structure is the contract design itself.

### Vault deposits and pool ownership

REP vault operators call `depositRep` to transfer REP into the pool. In return they receive internal pool-ownership accounting rather than a separate token. Pool ownership tracks each vault’s claim on the REP held by the pool.

Each vault can choose a `securityBondAllowance`. This is the amount of open interest that the vault is willing to underwrite. The pool enforces both local and global solvency conditions using the REP/ETH price from `SecurityPoolOracleCoordinator`.

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
- after finalization, users no longer redeem a full set
- instead, they redeem only the winning outcome through `redeemShares`, as described in Section 5

### Fee extraction and retention rate

The pool gradually converts part of complete-set collateral into fees owed to REP vaults. This is tracked through:

- `completeSetCollateralAmount`
- `totalFeesOwedToVaults`
- `feeIndex`
- `currentRetentionRate`

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

## 5. Shares and Complete Sets

[`ShareToken`](../solidity/contracts/peripherals/tokens/ShareToken.sol) is an [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) contract used by Augur Placeholder to represent outcome positions.

Those positions are transferable with the standard [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) token mechanics, so users can move shares to other users.

For each complete set:

- one `Invalid` share is minted
- one `Yes` share is minted
- one `No` share is minted

The token id encodes both universe id and outcome. This makes the same question’s positions fork-aware across universes.

Before finalization, a user who holds a complete set can burn all three legs and recover collateral through the parent security pool. After finalization, a user can redeem only the winning outcome through `redeemShares`.

At the implementation level, `redeemShares` burns the holder’s full balance of the winning token id and pays `sharesToCash(amount)` out of the pool’s current collateral accounting. In the healthy case, this should correspond to a clean `1:1` redemption outcome against the economic meaning of a complete-set claim, subject to the pool’s collateral accounting remaining intact through migration and any required auction repair. The important edge case is fork recovery: if a child pool emerges from migration with incomplete collateral, the truth auction exists to sell REP for ETH so that the child branch can restore the collateral base needed for clean redemption.

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

The contract also tracks the `binding capital`, which is the median of the three balances. This determines the effective end date of the game when the system times out naturally instead of reaching non-decision.

The median matters because the game is trying to detect whether disagreement remains live across multiple sides rather than merely whether one side has accumulated the most stake. In that sense, `binding capital` measures the level at which the contest is still jointly sustained by competing outcomes, which is why it is the relevant quantity for timeout and payout logic.

### Payout rule

Winning deposits are paid by `claimDepositForWinning`, and the payout depends on where that deposit sits relative to the final `binding capital`.

- If a winning deposit sits entirely above the binding capital, it is returned at par.
- If a winning deposit crosses the binding-capital boundary, the portion above the boundary is returned at par. The portion inside the binding region is paid as `2 * excess - (2/5) * excess`, which is `1.6 * excess`.
- If a winning deposit sits entirely inside the binding region, it is paid as `2 * deposit - (2/5) * deposit`, which is `1.6 * deposit`.

In code terms, the contract computes an `amountToWithdraw` from the winning deposit record and emits that result through `ClaimDeposit`. The security pool or pool forker then uses that amount in the relevant withdrawal or migration path. This means deeper winning deposits can earn a `1.6x` payout, while later deposits above the binding capital only get principal back.

Example:

- Suppose the final `binding capital` is `100 REP`.
- A winning deposit of `25 REP` that lies entirely inside that first `100 REP` is paid:

$$
\text{amountToWithdraw} = 2 \cdot 25 - \frac{2}{5} \cdot 25 = 50 - 10 = 40 \text{ REP}
$$

- A winning deposit of `30 REP` where only `10 REP` lies inside the binding region and `20 REP` lies above it is paid:

$$
\text{amountToWithdraw} = 20 + \left(2 \cdot 10 - \frac{2}{5} \cdot 10\right) = 20 + 16 = 36 \text{ REP}
$$

After that, one more adjustment can apply. If the actual Zoltar fork threshold for the universe is lower than the escalation game’s configured `nonDecisionThreshold`, the payout is scaled down proportionally by `actualForkThreshold / nonDecisionThreshold`.

If the game resolves locally without a fork, users withdraw through `SecurityPool.withdrawFromEscalationGame`, which applies the winning payout on the parent pool and adjusts the vault’s pool ownership by the gain or loss relative to the original locked REP. If the game reaches non-decision and the pool forks, the parent pool does not pay those winnings out directly in operational mode. Instead, `SecurityPoolForker.migrateFromEscalationGame` calls `claimDepositForWinning` for the selected child outcome, credits the resulting REP amount into the child pool as new ownership, and migrates proportional parent collateral alongside it. If an unrelated external Zoltar fork cancels the local game before it reaches non-decision, deposits are refunded rather than paid as winners.

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

At the Zoltar layer, universes fork and REP holders split post-fork claims across selected child branches. At the Augur Placeholder layer, the parent `SecurityPool` and its economic state must also move.

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
- vaults can call `migrateVault` to move pool ownership and bond allowance
- escalation-game winnings can migrate into child pools through `migrateFromEscalationGame`
- parent collateral is partially transferred into child pools in proportion to migrated REP
- shares migrate independently through `ShareToken.migrate`

This separation is important. Post-fork REP splitting is a Zoltar primitive, described in [whitepaper_zoltar.md](./whitepaper_zoltar.md). Vault migration, collateral transfer, and child-pool initialization are Augur Placeholder primitives built on top of it.

### Worked Example: Branch Collateral Repair

Suppose a parent pool has:

- `50 ETH` of collateral supporting clean redemption
- `200 REP` worth of branch-defining security capital at fork time

Now suppose a fork happens and REP claims are split as follows:

- `190 REP` is split into the child universe that a given user treats as truthful
- `10 REP` is split into the false child universe

If parent-side collateral follows the same proportion into child pools, then:

- the user-preferred child pool begins with `47.5 ETH`
- the false child pool begins with `2.5 ETH`

The child branch that a user expects to preserve economically meaningful claims is also the branch that user expects to continue supporting clean redemption. On those numbers, it is short by:

$$
\text{ethCollateralToBuy} = 50 \text{ ETH} - 47.5 \text{ ETH} = 2.5 \text{ ETH}
$$

The truth auction then sells that child branch’s REP for `2.5 ETH`. If bidders supply that ETH, the user-preferred child pool returns to the full `50 ETH` collateral base and can continue operating cleanly. The false child branch, by contrast, keeps only its `2.5 ETH` and whatever branch-local economic activity it can attract.

In contract terms, Zoltar first handles the universe fork and the splitting of post-fork REP claims into child universes. The Placeholder parent pool then separately enters its own fork lifecycle through `initiateSecurityPoolFork` and `activateForkMode`; the Zoltar fork and the pool-fork transition are related, but they are not the same contract step. Augur Placeholder creates the relevant child pool, migrates vault state and any eligible escalation-game winnings into it through `migrateVault` and `migrateFromEscalationGame`, and then starts a REP-for-ETH sale through `startTruthAuction` if the child branch still lacks its intended collateral base. If bidders supply the missing ETH, the child pool resumes operation with repaired collateral. If the auction is underfunded, the branch still continues, but collateral repair is incomplete.

## 8. Truth Auction

After migration, a child pool may still have less ETH collateral than is needed to represent that branch’s intended collateral base. This happens because migration can move less than the full parent-side economic state into that child universe.

More precisely, the parent pool may have outstanding complete-set obligations and collateral that were economically tied to the parent universe, while only some fraction of REP-backed security and vault state migrates into a given child branch. The child branch may therefore inherit a partial economic state: enough to exist, but not enough to cleanly support the level of collateralization that participants in that branch would want if it were to continue as a standalone market.

To repair that mismatch, the child pool can sell REP through [`UniformPriceDualCapBatchAuction`](../solidity/contracts/peripherals/UniformPriceDualCapBatchAuction.sol).

In the actual `startTruthAuction` logic, the ETH repair target, when `repAtForkAmount > 0` and the child has not already migrated all fork REP, is:

$$
\text{ethCollateralToBuy} = \text{parentCollateralAmount} - \frac{\text{parentCollateralAmount} \cdot \text{migratedRepAmount}}{\text{repAtForkAmount}}
$$

This is the contract’s direct statement of the gap: `ethCollateralToBuy` is the amount of ETH collateral the child branch is still missing after accounting for the fraction of REP-backed state that has already been split into it.

If `repAtForkAmount` is zero, the contract does not evaluate this division path. It finalizes immediately because `migratedRepAmount >= repAtForkAmount` already holds.

### Auction mechanics

- bidders submit ETH bids at ticks representing ETH/REP prices
- the auction maintains aggregate bid depth by tick
- finalization computes a clearing tick
- bids above the clearing tick win fully
- bids below the clearing tick lose and receive refunds
- bids at the clearing tick can be partially filled

If the auction is underfunded, the contract switches to threshold-based logic that allocates REP proportionally among bids above the underfunded threshold price.

The purpose of this auction is to let a child Augur Placeholder branch reassemble collateral completeness after a Zoltar fork. REP is sold here because it is the branch-native scarce asset that migrated into the child universe along with that branch’s security claims. The auction converts part of that security capital back into the ETH collateral required for the child market to continue operating cleanly. Put differently, it monetizes branch-native REP, not trader share balances or direct vault claims.

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

[`SecurityPoolOracleCoordinator`](../solidity/contracts/peripherals/SecurityPoolOracleCoordinator.sol) uses [`OpenOracle`](../solidity/contracts/peripherals/openOracle/OpenOracle.sol) to request a fresh REP/ETH price when needed. This price is used only for solvency-sensitive security-pool operations such as:

- liquidation
- REP withdrawal
- setting security bond allowance

If the last price is stale, these operations can be queued until a valid report is settled. The manager then replays the pending operation against the fresh price.

This is therefore not the oracle for determining whether a question resolves `Yes`, `No`, or `Invalid`. That truth path is handled by the escalation game and, if necessary, the Zoltar fork system. The REP/ETH oracle exists only to price security backing against ETH collateral.

## 10. Assumptions and Security Model

Augur Placeholder adds external collateral, underwriting, and auction-based repair on top of Zoltar. Its security argument therefore depends on stronger assumptions than the base Colored Coins substrate alone.

The main assumptions are:

- the economic value of REP backing remains larger than the value of the obligations that REP is securing
- users who want clean resolution continue in the branch they expect other users to keep valuing
- the child-branch truth auction can attract enough demand for branch-native REP to repair missing ETH collateral when repair is needed
- REP and ETH can be exchanged with sufficient liquidity and price discovery that collateral repair and solvency operations do not fail purely because markets are too thin
- users accept that fork recovery may convert part of branch-native security capital into collateral repair through the truth auction

The key inequality behind the design is:

$$
\text{REP value securing the system} > \text{value of the obligations secured by that REP}
$$

Zoltar forks only create branches, and Placeholder carries underwriting state, collateral state, and outcome shares into them. If a participant drags value into a branch they expect others to abandon, they may capture some local advantage but also destroy the value of the branch-native REP and underwriting base they rely on there. If users and bidders instead coordinate on the branch they expect to keep using, REP migration, proportional collateral migration, and truth-auction repair can rebuild a usable market state in that branch.

This argument has limits. If multiple branches retain substantial durable value, the simple “one branch gets almost all the value” intuition weakens. If REP/ETH liquidity is poor or truth-auction demand is weak, collateral repair may be incomplete. If REP/ETH price discovery is unreliable, solvency operations become less trustworthy. The escalation game helps avoid unnecessary forks, but it does not remove the need for these higher-level coordination and valuation assumptions.

## 11. Current Parameter Values

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `NUM_OUTCOMES` | `3` | Placeholder complete sets mint `Invalid`, `Yes`, and `No` shares |
| `TODO_INITIAL_ESCALATION_GAME_DEPOSIT` | `1 ether` | Fixed initial deposit used when the escalation game is first deployed |
| Escalation `nonDecisionThreshold` | `totalTheoreticalRepSupply / 40` | Deployed as `repToken.getTotalTheoreticalSupply() / (FORK_THRESHOLD_DIVISOR * 2)` |
| `MIGRATION_TIME` | `8 weeks` | Fork-migration window before truth auction can start |
| `AUCTION_TIME` | `1 week` | Truth-auction duration |
| `PRICE_PRECISION` | `1e18` | Fixed-point precision for REP/ETH and retention-rate math |
| `MAX_RETENTION_RATE` | `999999996848000000` | Upper retention-rate bound, annotated in code as approximately 90% yearly retention |
| `MIN_RETENTION_RATE` | `999999977880000000` | Lower retention-rate bound, annotated in code as approximately 50% yearly retention |
| `RETENTION_RATE_DIP` | `80` | Utilization point at which the retention curve reaches its minimum |
| `MIN_SECURITY_BOND_DEBT` | `1 ether` | Minimum non-zero bond allowance a vault can carry |
| `MIN_REP_DEPOSIT` | `10 ether` | Minimum REP backing for a non-empty vault |
| `MAX_AUCTION_VAULT_HAIRCUT_DIVISOR` | `1000000` | Small haircut divisor used when reserving a tiny amount of REP from auction sale |
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

An end-to-end lifecycle under the current contracts looks like this:

1. A binary question is registered in [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol).
2. An Augur Placeholder origin security pool is deployed for that question through [`SecurityPoolFactory`](../solidity/contracts/peripherals/factories/SecurityPoolFactory.sol). The current implementation requires the exact categorical outcomes `Yes` and `No`.
3. REP vault operators deposit REP with `depositRep` and set bond allowance, thereby funding security capacity.
4. Users mint ETH-backed complete sets through `createCompleteSet` and receive `Invalid`, `Yes`, and `No` [ERC-1155](https://eips.ethereum.org/EIPS/eip-1155) shares.
5. The question end time arrives.
6. Participants use the Placeholder escalation game to attempt local resolution.
7. If the escalation game converges, the question finalizes locally and winning shares can be redeemed.
8. If the escalation game reaches non-decision, a Zoltar fork path can be triggered.
9. Zoltar-side REP branching and Placeholder-side pool branching are related but distinct. The universe forks in Zoltar, and the parent pool then separately moves out of `Operational` state through `initiateSecurityPoolFork` and related logic.
10. REP claims are split in Zoltar across child universes. Placeholder vaults, collateral, and shares then migrate into child pools through calls such as `migrateVault`.
11. If a child pool lacks enough ETH collateral after migration, it starts a truth auction with `startTruthAuction` and sells REP for ETH.
12. The surviving child pool resumes operation, or users redeem final payouts once the outcome becomes final in that branch.

## 13. Current Implementation Constraints

The current repository exposes several implementation constraints.

- Origin security pools currently support only the exact categorical market shape `Yes / No`, with `Invalid` added as the third Placeholder trading and resolution outcome.
- Placeholder issues transferable shares and manages their redemption and migration, but not secondary-market trading.
- The fork threshold divisor, fork-burn divisor, and escalation-game initial deposit are fixed constants in the current implementation and should be read as current design parameters rather than as dynamically governed values.
- Retention-rate bounds, the retention-rate dip point, and several oracle and auction tuning parameters are also fixed constants in the current implementation.
- The retention-rate curve in [`SecurityPoolUtils`](../solidity/contracts/peripherals/SecurityPoolUtils.sol) is heuristic rather than final market design.
- Some comments in [`SecurityPool`](../solidity/contracts/peripherals/SecurityPool.sol) acknowledge open accounting questions around child-pool complete-set behavior.
