// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';

uint256 constant ESCALATION_TIME_LENGTH = 4233600; // 7 weeks
uint256 constant SCALE = 1e6;
uint256 constant LN2_SCALED = 693147;
uint256 constant MAX_ATANH_ITERATIONS = 16;
uint256 constant MAX_EXP_ITERATIONS = 16;
uint256 constant EXCESS_REWARD_WINDOW_DIVISOR = 2;
uint256 constant MERKLE_MOUNTAIN_RANGE_MAX_PEAKS = 64;
uint256 constant NULLIFIER_DEPTH = 64;

struct Deposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

struct CarryLeafView {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
}

struct OutcomeState {
	// Snapshot fields are the inherited proof baseline for this outcome.
	// currentNullifierRoot tracks which inherited proof indexes have been consumed in this instance.
	// currentLeafCount/currentPeaks are the descendant export snapshot, updated incrementally as local carry changes.
	// localHeadNodeId/localUnresolvedTotal track local carry added after the inherited snapshot.
	// Total principal currently assigned to this outcome by local deposits placed directly in this escalation game.
	uint256 balance;
	// Local deposits placed directly in this escalation game, preserved in arrival order for payout ordering.
	Deposit[] deposits;
	// The inherited carry snapshot this escalation game started with for this outcome.
	uint256 snapshotLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] snapshotPeaks;
	uint256 inheritedUnresolvedTotal;
	uint256 currentLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] currentPeaks;
	// The current unresolved carry state after local and inherited deposits are consumed.
	bytes32 currentNullifierRoot;
	uint256 localHeadNodeId;
	uint256 localUnresolvedTotal;
	uint256[] localNodeIds;
	mapping(uint256 => mapping(uint256 => bytes32)) currentCarryNodeHashes;
	// Authoritative settled-set for inherited and local carried parentDepositIndexes in this instance.
	mapping(uint256 => bool) consumedParentDepositIndexes;
	// Enumerable mirror of consumed proof indexes used for recursive offchain proof reconstruction.
	uint256[] proofConsumedDepositIndexes;
}

struct OutcomeStateView {
	uint256 balance;
	uint256 snapshotLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] snapshotPeaks;
	uint256 inheritedUnresolvedTotal;
	bytes32 currentNullifierRoot;
	uint256 localHeadNodeId;
	uint256 currentLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] currentPeaks;
	uint256 localUnresolvedTotal;
	bytes32 currentCarryRoot;
	uint256 currentCarryTotal;
}

struct Node {
	// Previous unresolved node for this same outcome inside this escalation game instance.
	uint256 parentNodeId;
	address depositor;
	BinaryOutcomes.BinaryOutcome outcome;
	uint256 amount;
	// Stable ordering key inherited from the source escalation game.
	uint256 parentDepositIndex;
	// Prefix-position data needed for payout-order proofs.
	uint256 cumulativeAmount;
	uint256 carryLeafIndex;
}

struct CarriedDepositProof {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
	uint256 leafIndex;
	bytes32[] merkleMountainRangeSiblings;
	uint256 merkleMountainRangePeakIndex;
	bytes32[] nullifierSiblings;
}

struct ForkedEscrowState {
	uint256 sourcePrincipal;
	uint256 sourcePrincipalClaimed;
	uint256 childRep;
	uint256 childRepClaimed;
}
