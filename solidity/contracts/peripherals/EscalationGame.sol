// SPDX-License-Identifier: UNICENSE
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
	uint256 public forkTreshold;
	uint256 public startBond;
	address public owner;
	uint256 public forkedTimestamp;

	event GameStarted(uint256 startingTime, uint256 startBond, uint256 forkTreshold);
	event DepositOnOutcome(address depositor, YesNoMarkets.Outcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, YesNoMarkets.Outcome winner, uint256 amountToWithdraw, uint256 depositIndex);

	constructor(ISecurityPool _securityPool) {
		securityPool = _securityPool;
		owner = msg.sender;
	}

	function start(uint256 _startBond, uint256 _forkTreshold) public {
		require(owner == msg.sender, 'only owner can start');
		require(startingTime == 0, 'already started');
		startingTime = block.timestamp + 3 days;
		forkTreshold = _forkTreshold;
		startBond = _startBond;
		emit GameStarted(startingTime, forkTreshold, startBond);
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [balances[0], balances[1], balances[2]];
	}

	// TODO, verify that this is never bigger than forkThreshold and is always increasing or constant in terms of timeSinceStart
	// approx for: attrition cost = start deposit * (fork treshold / start deposit) ^ (time since start / time limit)
	function compute5TermTaylorSeriesAttritionCostApproximation(uint256 startDeposit, uint256 forkThreshold, uint256 timeSinceStart) public pure returns (uint256) {
		require(timeSinceStart <= escalationTimeLength, 'Invalid time');
		uint256 ratio = forkThreshold * SCALE / startDeposit;
		require(ratio > SCALE, 'ratio must be > 1'); // since startDeposit < forkThreshold
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
		return startDeposit * series / SCALE;
	}

	// todo investigate this function more for errors. This can result in weird errors where you fork just before/after escalation game end
	function computeTimeSinceStartFromAttritionCost(uint256 startDeposit, uint256 forkThreshold, uint256 attritionCost) public view returns (uint256) {
		uint256 low = 0;
		uint256 high = forkTreshold;
		if (attritionCost <= startDeposit) return 0;
		uint256 maxCost = forkTreshold;
		if (attritionCost >= maxCost) return forkTreshold;

		// binary search
		for (uint256 iteration = 0; iteration < 64; iteration++) {
			uint256 midTime = (low + high) / 2;

			uint256 midCost = compute5TermTaylorSeriesAttritionCostApproximation(startDeposit, forkThreshold, midTime);

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
		if (startingTime <= block.timestamp) return 0;
		if (forkedTimestamp > 0) return forkedTimestamp;
		return startingTime + computeTimeSinceStartFromAttritionCost(startBond, forkTreshold, getBindingCapital());
	}

	function totalCost() public view returns (uint256) {
		if (startingTime >= block.timestamp) return 0;
		uint256 timeFromStart = block.timestamp - startingTime;
		if (timeFromStart >= escalationTimeLength) return forkTreshold;
		return compute5TermTaylorSeriesAttritionCostApproximation(startBond, forkTreshold, timeFromStart);
	}

	function getMarketResolution() public view returns (YesNoMarkets.Outcome outcome){
		uint256 currentTotalCost = totalCost();
		uint8 invalidOver = balances[0] >= currentTotalCost ? 1 : 0;
		uint8 yesOver = balances[1] >= currentTotalCost ? 1 : 0;
		uint8 noOver = balances[2] >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return YesNoMarkets.Outcome.None; // if two or more outcomes are over the total cost, the game is still going
		// the game has ended to timeout
		if (balances[0] > balances[1] && balances[0] > balances[2]) return YesNoMarkets.Outcome.Invalid;
		if (balances[1] > balances[0] && balances[1] > balances[2]) return YesNoMarkets.Outcome.Yes;
		return YesNoMarkets.Outcome.No;
	}

	function hasForked() internal view returns (bool) {
		uint8 invalidOver = balances[0] >= forkTreshold ? 1 : 0;
		uint8 yesOver = balances[1] >= forkTreshold ? 1 : 0;
		uint8 noOver = balances[2] >= forkTreshold ? 1 : 0;
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

	// deposits on market outcome, returns value how much the user should be refunded for
	function depositOnOutcome(address depositor, YesNoMarkets.Outcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(forkedTimestamp == 0, 'System has already forked');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(getMarketResolution() == YesNoMarkets.Outcome.None, 'System has already timeouted');
		require(balances[uint256(outcome)] < forkTreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit'); // checks that we get start bond and spam protection
		Deposit memory deposit;
		deposit.depositor = depositor;
		balances[uint256(outcome)] += amount;
		if (balances[uint256(outcome)] > forkTreshold) {
			depositAmount = amount - (balances[uint256(outcome)] - forkTreshold);
			balances[uint256(outcome)] = forkTreshold;
		} else {
			depositAmount = amount;
		}
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = balances[uint256(outcome)];
		deposits[uint8(outcome)].push(deposit);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, deposits[uint8(outcome)].length - 1, deposit.cumulativeAmount);
		if (hasForked()) {
			forkedTimestamp = block.timestamp;
		}
	}

	// todo, allow withdrawing after own fork as well
	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw) {
		require(forkedTimestamp == 0, 'System has forked');
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		YesNoMarkets.Outcome winner = getMarketResolution();
		require(winner != YesNoMarkets.Outcome.None, 'Escalation game has not ended');
		Deposit memory deposit = deposits[uint8(winner)][depositIndex];
		deposits[uint8(winner)][depositIndex].amount = 0;
		depositor = deposit.depositor;
		uint256 maxWithdrawableBalance = getBindingCapital();
		if (deposit.cumulativeAmount > maxWithdrawableBalance) {
			amountToWithdraw = deposit.amount;
		} else if (deposit.cumulativeAmount + deposit.amount > maxWithdrawableBalance) {
			uint256 excess = (deposit.cumulativeAmount + deposit.amount - maxWithdrawableBalance);
			amountToWithdraw = (deposit.amount - excess) * 2 + excess;
		} else {
			amountToWithdraw = deposit.amount * 2;
		}
		emit WithdrawDeposit(depositor, winner, amountToWithdraw, depositIndex);
	}

	// todo, for the UI, we probably want to retrive multiple outcomes at once
	function getDepositsByOutcome(YesNoMarkets.Outcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		returnDeposits = new Deposit[](numberOfEntries);
		uint256 iterateUntil = startIndex + numberOfEntries > deposits[uint8(outcome)].length ? deposits[uint8(outcome)].length : startIndex + numberOfEntries;
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnDeposits[i] = deposits[uint8(outcome)][i];
		}
	}
}
