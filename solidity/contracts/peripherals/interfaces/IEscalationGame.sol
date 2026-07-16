// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';

enum CarryConsumptionReason {
	WinningClaim,
	LosingSettlement,
	Export,
	DirectParentClaim,
	ForkedEscrowClaim
}

interface IEscalationGameEvents {
	/// @notice The game reached its non-decision threshold; timestamp uses Unix seconds.
	event NonDecisionReached(uint256 nonDecisionTimestamp);
	/// @notice Accepted REP and resulting escrow totals, all in REP token base units. `depositIndex` is the local
	/// per-outcome array index; `LocalDepositAppended.parentDepositIndex` is the stable continuation identity.
	/// `cumulativeRepAmount` is the resulting outcome total.
	event DepositOnOutcome(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 repAmount,
		uint256 depositIndex,
		uint256 cumulativeRepAmount,
		uint256 resultingVaultEscrowedRep,
		uint256 resultingTotalEscrowedRep
	);
	/// @notice One replayable carry leaf. `nodeId` is the stable source node identity; REP values use base units.
	event LocalDepositAppended(
		uint256 indexed nodeId,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		address indexed depositor,
		uint256 repAmount,
		uint256 parentDepositIndex,
		uint256 cumulativeRepAmount
	);
	/// @notice Compact commitment to the exact carry state installed from `sourceGame`. Counts are leaf counts;
	/// unresolved totals and resolution balances use REP base units. Roots commit to the exact child values.
	event ForkCarryCheckpoint(
		address indexed sourceGame,
		bytes32 indexed snapshotId,
		bytes32[3] carryRoots,
		bytes32[3] nullifierRoots,
		uint256[3] leafCounts,
		uint256[3] unresolvedTotals,
		uint256[3] resolutionBalances
	);
	/// @notice Resulting commitment state after one local or inherited deposit is consumed. `parentDepositIndex`
	/// and `sourceNodeId` are stable source identities; REP values use token base units. The reason distinguishes
	/// claims, losing settlement, export, direct parent claim, and forked-escrow claim.
	event CarryDepositConsumed(
		uint256 indexed parentDepositIndex,
		uint256 indexed sourceNodeId,
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 repAmount,
		CarryConsumptionReason reason,
		uint256 resultingUnresolvedTotal,
		bytes32 resultingNullifierRoot,
		bytes32 resultingCarryRoot
	);
}
