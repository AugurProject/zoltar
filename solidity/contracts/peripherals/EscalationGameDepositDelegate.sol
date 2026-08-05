// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import {
	Deposit,
	ForkedEscrowState,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	Node,
	NonDecisionState,
	OutcomeState
} from './EscalationGameTypes.sol';

interface IEscalationGameDepositContext {
	function getQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function hasReachedNonDecision() external view returns (bool);
	function repToken() external view returns (address);
	function securityPool() external view returns (address);
	function getBindingCapitalAttoRep() external view returns (uint256);
	function computeTimeSinceStartFromAttritionCostAttoRep(uint256 amountAttoRep) external view returns (uint256);
	function isForkCarryFundingComplete() external view returns (bool);
}

interface IEscalationGameSecurityPoolContext {
	function securityPoolForker() external view returns (address);
}

contract EscalationGameDepositDelegate is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;
	event VaultEscrowUpdated(
		address indexed vault,
		uint256 disputeStakedRepByVaultAttoRep,
		uint256 totalDisputeStakedRepAttoRep
	);

	event TruthAuctionHaircutApplied(
		uint256 repBeforeAttoRep,
		uint256 repRemovedAttoRep,
		uint256 repRemainingAttoRep,
		uint256 rebasedElapsed
	);
	event ForkContinuationResumed(uint256 resumedAt);
	event ForkedEscrowRecorded(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipalTotalAttoRep,
		uint256 childRepTotalAttoRep,
		uint256 disputeStakedRepByVaultAttoRep,
		uint256 totalDisputeStakedRepAttoRep,
		uint256 outcomeBalanceAttoRep
	);

	function recordDeposit(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 repAmountAttoRep,
		uint256 expectedCumulativeRepAmountAttoRep
	) external returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		_validateAcceptedDeposit(
			outcome,
			outcomeIndex,
			selectedOutcomeState.balanceAttoRep,
			repAmountAttoRep,
			expectedCumulativeRepAmountAttoRep
		);
		selectedOutcomeState.balanceAttoRep = expectedCumulativeRepAmountAttoRep;
		_increaseEscrowedRepForBundle(depositor, repAmountAttoRep, true);
		unresolvedRepByVaultAttoRep[depositor] += repAmountAttoRep;
		totalLocalUnresolvedRepAttoRep += repAmountAttoRep;
		localUnresolvedPrincipalByVaultAndOutcome[depositor][outcomeIndex] += repAmountAttoRep;

		selectedOutcomeState.deposits.push(
			Deposit({
				depositor: depositor,
				amountAttoRep: repAmountAttoRep,
				cumulativeAmountAttoRep: expectedCumulativeRepAmountAttoRep
			})
		);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		parentDepositIndex = depositIndex;
		if (forkContinuation) {
			require(depositIndex < (uint256(1) << 88), 'Deposit index high');
			parentDepositIndex = (uint256(uint160(address(this))) << 96) | (uint256(outcomeIndex) << 88) | depositIndex;
		}
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		Node storage node = nodes[nodeId];
		node.parentNodeId = selectedOutcomeState.localHeadNodeId;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amountAttoRep = repAmountAttoRep;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmountAttoRep = expectedCumulativeRepAmountAttoRep;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotalAttoRep += repAmountAttoRep;
		_appendCarryLeaf(selectedOutcomeState, nodeId);

		emit LocalDepositAppended(
			nodeId,
			outcome,
			depositor,
			repAmountAttoRep,
			parentDepositIndex,
			expectedCumulativeRepAmountAttoRep
		);
		emit DepositOnOutcome(
			depositor,
			outcome,
			repAmountAttoRep,
			depositIndex,
			expectedCumulativeRepAmountAttoRep,
			_claimEscrowedRepByVault(depositor),
			totalDisputeStakedRepAttoRep
		);
		if (IEscalationGameDepositContext(address(this)).hasReachedNonDecision()) {
			nonDecisionState = NonDecisionState.Local;
			nonDecisionTimestamp = block.timestamp;
			emit NonDecisionReached(nonDecisionTimestamp);
		}
	}

	function recordForkedEscrowForOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipalAttoRep,
		uint256 childRepAmountAttoRep
	) external {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(depositor != address(0x0), 'Depositor is zero');
		if (sourcePrincipalAttoRep == 0 && childRepAmountAttoRep == 0) return;
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		state.sourcePrincipalAttoRep += sourcePrincipalAttoRep;
		uint256 effectiveChildRepAttoRep = _applyTruthAuctionRetention(childRepAmountAttoRep);
		state.childRepAttoRep += childRepAmountAttoRep;
		// The carry commitment owns inherited payout identity. This record tracks
		// only child-local escrow attributed to the immutable depositor.
		_increaseEscrowedRepForBundle(depositor, effectiveChildRepAttoRep, false);
		emit ForkedEscrowRecorded(
			depositor,
			outcome,
			state.sourcePrincipalAttoRep,
			state.childRepAttoRep,
			_claimEscrowedRepByVault(depositor),
			totalDisputeStakedRepAttoRep,
			outcomeState[uint8(outcome)].balanceAttoRep
		);
	}

	function _validateAcceptedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		uint8 outcomeIndex,
		uint256 currentBalanceAttoRep,
		uint256 repAmountAttoRep,
		uint256 expectedCumulativeRepAmountAttoRep
	) private view {
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(
			IEscalationGameDepositContext(address(this)).getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None,
			'Question resolved'
		);
		require(currentBalanceAttoRep < nonDecisionThresholdAttoRep, 'Outcome full');
		require(repAmountAttoRep > 0, 'Deposit zero');
		require(expectedCumulativeRepAmountAttoRep == currentBalanceAttoRep + repAmountAttoRep, 'Preview mismatch');
		require(expectedCumulativeRepAmountAttoRep <= nonDecisionThresholdAttoRep, 'Deposit exceeds room');
		require(
			repAmountAttoRep >= startBondAttoRep || expectedCumulativeRepAmountAttoRep == nonDecisionThresholdAttoRep,
			'Below start bond'
		);

		uint256 maxBalance = outcomeState[0].balanceAttoRep;
		if (outcomeState[1].balanceAttoRep > maxBalance) maxBalance = outcomeState[1].balanceAttoRep;
		if (outcomeState[2].balanceAttoRep > maxBalance) maxBalance = outcomeState[2].balanceAttoRep;
		if (expectedCumulativeRepAmountAttoRep != maxBalance || maxBalance >= nonDecisionThresholdAttoRep) return;
		for (uint8 otherOutcomeIndex = 0; otherOutcomeIndex < 3; otherOutcomeIndex++) {
			if (otherOutcomeIndex != outcomeIndex && outcomeState[otherOutcomeIndex].balanceAttoRep == maxBalance) {
				revert('Preview mismatch');
			}
		}
	}

	function _appendCarryLeaf(OutcomeState storage state, uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(
			node.depositor,
			node.outcome,
			node.amountAttoRep,
			node.parentDepositIndex,
			node.cumulativeAmountAttoRep,
			nodeId
		);
		uint256 leafCount = state.currentLeafCount;
		uint256 peakHeight;
		uint256 carryStartIndex = leafCount;
		state.currentCarryNodeHashes[0][carryStartIndex] = carryHash;
		while (((leafCount >> peakHeight) & 1) == 1) {
			uint256 siblingStartIndex = carryStartIndex - (uint256(1) << peakHeight);
			carryHash = MerkleMountainRange.hashParent(state.currentPeaks[peakHeight], carryHash);
			delete state.currentPeaks[peakHeight];
			peakHeight += 1;
			carryStartIndex = siblingStartIndex;
			state.currentCarryNodeHashes[peakHeight][carryStartIndex] = carryHash;
		}
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'MMR too tall');
		state.currentPeaks[peakHeight] = carryHash;
		state.currentLeafCount = leafCount + 1;
	}

	function applyTruthAuctionHaircut(uint256 repToRemoveAttoRep) external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		address poolAddress = game.securityPool();
		require(msg.sender == IEscalationGameSecurityPoolContext(poolAddress).securityPoolForker(), 'Only forker');
		require(forkContinuation && forkResumedAt == 0, 'Fork not paused');
		require(truthAuctionRepBeforeAttoRep == 0, 'Haircut applied');
		uint256 repBeforeAttoRep = IERC20(game.repToken()).balanceOf(address(this));
		require(repToRemoveAttoRep < repBeforeAttoRep, 'Haircut too high');
		uint256 repRemainingAttoRep = repBeforeAttoRep - repToRemoveAttoRep;
		truthAuctionRepBeforeAttoRep = repBeforeAttoRep;
		truthAuctionRepRemainingAttoRep = repRemainingAttoRep;
		uint256 ratioShift = Math.log2(repBeforeAttoRep) - Math.log2(repRemainingAttoRep);
		uint256 scaledRemaining = repRemainingAttoRep << ratioShift;
		if (scaledRemaining > repBeforeAttoRep) {
			scaledRemaining >>= 1;
			ratioShift -= 1;
		}
		uint256 nextRetention = Math.mulDiv(cumulativeClaimRetention, scaledRemaining, repBeforeAttoRep);
		uint256 normalizationShift = 255 - Math.log2(nextRetention);
		cumulativeClaimRetention = nextRetention << normalizationShift;
		cumulativeClaimRetentionExponent += ratioShift + normalizationShift;
		totalDisputeStakedRepAttoRep = (totalDisputeStakedRepAttoRep * repRemainingAttoRep) / repBeforeAttoRep;
		forkCarryDisputeStakedRepAttoRep = (forkCarryDisputeStakedRepAttoRep * repRemainingAttoRep) / repBeforeAttoRep;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			outcomeState[outcomeIndex].balanceAttoRep =
				(outcomeState[outcomeIndex].balanceAttoRep * repRemainingAttoRep) / repBeforeAttoRep;
		}
		forkElapsedAtStart = game.computeTimeSinceStartFromAttritionCostAttoRep(game.getBindingCapitalAttoRep());
		IERC20(game.repToken()).safeTransfer(poolAddress, repToRemoveAttoRep);
		emit TruthAuctionHaircutApplied(repBeforeAttoRep, repToRemoveAttoRep, repRemainingAttoRep, forkElapsedAtStart);
	}

	function resumeFromFork() external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		require(msg.sender == game.securityPool(), 'Only pool');
		require(forkContinuation, 'No fork mode');
		require(forkResumedAt == 0, 'Fork resumed');
		require(game.isForkCarryFundingComplete(), 'Fork carry underfunded');
		if (forkCarryDisputeStakedRepAttoRep == 0 && forkCarrySnapshotRequiresForkedEscrow) {
			for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
				forkCarryDisputeStakedRepAttoRep += _applyTruthAuctionRetention(
					outcomeState[outcomeIndex].inheritedUnresolvedTotalAttoRep
				);
			}
			totalDisputeStakedRepAttoRep += forkCarryDisputeStakedRepAttoRep;
		}
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function consumeEscrowedRepForOwner(address ownerAddress, uint256 amountAttoRep) external {
		if (amountAttoRep == 0) return;
		uint256 claimUnits = _repToClaimUnits(amountAttoRep);
		require(escalationClaimBundles[ownerAddress].disputeStakedRepClaimUnits >= claimUnits, 'Escrowed REP low');
		escalationClaimBundles[ownerAddress].disputeStakedRepClaimUnits -= claimUnits;
		totalDisputeStakedRepAttoRep -= amountAttoRep;
		emit VaultEscrowUpdated(ownerAddress, _claimEscrowedRepByVault(ownerAddress), totalDisputeStakedRepAttoRep);
	}

	function consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amountAttoRep) external {
		require(unresolvedRepByVaultAttoRep[bundleId] >= amountAttoRep, 'Claim accounting remainder');
		require(
			localUnresolvedPrincipalByVaultAndOutcome[bundleId][outcomeIndex] >= amountAttoRep,
			'Claim accounting remainder'
		);
		unresolvedRepByVaultAttoRep[bundleId] -= amountAttoRep;
		localUnresolvedPrincipalByVaultAndOutcome[bundleId][outcomeIndex] -= amountAttoRep;
		totalLocalUnresolvedRepAttoRep -= amountAttoRep;
	}

	function creditClaimOwners(address bundleId, uint256 amountAttoRep) external {
		if (amountAttoRep == 0) return;
		IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(bundleId, amountAttoRep);
	}

	function creditExternalClaimOwners(
		address,
		address bundleId,
		uint256,
		uint256 amountAttoRep,
		uint256 burnAmountAttoRep
	) external {
		uint256 backingConsumed = amountAttoRep + (winnerHaircutPaidByFork ? 0 : burnAmountAttoRep);
		require(totalDisputeStakedRepAttoRep >= backingConsumed, 'Escrow low');
		uint256 inheritedBackingConsumed =
			backingConsumed < forkCarryDisputeStakedRepAttoRep ? backingConsumed : forkCarryDisputeStakedRepAttoRep;
		forkCarryDisputeStakedRepAttoRep -= inheritedBackingConsumed;
		totalDisputeStakedRepAttoRep -= backingConsumed;
		if (amountAttoRep == 0) return;
		IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(bundleId, amountAttoRep);
	}
}
