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
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	uint256 internal lnRatioScaled;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	OutcomeState[3] internal outcomeState;
	uint256 internal nextNodeId = 1;
	mapping(uint256 => Node) public nodes;
	mapping(address => EscalationClaimBundle) internal escalationClaimBundles;
	uint256 public totalEscrowedRep;
	mapping(address => uint256) internal unresolvedRepByVault;
	uint256 internal totalLocalUnresolvedRep;
	mapping(address => uint256[3]) internal localUnresolvedPrincipalByVaultAndOutcome;
	mapping(address => bool) internal localUnresolvedTotalsExportedByVault;
	mapping(address => mapping(uint8 => ForkedEscrowState)) internal forkedEscrowByVaultAndOutcome;
	bool internal forkCarrySnapshotRequiresForkedEscrow;
	bool internal winnerHaircutPaidByFork;
	uint256 internal forkCarryInitialBacking;
	uint256 internal forkCarryEscrowedRep;
	address internal forkCarrySourceGame;
	address internal forkCarryRootClaimSourceGame;
	// A normalized binary floating-point checkpoint. The effective retention is
	// `mantissa * 2^-exponent`; keeping the mantissa's high bit set prevents an
	// arbitrary number of fork haircuts from underflowing the lineage index.
	uint256 public cumulativeClaimRetention = uint256(1) << 255;
	uint256 public cumulativeClaimRetentionExponent;
	BinaryOutcomes.BinaryOutcome public fixedQuestionOutcome;
	NonDecisionState public nonDecisionState;
	uint256 internal forkCarryBackingExportedBeforeResume;
	uint256 public truthAuctionRepBefore;
	uint256 public truthAuctionRepRemaining;

	function _claimEscrowedRepByVault(address vault) internal view returns (uint256 amount) {
		return _applyTruthAuctionRetention(escalationClaimBundles[vault].escrowedRep);
	}

	function _increaseEscrowedRepForBundle(address bundleId, uint256 amount, bool) internal {
		uint256 claimShares = _repToClaimShares(amount);
		escalationClaimBundles[bundleId].escrowedRep += claimShares;
		totalEscrowedRep += amount;
	}

	function _applyTruthAuctionRetention(uint256 amount) internal view returns (uint256) {
		if (truthAuctionRepBefore == 0) return amount;
		return (amount * truthAuctionRepRemaining) / truthAuctionRepBefore;
	}

	function _applyInheritedSourceRetention(
		uint256 amount,
		uint256 parentDepositIndex
	) internal view returns (uint256 retainedAmount) {
		(bool success, bytes memory retentionData) = address(this).staticcall(
			abi.encodeWithSignature('applyInheritedClaimRetention(uint256,uint256)', amount, parentDepositIndex)
		);
		if (!success || retentionData.length != 32) revert();
		return abi.decode(retentionData, (uint256));
	}

	function _applyInheritedSourceStorageBasis(
		uint256 amount,
		uint256 cumulativeAmount,
		uint256 parentDepositIndex
	) internal view returns (uint256) {
		(bool success, bytes memory retentionData) = address(this).staticcall(
			abi.encodeWithSignature(
				'applyInheritedSourceStorageBasis(uint256,uint256,uint256)',
				amount,
				cumulativeAmount,
				parentDepositIndex
			)
		);
		if (!success || retentionData.length != 32) revert();
		return abi.decode(retentionData, (uint256));
	}

	function _repToClaimShares(uint256 amount) internal view returns (uint256 shares) {
		if (truthAuctionRepBefore == 0) return amount;
		uint256 numerator = amount * truthAuctionRepBefore;
		shares = numerator / truthAuctionRepRemaining;
		if (shares * truthAuctionRepRemaining < numerator) shares += 1;
	}
}
