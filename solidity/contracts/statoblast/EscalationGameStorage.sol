// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	EscalationClaimBundle,
	ForkedEscrowState,
	Node,
	NonDecisionState,
	OutcomeState
} from './EscalationGameTypes.sol';
import { EscalationClaimCheckpoint } from './EscalationClaimCheckpointTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { DelegateCall } from './DelegateCall.sol';

abstract contract EscalationGameStorage {
	uint256 internal constant ACTIVATION_DELAY = 3 days;
	uint256 public activationTime;
	uint256 public nonDecisionThresholdAttoRep;
	uint256 public startBondAttoRep;
	uint256 internal lnRatioScaled;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	// Negative elapsed time preserves activation delay still pending at the fork.
	int256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	OutcomeState[3] internal outcomeState;
	uint256 internal nextNodeId = 1;
	// Game-local node ID -> deposit node; zero is the absent-node sentinel.
	mapping(uint256 => Node) public nodes;
	struct VaultAccounting {
		EscalationClaimBundle claimBundle;
		uint256 unresolvedAttoRep;
		// Original unconsumed principal indexed by BinaryOutcome (Invalid, Yes, No).
		uint256[3] localUnresolvedPrincipalByOutcome;
		bool localUnresolvedTotalsExported;
		// Each branch retains its independent escrow accounting.
		mapping(uint8 => ForkedEscrowState) forkedEscrowByOutcome;
		// Only the new report generating surplus relinquishes this collateral credit.
		uint256 collateralBackingAttoRep;
	}
	mapping(address => VaultAccounting) internal vaultAccounting;

	// Logical escrow: unsettled local/bundle principal plus remaining inherited
	// backing. This is not the token balance or a budget for winner rewards.
	uint256 public totalDisputeStakedAttoRep;
	// Original local principal still represented by unconsumed claims.
	uint256 internal totalLocalUnresolvedAttoRep;
	bool internal forkCarrySnapshotRequiresForkedEscrow;
	bool public winnerHaircutPaidByFork;
	uint256 internal forkCarryInitialBackingAttoRep;
	// The inherited component of totalDisputeStakedAttoRep. Inherited expenditure
	// retires at most this component; local principal is released on settlement.
	uint256 internal forkCarryDisputeStakedAttoRep;
	address internal forkCarrySourceGame;
	address internal forkCarryRootClaimSourceGame;
	BinaryOutcomes.BinaryOutcome public fixedQuestionOutcome;
	NonDecisionState public nonDecisionState;
	uint256 internal forkCarryBackingExportedBeforeResumeAttoRep;
	uint8 public forkCarrySnapshotOutcomesInitialized;
	bytes32 internal forkCarrySnapshotId;
	// A checkpoint stores only frozen grandparent-and-earlier transforms. The
	// current game and its immediate source always remain live.
	mapping(bytes32 => EscalationClaimCheckpoint) internal claimCheckpoints;
	bool public ordinarySettlementInitialized;
	BinaryOutcomes.BinaryOutcome internal ordinarySettlementOutcome;
	uint256 public ordinaryWinningReserveAttoRep;
	uint256 public ordinarySettlementForkThresholdAttoRep;
	// Ordinary deposits irrevocably release the minimum outcome balance. Reporter
	// principal remains nominal because only one outcome can claim in each child.
	uint256 public creditedSurplusAttoRep;

	function _isDepositResolutionOpen(BinaryOutcomes.BinaryOutcome provisionalResolution) internal view returns (bool) {
		// A provisional leader cannot close an unresolved unrelated continuation's
		// guaranteed response period. Equality remains open, matching finality.
		return
			provisionalResolution == BinaryOutcomes.BinaryOutcome.None ||
			(forkContinuation &&
				fixedQuestionOutcome == BinaryOutcomes.BinaryOutcome.None &&
				forkResumedAt != 0 &&
				block.timestamp <= forkResumedAt + ACTIVATION_DELAY);
	}

	function _claimEscrowedRepByVault(address vault) internal view returns (uint256 amountAttoRep) {
		if (ordinarySettlementInitialized)
			return vaultAccounting[vault].localUnresolvedPrincipalByOutcome[uint8(ordinarySettlementOutcome)];
		return (vaultAccounting[vault].claimBundle.disputeStakedRepClaimUnits);
	}

	function _isRetiredOrdinaryOutcome(uint8 outcomeIndex) internal view returns (bool) {
		return ordinarySettlementInitialized && outcomeIndex != uint8(ordinarySettlementOutcome);
	}

	function _increaseEscrowedRepForBundle(address bundleId, uint256 amountAttoRep) internal {
		uint256 claimUnits = amountAttoRep;
		vaultAccounting[bundleId].claimBundle.disputeStakedRepClaimUnits += claimUnits;
		totalDisputeStakedAttoRep += amountAttoRep;
	}

	function _recordConsumedPrincipal(uint8 outcomeIndex, uint256 leafIndex, uint256 amountAttoRep) internal {
		// Carry indexes are strictly below 2^64. Updating the fixed-size tree does
		// not depend on the number or order of previously settled deposits.
		uint256 index = leafIndex + 1;
		while (index <= outcomeState[outcomeIndex].currentLeafCount) {
			outcomeState[outcomeIndex].consumedPrincipalTree[index] += amountAttoRep;
			index += index & (~index + 1);
		}
	}

	function _consumedPrincipalBefore(uint8 outcomeIndex, uint256 leafIndex) internal view returns (uint256 amountAttoRep) {
		while (leafIndex != 0) {
			amountAttoRep += outcomeState[outcomeIndex].consumedPrincipalTree[leafIndex];
			leafIndex &= leafIndex - 1;
		}
	}

	function _getInheritedClaimAllocation(uint8 outcomeIndex, uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 leafIndex)
		internal
		view
		returns (
			uint256 sourceAmountAttoRep,
			uint256 retainedAmountAttoRep,
			uint256 rewardAmountAttoRep,
			uint256 retainedCumulativeAttoRep
		)
	{
		(bool success, bytes memory data) = address(this).staticcall(abi.encodeWithSignature('getInheritedClaimAllocation(uint8,uint256,uint256,uint256)', outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex));
		if (!success) DelegateCall.bubbleRevert(data);
		require(data.length == 128, 'Invalid allocation response');
		return abi.decode(data, (uint256, uint256, uint256, uint256));
	}
}
