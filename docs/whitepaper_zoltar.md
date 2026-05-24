# Zoltar White Paper

## Abstract

Zoltar is a forkable oracle substrate centered on universes, question encoding, and REP branching. It is best understood as an implementation of the branching model described in [Colored Coins.md](https://github.com/AugurProject/oracle-research/blob/main/Colored%20Coins.md): unresolved disagreement is represented as explicit child universes, and REP holders convert post-fork migration balances into child-universe REP across one or more selected branches. Zoltar supports both categorical and scalar questions, treats `Invalid` as a legitimate answer state, and branches protocol state without embedding a higher-level market design directly into the core layer.

## 1. System Overview

Zoltar is the base oracle layer in this repository. It does not implement the full market, collateral, or underwriting system built on top of it elsewhere in the repo. Its role is narrower and more fundamental:

- register questions
- encode valid answer spaces
- represent forks as child universes
- mint and burn child-universe REP
- split post-fork REP claims across disputed branches

Core contract map:

- [`Zoltar`](../solidity/contracts/Zoltar.sol): universe forks and REP splitting
- [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol): question registry and outcome encoding
- [`ReputationToken`](../solidity/contracts/ReputationToken.sol): child-universe REP minted and burned by Zoltar
- [`ScalarOutcomes`](../solidity/contracts/ScalarOutcomes.sol): scalar formatting and interpolation logic

In the [Colored Coins.md](https://github.com/AugurProject/oracle-research/blob/main/Colored%20Coins.md) framing, a fork does not replace the disputed parent state with a single chosen successor. Instead, it defines child universes for each valid outcome, after which REP holders can split their post-fork claims across those branches.

```
+----------------------+
|      Zoltar          |
| questions, universes,|
| forks, REP splitting |
+----------------------+
```

## 2. Universe Model

[`Zoltar.Universe`](../solidity/contracts/Zoltar.sol) stores the data for one branch of protocol state, including:

- `forkTime`: when the universe forked
- `forkQuestionId`: the question that triggered the fork
- `forkingOutcomeIndex`: the outcome index represented by the universe when it is a child
- `reputationToken`: the REP token used inside that universe
- `parentUniverseId`: the parent branch

Universe `0` is the genesis universe. Its REP token is an external genesis token configured in `Constants.GENESIS_REPUTATION_TOKEN`. Child universes are identified deterministically as:

$$
\text{childUniverseId} = \text{uint248}(\text{keccak256}(\text{abi.encode}(\text{parentUniverseId}, \text{outcomeIndex})))
$$

This makes each branch reproducible from parent universe and outcome index alone. Child universes are then deployed lazily when a forked branch is actually needed.

The resulting child universes coexist. Zoltar does not select one canonical child universe and delete the others. It deterministically defines all valid branches for the forked question and leaves later economic and social coordination to determine which branch accumulates meaningful value.

```
Parent universe
      |
      | fork on disputed question
      v
+-------------------+
| parentUniverseId  |
+-------------------+
      |
      +--> child for Invalid
      |
      +--> child for outcome 1
      |
      +--> child for outcome 2
      |
      +--> child for outcome N
```

Zoltar defines the branch set; it does not choose one winner.

## 3. Fork Thresholds and REP Economics

The current fork threshold is:

$$
\text{forkThreshold} = \frac{\text{totalTheoreticalRepSupply}}{20}
$$

where `forkThreshold` denotes the REP amount required to trigger a fork in the current universe.

Initiating a fork requires supplying REP equal to 5% of the universe’s total theoretical supply as the fork threshold. Under the current constants, 20% of that threshold deposit is permanently burned, which is 1% of total theoretical supply, and the remaining 80% becomes the initiator’s migration balance.

Using descriptive names for the fork initiator’s two post-fork quantities:

$$
\text{burnedRepAmount} = \frac{\text{forkThreshold}}{5}
$$

$$
\text{forkInitiatorMigrationBalance} = \text{forkThreshold} - \text{burnedRepAmount} = \frac{4 \cdot \text{forkThreshold}}{5}
$$

```
Fork initiator deposits forkThreshold REP
                    |
                    v
         +----------------------+
         | threshold deposit    |
         +----------------------+
             |              |
             |              |
             v              v
      20% burned        80% kept as
                        migration balance
```

Genesis REP cannot be burned natively, so the contract transfers it to the configured burn address. Child-universe REP is minted and burned directly by [`ReputationToken`](../solidity/contracts/ReputationToken.sol) under Zoltar’s control.

In the Colored Coins framing, the threshold deposit is the cost of forcing the branch point into existence.

### Current parameter values

| Parameter | Current value | Meaning |
| --- | --- | --- |
| `GENESIS_REPUTATION_TOKEN` | `0x221657776846890989a759BA2973e427DfF5C9bB` | Genesis-universe REP token address |
| `BURN_ADDRESS` | `0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF` | Burn sink used for genesis REP |
| `FORK_THRESHOLD_DIVISOR` | `20` | Fork threshold is `totalTheoreticalRepSupply / 20`, or 5% of supply |
| `FORK_BURN_DIVISOR` | `5` | Burned amount is `forkThreshold / 5`, or 20% of threshold |

## 4. Child Universes and REP Splitting

Once a universe forks, child universes can be deployed lazily through `deployChild`. A user can also add more REP into the migration balance with `addRepToMigrationBalance`. The core post-fork action is then `splitMigrationRep`, which lets a holder mint child-universe REP for one or more non-malformed outcome indices.

For categorical questions, that means `Invalid`, which is a legitimate answer state, and any in-range categorical outcome are allowed, while out-of-range values are rejected. For scalar questions, only well-formed scalar encodings are allowed.

This is Zoltar’s core branching primitive. A REP holder does not choose one destination universe and abandon all others inside the substrate. Instead, the holder takes a post-fork migration balance and uses it to mint child-universe REP across one or more selected branches. If multiple child outcomes are selected, the same migrated balance is reproduced into each selected child universe. That is the key Colored Coins-style property: the fork branches the claim structure itself, and later value concentration determines which branch matters economically.

```
Post-fork migration balance
          |
          | splitMigrationRep(select outcomes)
          v

If user selects one branch:
  migration balance
        |
        +--> child REP in selected universe only

If user selects multiple branches:
  migration balance
        |
        +--> child REP in Invalid universe
        |
        +--> child REP in outcome A universe
        |
        +--> child REP in outcome B universe

Same migrated claim is reproduced across selected children.
Later value concentration determines which branch matters economically.
```

The security intuition is a coordination claim: if durable value concentrates in the branch that participants regard as truthful, then branched post-fork claims can still inherit meaningful security from the pre-fork REP base even though the protocol has split them across multiple child universes.

## 5. Assumptions and Security Model

Zoltar is a Colored Coins-style system, so its security argument depends on user behavior and value concentration rather than on the contract being able to identify one objectively correct branch onchain.

The core assumptions are:

- users can choose which child universe to continue using after a fork
- users prefer to continue in the universe they regard as truthful
- the protocol itself does not know which universe is truthful and treats all valid branches symmetrically
- most durable economic activity concentrates in the branch that users expect other users to keep using
- dishonest or abandoned branches may continue to exist, but are assumed to retain little long-term value compared with the branch that market participants keep coordinating around

A fork only creates branches. If users and future activity concentrate in the branch they regard as truthful, the value of child-universe REP also concentrates there. Rational REP holders are therefore pushed toward the branch they expect the market to keep using, because migrating into a branch they expect others to abandon destroys the long-term value of the REP they receive there.

## 6. Questions and Outcome Encoding

[`ZoltarQuestionData.QuestionData`](../solidity/contracts/ZoltarQuestionData.sol) stores:

- title and description
- start and end time
- scalar metadata such as `numTicks`, `displayValueMin`, `displayValueMax`, and `answerUnit`

Question ids are deterministic hashes of the question data. For categorical questions, that hash path also includes the sorted categorical outcome options. For scalar questions, there are no categorical labels to include, so the id is determined from the scalar question fields alone.

### Categorical questions

Categorical questions store sorted outcome labels. The implementation requires labels to be:

- non-empty
- strictly ordered by hash

The contract stores the labels in `outcomeLabels[questionId]`. Any number of categorical outcomes can exist at the Zoltar level as long as those conditions hold.

### Scalar questions

Scalar questions store no categorical labels. Instead, `numTicks`, `displayValueMin`, `displayValueMax`, and `answerUnit` define the answer space.

At creation time, scalar questions must satisfy `numTicks > 0` and `displayValueMax > displayValueMin`.

Onchain, each scalar answer is encoded into a single `uint256` that packs:

- the highest bit as an invalid flag
- a 120-bit first payout numerator
- a 120-bit second payout numerator

In the contract’s encoding:

- highest bit `0` means the answer lives in the invalid namespace
- highest bit `1` means the answer lives in the scalar-payout namespace

```
Packed scalar answer (uint256)

[ highest bit ][ first payout numerator ][ second payout numerator ]

highest bit = 0  -> invalid namespace
highest bit = 1  -> scalar payout namespace
```

The all-zero encoding is therefore the canonical `Invalid` answer for scalar questions.

For a valid scalar answer, the two payout numerators must sum exactly to `numTicks`:

$$
\text{firstPayoutNumerator} + \text{secondPayoutNumerator} = \text{numTicks}
$$

If that equality does not hold, the answer is malformed rather than valid.

At the helper and UI level, a scalar tick index named `tickIndex` is encoded as:

- `firstPayoutNumerator = numTicks - tickIndex`
- `secondPayoutNumerator = tickIndex`
- highest bit = `1`

So the packed scalar answer corresponds to:

$$
(\text{numTicks} - \text{tickIndex}, \text{tickIndex})
$$

[`ScalarOutcomes`](../solidity/contracts/ScalarOutcomes.sol) interprets `secondPayoutNumerator` as the position along the scalar range. Using the contract’s `numTicks` parameter, the displayed scalar value is:

$$
\text{displayedValue} = \text{displayValueMin} + \frac{\text{secondPayoutNumerator}}{\text{numTicks}} \cdot (\text{displayValueMax} - \text{displayValueMin})
$$

The contract implementation performs this interpolation with fixed-point integer math and formats the result with 18 decimal places, trimming trailing zeroes for display.

## 7. Market Types Supported by Zoltar

At the Zoltar layer, market type support comes from how questions and outcomes are encoded in [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol).

Zoltar currently supports:

- categorical questions, implemented as an ordered array of non-empty outcome labels
- scalar questions, implemented as a tick-based numeric range with no categorical labels

Zoltar can represent arbitrary categorical questions and scalar questions, while higher-level protocols may choose narrower market shapes on top of that substrate. It defines answer spaces and forkable resolution state, not the collateralized trading mechanics that may later be attached to those questions.

## 8. Invalid vs Malformed

Zoltar distinguishes `Invalid` answers from `Malformed` answers.

- `Invalid` is a legitimate resolution state.
- `Malformed` means the submitted outcome index or scalar encoding does not fit the question’s allowed answer space.

This distinction matters because malformed answers are rejected during child-universe REP splitting and any fork-aware asset branching that depends on Zoltar’s answer validation, while `Invalid` remains a valid branch and a valid final outcome.

## 9. Example Fork Lifecycle

Consider a universe `parentUniverse` and a question `forkQuestion`, meaning the question whose unresolved outcome caused `parentUniverse` to split, after that question’s end time. The Zoltar fork lifecycle is:

1. `forkUniverse(parentUniverse, forkQuestion)` records that `forkQuestion` triggered a fork in `parentUniverse`.
2. Child universes are defined deterministically from `parentUniverse` and each valid outcome index.
3. The fork initiator’s REP deposit is partly burned and partly converted into migration balance.
4. Any REP holder can add more REP into migration balance for the forked universe.
5. REP holders call `splitMigrationRep` to mint child-universe REP across the outcome branches they support.

At that point, Zoltar has turned one disputed universe into multiple child universes with separate reputation tokens. The higher-level economic meaning of those branches is left to protocols built on top.

## 10. Design Thesis

Zoltar provides a generalized branching substrate for categorical and scalar questions. Rather than forcing a single answer when disagreement persists, it turns unresolved decisions into explicit child universes and lets REP holders split post-fork claims across one or more selected branches. In that sense it closely follows the Colored Coins model: the protocol branches state first, and later coordination determines which branch carries durable value.
