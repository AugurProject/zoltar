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
	function computeIterativeAttritionCostAttoRep(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, uint256 lnRatioScaled, uint256 timeSinceStart, uint256 escalationTimeLength) external pure returns (uint256) {
		require(timeSinceStart <= escalationTimeLength, 'Time too high');
		if (timeSinceStart == 0) return startBondAttoRep;
		if (timeSinceStart == escalationTimeLength) return nonDecisionThresholdAttoRep;
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
		uint256 cost = (startBondAttoRep * expScaled) / SCALE;
		return cost > nonDecisionThresholdAttoRep ? nonDecisionThresholdAttoRep : cost;
	}

	function computeAcceptedDepositAmount(uint256 outcomeIndex, uint256 requestedAmountAttoRep, uint256 currentBalanceAttoRep, uint256 roomAttoRep, uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, uint256[3] calldata balancesAttoRep) external pure returns (uint256 acceptedAmountAttoRep, uint256 newBalanceAttoRep) {
		acceptedAmountAttoRep = requestedAmountAttoRep > roomAttoRep ? roomAttoRep : requestedAmountAttoRep;
		newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep;
		uint256 maxBalanceAttoRep = _maxOutcomeBalance(balancesAttoRep[0], balancesAttoRep[1], balancesAttoRep[2]);
		bool otherHasMax = _otherOutcomeHasBalance(outcomeIndex, balancesAttoRep[0], balancesAttoRep[1], balancesAttoRep[2], maxBalanceAttoRep);
		if (newBalanceAttoRep == maxBalanceAttoRep && otherHasMax && maxBalanceAttoRep < nonDecisionThresholdAttoRep) {
			acceptedAmountAttoRep -= 1;
			newBalanceAttoRep = currentBalanceAttoRep + acceptedAmountAttoRep;
		}
		require(acceptedAmountAttoRep >= startBondAttoRep || newBalanceAttoRep == nonDecisionThresholdAttoRep, 'Below start bond');
	}

	function computeWinningWithdrawal(uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep, uint256 bindingCapitalAttoRep, uint256 winningOutcomeBalanceAttoRep, uint256 actualForkThresholdAttoRep, uint256 nonDecisionThresholdAttoRep) external pure returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		uint256 depositStartAttoRep = cumulativeAmountAttoRep - depositAmountAttoRep;
		uint256 rewardEligibleCapAttoRep = bindingCapitalAttoRep + bindingCapitalAttoRep / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 rewardEligiblePrincipalAttoRep =
			winningOutcomeBalanceAttoRep < rewardEligibleCapAttoRep
				? winningOutcomeBalanceAttoRep
				: rewardEligibleCapAttoRep;
		if (rewardEligiblePrincipalAttoRep == 0) {
			amountToWithdrawAttoRep = depositAmountAttoRep;
		} else {
			uint256 eligibleEndAttoRep =
				cumulativeAmountAttoRep < rewardEligibleCapAttoRep ? cumulativeAmountAttoRep : rewardEligibleCapAttoRep;
			uint256 rewardEligibleDepositAttoRep =
				eligibleEndAttoRep > depositStartAttoRep ? eligibleEndAttoRep - depositStartAttoRep : 0;
			if (rewardEligibleDepositAttoRep > depositAmountAttoRep)
				rewardEligibleDepositAttoRep = depositAmountAttoRep;
			uint256 bonusAttoRep =
				(rewardEligibleDepositAttoRep * ((bindingCapitalAttoRep * 3) / 5)) / rewardEligiblePrincipalAttoRep;
			burnAmountAttoRep =
				(rewardEligibleDepositAttoRep * ((bindingCapitalAttoRep * 2) / 5)) / rewardEligiblePrincipalAttoRep;
			amountToWithdrawAttoRep = depositAmountAttoRep + bonusAttoRep;
		}
		if (actualForkThresholdAttoRep < nonDecisionThresholdAttoRep) {
			amountToWithdrawAttoRep =
				(amountToWithdrawAttoRep * actualForkThresholdAttoRep) / nonDecisionThresholdAttoRep;
		}
	}

	function resolveQuestion(uint256[3] calldata balancesAttoRep, uint256 currentTotalCostAttoRep) external pure returns (BinaryOutcomes.BinaryOutcome) {
		if (
			_countBalancesAtLeast(balancesAttoRep[0], balancesAttoRep[1], balancesAttoRep[2], currentTotalCostAttoRep) >= 2
		) {
			return BinaryOutcomes.BinaryOutcome.None;
		}
		if (balancesAttoRep[0] == 0 && balancesAttoRep[1] == 0 && balancesAttoRep[2] == 0) {
			return BinaryOutcomes.BinaryOutcome.Invalid;
		}
		return _getStrictLeaderOrNone(balancesAttoRep[0], balancesAttoRep[1], balancesAttoRep[2]);
	}

	function hasReachedNonDecision(uint256[3] calldata balancesAttoRep, uint256 nonDecisionThresholdAttoRep) external pure returns (bool) {
		return
			_countBalancesAtLeast(balancesAttoRep[0], balancesAttoRep[1], balancesAttoRep[2], nonDecisionThresholdAttoRep) >= 2;
	}

	function medianBalanceAttoRep(uint256[3] calldata balancesAttoRep) external pure returns (uint256 medianAttoRep) {
		uint256 invalidBalanceAttoRep = balancesAttoRep[0];
		uint256 yesBalanceAttoRep = balancesAttoRep[1];
		uint256 noBalanceAttoRep = balancesAttoRep[2];
		if (
			(invalidBalanceAttoRep >= yesBalanceAttoRep && invalidBalanceAttoRep <= noBalanceAttoRep) ||
			(invalidBalanceAttoRep >= noBalanceAttoRep && invalidBalanceAttoRep <= yesBalanceAttoRep)
		) return invalidBalanceAttoRep;
		if (
			(yesBalanceAttoRep >= invalidBalanceAttoRep && yesBalanceAttoRep <= noBalanceAttoRep) ||
			(yesBalanceAttoRep >= noBalanceAttoRep && yesBalanceAttoRep <= invalidBalanceAttoRep)
		) return yesBalanceAttoRep;
		return noBalanceAttoRep;
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
		if (z == 0) return log2Count * LN2_SCALED;
		return log2Count * LN2_SCALED + 2 * _computeAtanhScaled(z);
	}

	function getCurrentCarryPeakForLeaf(uint256 leafCount, uint256 leafIndex) external pure returns (uint256 peakHeight, uint256 peakStartIndex) {
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

	function bagCarryPeaks(bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes, uint256 leafCount) external pure returns (bytes32) {
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

	function computeMerkleMountainRangeRootFromProof(bytes32 leafHash, uint256 leafCount, uint256 leafIndex, uint256 peakHeight, bytes32[] calldata siblings) external pure returns (bytes32) {
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

	function computeNullifierRoot(uint256 parentDepositIndex, bytes32[] calldata siblings, bytes32 leafValue) external pure returns (bytes32 root) {
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

	function _countBalancesAtLeast(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep, uint256 threshold) private pure returns (uint8 count) {
		if (invalidBalanceAttoRep >= threshold) count += 1;
		if (yesBalanceAttoRep >= threshold) count += 1;
		if (noBalanceAttoRep >= threshold) count += 1;
	}

	function _maxOutcomeBalance(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) private pure returns (uint256 maximumBalanceAttoRep) {
		maximumBalanceAttoRep = invalidBalanceAttoRep;
		if (yesBalanceAttoRep > maximumBalanceAttoRep) maximumBalanceAttoRep = yesBalanceAttoRep;
		if (noBalanceAttoRep > maximumBalanceAttoRep) maximumBalanceAttoRep = noBalanceAttoRep;
	}

	function _otherOutcomeHasBalance(uint256 outcomeIndex, uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep, uint256 targetBalanceAttoRep) private pure returns (bool) {
		if (outcomeIndex == 0)
			return yesBalanceAttoRep == targetBalanceAttoRep || noBalanceAttoRep == targetBalanceAttoRep;
		if (outcomeIndex == 1)
			return invalidBalanceAttoRep == targetBalanceAttoRep || noBalanceAttoRep == targetBalanceAttoRep;
		return invalidBalanceAttoRep == targetBalanceAttoRep || yesBalanceAttoRep == targetBalanceAttoRep;
	}

	function _getStrictLeaderOrNone(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) private pure returns (BinaryOutcomes.BinaryOutcome) {
		if (invalidBalanceAttoRep > yesBalanceAttoRep && invalidBalanceAttoRep > noBalanceAttoRep)
			return BinaryOutcomes.BinaryOutcome.Invalid;
		if (yesBalanceAttoRep > invalidBalanceAttoRep && yesBalanceAttoRep > noBalanceAttoRep)
			return BinaryOutcomes.BinaryOutcome.Yes;
		if (noBalanceAttoRep > invalidBalanceAttoRep && noBalanceAttoRep > yesBalanceAttoRep)
			return BinaryOutcomes.BinaryOutcome.No;
		return BinaryOutcomes.BinaryOutcome.None;
	}
}
