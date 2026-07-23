// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { ESCALATION_TIME_LENGTH, NonDecisionState } from './EscalationGameTypes.sol';

abstract contract EscalationGameCalculations is EscalationGameState {
	// Attrition cost = startBond * exp( ln(ratio) * t / T ) where ratio = nonDecisionThreshold / startBond.
	// Uses fixed-point with SCALE=1e6. ln(ratio) is cached at start to avoid recomputing it on every read.
	// Series iterate until convergence (max iterations: atanh=MAX_ATANH_ITERATIONS, exp=MAX_EXP_ITERATIONS). Guarantees:
	// - f(0) = startBond, f(T) = nonDecisionThreshold
	// - f(t) monotonic increasing for t in (0,T)
	// - f(t) <= nonDecisionThreshold
	function computeIterativeAttritionCost(uint256 timeSinceStart) public view returns (uint256) {
		return
			proofVerifier.computeIterativeAttritionCost(
				startBond,
				nonDecisionThreshold,
				lnRatioScaled,
				timeSinceStart,
				ESCALATION_TIME_LENGTH
			);
	}

	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		if (attritionCost <= startBond) return 0;
		if (attritionCost >= nonDecisionThreshold) return ESCALATION_TIME_LENGTH;

		uint256 lnCostRatioScaled = proofVerifier.computeLnRatioScaled(startBond, attritionCost);
		return (lnCostRatioScaled * ESCALATION_TIME_LENGTH) / lnRatioScaled;
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionState == NonDecisionState.Local) return nonDecisionTimestamp;
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
		outcome = proofVerifier.resolveQuestion([invalidBalance, yesBalance, noBalance], totalCost());
		if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None && block.timestamp > getEscalationGameEndDate())
			outcome = fixedQuestionOutcome;
		return outcome;
	}

	function getFinalQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome) {
		if (block.timestamp <= getEscalationGameEndDate()) return BinaryOutcomes.BinaryOutcome.None;
		return getQuestionResolution();
	}

	function hasReachedNonDecision() public view returns (bool) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		return proofVerifier.hasReachedNonDecision([invalidBalance, yesBalance, noBalance], nonDecisionThreshold);
	}

	function canTriggerOwnFork() public view returns (bool) {
		if (nonDecisionState == NonDecisionState.Local) return true;
		return
			nonDecisionState == NonDecisionState.InheritedThresholdTie &&
			fixedQuestionOutcome == BinaryOutcomes.BinaryOutcome.None;
	}

	function getBindingCapital() public view returns (uint256) {
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _getOutcomeBalances();
		return proofVerifier.medianBalance([invalidBalance, yesBalance, noBalance]);
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
		uint256 invalidBalance = outcomeState[0].balance;
		uint256 yesBalance = outcomeState[1].balance;
		uint256 noBalance = outcomeState[2].balance;
		return
			proofVerifier.computeAcceptedDepositAmount(
				outcomeIndex,
				requestedAmount,
				currentBalance,
				room,
				startBond,
				nonDecisionThreshold,
				[invalidBalance, yesBalance, noBalance]
			);
	}

	function _computeWinningWithdrawal(
		uint8 outcomeIndex,
		uint256 depositAmount,
		uint256 cumulativeAmount
	) internal view returns (uint256 amountToWithdraw, uint256 burnAmount) {
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 winningOutcomeBalance = outcomeState[outcomeIndex].balance;
		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		return
			proofVerifier.computeWinningWithdrawal(
				depositAmount,
				cumulativeAmount,
				bindingCapitalAmount,
				winningOutcomeBalance,
				actualForkThreshold,
				nonDecisionThreshold
			);
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
}
