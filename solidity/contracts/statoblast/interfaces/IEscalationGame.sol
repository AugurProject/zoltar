// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';

enum CarryConsumptionReason {
	WinningClaim,
	LosingSettlement,
	Export,
	DirectParentClaim,
	// Unused; kept because removing it adds approximately 240 bytes to EscalationGame.
	ForkedEscrowClaim
}

interface IEscalationGameEvents {
	/// @notice The game reached its non-decision threshold; timestamp uses Unix seconds.
	event NonDecisionReached(uint256 nonDecisionTimestamp);
	/// @notice A continuation inherited two or more threshold-full outcomes without fabricating a local timestamp.
	event InheritedThresholdTie(address indexed sourceGame);
	/// @notice An auction reduced an unfixed inherited tie below non-decision, reopening ordinary reporting.
	event InheritedThresholdTieReopened();
	/// @notice Accepted REP and resulting escrow totals, all in attoREP. `depositIndex` is the local
	/// per-outcome array index; `LocalDepositAppended.parentDepositIndex` is the stable continuation identity.
	/// `cumulativeRepAmountAttoRep` is the resulting outcome total.
	event DepositOnOutcome(address indexed depositor, BinaryOutcomes.BinaryOutcome indexed outcome, uint256 amountAttoRep, uint256 depositIndex, uint256 cumulativeRepAmountAttoRep, uint256 resultingVaultDisputeStakedAttoRep, uint256 resultingTotalDisputeStakedAttoRep);
	/// @notice One replayable carry leaf. `nodeId` is the stable source node identity; REP values use attoREP.
	event LocalDepositAppended(uint256 indexed nodeId, BinaryOutcomes.BinaryOutcome indexed outcome, address indexed depositor, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 cumulativeRepAmountAttoRep);
	/// @notice Compact commitment to the exact carry state installed from `sourceGame`. Counts are leaf counts;
	/// unresolved totals and resolution balances use attoREP. Roots commit to the exact child values.
	event ForkCarryCheckpoint(address indexed sourceGame, bytes32 indexed snapshotId, bytes32[3] carryRoots, bytes32[3] nullifierRoots, uint256[3] leafCounts, uint256[3] unresolvedTotalsAttoRep, uint256[3] resolutionBalancesAttoRep);
	/// @notice Resulting commitment state after one local or inherited deposit is consumed. `parentDepositIndex`
	/// and `sourceNodeId` are stable source identities; REP values use attoREP. The reason distinguishes
	/// claims, losing settlement, export, and direct parent claim.
	event CarryDepositConsumed(uint256 indexed parentDepositIndex, uint256 indexed sourceNodeId, address indexed depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, CarryConsumptionReason reason, uint256 resultingUnresolvedTotalAttoRep, bytes32 resultingNullifierRoot, bytes32 resultingCarryRoot);
}

interface IEscalationGameAuthorization {
	function depositRepOnOutcomeWithPermit(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
	function depositRepOnOutcomeWithAuthorization(address owner, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}
