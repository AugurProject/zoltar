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
	function getBindingCapital() external view returns (uint256);
	function computeTimeSinceStartFromAttritionCost(uint256 amount) external view returns (uint256);
	function isForkCarryFundingComplete() external view returns (bool);
}

interface IEscalationGameSecurityPoolContext {
	function securityPoolForker() external view returns (address);
}

contract EscalationGameDepositDelegate is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;
	event VaultEscrowUpdated(address indexed vault, uint256 escrowedRepByVault, uint256 totalEscrowedRep);

	event TruthAuctionHaircutApplied(
		uint256 repBefore,
		uint256 repRemoved,
		uint256 repRemaining,
		uint256 rebasedElapsed
	);
	event ForkContinuationResumed(uint256 resumedAt);
	event ForkedEscrowRecorded(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipal,
		uint256 childRep,
		uint256 escrowedRepByVault,
		uint256 totalEscrowedRep,
		uint256 outcomeBalance
	);

	function recordDeposit(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) external returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		_validateAcceptedDeposit(
			outcome,
			outcomeIndex,
			selectedOutcomeState.balance,
			repAmount,
			expectedCumulativeRepAmount
		);
		selectedOutcomeState.balance = expectedCumulativeRepAmount;
		_increaseEscrowedRepForBundle(depositor, repAmount, true);
		unresolvedRepByVault[depositor] += repAmount;
		totalLocalUnresolvedRep += repAmount;
		localUnresolvedPrincipalByVaultAndOutcome[depositor][outcomeIndex] += repAmount;

		selectedOutcomeState.deposits.push(
			Deposit({ depositor: depositor, amount: repAmount, cumulativeAmount: expectedCumulativeRepAmount })
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
		node.amount = repAmount;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmount = expectedCumulativeRepAmount;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotal += repAmount;
		_appendCarryLeaf(selectedOutcomeState, nodeId);

		emit LocalDepositAppended(
			nodeId,
			outcome,
			depositor,
			repAmount,
			parentDepositIndex,
			expectedCumulativeRepAmount
		);
		emit DepositOnOutcome(
			depositor,
			outcome,
			repAmount,
			depositIndex,
			expectedCumulativeRepAmount,
			_claimEscrowedRepByVault(depositor),
			totalEscrowedRep
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
		uint256 sourcePrincipal,
		uint256 childRepAmount
	) external {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(depositor != address(0x0), 'Depositor is zero');
		if (sourcePrincipal == 0 && childRepAmount == 0) return;
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		state.sourcePrincipal += sourcePrincipal;
		uint256 effectiveChildRep = _applyTruthAuctionRetention(childRepAmount);
		state.childRep += childRepAmount;
		// The carry commitment owns inherited payout identity. This record tracks
		// only child-local escrow attributed to the immutable depositor.
		_increaseEscrowedRepForBundle(depositor, effectiveChildRep, false);
		emit ForkedEscrowRecorded(
			depositor,
			outcome,
			state.sourcePrincipal,
			state.childRep,
			_claimEscrowedRepByVault(depositor),
			totalEscrowedRep,
			outcomeState[uint8(outcome)].balance
		);
	}

	function _validateAcceptedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		uint8 outcomeIndex,
		uint256 currentBalance,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) private view {
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(
			IEscalationGameDepositContext(address(this)).getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None,
			'Question resolved'
		);
		require(currentBalance < nonDecisionThreshold, 'Outcome full');
		require(repAmount > 0, 'Deposit zero');
		require(expectedCumulativeRepAmount == currentBalance + repAmount, 'Preview mismatch');
		require(expectedCumulativeRepAmount <= nonDecisionThreshold, 'Deposit exceeds room');
		require(repAmount >= startBond || expectedCumulativeRepAmount == nonDecisionThreshold, 'Below start bond');

		uint256 maxBalance = outcomeState[0].balance;
		if (outcomeState[1].balance > maxBalance) maxBalance = outcomeState[1].balance;
		if (outcomeState[2].balance > maxBalance) maxBalance = outcomeState[2].balance;
		if (expectedCumulativeRepAmount != maxBalance || maxBalance >= nonDecisionThreshold) return;
		for (uint8 otherOutcomeIndex = 0; otherOutcomeIndex < 3; otherOutcomeIndex++) {
			if (otherOutcomeIndex != outcomeIndex && outcomeState[otherOutcomeIndex].balance == maxBalance) {
				revert('Preview mismatch');
			}
		}
	}

	function _appendCarryLeaf(OutcomeState storage state, uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(
			node.depositor,
			node.outcome,
			node.amount,
			node.parentDepositIndex,
			node.cumulativeAmount,
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

	function applyTruthAuctionHaircut(uint256 repToRemove) external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		address poolAddress = game.securityPool();
		require(msg.sender == IEscalationGameSecurityPoolContext(poolAddress).securityPoolForker(), 'Only forker');
		require(forkContinuation && forkResumedAt == 0, 'Fork not paused');
		require(truthAuctionRepBefore == 0, 'Haircut applied');
		uint256 repBefore = IERC20(game.repToken()).balanceOf(address(this));
		require(repToRemove < repBefore, 'Haircut too high');
		uint256 repRemaining = repBefore - repToRemove;
		truthAuctionRepBefore = repBefore;
		truthAuctionRepRemaining = repRemaining;
		uint256 ratioShift = Math.log2(repBefore) - Math.log2(repRemaining);
		uint256 scaledRemaining = repRemaining << ratioShift;
		if (scaledRemaining > repBefore) {
			scaledRemaining >>= 1;
			ratioShift -= 1;
		}
		uint256 nextRetention = Math.mulDiv(cumulativeClaimRetention, scaledRemaining, repBefore);
		uint256 normalizationShift = 255 - Math.log2(nextRetention);
		cumulativeClaimRetention = nextRetention << normalizationShift;
		cumulativeClaimRetentionExponent += ratioShift + normalizationShift;
		totalEscrowedRep = (totalEscrowedRep * repRemaining) / repBefore;
		forkCarryEscrowedRep = (forkCarryEscrowedRep * repRemaining) / repBefore;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			outcomeState[outcomeIndex].balance = (outcomeState[outcomeIndex].balance * repRemaining) / repBefore;
		}
		forkElapsedAtStart = game.computeTimeSinceStartFromAttritionCost(game.getBindingCapital());
		IERC20(game.repToken()).safeTransfer(poolAddress, repToRemove);
		emit TruthAuctionHaircutApplied(repBefore, repToRemove, repRemaining, forkElapsedAtStart);
	}

	function resumeFromFork() external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		require(msg.sender == game.securityPool(), 'Only pool');
		require(forkContinuation, 'No fork mode');
		require(forkResumedAt == 0, 'Fork resumed');
		require(game.isForkCarryFundingComplete(), 'Fork carry underfunded');
		if (forkCarryEscrowedRep == 0 && forkCarrySnapshotRequiresForkedEscrow) {
			for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
				forkCarryEscrowedRep += _applyTruthAuctionRetention(
					outcomeState[outcomeIndex].inheritedUnresolvedTotal
				);
			}
			totalEscrowedRep += forkCarryEscrowedRep;
		}
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function consumeEscrowedRepForOwner(address ownerAddress, uint256 amount) external {
		if (amount == 0) return;
		uint256 rawAmount = _repToClaimShares(amount);
		require(escalationClaimBundles[ownerAddress].escrowedRep >= rawAmount, 'Escrowed REP low');
		escalationClaimBundles[ownerAddress].escrowedRep -= rawAmount;
		totalEscrowedRep -= amount;
		emit VaultEscrowUpdated(ownerAddress, _claimEscrowedRepByVault(ownerAddress), totalEscrowedRep);
	}

	function consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amount) external {
		require(unresolvedRepByVault[bundleId] >= amount, 'Claim accounting remainder');
		require(
			localUnresolvedPrincipalByVaultAndOutcome[bundleId][outcomeIndex] >= amount,
			'Claim accounting remainder'
		);
		unresolvedRepByVault[bundleId] -= amount;
		localUnresolvedPrincipalByVaultAndOutcome[bundleId][outcomeIndex] -= amount;
		totalLocalUnresolvedRep -= amount;
	}

	function creditClaimOwners(address bundleId, uint256 amount) external {
		if (amount == 0) return;
		IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(bundleId, amount);
	}

	function creditExternalClaimOwners(
		address,
		address bundleId,
		uint256,
		uint256 amount,
		uint256 burnAmount
	) external {
		uint256 backingConsumed = amount + (winnerHaircutPaidByFork ? 0 : burnAmount);
		require(totalEscrowedRep >= backingConsumed, 'Escrow low');
		uint256 inheritedBackingConsumed =
			backingConsumed < forkCarryEscrowedRep ? backingConsumed : forkCarryEscrowedRep;
		forkCarryEscrowedRep -= inheritedBackingConsumed;
		totalEscrowedRep -= backingConsumed;
		if (amount == 0) return;
		IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(bundleId, amount);
	}
}
