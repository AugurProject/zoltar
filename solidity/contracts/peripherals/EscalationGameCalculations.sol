// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import {
	ESCALATION_TIME_LENGTH,
	EXCESS_REWARD_WINDOW_DIVISOR,
	LN2_SCALED,
	MAX_EXP_ITERATIONS,
	SCALE
} from './EscalationGameTypes.sol';

abstract contract EscalationGameCalculations is EscalationGameState {
	// Attrition cost = startBond * exp( ln(ratio) * t / T ) where ratio = nonDecisionThreshold / startBond.
	// Uses fixed-point with SCALE=1e6. ln(ratio) is cached at start to avoid recomputing it on every read.
	// Series iterate until convergence (max iterations: atanh=MAX_ATANH_ITERATIONS, exp=MAX_EXP_ITERATIONS). Guarantees:
	// - f(0) = startBond, f(T) = nonDecisionThreshold
	// - f(t) monotonic increasing for t in (0,T)
	// - f(t) <= nonDecisionThreshold
	function computeIterativeAttritionCost(uint256 timeSinceStart) public view returns (uint256) {
		uint256 startBondLocal = startBond;
		uint256 nonDecisionThresholdLocal = nonDecisionThreshold;
		require(timeSinceStart <= ESCALATION_TIME_LENGTH, 'Time too high');
		// Exact edge cases
		if (timeSinceStart == 0) return startBondLocal;
		if (timeSinceStart == ESCALATION_TIME_LENGTH) return nonDecisionThresholdLocal;

		// Exponent = lnRatio_scaled * t / T
		uint256 exponent = (lnRatioScaled * timeSinceStart) / ESCALATION_TIME_LENGTH;
		uint256 exponentPow2 = exponent / LN2_SCALED;
		uint256 exponentRemainder = exponent - exponentPow2 * LN2_SCALED;

		// Compute exp(exponentRemainder / SCALE) * SCALE using series: Σ_{k=0} exponent^k / (k! * SCALE^{k-1})
		// Range reduction uses exp(x) = 2^k * exp(x - k * ln(2)).
		// Recurrence: term_k = term_{k-1} * exponent / (k * SCALE)
		uint256 expScaled = SCALE; // k=0
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
		uint256 cost = (startBondLocal * expScaled) / SCALE;
		// Clamp (should be ≤ nonDecisionThreshold, but rounding may cause slight overshoot)
		return cost > nonDecisionThresholdLocal ? nonDecisionThresholdLocal : cost;
	}

	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		if (attritionCost <= startBond) return 0;
		if (attritionCost >= nonDecisionThreshold) return ESCALATION_TIME_LENGTH;

		uint256 lnCostRatioScaled = proofVerifier.computeLnRatioScaled(startBond, attritionCost);
		return (lnCostRatioScaled * ESCALATION_TIME_LENGTH) / lnRatioScaled;
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionTimestamp > 0) return nonDecisionTimestamp;
		if (forkContinuation) {
			if (forkResumedAt == 0) return type(uint256).max;
			uint256 requiredElapsed = computeTimeSinceStartFromAttritionCost(getBindingCapital());
			if (requiredElapsed <= forkElapsedAtStart) return forkResumedAt;
			return forkResumedAt + (requiredElapsed - forkElapsedAtStart);
		}
		return activationTime + computeTimeSinceStartFromAttritionCost(getBindingCapital());
	}

	function totalCost() public view returns (uint256) {
		if (forkContinuation && forkResumedAt == 0 && forkElapsedAtStart == 0) return 0;
		if (forkContinuation && forkResumedAt == 0) return computeIterativeAttritionCost(forkElapsedAtStart);
		if (forkContinuation) {
			uint256 forkElapsed = forkElapsedAtStart + (block.timestamp - forkResumedAt);
			if (forkElapsed == 0) return 0;
			if (forkElapsed >= ESCALATION_TIME_LENGTH) return nonDecisionThreshold;
			return computeIterativeAttritionCost(forkElapsed);
		}
		if (activationTime >= block.timestamp) return 0;
		uint256 elapsedSinceActivation = block.timestamp - activationTime;
		if (elapsedSinceActivation >= ESCALATION_TIME_LENGTH) return nonDecisionThreshold;
		return computeIterativeAttritionCost(elapsedSinceActivation);
	}

	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		uint256 currentTotalCost = totalCost();
		if (_countBalancesAtLeast(invalidBalance, yesBalance, noBalance, currentTotalCost) >= 2) {
			return BinaryOutcomes.BinaryOutcome.None;
		}
		if (_allOutcomeBalancesEmpty(invalidBalance, yesBalance, noBalance)) {
			return BinaryOutcomes.BinaryOutcome.Invalid;
		}
		return _getStrictLeaderOrNone(invalidBalance, yesBalance, noBalance);
	}

	function hasReachedNonDecision() public view returns (bool) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		return _countBalancesAtLeast(invalidBalance, yesBalance, noBalance, nonDecisionThreshold) >= 2;
	}

	function getBindingCapital() public view returns (uint256) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		return _medianBalance(invalidBalance, yesBalance, noBalance);
	}

	function getOutcomeBalances() public view returns (uint256[3] memory balances) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		balances[0] = invalidBalance;
		balances[1] = yesBalance;
		balances[2] = noBalance;
	}

	function _getAcceptedDepositAmount(
		uint256 outcomeIndex,
		uint256 requestedAmount,
		uint256 currentBalance,
		uint256 room
	) internal view returns (uint256 acceptedAmount, uint256 newBalance) {
		acceptedAmount = requestedAmount > room ? room : requestedAmount;
		newBalance = currentBalance + acceptedAmount;

		uint256 invalidBalance = outcomeState[0].balance;
		uint256 yesBalance = outcomeState[1].balance;
		uint256 noBalance = outcomeState[2].balance;
		uint256 maxBalance = _maxOutcomeBalance(invalidBalance, yesBalance, noBalance);
		bool otherHasMax = _otherOutcomeHasBalance(outcomeIndex, invalidBalance, yesBalance, noBalance, maxBalance);

		if (newBalance == maxBalance && otherHasMax && maxBalance < nonDecisionThreshold) {
			acceptedAmount -= 1;
			newBalance = currentBalance + acceptedAmount;
		}
		require(acceptedAmount >= startBond || newBalance == nonDecisionThreshold, 'Below start bond');
	}

	function _computeWinningWithdrawal(
		uint8 outcomeIndex,
		uint256 depositAmount,
		uint256 cumulativeAmount
	) internal view returns (uint256 amountToWithdraw, uint256 burnAmount) {
		uint256 depositStart = cumulativeAmount - depositAmount;
		uint256 bindingCapitalAmount = getBindingCapital();
		// The reward window is intentionally first-come on the winning side. Earlier accepted
		// deposits consume the reward-eligible depth before later same-side deposits, so reward
		// depends on the overlap of this deposit's [depositStart, cumulativeAmount) interval with
		// the fixed window that ends at `rewardEligibleCapAmount`.
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 winningOutcomeBalance = outcomeState[outcomeIndex].balance;
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
			uint256 rewardBonusPoolAmount = (bindingCapitalAmount * 3) / 5;
			uint256 totalHaircutAmount = (bindingCapitalAmount * 2) / 5;
			uint256 bonusShare = (rewardEligibleDepositAmount * rewardBonusPoolAmount) / rewardEligiblePrincipalAmount;
			burnAmount = (rewardEligibleDepositAmount * totalHaircutAmount) / rewardEligiblePrincipalAmount;
			amountToWithdraw = depositAmount + bonusShare;
		}

		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}
	}

	function _getOutcomeBalances()
		private
		view
		returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance)
	{
		invalidBalance = outcomeState[0].balance;
		yesBalance = outcomeState[1].balance;
		noBalance = outcomeState[2].balance;
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

	function _allOutcomeBalancesEmpty(
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance
	) private pure returns (bool) {
		return invalidBalance == 0 && yesBalance == 0 && noBalance == 0;
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

	function _medianBalance(
		uint256 invalidBalance,
		uint256 yesBalance,
		uint256 noBalance
	) private pure returns (uint256) {
		if (
			(invalidBalance >= yesBalance && invalidBalance <= noBalance) ||
			(invalidBalance >= noBalance && invalidBalance <= yesBalance)
		) {
			return invalidBalance;
		}
		if (
			(yesBalance >= invalidBalance && yesBalance <= noBalance) ||
			(yesBalance >= noBalance && yesBalance <= invalidBalance)
		) {
			return yesBalance;
		}
		return noBalance;
	}
}
