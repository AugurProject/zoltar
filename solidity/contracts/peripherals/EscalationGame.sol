// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

struct Deposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

struct ImportedDeposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
	bool settled;
}

struct OutcomeState {
	// Total principal currently assigned to this outcome, including imported continuation deposits.
	uint256 balance;
	// Local deposits placed directly in this escalation game, preserved in arrival order for payout ordering.
	Deposit[] deposits;
	// [parentDepositIndex] => imported deposit record carried from a parent or ancestor continuation game.
	mapping(uint256 => ImportedDeposit) importedDeposits;
	// [fenwickNodeIndex] => Fenwick tree node sum used to compute imported principal before a given parentDepositIndex.
	mapping(uint256 => uint256) importedPrefixTree;
	// [depositor] => unsettled imported parentDepositIndexes owned by that depositor, used for bounded discovery and pagination.
	mapping(address => uint256[]) unsettledImportedDepositIndexesByDepositor;
	// [depositor][parentDepositIndex] => 1-based position inside unsettledImportedDepositIndexesByDepositor for O(1) swap-and-pop removal.
	mapping(address => mapping(uint256 => uint256)) importedDepositorIndexPosition;
	// Total imported principal tracked in this outcome's imported prefix accounting.
	uint256 importedTotalAmount;
	// Imported principal sitting at the sentinel max key, excluded from normal Fenwick prefix traversal.
	uint256 importedMaxKeyAmount;
	// Total imported continuation principal currently assigned to this outcome.
	uint256 importedBalance;
}

uint256 constant escalationTimeLength = 4233600; // 7 weeks
uint256 constant SCALE = 1e6;
uint256 constant LN2_SCALED = 693147;
uint256 constant MAX_ATANH_ITERATIONS = 16;
uint256 constant MAX_EXP_ITERATIONS = 16;
uint256 constant EXCESS_REWARD_WINDOW_DIVISOR = 2;
uint256 constant FORK_CONTINUATION_LOCAL_DEPOSIT_INDEX_PREFIX = 1 << 255;

