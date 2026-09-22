// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	EscalationClaimBundle,
	ForkedEscrowState,
	Node,
	NonDecisionState,
	OutcomeState
} from './EscalationGameTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

abstract contract EscalationGameStorage {
	uint256 public activationTime;
	uint256 public nonDecisionThresholdAttoRep;
	uint256 public startBondAttoRep;
	uint256 internal lnRatioScaled;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	OutcomeState[3] internal outcomeState;
	uint256 internal nextNodeId = 1;
	mapping(uint256 => Node) public nodes;
	mapping(address => EscalationClaimBundle) internal escalationClaimBundles;
	uint256 public totalDisputeStakedAttoRep;
	mapping(address => uint256) internal unresolvedRepByVaultAttoRep;
	uint256 internal totalLocalUnresolvedAttoRep;
	mapping(address => uint256[3]) internal localUnresolvedPrincipalByVaultAndOutcome;
	mapping(address => bool) internal localUnresolvedTotalsExportedByVault;
	mapping(address => mapping(uint8 => ForkedEscrowState)) internal forkedEscrowByVaultAndOutcome;
	bool internal forkCarrySnapshotRequiresForkedEscrow;
	bool internal winnerHaircutPaidByFork;
	uint256 internal forkCarryInitialBackingAttoRep;
	uint256 internal forkCarryDisputeStakedAttoRep;
	address internal forkCarrySourceGame;
	address internal forkCarryRootClaimSourceGame;
	BinaryOutcomes.BinaryOutcome public fixedQuestionOutcome;
	NonDecisionState public nonDecisionState;
	uint256 internal forkCarryBackingExportedBeforeResumeAttoRep;
	uint256 public truthAuctionRepBeforeAttoRep;
	uint256 public truthAuctionRepRemainingAttoRep;

	function _claimEscrowedRepByVault(address vault) internal view returns (uint256 amountAttoRep) {
		return _applyTruthAuctionRetention(escalationClaimBundles[vault].disputeStakedRepClaimUnits);
	}

	function _increaseEscrowedRepForBundle(address bundleId, uint256 amountAttoRep, bool) internal {
		uint256 claimUnits = _repToClaimUnits(amountAttoRep);
		escalationClaimBundles[bundleId].disputeStakedRepClaimUnits += claimUnits;
		totalDisputeStakedAttoRep += amountAttoRep;
	}

	function _applyTruthAuctionRetention(uint256 amountAttoRep) internal view returns (uint256) {
		if (truthAuctionRepBeforeAttoRep == 0) return amountAttoRep;
		return (amountAttoRep * truthAuctionRepRemainingAttoRep) / truthAuctionRepBeforeAttoRep;
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
		if (!success) {
			assembly ('memory-safe') {
				revert(add(data, 32), mload(data))
			}
		}
		require(data.length == 128, 'Invalid allocation response');
		return abi.decode(data, (uint256, uint256, uint256, uint256));
	}

	function _repToClaimUnits(uint256 amountAttoRep) internal view returns (uint256 claimUnits) {
		if (truthAuctionRepBeforeAttoRep == 0) return amountAttoRep;
		uint256 numerator = amountAttoRep * truthAuctionRepBeforeAttoRep;
		claimUnits = numerator / truthAuctionRepRemainingAttoRep;
		if (claimUnits * truthAuctionRepRemainingAttoRep < numerator) claimUnits += 1;
	}
}
