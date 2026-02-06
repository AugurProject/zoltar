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

uint256 constant maxTime = 8 weeks;

contract EscalationGame {
	uint256 public startingTime;
	uint256[3] public balances; // outcome -> amount
	mapping(uint8 => Deposit[]) public deposits;
	ISecurityPool public securityPool;
	uint256 public forkTreshold;
	address owner;

	constructor(ISecurityPool _securityPool) {
		securityPool = _securityPool;
		owner = msg.sender;
	}

	function start(uint256 _forkTreshold) public {
		require(owner == msg.sender, 'only owner can start');
		require(startingTime == 0, 'already started');
		startingTime = block.timestamp + 3 days;
		forkTreshold = _forkTreshold;
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [balances[0], balances[1], balances[2]];
	}

	function pow(uint256 base, uint256 exp, uint256 scale) internal pure returns (uint256) {
		uint256 result = scale;
		while (exp > 0) {
			if (exp % 2 == 1) {
				result = (result * base) / scale;
			}
			base = (base * base) / scale;
			exp /= 2;
		}
		return result;
	}

	function totalCost() public view returns (uint256) {
		if (startingTime >= block.timestamp) return 0;
		uint256 timeFromStart = block.timestamp - startingTime;
		if (timeFromStart >= 4233600) return forkTreshold;
		/*
		// approximates e^(ln(FORK_THRESHOLD) / duration) scaled by SCALE
		const duration = 4233600; // 7 weeks
		const FORK_THRESHOLD = 100000000;
		const base = FORK_THRESHOLD ** (1 / duration) // fractional exponent off-chain
		*/
		uint256 base = 1000000000547; // scaled by 1e12
		uint256 scale = 1e12;
		return pow(base, timeFromStart, scale);
	}

	function getBindingCapital() public view returns (uint256) {
		if ((balances[0] >= balances[1] && balances[0] <= balances[2]) || (balances[0] >= balances[2] && balances[0] <= balances[1])) {
			return balances[0];
		} else if ((balances[1] >= balances[0] && balances[1] <= balances[2]) || (balances[1] >= balances[2] && balances[1] <= balances[0])) {
			return balances[1];
		}
		return balances[2];
	}

	function hasForked() public view returns (bool) {
		uint8 invalidOver = balances[0] >= forkTreshold ? 1 : 0;
		uint8 yesOver = balances[1] >= forkTreshold ? 1 : 0;
		uint8 noOver = balances[2] >= forkTreshold ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return true;
		return false;
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

	// deposits on market outcome, returns value how much the user should be refunded for
	function depositOnOutcome(address depositor, YesNoMarkets.Outcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(!hasForked(), 'System has already forked');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(getMarketResolution() == YesNoMarkets.Outcome.None, 'System has already timeouted');
		require(balances[uint256(outcome)] < forkTreshold, 'Already full');
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
	}

	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw) {
		require(!hasForked(), 'System has forked');
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		YesNoMarkets.Outcome winner = getMarketResolution();
		require(winner != YesNoMarkets.Outcome.None, 'System has already timeouted');
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
	}

	function getDepositsByOutcome(YesNoMarkets.Outcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		returnDeposits = new Deposit[](numberOfEntries);
		for (uint256 i = 0; i < numberOfEntries; i++) {
			returnDeposits[i] = deposits[uint8(outcome)][startIndex + i];
		}
	}
}
