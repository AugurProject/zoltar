// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	EscalationClaimBundle,
	CLAIM_SHARE_SCALE,
	ForkedEscrowState,
	MAX_CLAIM_BUNDLES_PER_VAULT,
	MAX_CLAIM_OWNERS_PER_BUNDLE,
	MAX_CLAIM_SOURCE_DEPTH,
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
	mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) internal claimBundlesByOwner;
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
	BinaryOutcomes.BinaryOutcome public fixedQuestionOutcome;
	NonDecisionState public nonDecisionState;
	uint256 internal forkCarryBackingExportedBeforeResume;
	uint256 public truthAuctionRepBefore;
	uint256 public truthAuctionRepRemaining;
	// Escrow shares are consumed as REP leaves this game; payout shares survive
	// exports so liquidation ownership follows the claim through descendants.
	mapping(address => EscalationClaimBundle) internal payoutClaimBundles;
	mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) internal payoutClaimBundlesByOwner;

	function _claimEscrowedRepByVault(address vault) internal view returns (uint256 amount) {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = claimBundlesByOwner[vault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				if (bundle.owners[ownerIndex] != vault || bundle.totalShares == 0) continue;
				uint256 bundleRep = _applyTruthAuctionRetention(bundle.escrowedRep);
				amount += (bundleRep * bundle.ownerShares[ownerIndex]) / bundle.totalShares;
				break;
			}
		}
	}

	function _increaseEscrowedRepForBundle(address bundleId, uint256 amount) internal {
		EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
		if (bundle.totalShares == 0) {
			bundle.totalShares = CLAIM_SHARE_SCALE;
			bundle.owners[0] = bundleId;
			bundle.ownerShares[0] = CLAIM_SHARE_SCALE;
		}
		EscalationClaimBundle storage payoutBundle = payoutClaimBundles[bundleId];
		if (payoutBundle.totalShares == 0) {
			payoutBundle.totalShares = CLAIM_SHARE_SCALE;
			payoutBundle.owners[0] = bundleId;
			payoutBundle.ownerShares[0] = CLAIM_SHARE_SCALE;
		}
		bundle.escrowedRep += _repToClaimShares(amount);
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
		retainedAmount = amount;
		address sourceGame = forkCarrySourceGame;
		address encodedSourceGame = address(uint160(parentDepositIndex >> 96));
		// All calls are fixed-size getters and the ancestry loop shares the
		// protocol's eight-generation claim-source bound.
		assembly ('memory-safe') {
			for {
				let depth := 0
			} and(lt(depth, MAX_CLAIM_SOURCE_DEPTH), sourceGame) {
				depth := add(depth, 1)
			} {
				if and(encodedSourceGame, eq(sourceGame, encodedSourceGame)) {
					sourceGame := 0
					break
				}
				mstore(0, shl(224, 0xee692417))
				let retentionSuccess := staticcall(gas(), sourceGame, 0, 4, 0, 0x40)
				if and(retentionSuccess, eq(returndatasize(), 0x40)) {
					let repBefore := mload(0)
					if repBefore {
						let repRemaining := mload(0x20)
						if gt(repRemaining, repBefore) {
							retainedAmount := not(0)
							sourceGame := 0
							break
						}
						retainedAmount := div(mul(retainedAmount, repRemaining), repBefore)
					}
				}
				mstore(0, shl(224, 0xdb05d0b2))
				let sourceSuccess := staticcall(gas(), sourceGame, 0, 4, 0, 0x20)
				if iszero(and(sourceSuccess, eq(returndatasize(), 0x20))) {
					sourceGame := 0
					break
				}
				let nextSourceGame := mload(0)
				if iszero(nextSourceGame) {
					sourceGame := 0
					break
				}
				sourceGame := nextSourceGame
			}
		}
	}

	function _repToClaimShares(uint256 amount) internal view returns (uint256 shares) {
		if (truthAuctionRepBefore == 0) return amount;
		uint256 numerator = amount * truthAuctionRepBefore;
		shares = numerator / truthAuctionRepRemaining;
		if (shares * truthAuctionRepRemaining < numerator) shares += 1;
	}
}
