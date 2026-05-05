# Zoltar White Paper

## Abstract

Zoltar is a forkable oracle substrate centered on universes, question encoding, and REP migration across disputed branches of reality. Its purpose is to represent unresolved disagreement as explicit child universes and to let reputation capital migrate into those branches. Zoltar supports both categorical and scalar questions, treats `Invalid` as a legitimate answer state, and uses deterministic fork and migration mechanics to branch protocol state without embedding a higher-level market design directly into the core layer.

## 1. System Overview

Zoltar is the base oracle layer in this repository. It does not implement the full market, collateral, or underwriting system built on top of it elsewhere in the repo. Its role is narrower and more fundamental:

- register questions
- encode valid answer spaces
- represent forks as child universes
- mint and burn child-universe REP
- migrate REP balances across disputed branches

Core contract map:

- [`Zoltar`](../solidity/contracts/Zoltar.sol): universe forks and REP migration
- [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol): question registry and outcome encoding
- [`ReputationToken`](../solidity/contracts/ReputationToken.sol): child-universe REP minted and burned by Zoltar
- [`ScalarOutcomes`](../solidity/contracts/ScalarOutcomes.sol): scalar formatting and interpolation logic

Terminology:

- `Universe`: a branch of protocol state with its own REP token and fork history
- `Fork question`: the question whose unresolved outcome caused a universe to split
- `Migration balance`: internal REP amount that can be split into child universes after a fork
- `Invalid`: a legitimate answer state
- `Malformed`: an answer encoding that does not fit the question’s allowed answer space

```
+----------------------+
|      Zoltar          |
| questions, universes,|
| forks, REP migration |
+----------------------+
```

## 2. Universe Model

[`Zoltar.Universe`](../solidity/contracts/Zoltar.sol) stores:

- `forkTime`: when the universe forked
- `forkQuestionId`: the question that triggered the fork
- `forkingOutcomeIndex`: the outcome index represented by the universe when it is a child
- `reputationToken`: the REP token used inside that universe
- `parentUniverseId`: the parent branch

Universe `0` is the genesis universe. Its REP token is an external genesis token configured in `Constants.GENESIS_REPUTATION_TOKEN`. Child universes are identified deterministically as:

`childUniverseId = uint248(keccak256(abi.encode(parentUniverseId, outcomeIndex)))`

This makes each branch reproducible from parent universe and outcome index alone.

## 3. Fork Thresholds and REP Economics

The current fork threshold is:

`fork threshold = total theoretical REP supply / 20`

Equivalently, if `S` is the universe’s total theoretical REP supply:

`F = S / 20`

where `F` is the current fork threshold.

Initiating a fork requires burning REP equal to 5% of the universe’s total theoretical supply. Under the current constants, 20% of that fork-triggering deposit is permanently burned and the remaining 80% becomes the initiator’s migration balance.

If `B` is the permanently burned portion and `M` is the initiator’s migration balance:

- `B = F / 5`
- `M = F - B = 4F / 5`

Genesis REP cannot be burned natively, so the contract transfers it to the configured burn address. Child-universe REP is minted and burned directly by [`ReputationToken`](../solidity/contracts/ReputationToken.sol) under Zoltar’s control.

## 4. Child Universes and REP Migration

Once a universe forks, child universes can be deployed lazily through `deployChild`. A user can also add more REP into the migration balance with `addRepToMigrationBalance`. Migration itself is performed through `splitMigrationRep`, which lets a holder mint child-universe REP for one or more valid outcome indices.

This is Zoltar’s core branching primitive. If a forked question has multiple plausible branches, REP holders express their view by deciding which child universes receive their migrated reputation capital.

## 5. Questions and Outcome Encoding

[`ZoltarQuestionData.QuestionData`](../solidity/contracts/ZoltarQuestionData.sol) stores:

- title and description
- start and end time
- scalar metadata such as `numTicks`, `displayValueMin`, `displayValueMax`, and `answerUnit`

Question ids are deterministic hashes of the question data plus the categorical outcome options.

### Categorical questions

Categorical questions store sorted outcome labels. The implementation requires labels to be:

- non-empty
- strictly ordered by hash

The contract stores the labels in `outcomeLabels[questionId]`. Any number of categorical outcomes can exist at the Zoltar level as long as those conditions hold.

### Scalar questions

Scalar questions store no categorical labels. Instead, `numTicks`, `displayValueMin`, `displayValueMax`, and `answerUnit` define the answer space.

Onchain, each scalar answer is encoded into a single `uint256` that packs:

- the highest bit as an invalid flag
- a 120-bit first payout numerator
- a 120-bit second payout numerator

In the contract’s encoding:

- highest bit `0` means the answer is interpreted as invalid-style encoding
- highest bit `1` means the answer is interpreted as a scalar payout pair

The all-zero encoding is therefore the canonical `Invalid` answer for scalar questions.

For a valid scalar answer, the two 120-bit payout numerators must sum exactly to `numTicks`:

`firstPart + secondPart = numTicks`

If that equality does not hold, the answer is malformed rather than valid.

At the helper and UI level, a scalar tick index `k` is encoded as:

- `firstPart = numTicks - k`
- `secondPart = k`
- highest bit = `1`

So the packed scalar answer corresponds to:

`(numTicks - k, k)`

[`ScalarOutcomes`](../solidity/contracts/ScalarOutcomes.sol) interprets the second payout numerator as the position along the scalar range. If `p` is that second payout numerator and `T` is `numTicks`, the displayed scalar value is:

`displayed value = minValue + (p / T) * (maxValue - minValue)`

The contract implementation performs this interpolation with fixed-point integer math and formats the result with 18 decimal places, trimming trailing zeroes for display.

## 6. Market Types Supported by Zoltar

At the Zoltar layer, market type support comes from how questions and outcomes are encoded in [`ZoltarQuestionData`](../solidity/contracts/ZoltarQuestionData.sol).

Zoltar currently supports:

- categorical questions, implemented as an ordered array of non-empty outcome labels
- scalar questions, implemented as a tick-based numeric range with no categorical labels

This means Zoltar itself is more general than any one application-specific market design built on top of it. It can represent arbitrary categorical questions and scalar questions, while higher-level protocols may choose to build only narrower market shapes on top of that substrate.

## 7. Invalid vs Malformed

Zoltar distinguishes `invalid` answers from `malformed` answers.

- `Invalid` is a legitimate resolution state.
- `Malformed` means the submitted outcome index or scalar encoding does not fit the question’s answer space.

This distinction matters because malformed answers are rejected during child-universe REP migration and any fork-aware asset migration that depends on Zoltar’s answer validation, while `Invalid` remains a valid branch and a valid final outcome.

## 8. Design Thesis

Zoltar provides a forkable oracle substrate. Rather than forcing a single answer when disagreement persists, it turns unresolved decisions into explicit child universes and lets reputation capital migrate into those branches. The result is a generalized branching layer for categorical and scalar questions, with deterministic encoding, deterministic child-universe ids, and REP migration as the mechanism for expressing branch-level belief.
