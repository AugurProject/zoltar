// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { ESCALATION_TIME_LENGTH, NonDecisionState } from './EscalationGameTypes.sol';

abstract contract EscalationGameCalculations is EscalationGameState {
	// Attrition cost = startBondAttoRep * exp( ln(ratio) * t / T ) where ratio = nonDecisionThresholdAttoRep / startBondAttoRep.
	// Uses fixed-point with SCALE=1e6. ln(ratio) is cached at start to avoid recomputing it on every read.
	// Series iterate until convergence (max iterations: atanh=MAX_ATANH_ITERATIONS, exp=MAX_EXP_ITERATIONS). Guarantees:
	// - f(0) = startBondAttoRep, f(T) = nonDecisionThresholdAttoRep
	// - f(t) monotonic increasing for t in (0,T)
	// - f(t) <= nonDecisionThresholdAttoRep
	function computeIterativeAttritionCostAttoRep(uint256 timeSinceStart) public view returns (uint256) {
		return
			proofVerifier.computeIterativeAttritionCostAttoRep(startBondAttoRep, nonDecisionThresholdAttoRep, lnRatioScaled, timeSinceStart, ESCALATION_TIME_LENGTH);
	}

	function computeTimeSinceStartFromAttritionCostAttoRep(uint256 attritionCostAttoRep) public view returns (uint256) {
		if (attritionCostAttoRep <= startBondAttoRep) return 0;
		if (attritionCostAttoRep >= nonDecisionThresholdAttoRep) return ESCALATION_TIME_LENGTH;

		uint256 lnCostRatioScaled = proofVerifier.computeLnRatioScaled(startBondAttoRep, attritionCostAttoRep);
		return (lnCostRatioScaled * ESCALATION_TIME_LENGTH) / lnRatioScaled;
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionState == NonDecisionState.Local) return nonDecisionTimestamp;
		if (forkContinuation) {
			if (forkResumedAt == 0) return type(uint256).max;
			uint256 requiredElapsed = computeTimeSinceStartFromAttritionCostAttoRep(getBindingCapitalAttoRep());
			uint256 curveEnd =
				requiredElapsed <= forkElapsedAtStart
					? forkResumedAt
					: forkResumedAt + (requiredElapsed - forkElapsedAtStart);
			uint256 minimumResponseEnd = forkResumedAt + activationDelay;
			return curveEnd > minimumResponseEnd ? curveEnd : minimumResponseEnd;
		}
		return activationTime + computeTimeSinceStartFromAttritionCostAttoRep(getBindingCapitalAttoRep());
	}

	function totalCostAttoRep() public view returns (uint256) {
		if (forkContinuation && forkResumedAt == 0 && forkElapsedAtStart == 0) return 0;
		if (forkContinuation && forkResumedAt == 0) return computeIterativeAttritionCostAttoRep(forkElapsedAtStart);
		if (forkContinuation) {
			uint256 forkElapsed = forkElapsedAtStart + (block.timestamp - forkResumedAt);
			if (forkElapsed == 0) return 0;
			if (forkElapsed >= ESCALATION_TIME_LENGTH) return nonDecisionThresholdAttoRep;
			return computeIterativeAttritionCostAttoRep(forkElapsed);
		}
		if (activationTime >= block.timestamp) return 0;
		uint256 elapsedSinceActivation = block.timestamp - activationTime;
		if (elapsedSinceActivation >= ESCALATION_TIME_LENGTH) return nonDecisionThresholdAttoRep;
		return computeIterativeAttritionCostAttoRep(elapsedSinceActivation);
	}

	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome) {
		(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) = _getOutcomeBalances();
		outcome = proofVerifier.resolveQuestion([invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep], totalCostAttoRep());
		if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None && block.timestamp > getEscalationGameEndDate())
			outcome = fixedQuestionOutcome;
		return outcome;
	}

	function getFinalQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome) {
		if (block.timestamp <= getEscalationGameEndDate()) return BinaryOutcomes.BinaryOutcome.None;
		return getQuestionResolution();
	}

	function hasReachedNonDecision() public view returns (bool) {
		(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) = _getOutcomeBalances();
		return
			proofVerifier.hasReachedNonDecision([invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep], nonDecisionThresholdAttoRep);
	}

	function canTriggerOwnFork() public view returns (bool) {
		if (nonDecisionState == NonDecisionState.Local) return true;
		return
			nonDecisionState == NonDecisionState.InheritedThresholdTie &&
			fixedQuestionOutcome == BinaryOutcomes.BinaryOutcome.None;
	}

	function getBindingCapitalAttoRep() public view returns (uint256) {
		(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) = _getOutcomeBalances();
		return proofVerifier.medianBalanceAttoRep([invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep]);
	}

	function getOutcomeBalancesAttoRep() public view returns (uint256[3] memory balancesAttoRep) {
		(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) = _getOutcomeBalances();
		balancesAttoRep[0] = invalidBalanceAttoRep;
		balancesAttoRep[1] = yesBalanceAttoRep;
		balancesAttoRep[2] = noBalanceAttoRep;
	}

	function _getAcceptedDepositAmount(uint256 outcomeIndex, uint256 requestedAmountAttoRep, uint256 currentBalanceAttoRep, uint256 roomAttoRep) internal view returns (uint256 acceptedAmountAttoRep, uint256 newBalanceAttoRep) {
		uint256 invalidBalanceAttoRep = outcomeState[0].balanceAttoRep;
		uint256 yesBalanceAttoRep = outcomeState[1].balanceAttoRep;
		uint256 noBalanceAttoRep = outcomeState[2].balanceAttoRep;
		return
			proofVerifier.computeAcceptedDepositAmount(outcomeIndex, requestedAmountAttoRep, currentBalanceAttoRep, roomAttoRep, startBondAttoRep, nonDecisionThresholdAttoRep, [invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep]);
	}

	function _computeWinningWithdrawal(uint8 outcomeIndex, uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep) internal view returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		uint256 bindingCapitalAttoRep = getBindingCapitalAttoRep();
		uint256 winningOutcomeBalanceAttoRep = outcomeState[outcomeIndex].balanceAttoRep;
		uint256 actualForkThresholdAttoRep = securityPool.zoltar().getForkThresholdAttoRep(securityPool.universeId());
		uint256 forkTime = securityPool.zoltar().getForkTime(securityPool.universeId());
		if (forkTime > getEscalationGameEndDate()) {
			actualForkThresholdAttoRep = nonDecisionThresholdAttoRep;
		}
		return
			proofVerifier.computeWinningWithdrawal(depositAmountAttoRep, cumulativeAmountAttoRep, bindingCapitalAttoRep, winningOutcomeBalanceAttoRep, actualForkThresholdAttoRep, nonDecisionThresholdAttoRep);
	}

	function _computeCarriedWinningWithdrawal(uint8 outcomeIndex, uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep, uint256 parentDepositIndex) internal view returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		depositAmountAttoRep = _applyInheritedSourceRetention(depositAmountAttoRep, parentDepositIndex);
		cumulativeAmountAttoRep = _applyInheritedSourceRetention(cumulativeAmountAttoRep, parentDepositIndex);
		return _computeWinningWithdrawal(outcomeIndex, depositAmountAttoRep, cumulativeAmountAttoRep);
	}

	function _getOutcomeBalances()
		private
		view
		returns (uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep)
	{
		invalidBalanceAttoRep = outcomeState[0].balanceAttoRep;
		yesBalanceAttoRep = outcomeState[1].balanceAttoRep;
		noBalanceAttoRep = outcomeState[2].balanceAttoRep;
	}
}