contract EscalationGame {
	uint256 public constant activationDelay = 3 days;
	uint256 public activationTime;
	ISecurityPool public securityPool;
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	uint256 public lnRatioScaled;
	address public owner;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	bool public forkContinuationResumed;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	// Outcome-indexed state uses 0 = Invalid, 1 = Yes, 2 = No.
	// Each bucket owns its local deposits, imported continuation deposits, and aggregate balances.
	OutcomeState[3] private outcomeState;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkContinuationResumed(uint256 resumedAt);
	event DepositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountToWithdraw, uint256 depositIndex);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);
	event ImportedForkDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 parentDepositIndex, uint256 amount);

	constructor(ISecurityPool _securityPool) {
		securityPool = _securityPool;
		owner = msg.sender;
	}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) public {
		require(owner == msg.sender, 'only owner can start');
		require(activationTime == 0, 'already started');
		require(_nonDecisionThreshold > _startBond, 'threshold must exceed start bond');
		require(_startBond > 0, 'start bond must be positive');
		require(_startBond >= 1e18, 'start bond must be at least 1 ether');
		require(_nonDecisionThreshold >= 1e18, 'threshold must be at least 1 ether');
		activationTime = block.timestamp + activationDelay;
		nonDecisionThreshold = _nonDecisionThreshold;
		startBond = _startBond;
		lnRatioScaled = _computeLnRatioScaled(_startBond, _nonDecisionThreshold);
		emit GameStarted(activationTime, startBond, nonDecisionThreshold);
	}

	function startFromFork(uint256 _startBond, uint256 _nonDecisionThreshold, uint256 elapsedAtFork) public {
		require(owner == msg.sender, 'only owner can start');
		require(activationTime == 0, 'already started');
		require(_nonDecisionThreshold > _startBond, 'threshold must exceed start bond');
		require(_startBond > 0, 'start bond must be positive');
		require(_startBond >= 1e18, 'start bond must be at least 1 ether');
		require(_nonDecisionThreshold >= 1e18, 'threshold must be at least 1 ether');
		require(elapsedAtFork <= escalationTimeLength, 'Invalid time');
		forkContinuation = true;
		forkContinuationResumed = false;
		forkElapsedAtStart = elapsedAtFork;
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = _computeLnRatioScaled(_startBond, _nonDecisionThreshold);
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function resumeFromFork() public {
		require(owner == msg.sender || address(securityPool) == msg.sender, 'only owner can resume');
		require(forkContinuation, 'not fork continuation');
		require(!forkContinuationResumed, 'already resumed');
		forkContinuationResumed = true;
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function balances(uint256 outcomeIndex) public view returns (uint256) {
		return outcomeState[outcomeIndex].balance;
	}

	function deposits(uint8 outcomeIndex, uint256 depositIndex) public view returns (address depositor, uint256 amount, uint256 cumulativeAmount) {
		Deposit storage deposit = outcomeState[outcomeIndex].deposits[depositIndex];
		return (deposit.depositor, deposit.amount, deposit.cumulativeAmount);
	}

	function importedDeposits(uint256 outcomeIndex, uint256 parentDepositIndex) public view returns (address depositor, uint256 amount, uint256 cumulativeAmount, bool settled) {
		ImportedDeposit storage deposit = outcomeState[outcomeIndex].importedDeposits[parentDepositIndex];
		return (deposit.depositor, deposit.amount, deposit.cumulativeAmount, deposit.settled);
	}

	function importedBalances(uint256 outcomeIndex) public view returns (uint256) {
		return outcomeState[outcomeIndex].importedBalance;
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [outcomeState[0].balance, outcomeState[1].balance, outcomeState[2].balance];
	}

	// Attrition cost = startBond * exp( ln(ratio) * t / T ) where ratio = nonDecisionThreshold / startBond.
	// Uses fixed-point with SCALE=1e6. ln(ratio) is cached at start to avoid recomputing it on every read.
	// Series iterate until convergence (max iterations: atanh=MAX_ATANH_ITERATIONS, exp=MAX_EXP_ITERATIONS). Guarantees:
	// - f(0) = startBond, f(T) = nonDecisionThreshold
	// - f(t) monotonic increasing for t in (0,T)
	// - f(t) <= nonDecisionThreshold
	function computeIterativeAttritionCost(uint256 timeSinceStart) public view returns (uint256) {
		uint256 startBondLocal = startBond;
		uint256 nonDecisionThresholdLocal = nonDecisionThreshold;
		require(timeSinceStart <= escalationTimeLength, 'Invalid time');
		// Exact edge cases
		if (timeSinceStart == 0) return startBondLocal;
		if (timeSinceStart == escalationTimeLength) return nonDecisionThresholdLocal;

		// Exponent = lnRatio_scaled * t / T
		uint256 exponent = lnRatioScaled * timeSinceStart / escalationTimeLength;
		uint256 exponentPow2 = exponent / LN2_SCALED;
		uint256 exponentRemainder = exponent - exponentPow2 * LN2_SCALED;

		// Compute exp(exponentRemainder / SCALE) * SCALE using series: Σ_{k=0} exponent^k / (k! * SCALE^{k-1})
		// Range reduction uses exp(x) = 2^k * exp(x - k * ln(2)).
		// Recurrence: term_k = term_{k-1} * exponent / (k * SCALE)
		uint256 exp_scaled = SCALE; // k=0
		uint256 term = exponentRemainder; // k=1
		exp_scaled += term;

		for (uint256 k = 2; k < MAX_EXP_ITERATIONS;) {
			term = term * exponentRemainder / (k * SCALE);
			if (term == 0) break;
			exp_scaled += term;
			unchecked {
				++k;
			}
		}

		exp_scaled <<= exponentPow2;
		uint256 cost = startBondLocal * exp_scaled / SCALE;
		// Clamp (should be ≤ nonDecisionThreshold, but rounding may cause slight overshoot)
		return cost > nonDecisionThresholdLocal ? nonDecisionThresholdLocal : cost;
	}

	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		if (attritionCost <= startBond) return 0;
		if (attritionCost >= nonDecisionThreshold) return escalationTimeLength;

		uint256 lnCostRatioScaled = _computeLnRatioScaled(startBond, attritionCost);
		return lnCostRatioScaled * escalationTimeLength / lnRatioScaled;
	}

	function _computeLnRatioScaled(uint256 lowValue, uint256 highValue) internal pure returns (uint256) {
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
		uint256 z = diff * SCALE / sum; // z ∈ [0, SCALE / 3] after range reduction
		if (z == 0) return 0;
		return log2Count * LN2_SCALED + 2 * _computeAtanhScaled(z); // ln(highValue / lowValue) * SCALE
	}

	function _computeAtanhScaled(uint256 z) internal pure returns (uint256 atanhScaled) {
		uint256 z2 = z * z / SCALE; // = Z^2 * SCALE
		uint256 term = z; // k=0: z / 1
		atanhScaled = term;

		for (uint256 k = 1; k < MAX_ATANH_ITERATIONS;) {
			term = term * z2 * (2 * k - 1) / ((2 * k + 1) * SCALE);
			if (term == 0) break;
			atanhScaled += term;
			unchecked {
				++k;
			}
		}
	}

	function getEscalationGameEndDate() public view returns (uint256 endTime) {
		if (nonDecisionTimestamp > 0) return nonDecisionTimestamp;
		if (forkContinuation) {
			if (!forkContinuationResumed) return type(uint256).max;
			uint256 requiredElapsed = computeTimeSinceStartFromAttritionCost(getBindingCapital());
			if (requiredElapsed <= forkElapsedAtStart) return forkResumedAt;
			return forkResumedAt + (requiredElapsed - forkElapsedAtStart);
		}
		return activationTime + computeTimeSinceStartFromAttritionCost(getBindingCapital());
	}

	function totalCost() public view returns (uint256) {
		if (forkContinuation && !forkContinuationResumed && forkElapsedAtStart == 0) return 0;
		if (forkContinuation && !forkContinuationResumed) return computeIterativeAttritionCost(forkElapsedAtStart);
		if (forkContinuation) {
			uint256 forkElapsed = forkElapsedAtStart + (block.timestamp - forkResumedAt);
			if (forkElapsed == 0) return 0;
			if (forkElapsed >= escalationTimeLength) return nonDecisionThreshold;
			return computeIterativeAttritionCost(forkElapsed);
		}
		if (activationTime >= block.timestamp) return 0;
		uint256 elapsedSinceActivation = block.timestamp - activationTime;
		if (elapsedSinceActivation >= escalationTimeLength) return nonDecisionThreshold;
		return computeIterativeAttritionCost(elapsedSinceActivation);
	}

	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome){
		uint256 currentTotalCost = totalCost();
		uint8 invalidOver = outcomeState[0].balance >= currentTotalCost ? 1 : 0;
		uint8 yesOver = outcomeState[1].balance >= currentTotalCost ? 1 : 0;
		uint8 noOver = outcomeState[2].balance >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return BinaryOutcomes.BinaryOutcome.None; // if two or more outcomes are over the total cost, the game is still going
		if (outcomeState[0].balance == 0 && outcomeState[1].balance == 0 && outcomeState[2].balance == 0) return BinaryOutcomes.BinaryOutcome.Invalid;
		// the game has ended due to timeout
		if (outcomeState[0].balance > outcomeState[1].balance && outcomeState[0].balance > outcomeState[2].balance) return BinaryOutcomes.BinaryOutcome.Invalid;
		if (outcomeState[1].balance > outcomeState[0].balance && outcomeState[1].balance > outcomeState[2].balance) return BinaryOutcomes.BinaryOutcome.Yes;
		return BinaryOutcomes.BinaryOutcome.No;
	}

	function hasReachedNonDecision() public view returns (bool) {
		uint8 invalidOver = outcomeState[0].balance >= nonDecisionThreshold ? 1 : 0;
		uint8 yesOver = outcomeState[1].balance >= nonDecisionThreshold ? 1 : 0;
		uint8 noOver = outcomeState[2].balance >= nonDecisionThreshold ? 1 : 0;
		return invalidOver + yesOver + noOver >= 2;
	}

	function getBindingCapital() public view returns (uint256) {
		if (
			(outcomeState[0].balance >= outcomeState[1].balance && outcomeState[0].balance <= outcomeState[2].balance) ||
			(outcomeState[0].balance >= outcomeState[2].balance && outcomeState[0].balance <= outcomeState[1].balance)
		) {
			return outcomeState[0].balance;
		} else if (
			(outcomeState[1].balance >= outcomeState[0].balance && outcomeState[1].balance <= outcomeState[2].balance) ||
			(outcomeState[1].balance >= outcomeState[2].balance && outcomeState[1].balance <= outcomeState[0].balance)
		) {
			return outcomeState[1].balance;
		}
		return outcomeState[2].balance;
	}

	// deposits on question outcome, returns how much user actually ended depositing
	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(nonDecisionTimestamp == 0, 'System has already reached a non-decision');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'System has already timed out');
		require(outcomeState[uint256(outcome)].balance < nonDecisionThreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit'); // checks that we get start bond and spam protection
		uint256 outcomeIdx = uint256(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIdx];
		uint256 currentBalance = selectedOutcomeState.balance;
		uint256 room = nonDecisionThreshold - currentBalance;
		uint256 effectiveDeposit = amount > room ? room : amount;
		uint256 newBalance = currentBalance + effectiveDeposit;

		// Snapshot all balances for tie detection
		uint256 b0 = outcomeState[0].balance;
		uint256 b1 = outcomeState[1].balance;
		uint256 b2 = outcomeState[2].balance;
		uint256 maxBal = b0 > b1 ? (b0 > b2 ? b0 : b2) : (b1 > b2 ? b1 : b2);

		// Check if new balance ties with existing maximum and another outcome has that maximum, and max is below threshold.
		// Ties at/above threshold are allowed (to trigger nonDecision/fork).
			bool otherHasMax = (outcomeIdx == 0) ? (b1 == maxBal || b2 == maxBal) :
			                    (outcomeIdx == 1) ? (b0 == maxBal || b2 == maxBal) :
			                    (b0 == maxBal || b1 == maxBal);
			if (newBalance == maxBal && otherHasMax && maxBal < nonDecisionThreshold) {
				effectiveDeposit -= 1;
				require(effectiveDeposit >= startBond, 'tie adjustment would break min deposit');
				newBalance = currentBalance + effectiveDeposit;
			}

		// Update the balance
		selectedOutcomeState.balance = newBalance;
		depositAmount = effectiveDeposit;

		// Record deposit
		Deposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = selectedOutcomeState.balance;
		selectedOutcomeState.deposits.push(deposit);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, selectedOutcomeState.deposits.length - 1, deposit.cumulativeAmount);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
		}
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		OutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		Deposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 depositStart = deposit.cumulativeAmount - deposit.amount;
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 winningOutcomeBalance = selectedOutcomeState.balance;
		uint256 rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount;
		uint256 rewardBonusPoolAmount = (bindingCapitalAmount * 3) / 5;
		uint256 totalHaircutAmount = (bindingCapitalAmount * 2) / 5;
		uint256 burnAmount;
		if (rewardEligiblePrincipalAmount == 0) {
			amountToWithdraw = deposit.amount;
			burnAmount = 0;
		} else {
			uint256 eligibleEndAmount = deposit.cumulativeAmount < rewardEligibleCapAmount ? deposit.cumulativeAmount : rewardEligibleCapAmount;
			uint256 rewardEligibleDepositAmount = eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0;
			if (rewardEligibleDepositAmount > deposit.amount) rewardEligibleDepositAmount = deposit.amount;
			uint256 bonusShare = rewardEligibleDepositAmount * rewardBonusPoolAmount / rewardEligiblePrincipalAmount;
			burnAmount = rewardEligibleDepositAmount * totalHaircutAmount / rewardEligiblePrincipalAmount;
			amountToWithdraw = deposit.amount + bonusShare;
		}

		// Adjust based on actual fork threshold
		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}

		emit ClaimDeposit(amountToWithdraw, burnAmount);
	}

	function exportUnresolvedForkDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		OutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		if (depositIndex > type(uint128).max) {
			uint256 importedDepositIndex = ~depositIndex;
			ImportedDeposit storage importedDeposit = selectedOutcomeState.importedDeposits[importedDepositIndex];
			require(importedDeposit.depositor != address(0x0), 'unknown imported deposit');
			require(!importedDeposit.settled, 'deposit already settled');
			importedDeposit.settled = true;
			depositor = importedDeposit.depositor;
			amount = importedDeposit.amount;
			parentDepositIndex = importedDepositIndex;
			return (depositor, amount, parentDepositIndex);
		}
		Deposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		depositor = deposit.depositor;
		amount = deposit.amount;
		parentDepositIndex = forkContinuation ? FORK_CONTINUATION_LOCAL_DEPOSIT_INDEX_PREFIX | depositIndex : depositIndex;
	}

	function importForkedDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 parentDepositIndex, uint256 amount) public {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(forkContinuation, 'not fork continuation');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		require(amount > 0, 'amount must be positive');
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		ImportedDeposit storage deposit = selectedOutcomeState.importedDeposits[parentDepositIndex];
		require(deposit.depositor == address(0x0), 'deposit already imported');
		deposit.depositor = depositor;
		deposit.amount = amount;
		deposit.cumulativeAmount = _getImportedPrefixAmount(outcomeIndex, parentDepositIndex);
		selectedOutcomeState.importedBalance += amount;
		selectedOutcomeState.balance += amount;
		_addImportedPrefixAmount(outcomeIndex, parentDepositIndex, amount);
		selectedOutcomeState.unsettledImportedDepositIndexesByDepositor[depositor].push(parentDepositIndex);
		selectedOutcomeState.importedDepositorIndexPosition[depositor][parentDepositIndex] = selectedOutcomeState.unsettledImportedDepositIndexesByDepositor[depositor].length;
		emit ImportedForkDeposit(depositor, outcome, parentDepositIndex, amount);
	}

	function withdrawImportedForkDeposit(uint256 parentDepositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		ImportedDeposit storage deposit = selectedOutcomeState.importedDeposits[parentDepositIndex];
		require(deposit.depositor != address(0x0), 'unknown imported deposit');
		require(!deposit.settled, 'deposit already settled');
		deposit.settled = true;
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		_removeUnsettledImportedDeposit(outcomeIndex, depositor, parentDepositIndex);
		uint256 depositStart = deposit.cumulativeAmount;
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 winningOutcomeBalance = selectedOutcomeState.balance;
		uint256 rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount;
		uint256 burnAmount;
		if (rewardEligiblePrincipalAmount == 0) {
			amountToWithdraw = originalDepositAmount;
		} else {
			uint256 eligibleEndAmount = depositStart + originalDepositAmount < rewardEligibleCapAmount ? depositStart + originalDepositAmount : rewardEligibleCapAmount;
			uint256 rewardEligibleDepositAmount = eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0;
			if (rewardEligibleDepositAmount > originalDepositAmount) rewardEligibleDepositAmount = originalDepositAmount;
			uint256 rewardBonusPoolAmount = (bindingCapitalAmount * 3) / 5;
			uint256 totalHaircutAmount = (bindingCapitalAmount * 2) / 5;
			uint256 bonusShare = rewardEligibleDepositAmount * rewardBonusPoolAmount / rewardEligiblePrincipalAmount;
			burnAmount = rewardEligibleDepositAmount * totalHaircutAmount / rewardEligiblePrincipalAmount;
			amountToWithdraw = originalDepositAmount + bonusShare;
		}

		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}

		emit ClaimDeposit(amountToWithdraw, burnAmount);
	}

	function forfeitImportedForkDeposit(uint256 parentDepositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		require(outcome != questionResolution, 'Winning deposits must withdraw');
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		ImportedDeposit storage deposit = selectedOutcomeState.importedDeposits[parentDepositIndex];
		require(deposit.depositor != address(0x0), 'unknown imported deposit');
		require(!deposit.settled, 'deposit already settled');
		deposit.settled = true;
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		_removeUnsettledImportedDeposit(outcomeIndex, depositor, parentDepositIndex);
		emit WithdrawDeposit(depositor, outcome, 0, parentDepositIndex);
	}

	function refundCanceledDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(securityPool.zoltar().getForkTime(securityPool.universeId()) > 0, 'Zoltar has not forked');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		OutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		Deposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		depositor = deposit.depositor;
		amountToWithdraw = deposit.amount;
		emit WithdrawDeposit(depositor, outcome, amountToWithdraw, depositIndex);
	}

	function getUnsettledImportedDepositIndexesByOutcomeAndDepositor(
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 startIndex,
		uint256 scanCount
	) external view returns (uint256[] memory depositIndexes) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint256[] storage depositorIndexes = outcomeState[uint8(outcome)].unsettledImportedDepositIndexesByDepositor[depositor];
		if (startIndex >= depositorIndexes.length || scanCount == 0) return new uint256[](0);
		uint256 endIndex = startIndex + scanCount;
		if (endIndex > depositorIndexes.length) {
			endIndex = depositorIndexes.length;
		}
		depositIndexes = new uint256[](endIndex - startIndex);
		uint256 writeIndex = 0;
		for (uint256 index = startIndex; index < endIndex; index++) {
			uint256 depositIndex = depositorIndexes[index];
			depositIndexes[writeIndex] = depositIndex;
			writeIndex += 1;
		}
	}

	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
		// if system hasnt forked, check outcome is winning
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		(depositor, amountToWithdraw, originalDepositAmount) = claimDepositForWinning(depositIndex, questionResolution);
		emit WithdrawDeposit(depositor, questionResolution, amountToWithdraw, depositIndex);
	}

	function forfeitLosingDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		require(outcome != questionResolution, 'Winning deposits must withdraw');
		OutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		require(depositIndex < selectedOutcomeState.deposits.length, 'Invalid deposit index');
		Deposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		emit WithdrawDeposit(depositor, outcome, 0, depositIndex);
	}

	function getUnsettledDepositIndexesByOutcomeAndDepositor(
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 startIndex,
		uint256 scanCount
	) external view returns (uint256[] memory depositIndexes) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		Deposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		if (startIndex >= outcomeDeposits.length || scanCount == 0) return new uint256[](0);
		uint256 endIndex = startIndex + scanCount;
		if (endIndex > outcomeDeposits.length) {
			endIndex = outcomeDeposits.length;
		}

		uint256 matchCount = 0;
		for (uint256 index = startIndex; index < endIndex; index++) {
			Deposit storage deposit = outcomeDeposits[index];
			if (deposit.depositor == depositor && deposit.amount > 0) {
				matchCount++;
			}
		}

		depositIndexes = new uint256[](matchCount);
		uint256 writeIndex = 0;
		for (uint256 index = startIndex; index < endIndex; index++) {
			Deposit storage deposit = outcomeDeposits[index];
			if (deposit.depositor == depositor && deposit.amount > 0) {
				depositIndexes[writeIndex] = index;
				writeIndex++;
			}
		}
	}

	// TODO, for the UI, we probably want to retrieve multiple outcomes at once
	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		Deposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		uint256 iterateUntil = startIndex + numberOfEntries > outcomeDeposits.length ? outcomeDeposits.length : startIndex + numberOfEntries;
		if (iterateUntil <= startIndex) return new Deposit[](0);
		returnDeposits = new Deposit[](iterateUntil - startIndex);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnDeposits[i - startIndex] = outcomeDeposits[i];
		}
	}

	function _removeUnsettledImportedDeposit(uint8 outcomeIndex, address depositor, uint256 parentDepositIndex) private {
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		uint256[] storage depositorIndexes = selectedOutcomeState.unsettledImportedDepositIndexesByDepositor[depositor];
		uint256 positionPlusOne = selectedOutcomeState.importedDepositorIndexPosition[depositor][parentDepositIndex];
		require(positionPlusOne != 0, 'deposit not unsettled');
		uint256 position = positionPlusOne - 1;
		uint256 lastIndex = depositorIndexes.length - 1;
		if (position != lastIndex) {
			uint256 movedDepositIndex = depositorIndexes[lastIndex];
			depositorIndexes[position] = movedDepositIndex;
			selectedOutcomeState.importedDepositorIndexPosition[depositor][movedDepositIndex] = positionPlusOne;
		}
		depositorIndexes.pop();
		delete selectedOutcomeState.importedDepositorIndexPosition[depositor][parentDepositIndex];
	}

	function _getImportedPrefixAmount(uint8 outcomeIndex, uint256 parentDepositIndex) internal view returns (uint256 prefixAmount) {
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		if (parentDepositIndex == 0) {
			return 0;
		}
		if (parentDepositIndex == type(uint256).max) {
			return selectedOutcomeState.importedTotalAmount - selectedOutcomeState.importedMaxKeyAmount;
		}
		for (uint256 index = parentDepositIndex; index > 0;) {
			prefixAmount += selectedOutcomeState.importedPrefixTree[index];
			uint256 lowBit = index & (~index + 1);
			index -= lowBit;
		}
	}

	function _addImportedPrefixAmount(uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) internal {
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		selectedOutcomeState.importedTotalAmount += amount;
		if (parentDepositIndex == type(uint256).max) {
			selectedOutcomeState.importedMaxKeyAmount += amount;
			return;
		}
		for (uint256 index = parentDepositIndex + 1; index > 0;) {
			selectedOutcomeState.importedPrefixTree[index] += amount;
			uint256 lowBit = index & (~index + 1);
			unchecked {
				index += lowBit;
			}
		}
	}
}
