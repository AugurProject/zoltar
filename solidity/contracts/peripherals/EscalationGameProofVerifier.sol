// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { MerkleMountainRange } from './MerkleMountainRange.sol';
import {
	EXCESS_REWARD_WINDOW_DIVISOR,
	LN2_SCALED,
	MAX_ATANH_ITERATIONS,
	MAX_EXP_ITERATIONS,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	NULLIFIER_DEPTH,
	SCALE
} from './EscalationGameTypes.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

contract EscalationGameProofVerifier {
	function computeIterativeAttritionCost(
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 lnRatioScaled,
		uint256 timeSinceStart,
		uint256 escalationTimeLength
	) external pure returns (uint256) {
		require(timeSinceStart <= escalationTimeLength, 'Time too high');
		if (timeSinceStart == 0) return startBond;
		if (timeSinceStart == escalationTimeLength) return nonDecisionThreshold;
		uint256 exponent = (lnRatioScaled * timeSinceStart) / escalationTimeLength;
		uint256 exponentPow2 = exponent / LN2_SCALED;
		uint256 exponentRemainder = exponent - exponentPow2 * LN2_SCALED;
		uint256 expScaled = SCALE;
		uint256 term = exponentRemainder;
		expScaled += term;
		for (uint256 k = 2; k < MAX_EXP_ITERATIONS; ) {
			term = (term * exponentRemainder) / (k * SCALE);
			if (term == 0) break;
			expScaled += term;
			unchecked {
				++k;
			}
		}
		expScaled <<= exponentPow2;
		uint256 cost = (startBond * expScaled) / SCALE;
		return cost > nonDecisionThreshold ? nonDecisionThreshold : cost;
	}

	function computeAcceptedDepositAmount(
		uint256 outcomeIndex,
		uint256 requestedAmount,
		uint256 currentBalance,
		uint256 room,
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256[3] calldata balances
	) external pure returns (uint256 acceptedAmount, uint256 newBalance) {
		acceptedAmount = requestedAmount > room ? room : requestedAmount;
		newBalance = currentBalance + acceptedAmount;
		uint256 maxBalance = _maxOutcomeBalance(balances[0], balances[1], balances[2]);
		bool otherHasMax = _otherOutcomeHasBalance(outcomeIndex, balances[0], balances[1], balances[2], maxBalance);
		if (newBalance == maxBalance && otherHasMax && maxBalance < nonDecisionThreshold) {
			acceptedAmount -= 1;
			newBalance = currentBalance + acceptedAmount;
		}
		require(acceptedAmount >= startBond || newBalance == nonDecisionThreshold, 'Below start bond');
	}

	function computeWinningWithdrawal(
		uint256 depositAmount,
		uint256 cumulativeAmount,
		uint256 bindingCapitalAmount,
		uint256 winningOutcomeBalance,
		uint256 actualForkThreshold,
		uint256 nonDecisionThreshold
	) external pure returns (uint256 amountToWithdraw, uint256 burnAmount) {
		uint256 depositStart = cumulativeAmount - depositAmount;
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 rewardEligiblePrincipalAmount =
			winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount;
		if (rewardEligiblePrincipalAmount == 0) {
			amountToWithdraw = depositAmount;
		} else {
			uint256 eligibleEndAmount =
				cumulativeAmount < rewardEligibleCapAmount ? cumulativeAmount : rewardEligibleCapAmount;
			uint256 rewardEligibleDepositAmount =
				eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0;
			if (rewardEligibleDepositAmount > depositAmount) rewardEligibleDepositAmount = depositAmount;
			uint256 bonusShare =
				(rewardEligibleDepositAmount * ((bindingCapitalAmount * 3) / 5)) / rewardEligiblePrincipalAmount;
			burnAmount =
				(rewardEligibleDepositAmount * ((bindingCapitalAmount * 2) / 5)) / rewardEligiblePrincipalAmount;
			amountToWithdraw = depositAmount + bonusShare;
		}
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}
	}

	function resolveQuestion(
		uint256[3] calldata balances,
		uint256 currentTotalCost
	) external pure returns (BinaryOutcomes.BinaryOutcome) {
		if (_countBalancesAtLeast(balances[0], balances[1], balances[2], currentTotalCost) >= 2) {
			return BinaryOutcomes.BinaryOutcome.None;
		}
		if (balances[0] == 0 && balances[1] == 0 && balances[2] == 0) {
			return BinaryOutcomes.BinaryOutcome.Invalid;
		}
		return _getStrictLeaderOrNone(balances[0], balances[1], balances[2]);
	}

	function hasReachedNonDecision(
		uint256[3] calldata balances,
		uint256 nonDecisionThreshold
	) external pure returns (bool) {
		return _countBalancesAtLeast(balances[0], balances[1], balances[2], nonDecisionThreshold) >= 2;
	}

	function medianBalance(uint256[3] calldata balances) external pure returns (uint256) {
		uint256 invalidBalance = balances[0];
		uint256 yesBalance = balances[1];
		uint256 noBalance = balances[2];
		if (
			(invalidBalance >= yesBalance && invalidBalance <= noBalance) ||
			(invalidBalance >= noBalance && invalidBalance <= yesBalance)
		) return invalidBalance;
		if (
			(yesBalance >= invalidBalance && yesBalance <= noBalance) ||
			(yesBalance >= noBalance && yesBalance <= invalidBalance)
		) return yesBalance;
		return noBalance;
	}
	function computeEmptyNullifierRoot() external pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			root = MerkleMountainRange.hashParent(root, root);
		}
	}

	function computeLnRatioScaled(uint256 lowValue, uint256 highValue) external pure returns (uint256) {
		uint256 normalizedLow = lowValue;
		uint256 log2Count = 0;
		while (highValue >= normalizedLow * 2) {
			unchecked {
				normalizedLow *= 2;
				++log2Count;
			}
		}

		uint256 diff = highValue - normalizedLow;
		uint256 sum = highValue + normalizedLow;
		uint256 z = (diff * SCALE) / sum;
		if (z == 0) return 0;
		return log2Count * LN2_SCALED + 2 * _computeAtanhScaled(z);
	}

	function getCurrentCarryPeakForLeaf(
		uint256 leafCount,
		uint256 leafIndex
	) external pure returns (uint256 peakHeight, uint256 peakStartIndex) {
		for (uint256 reverseHeight = MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; reverseHeight > 0; ) {
			unchecked {
				--reverseHeight;
			}
			uint256 currentPeakHeight = reverseHeight;
			if (((leafCount >> currentPeakHeight) & 1) != 1) continue;
			uint256 nextPeakStartIndex = peakStartIndex + (uint256(1) << currentPeakHeight);
			if (leafIndex < nextPeakStartIndex) return (currentPeakHeight, peakStartIndex);
			peakStartIndex = nextPeakStartIndex;
		}
		revert('Carry peak absent');
	}

	function bagCarryPeaks(
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes,
		uint256 leafCount
	) external pure returns (bytes32) {
		if (leafCount == 0) return bytes32(0);

		uint256 peakCount = 0;
		for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peakCount += 1;
			}
		}

		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peaks[writeIndex] = peakHashes[peakIndex];
				writeIndex += 1;
			}
		}

		return MerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function computeMerkleMountainRangeRootFromProof(
		bytes32 leafHash,
		uint256 leafCount,
		uint256 leafIndex,
		uint256 peakHeight,
		bytes32[] calldata siblings
	) external pure returns (bytes32) {
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'Bad carry peak');
		require(((leafCount >> peakHeight) & 1) == 1, 'Carry peak absent');
		require(leafIndex < (uint256(1) << peakHeight), 'Bad carry leaf');

		uint256 peakCount = 0;
		for (uint256 index = 0; index < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; index++) {
			if (((leafCount >> index) & 1) == 1) {
				peakCount += 1;
			}
		}
		require(siblings.length == peakHeight + peakCount - 1, 'Bad MMR proof length');

		bytes32 peakRoot = leafHash;
		for (uint256 level = 0; level < peakHeight; level++) {
			bytes32 siblingHash = siblings[level];
			if (((leafIndex >> level) & 1) == 0) {
				peakRoot = MerkleMountainRange.hashParent(peakRoot, siblingHash);
			} else {
				peakRoot = MerkleMountainRange.hashParent(siblingHash, peakRoot);
			}
		}

		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		uint256 siblingIndex = peakHeight;
		for (uint256 index = 0; index < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; index++) {
			if (((leafCount >> index) & 1) != 1) continue;
			if (index == peakHeight) {
				peaks[writeIndex] = peakRoot;
			} else {
				peaks[writeIndex] = siblings[siblingIndex];
				siblingIndex += 1;
			}
			writeIndex += 1;
		}
		return MerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function computeNullifierRoot(
		uint256 parentDepositIndex,
		bytes32[] calldata siblings,
		bytes32 leafValue
	) external pure returns (bytes32 root) {
		require(siblings.length == NULLIFIER_DEPTH, 'Bad nullifier length');
		root = leafValue;
		uint256 path = uint256(keccak256(abi.encode(parentDepositIndex)));
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			bytes32 siblingHash = siblings[depth];
			if (((path >> depth) & 1) == 0) {
				root = MerkleMountainRange.hashParent(root, siblingHash);
			} else {
				root = MerkleMountainRange.hashParent(siblingHash, root);
			}
		}
	}

	function _computeAtanhScaled(uint256 z) private pure returns (uint256 atanhScaled) {
		uint256 z2 = (z * z) / SCALE;
		uint256 term = z;
		atanhScaled = term;

		for (uint256 k = 1; k < MAX_ATANH_ITERATIONS; ) {
			term = (term * z2 * (2 * k - 1)) / ((2 * k + 1) * SCALE);
			if (term == 0) break;
			atanhScaled += term;
			unchecked {
				++k;
			}
		}
	}

	function _countBalancesAtLeast(
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance,
		uint256 threshold
	) private pure returns (uint8 count) {
		if (invalidBalance >= threshold) count += 1;
		if (yesBalance >= threshold) count += 1;
		if (noBalance >= threshold) count += 1;
	}

	function _maxOutcomeBalance(
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance
	) private pure returns (uint256 maxBalance) {
		maxBalance = invalidBalance;
		if (yesBalance > maxBalance) maxBalance = yesBalance;
		if (noBalance > maxBalance) maxBalance = noBalance;
	}

	function _otherOutcomeHasBalance(
		uint256 outcomeIndex,
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance,
		uint256 targetBalance
	) private pure returns (bool) {
		if (outcomeIndex == 0) return yesBalance == targetBalance || noBalance == targetBalance;
		if (outcomeIndex == 1) return invalidBalance == targetBalance || noBalance == targetBalance;
		return invalidBalance == targetBalance || yesBalance == targetBalance;
	}

	function _getStrictLeaderOrNone(
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance
	) private pure returns (BinaryOutcomes.BinaryOutcome) {
		if (invalidBalance > yesBalance && invalidBalance > noBalance) return BinaryOutcomes.BinaryOutcome.Invalid;
		if (yesBalance > invalidBalance && yesBalance > noBalance) return BinaryOutcomes.BinaryOutcome.Yes;
		if (noBalance > invalidBalance && noBalance > yesBalance) return BinaryOutcomes.BinaryOutcome.No;
		return BinaryOutcomes.BinaryOutcome.None;
	}
}
