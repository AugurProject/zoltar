// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationClaimBundle, Node, NonDecisionState, OutcomeState } from './EscalationGameTypes.sol';
import { EscalationClaimCheckpoint } from './EscalationClaimCheckpointTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { DelegateCall } from './DelegateCall.sol';

/// @dev EscalationGame owns this storage and routes mutations through delegatecall.
/// DepositDelegate writes deposits, carry initialization and escrow; ClaimDelegate
/// processes bounded claim checkpoints. Both must share this exact layout.
/// Pool/custody bindings and authorization live in the host context: delegates
/// execute with the original caller and the host's storage, not their own accounts.
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
	// A deposit that takes the lead restarts the response period. The attrition
	// curve alone cannot guarantee one: a challenger resting just below the leader
	// pushes the curve deadline to the leader's own stake, then flips at that second.
	uint256 public responseRestartedUntil;
	// A continuation scales winning claims by the universe's fork threshold. The first
	// claim freezes it, as ordinary settlement does: otherwise REP burned between two
	// claims, including each claim's own haircut, would pay later claimants less.
	uint256 public continuationSettlementForkThresholdAttoRep;

	function _strictStakeLeader() internal view returns (BinaryOutcomes.BinaryOutcome leader) {
		uint256 highest;
		for (uint8 index = 0; index < 3; index++) {
			uint256 balance = outcomeState[index].balanceAttoRep;
			if (balance > highest) {
				highest = balance;
				leader = BinaryOutcomes.BinaryOutcome(index);
			} else if (balance == highest) leader = BinaryOutcomes.BinaryOutcome.None;
		}
	}

	function _isDepositResolutionOpen(BinaryOutcomes.BinaryOutcome provisionalResolution) internal view returns (bool) {
		// A provisional leader cannot close a guaranteed response period: the one
		// an unresolved continuation starts with, or one restarted by a change of
		// leader. Equality remains open, matching finality.
		if (provisionalResolution == BinaryOutcomes.BinaryOutcome.None) return true;
		if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None || (forkContinuation && forkResumedAt == 0))
			return false;
		return block.timestamp <= _responseEnd();
	}

	/// @dev Last second of the current guaranteed response period, or zero when none applies.
	function _responseEnd() internal view returns (uint256 end) {
		if (forkContinuation) end = forkResumedAt + ACTIVATION_DELAY;
		if (responseRestartedUntil > end) end = responseRestartedUntil;
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
