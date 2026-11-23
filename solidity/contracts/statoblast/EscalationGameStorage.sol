// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationClaimBundle, Node, NonDecisionState, OutcomeState } from './EscalationGameTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { Constants } from '../Constants.sol';

/// @dev EscalationGame owns this storage and routes mutations through delegatecall.
/// DepositDelegate writes deposits, carry initialization and escrow using this exact layout.
/// Pool/custody bindings and authorization live in the host context: delegates
/// execute with the original caller and the host's storage, not their own accounts.
abstract contract EscalationGameStorage {
	uint256 internal constant ACTIVATION_DELAY = Constants.FORK_RESPONSE_DELAY;
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
	BinaryOutcomes.BinaryOutcome public fixedQuestionOutcome;
	NonDecisionState public nonDecisionState;
	uint8 public forkCarrySnapshotOutcomesInitialized;
	bytes32 internal forkCarrySnapshotId;
	bool public ordinarySettlementInitialized;
	BinaryOutcomes.BinaryOutcome internal ordinarySettlementOutcome;
	uint256 public ordinaryWinningReserveAttoRep;
	// Ordinary deposits irrevocably release the minimum outcome balance. Reporter
	// principal remains nominal because only one outcome can claim in each child.
	uint256 public creditedSurplusAttoRep;
	// Winning claims scale by the universe's fork threshold as it stood when the game
	// last changed: every accepted deposit and a continuation's resume record it. REP
	// burned once the game can no longer change, including each claim's own haircut,
	// cannot pay any winner less.
	uint256 public settlementForkThresholdAttoRep;

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
		// The game is open while the curve is at or below the median. A provisional
		// leader closes it, except during the fixed response period a resumed
		// continuation starts with. Equality remains open, matching finality.
		if (provisionalResolution == BinaryOutcomes.BinaryOutcome.None) return true;
		if (!forkContinuation || forkResumedAt == 0 || fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None)
			return false;
		return block.timestamp <= forkResumedAt + ACTIVATION_DELAY;
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
}
