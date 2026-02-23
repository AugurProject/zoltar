// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { YesNoMarkets } from './YesNoMarkets.sol';

struct Deposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

uint256 constant escalationTimeLength = 4233600; // 7 weeks
uint256 constant SCALE = 1e6;
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
	event DepositOnOutcome(address depositor, YesNoMarkets.Outcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, YesNoMarkets.Outcome winner, uint256 amountToWithdraw, uint256 depositIndex);
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
		startingTime = block.timestamp + 3 days;
		nonDecisionThreshold = _nonDecisionThreshold;
		startBond = _startBond;
		emit GameStarted(startingTime, startBond, nonDecisionThreshold);
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [balances[0], balances[1], balances[2]];
	}

	// TODO, verify that this is never bigger than nonDecisionThreshold and is always increasing or constant in terms of timeSinceStart
	// approx for: attrition cost = start deposit * (nonDecisionThreshold / start deposit) ^ (time since start / time limit)
	function compute5TermTaylorSeriesAttritionCostApproximation(uint256 timeSinceStart) public view returns (uint256) {
		require(timeSinceStart <= escalationTimeLength, 'Invalid time');
		uint256 ratio = nonDecisionThreshold * SCALE / startBond;
		require(ratio > SCALE, 'ratio must be > 1'); // since startBond < nonDecisionThreshold
		uint256 z = (ratio - SCALE) * SCALE / (ratio + SCALE);
		uint256 z2 = z * z / SCALE;
		uint256 lnRatio = 2 * (z + z2 * z / (3 * SCALE) + z2 * z2 * z / (5 * SCALE));

		uint256 tLnX = timeSinceStart * lnRatio / escalationTimeLength;
		// Compute series: 1 + t*ln(x) + (t*ln(x))^2/2! + ... + (t*ln(x))^5/5!
		uint256 series = SCALE;
		uint256 term = tLnX;
		// 1
		series += term;
		// 2
		term = term * tLnX / (2 * SCALE);
		series += term;
		// 3
		term = term * tLnX / (3 * SCALE);
		series += term;
		// 4
		term = term * tLnX / (4 * SCALE);
		series += term;
		// 5
		term = term * tLnX / (5 * SCALE);
		series += term;
		return startBond * series / SCALE;
	}

	// TODO investigate this function more for errors. This can result in weird errors where you fork just before/after escalation game end
	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		uint256 low = 0;
		uint256 high = escalationTimeLength;
		if (attritionCost <= startBond) return 0;
		uint256 maxCost = nonDecisionThreshold;
		if (attritionCost >= maxCost) return escalationTimeLength;

		// binary search
		for (uint256 iteration = 0; iteration < 64; iteration++) {
			uint256 midTime = (low + high) / 2;

			uint256 midCost = compute5TermTaylorSeriesAttritionCostApproximation(midTime);

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
		return compute5TermTaylorSeriesAttritionCostApproximation(timeFromStart);
	}

	function getMarketResolution() public view returns (YesNoMarkets.Outcome outcome){
		uint256 currentTotalCost = totalCost();
		uint8 invalidOver = balances[0] >= currentTotalCost ? 1 : 0;
		uint8 yesOver = balances[1] >= currentTotalCost ? 1 : 0;
		uint8 noOver = balances[2] >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return YesNoMarkets.Outcome.None; // if two or more outcomes are over the total cost, the game is still going
		// the game has ended due to timeout
		// TODO, doesn't handle ties well logically. We could avoid it by checking if tie is happening before deposit and break it there
		if (balances[0] > balances[1] && balances[0] > balances[2]) return YesNoMarkets.Outcome.Invalid;
		if (balances[1] > balances[0] && balances[1] > balances[2]) return YesNoMarkets.Outcome.Yes;
		return YesNoMarkets.Outcome.No;
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

	// deposits on market outcome, returns how much user actually ended depositing
	function depositOnOutcome(address depositor, YesNoMarkets.Outcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(nonDecisionTimestamp == 0, 'System has already reached a non-decision');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(getMarketResolution() == YesNoMarkets.Outcome.None, 'System has already timed out');
		require(balances[uint256(outcome)] < nonDecisionThreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit'); // checks that we get start bond and spam protection
		Deposit memory deposit;
		deposit.depositor = depositor;
		balances[uint256(outcome)] += amount;
		if (balances[uint256(outcome)] > nonDecisionThreshold) {
			depositAmount = amount - (balances[uint256(outcome)] - nonDecisionThreshold);
			balances[uint256(outcome)] = nonDecisionThreshold;
		} else {
			depositAmount = amount;
		}
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = balances[uint256(outcome)];
		deposits[uint8(outcome)].push(deposit);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, deposits[uint8(outcome)].length - 1, deposit.cumulativeAmount);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
		}
	}

	// TODO, this should be calculated against to actual nonDecisionThreshold, not the one set at the start. The actual can be lower than the games treshold but never above
	function claimDepositForWinning(uint256 depositIndex, YesNoMarkets.Outcome outcome) public returns (address depositor, uint256 amountToWithdraw) {
		require(msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()), 'Only Security Pool can withdraw');
		Deposit memory deposit = deposits[uint8(outcome)][depositIndex];
		deposits[uint8(outcome)][depositIndex].amount = 0;
		depositor = deposit.depositor;
		uint256 maxWithdrawableBalance = getBindingCapital();
		if (deposit.cumulativeAmount > maxWithdrawableBalance) {
			amountToWithdraw = deposit.amount;
			emit ClaimDeposit(amountToWithdraw, 0);
		} else if (deposit.cumulativeAmount + deposit.amount > maxWithdrawableBalance) {
			uint256 excess = (deposit.cumulativeAmount + deposit.amount - maxWithdrawableBalance);
			uint256 burnAmount = excess * 2 / 5;
			amountToWithdraw = (deposit.amount - excess) + excess * 2 - burnAmount;
			emit ClaimDeposit(amountToWithdraw, burnAmount);
		} else {
			uint256 burnAmount = (deposit.amount * 2) / 5;
			amountToWithdraw = deposit.amount * 2 - burnAmount;
			emit ClaimDeposit(amountToWithdraw, burnAmount);
		}
	}

	// TODO, allow withdrawing after someones elses fork as well (game is canceled)
	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
		// if system hasnt forked, check outcome is winning
		YesNoMarkets.Outcome marketResolution = getMarketResolution();
		(depositor,amountToWithdraw) = claimDepositForWinning(depositIndex, marketResolution);
		emit WithdrawDeposit(depositor, marketResolution, amountToWithdraw, depositIndex);
	}

	// TODO, for the UI, we probably want to retrieve multiple outcomes at once
	function getDepositsByOutcome(YesNoMarkets.Outcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		returnDeposits = new Deposit[](numberOfEntries);
		uint256 iterateUntil = startIndex + numberOfEntries > deposits[uint8(outcome)].length ? deposits[uint8(outcome)].length : startIndex + numberOfEntries;
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnDeposits[i - startIndex] = deposits[uint8(outcome)][i];
		}
	}
}
