// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

struct Deposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

uint256 constant escalationTimeLength = 4233600; // 7 weeks
uint256 constant SCALE = 1e6;
uint256 constant MAX_ATANH_ITERATIONS = 5000;
uint256 constant MAX_EXP_ITERATIONS = 1000;

contract EscalationGame {
	uint256 public startingTime;
	uint256[3] public balances; // outcome -> amount
	mapping(uint8 => Deposit[]) public deposits; // make a fixed array with dynamic
	ISecurityPool public securityPool;
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	address public owner;
	uint256 public nonDecisionTimestamp;

	event GameStarted(uint256 startingTime, uint256 startBond, uint256 nonDecisionThreshold);
	event DepositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, BinaryOutcomes.BinaryOutcome winner, uint256 amountToWithdraw, uint256 depositIndex);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);

	constructor(ISecurityPool _securityPool) {
		securityPool = _securityPool;
		owner = msg.sender;
	}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) public {
		require(owner == msg.sender, 'only owner can start');
		require(startingTime == 0, 'already started');
		require(_nonDecisionThreshold > _startBond, 'threshold must exceed start bond');
		require(_startBond > 0, 'start bond must be positive');
		require(_startBond >= 1e18, 'start bond must be at least 1 ether');
		require(_nonDecisionThreshold >= 1e18, 'threshold must be at least 1 ether');
		startingTime = block.timestamp + 3 days;
		nonDecisionThreshold = _nonDecisionThreshold;
		startBond = _startBond;
		emit GameStarted(startingTime, startBond, nonDecisionThreshold);
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [balances[0], balances[1], balances[2]];
	}

	// Attrition cost = startBond * exp( ln(ratio) * t / T ) where ratio = nonDecisionThreshold / startBond.
	// Uses fixed-point with SCALE=1e6. ln(ratio) = 2 * atanh(Z) with Z = (ratio-1)/(ratio+1).
	// Series iterate until convergence (max iterations: atanh=MAX_ATANH_ITERATIONS, exp=MAX_EXP_ITERATIONS). Guarantees:
	// - f(0) = startBond, f(T) = nonDecisionThreshold
	// - f(t) monotonic increasing for t in (0,T)
	// - f(t) <= nonDecisionThreshold
	function computeIterativeAttritionCost(uint256 timeSinceStart) public view returns (uint256) {
		require(timeSinceStart <= escalationTimeLength, 'Invalid time');
		// Exact edge cases
		if (timeSinceStart == 0) return startBond;
		if (timeSinceStart == escalationTimeLength) return nonDecisionThreshold;

		// Compute Z_scaled = (nonDecisionThreshold - startBond) * SCALE / (nonDecisionThreshold + startBond)
		uint256 diff = nonDecisionThreshold - startBond;
		uint256 sum = nonDecisionThreshold + startBond;
		uint256 z = diff * SCALE / sum; // z ∈ [0, SCALE)
		if (z == 0) return startBond; // degenerate (should not happen)
		uint256 z2 = z * z / SCALE; // = Z^2 * SCALE

		// Compute atanh(z/SCALE) * SCALE using series: Σ_{k=0} z^{2k+1} / ((2k+1) * SCALE^k)
		// Recurrence: term_k = term_{k-1} * z2 * (2k-1) / ((2k+1) * SCALE)
		uint256 atanh_scaled = 0;
		uint256 term = z; // k=0: z / 1
		atanh_scaled += term;

		for (uint256 k = 1; k < MAX_ATANH_ITERATIONS; k++) {
			// term = term * z2 * (2k-1) / ((2k+1) * SCALE)
			term = term * z2 * (2 * k - 1) / ((2 * k + 1) * SCALE);
			if (term == 0) break;
			atanh_scaled += term;
		}

		uint256 lnRatio_scaled = 2 * atanh_scaled; // ln(ratio) * SCALE

		// Exponent = lnRatio_scaled * t / T
		uint256 exponent = lnRatio_scaled * timeSinceStart / escalationTimeLength;

		// Compute exp(exponent / SCALE) * SCALE using series: Σ_{k=0} exponent^k / (k! * SCALE^{k-1})
		// Recurrence: term_k = term_{k-1} * exponent / (k * SCALE)
		uint256 exp_scaled = SCALE; // k=0
		term = exponent; // k=1
		exp_scaled += term;

		for (uint256 k = 2; k < MAX_EXP_ITERATIONS; k++) {
			term = term * exponent / (k * SCALE);
			if (term == 0) break;
			exp_scaled += term;
		}

		uint256 cost = startBond * exp_scaled / SCALE;
		// Clamp (should be ≤ nonDecisionThreshold, but rounding may cause slight overshoot)
		return cost > nonDecisionThreshold ? nonDecisionThreshold : cost;
	}

	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		uint256 low = 0;
		uint256 high = escalationTimeLength;
		if (attritionCost <= startBond) return 0;
		uint256 maxCost = nonDecisionThreshold;
		if (attritionCost >= maxCost) return escalationTimeLength;

		// binary search
		for (uint256 iteration = 0; iteration < 64; iteration++) {
			uint256 midTime = (low + high) / 2;

			uint256 midCost = computeIterativeAttritionCost(midTime);

			if (midCost == attritionCost) return midTime;
			if (midCost < attritionCost) {
				low = midTime + 1;
			} else {
				high = midTime - 1;
			}
		}
		return (low + high) / 2;
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionTimestamp > 0) return nonDecisionTimestamp;
		return startingTime + computeTimeSinceStartFromAttritionCost(getBindingCapital());
	}

	function totalCost() public view returns (uint256) {
		if (startingTime >= block.timestamp) return 0;
		uint256 timeFromStart = block.timestamp - startingTime;
		if (timeFromStart >= escalationTimeLength) return nonDecisionThreshold;
		return computeIterativeAttritionCost(timeFromStart);
	}

	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome){
		uint256 currentTotalCost = totalCost();
		uint8 invalidOver = balances[0] >= currentTotalCost ? 1 : 0;
		uint8 yesOver = balances[1] >= currentTotalCost ? 1 : 0;
		uint8 noOver = balances[2] >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return BinaryOutcomes.BinaryOutcome.None; // if two or more outcomes are over the total cost, the game is still going
		// the game has ended due to timeout
		if (balances[0] > balances[1] && balances[0] > balances[2]) return BinaryOutcomes.BinaryOutcome.Invalid;
		if (balances[1] > balances[0] && balances[1] > balances[2]) return BinaryOutcomes.BinaryOutcome.Yes;
		return BinaryOutcomes.BinaryOutcome.No;
	}

	function hasReachedNonDecision() public view returns (bool) {
		uint8 invalidOver = balances[0] >= nonDecisionThreshold ? 1 : 0;
		uint8 yesOver = balances[1] >= nonDecisionThreshold ? 1 : 0;
		uint8 noOver = balances[2] >= nonDecisionThreshold ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return true;
		return false;
	}

	function getBindingCapital() public view returns (uint256) {
		if ((balances[0] >= balances[1] && balances[0] <= balances[2]) || (balances[0] >= balances[2] && balances[0] <= balances[1])) {
			return balances[0];
		} else if ((balances[1] >= balances[0] && balances[1] <= balances[2]) || (balances[1] >= balances[2] && balances[1] <= balances[0])) {
			return balances[1];
		}
		return balances[2];
	}

	// deposits on question outcome, returns how much user actually ended depositing
	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(nonDecisionTimestamp == 0, 'System has already reached a non-decision');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'System has already timed out');
		require(balances[uint256(outcome)] < nonDecisionThreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit'); // checks that we get start bond and spam protection
		uint256 outcomeIdx = uint256(outcome);
		uint256 currentBalance = balances[outcomeIdx];
		uint256 room = nonDecisionThreshold - currentBalance;
		uint256 effectiveDeposit = amount > room ? room : amount;
		uint256 newBalance = currentBalance + effectiveDeposit;

		// Snapshot all balances for tie detection
		uint256 b0 = balances[0];
		uint256 b1 = balances[1];
		uint256 b2 = balances[2];
		uint256 maxBal = b0 > b1 ? (b0 > b2 ? b0 : b2) : (b1 > b2 ? b1 : b2);

		// Check if new balance ties with existing maximum and another outcome has that maximum, and max is below threshold.
		// Ties at/above threshold are allowed (to trigger nonDecision/fork).
		bool otherHasMax = (outcomeIdx == 0) ? (b1 == maxBal || b2 == maxBal) :
		                    (outcomeIdx == 1) ? (b0 == maxBal || b2 == maxBal) :
		                    (b0 == maxBal || b1 == maxBal);
		if (newBalance == maxBal && otherHasMax && maxBal < nonDecisionThreshold) {
			effectiveDeposit -= 1;
			newBalance = currentBalance + effectiveDeposit;
		}

		// Update the balance
		balances[outcomeIdx] = newBalance;
		depositAmount = effectiveDeposit;

		// Record deposit
		Deposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = balances[outcomeIdx];
		deposits[uint8(outcome)].push(deposit);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, deposits[uint8(outcome)].length - 1, deposit.cumulativeAmount);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
		}
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()), 'Only Security Pool can withdraw');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		Deposit memory deposit = deposits[uint8(outcome)][depositIndex];
		deposits[uint8(outcome)][depositIndex].amount = 0;
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 maxWithdrawableBalance = getBindingCapital();
		uint256 burnAmount;
		if (deposit.cumulativeAmount > maxWithdrawableBalance) {
			amountToWithdraw = deposit.amount;
			burnAmount = 0;
		} else if (deposit.cumulativeAmount + deposit.amount > maxWithdrawableBalance) {
			uint256 excess = (deposit.cumulativeAmount + deposit.amount - maxWithdrawableBalance);
			burnAmount = excess * 2 / 5;
			amountToWithdraw = (deposit.amount - excess) + excess * 2 - burnAmount;
		} else {
			burnAmount = (deposit.amount * 2) / 5;
			amountToWithdraw = deposit.amount * 2 - burnAmount;
		}

		// Adjust based on actual fork threshold
		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}

		emit ClaimDeposit(amountToWithdraw, burnAmount);
	}

	// TODO, allow withdrawing after someones elses fork as well (game is canceled)
	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
		// if system hasnt forked, check outcome is winning
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		(depositor, amountToWithdraw, originalDepositAmount) = claimDepositForWinning(depositIndex, questionResolution);
		emit WithdrawDeposit(depositor, questionResolution, amountToWithdraw, depositIndex);
	}

	// TODO, for the UI, we probably want to retrieve multiple outcomes at once
	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		returnDeposits = new Deposit[](numberOfEntries);
		uint256 iterateUntil = startIndex + numberOfEntries > deposits[uint8(outcome)].length ? deposits[uint8(outcome)].length : startIndex + numberOfEntries;
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnDeposits[i - startIndex] = deposits[uint8(outcome)][i];
		}
	}
}
