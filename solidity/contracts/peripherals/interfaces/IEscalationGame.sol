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
	/// @notice A continuation inherited two or more threshold-full outcomes without fabricating a local timestamp.
	event InheritedThresholdTie(address indexed sourceGame);
	/// @notice Accepted REP and resulting escrow totals, all in attoREP. `depositIndex` is the local
	/// per-outcome array index; `LocalDepositAppended.parentDepositIndex` is the stable continuation identity.
	/// `cumulativeRepAmountAttoRep` is the resulting outcome total.
	event DepositOnOutcome(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 attoRepAmount,
		uint256 depositIndex,
		uint256 cumulativeRepAmountAttoRep,
		uint256 resultingVaultDisputeStakedAttoRep,
		uint256 resultingTotalDisputeStakedAttoRep
	);
	/// @notice One replayable carry leaf. `nodeId` is the stable source node identity; REP values use attoREP.
	event LocalDepositAppended(
		uint256 indexed nodeId,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		address indexed depositor,
		uint256 attoRepAmount,
		uint256 parentDepositIndex,
		uint256 cumulativeRepAmountAttoRep
	);
	/// @notice Compact commitment to the exact carry state installed from `sourceGame`. Counts are leaf counts;
	/// unresolved totals and resolution balances use attoREP. Roots commit to the exact child values.
	event ForkCarryCheckpoint(
		address indexed sourceGame,
		bytes32 indexed snapshotId,
		bytes32[3] carryRoots,
		bytes32[3] nullifierRoots,
		uint256[3] leafCounts,
		uint256[3] unresolvedTotalsAttoRep,
		uint256[3] resolutionBalancesAttoRep
	);
	/// @notice Resulting commitment state after one local or inherited deposit is consumed. `parentDepositIndex`
	/// and `sourceNodeId` are stable source identities; REP values use attoREP. The reason distinguishes
	/// claims, losing settlement, export, direct parent claim, and forked-escrow claim.
	event CarryDepositConsumed(
		uint256 indexed parentDepositIndex,
		uint256 indexed sourceNodeId,
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 attoRepAmount,
		CarryConsumptionReason reason,
		uint256 resultingUnresolvedTotalAttoRep,
		bytes32 resultingNullifierRoot,
		bytes32 resultingCarryRoot
	);
}
