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
	// A normalized binary floating-point checkpoint. The effective retention is
	// `mantissa * 2^-exponent`; keeping the mantissa's high bit set prevents an
	// arbitrary number of fork haircuts from underflowing the lineage index.
	uint256 public cumulativeClaimRetention = uint256(1) << 255;
	uint256 public cumulativeClaimRetentionExponent;
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

	function _applyInheritedSourceRetention(uint256 amountAttoRep, uint256 parentDepositIndex) internal view returns (uint256 retainedAmountAttoRep) {
		(bool success, bytes memory retentionData) = address(this).staticcall(abi.encodeWithSignature('applyInheritedClaimRetention(uint256,uint256)', amountAttoRep, parentDepositIndex));
		if (!success || retentionData.length != 32) revert();
		return abi.decode(retentionData, (uint256));
	}

	function _applyInheritedSourceStorageBasis(uint256 amountAttoRep, uint256 cumulativeAmountAttoRep, uint256 parentDepositIndex) internal view returns (uint256) {
		(bool success, bytes memory retentionData) = address(this).staticcall(abi.encodeWithSignature('applyInheritedSourceStorageBasis(uint256,uint256,uint256)', amountAttoRep, cumulativeAmountAttoRep, parentDepositIndex));
		if (!success || retentionData.length != 32) revert();
		return abi.decode(retentionData, (uint256));
	}

	function _repToClaimUnits(uint256 amountAttoRep) internal view returns (uint256 claimUnits) {
		if (truthAuctionRepBeforeAttoRep == 0) return amountAttoRep;
		uint256 numerator = amountAttoRep * truthAuctionRepBeforeAttoRep;
		claimUnits = numerator / truthAuctionRepRemainingAttoRep;
		if (claimUnits * truthAuctionRepRemainingAttoRep < numerator) claimUnits += 1;
	}
}
