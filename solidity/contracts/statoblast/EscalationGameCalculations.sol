// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameState } from './EscalationGameState.sol';
import { EscalationGameRepCustody } from './EscalationGameRepCustody.sol';
import { ISecurityPoolReporterHost } from './interfaces/ISecurityPoolReporterLedger.sol';
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
		return _firstSecondAtCost(attritionCostAttoRep);
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionState == NonDecisionState.Local) return nonDecisionTimestamp;
		if (forkContinuation) {
			if (forkResumedAt == 0) return type(uint256).max;
			if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None) return _fixedQuestionEndDate();
			int256 requiredElapsed = int256(_finalityElapsed());
			uint256 curveEnd =
				requiredElapsed <= forkElapsedAtStart
					? forkResumedAt
					: forkResumedAt + uint256(requiredElapsed - forkElapsedAtStart);
			return curveEnd;
		}
		// The forward curve crossing binding capital is the only deadline: a leader change adds no time.
		return activationTime + _finalityElapsed();
	}

	/// @dev A late-activated fixed outcome can be interrupted by another native fork.
	/// Custody preserves its remaining deadline; materialization must never restart it.
	function _fixedQuestionEndDate() private view returns (uint256) {
		address authority = EscalationGameRepCustody.securityPool(address(questionLedger));
		if (authority == address(0)) return forkResumedAt + ACTIVATION_DELAY;
		ISecurityPoolReporterHost securityPool = ISecurityPoolReporterHost(authority);
		uint248 universe = questionLedger.universeId();
		uint48 finalAfter = EscalationGameRepCustody.fixedQuestionFinalAfter(authority, universe, questionLedger.questionId());
		if (finalAfter == 0) return forkResumedAt + ACTIVATION_DELAY;
		return securityPool.nativeTimeForSecurityPoolTime(universe, finalAfter);
	}

	/// @dev Finality is strictly after this last second at or below binding capital.
	/// Search the forward curve so reporter and settlement schedules cannot mature early.
	function _finalityElapsed() private view returns (uint256) {
		// Incomplete carry installation exposes a partial balance snapshot only to
		// authenticated setup paths. Preserve its exact read semantics until sealed.
		if (startBondAttoRep != 0 && (!forkContinuation || forkCarrySnapshotOutcomesInitialized == 3))
			return cachedFinalityElapsed;
		return computeCurveFinalityElapsed();
	}

	/// @notice Exact last-open curve second for the current balances, independent of cached state.
	/// @dev Deposit delegates use this when the median changes, including the threshold plateau.
	function computeCurveFinalityElapsed() public view returns (uint256) {
		uint256 bindingCapital = getBindingCapitalAttoRep();
		if (bindingCapital < startBondAttoRep) return 0;
		if (bindingCapital >= nonDecisionThresholdAttoRep) return ESCALATION_TIME_LENGTH;
		return _firstSecondAtCost(bindingCapital + 1) - 1;
	}

	function _firstSecondAtCost(uint256 target) private view returns (uint256) {
		uint256 lower;
		uint256 upper = ESCALATION_TIME_LENGTH;
		while (upper - lower > 1) {
			uint256 middle = lower + (upper - lower) / 2;
			if (computeIterativeAttritionCostAttoRep(middle) < target) lower = middle;
			else upper = middle;
		}
		return upper;
	}

	function totalCostAttoRep() public view returns (uint256) {
		// Freeze the forward curve at the actual fork, including before continuation resume.
		uint256 timestamp = _getUniverseForkTime();
		if (timestamp == 0) timestamp = block.timestamp;
		if (forkContinuation) {
			int256 elapsed = forkElapsedAtStart;
			if (forkResumedAt != 0 && timestamp > forkResumedAt) elapsed += int256(timestamp - forkResumedAt);
			if (elapsed <= 0) return 0;
			if (elapsed >= int256(ESCALATION_TIME_LENGTH)) return nonDecisionThresholdAttoRep;
			return computeIterativeAttritionCostAttoRep(uint256(elapsed));
		}
		if (activationTime >= timestamp) return 0;
		uint256 elapsedSinceActivation = timestamp - activationTime;
		if (elapsedSinceActivation >= ESCALATION_TIME_LENGTH) return nonDecisionThresholdAttoRep;
		return computeIterativeAttritionCostAttoRep(elapsedSinceActivation);
	}

	// The attrition leader is provisional until getFinalQuestionResolution is non-None.
	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome) {
		(uint256 invalidBalanceAttoRep, uint256 yesBalanceAttoRep, uint256 noBalanceAttoRep) = _getOutcomeBalances();
		outcome = proofVerifier.resolveQuestion([invalidBalanceAttoRep, yesBalanceAttoRep, noBalanceAttoRep], totalCostAttoRep());
		if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None && block.timestamp > getEscalationGameEndDate())
			outcome = fixedQuestionOutcome;
		return outcome;
	}

	/// @notice Canonical central custody permits consumption only after finality.
	/// Live fork exports therefore contain no spent deposits; standalone games
	/// retain their independently supported mutable carry lifecycle.
	function appendOnlyCarry() public view returns (bool) {
		return EscalationGameRepCustody.securityPool(address(questionLedger)) != address(0);
	}

	function getFinalQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome) {
		uint256 endDate = getEscalationGameEndDate();
		if (block.timestamp <= endDate) return BinaryOutcomes.BinaryOutcome.None;
		// A fork at the deadline interrupts finality, even when migration is initialized later.
		uint256 forkTime = _getUniverseForkTime();
		if (forkTime != 0 && forkTime <= endDate) return BinaryOutcomes.BinaryOutcome.None;
		// An inherited branch outcome is already fixed, but still observes the fresh response period.
		if (fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None) return fixedQuestionOutcome;
		return getQuestionResolution();
	}

	function _getUniverseForkTime() internal view returns (uint256) {
		return questionLedger.zoltar().getForkTime(questionLedger.universeId());
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
		if (ordinarySettlementInitialized)
			return
				proofVerifier.computeOrdinaryWinningWithdrawal(depositAmountAttoRep, cumulativeAmountAttoRep, getBindingCapitalAttoRep(), outcomeState[outcomeIndex].balanceAttoRep, settlementForkThresholdAttoRep, nonDecisionThresholdAttoRep);
		return
			_computeAllocatedWinningWithdrawal(outcomeIndex, depositAmountAttoRep, depositAmountAttoRep, cumulativeAmountAttoRep);
	}

	function _computeAllocatedWinningWithdrawal(uint8 outcomeIndex, uint256 principalAttoRep, uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep) private view returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		uint256 bindingCapitalAttoRep = getBindingCapitalAttoRep();
		uint256 winningOutcomeBalanceAttoRep = outcomeState[outcomeIndex].balanceAttoRep;
		return
			proofVerifier.computeAllocatedWinningWithdrawal(principalAttoRep, depositAmountAttoRep, cumulativeAmountAttoRep, bindingCapitalAttoRep, winningOutcomeBalanceAttoRep, settlementForkThresholdAttoRep, nonDecisionThresholdAttoRep);
	}

	function _computeCarriedWinningWithdrawal(uint8 outcomeIndex, uint256 depositAmountAttoRep, uint256 cumulativeAmountAttoRep) internal view returns (uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep) {
		// Live reporter custody preserves the authenticated leaf's principal and reward coordinates.
		return
			_computeAllocatedWinningWithdrawal(outcomeIndex, depositAmountAttoRep, depositAmountAttoRep, cumulativeAmountAttoRep);
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
