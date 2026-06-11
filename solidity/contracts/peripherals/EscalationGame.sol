// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

struct CarryTreeDeposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

struct CarryTreeLeafView {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
}

struct CarryTreeOutcomeState {
	// Total principal currently assigned to this outcome by local deposits placed directly in this escalation game.
	uint256 balance;
	// Local deposits placed directly in this escalation game, preserved in arrival order for payout ordering.
	CarryTreeDeposit[] deposits;
}

library CarryTreeMerkleMountainRange {
	function hashLeaf(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount,
		uint256 sourceNodeId
	) internal pure returns (bytes32) {
		return keccak256(abi.encode(depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId));
	}

	function hashParent(bytes32 left, bytes32 right) internal pure returns (bytes32) {
		return keccak256(abi.encodePacked(left, right));
	}

	function bagPeaks(bytes32[] memory peaks, uint256 peakCount) internal pure returns (bytes32 root) {
		if (peakCount == 0) return bytes32(0);
		root = peaks[peakCount - 1];
		for (uint256 peakIndex = peakCount - 1; peakIndex > 0; peakIndex--) {
			root = hashParent(peaks[peakIndex - 1], root);
		}
	}
}

struct CarryTreeNode {
	// Previous unresolved node for this same outcome inside this escalation game instance.
	uint256 parentNodeId;
	address depositor;
	BinaryOutcomes.BinaryOutcome outcome;
	uint256 amount;
	// Stable ordering key inherited from the source escalation game.
	uint256 parentDepositIndex;
	// Prefix-position data needed for payout-order proofs.
	uint256 cumulativeAmount;
}

struct CarriedDepositProof {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
	uint256 leafIndex;
	bytes32[] merkleMountainRangeSiblings;
	uint256 merkleMountainRangePeakIndex;
	bytes32[] nullifierSiblings;
}

uint256 constant escalationTimeLength = 4233600; // 7 weeks
uint256 constant carryTreeScale = 1e6;
uint256 constant carryTreeLn2Scaled = 693147;
uint256 constant carryTreeMaxAtanhIterations = 16;
uint256 constant carryTreeMaxExpIterations = 16;
uint256 constant carryTreeExcessRewardWindowDivisor = 2;
uint256 constant carryTreeForkContinuationLocalDepositIndexPrefix = 1 << 255;
uint256 constant carryTreeMerkleMountainRangeMaxPeaks = 64;
uint256 constant carryTreeNullifierDepth = 64;

// Alternative escalation game design:
// - includes the full local escalation-game feature surface from EscalationGame
// - snapshots inherited fork-carried state without replaying deposits into children
// - tracks local carry additions as Merkle mountain ranges per outcome
// - settles inherited carry through proofs instead of eager imported child rows
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
	bool public forkCarrySnapshotInitialized;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	// Outcome-indexed state uses 0 = Invalid, 1 = Yes, 2 = No.
	CarryTreeOutcomeState[3] private outcomeState;
	uint256 public nextNodeId = 1;
	uint256[3] private snapshotCarryLeafCounts;
	bytes32[carryTreeMerkleMountainRangeMaxPeaks][3] private snapshotCarryPeaks;
	uint256[3] private inheritedCarryTotals;
	uint256[3] private inheritedCarryUnresolvedTotals;
	bytes32[3] private inheritedNullifierRoots;
	bytes32[3] private currentNullifierRoots;
	mapping(uint256 => CarryTreeNode) private carryNodes;
	uint256[3] private localHeadNodeIds;
	uint256[3] private currentCarryLeafCounts;
	bytes32[carryTreeMerkleMountainRangeMaxPeaks][3] private currentCarryPeaks;
	uint256[3] private localCarryUnresolvedTotals;
	mapping(uint8 => mapping(uint256 => bool)) private consumedParentDepositIndexes;
	mapping(uint8 => uint256[]) private proofConsumedCarriedDepositIndexesByOutcome;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkCarrySnapshotInitialized(uint256[3] snapshotCarryLeafCounts, uint256[3] inheritedCarryTotals, bytes32[3] inheritedNullifierRoots);
	event ForkContinuationResumed(uint256 resumedAt);
	event DepositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountToWithdraw, uint256 depositIndex);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);
	event LocalDepositAppended(
		uint256 indexed nodeId,
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount
	);
	event CarriedDepositClaimed(
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 sourceNodeId,
		bytes32 leafHash
	);

	modifier onlyOwner() {
		require(msg.sender == owner, 'only owner');
		_;
	}

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

	function initializeForkCarrySnapshot(
		bytes32[carryTreeMerkleMountainRangeMaxPeaks][3] memory snapshotCarryPeaksInput,
		uint256[3] memory snapshotCarryLeafCountsInput,
		uint256[3] memory snapshotCarryTotals,
		bytes32[3] memory snapshotNullifierRoots
	) public {
		require(msg.sender == address(securityPool), 'only security pool can initialize carry snapshot');
		require(forkContinuation, 'not fork continuation');
		require(!forkCarrySnapshotInitialized, 'carry snapshot already initialized');

		forkCarrySnapshotInitialized = true;
		inheritedNullifierRoots = snapshotNullifierRoots;
		currentNullifierRoots = snapshotNullifierRoots;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			snapshotCarryLeafCounts[outcomeIndex] = snapshotCarryLeafCountsInput[outcomeIndex];
			currentCarryLeafCounts[outcomeIndex] = snapshotCarryLeafCountsInput[outcomeIndex];
			for (uint256 peakIndex = 0; peakIndex < carryTreeMerkleMountainRangeMaxPeaks; peakIndex++) {
				bytes32 peak = snapshotCarryPeaksInput[outcomeIndex][peakIndex];
				snapshotCarryPeaks[outcomeIndex][peakIndex] = peak;
				currentCarryPeaks[outcomeIndex][peakIndex] = peak;
			}
			inheritedCarryTotals[outcomeIndex] = snapshotCarryTotals[outcomeIndex];
			inheritedCarryUnresolvedTotals[outcomeIndex] = snapshotCarryTotals[outcomeIndex];
		}

		emit ForkCarrySnapshotInitialized(snapshotCarryLeafCountsInput, snapshotCarryTotals, snapshotNullifierRoots);
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
		return _getOutcomeBalance(uint8(outcomeIndex));
	}

	function deposits(uint8 outcomeIndex, uint256 depositIndex) public view returns (address depositor, uint256 amount, uint256 cumulativeAmount) {
		CarryTreeDeposit storage deposit = outcomeState[outcomeIndex].deposits[depositIndex];
		return (deposit.depositor, deposit.amount, deposit.cumulativeAmount);
	}

	function getCarryRoot(BinaryOutcomes.BinaryOutcome outcome) external view returns (bytes32) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return _getCurrentCarryRoot(uint8(outcome));
	}

	function getCarryLeafCount(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return currentCarryLeafCounts[uint8(outcome)];
	}

	function getCarryPeaks(BinaryOutcomes.BinaryOutcome outcome) external view returns (bytes32[carryTreeMerkleMountainRangeMaxPeaks] memory peaks) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		peaks = currentCarryPeaks[uint8(outcome)];
	}

	function getCarryTotal(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		uint8 outcomeIndex = uint8(outcome);
		return inheritedCarryUnresolvedTotals[outcomeIndex] + localCarryUnresolvedTotals[outcomeIndex];
	}

	function getNullifierRoot(BinaryOutcomes.BinaryOutcome outcome) external view returns (bytes32) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return _getCurrentNullifierRoot(uint8(outcome));
	}

	function getBalances() public view returns (uint256[3] memory) {
		return [_getOutcomeBalance(0), _getOutcomeBalance(1), _getOutcomeBalance(2)];
	}

	function computeIterativeAttritionCost(uint256 timeSinceStart) public view returns (uint256) {
		uint256 startBondLocal = startBond;
		uint256 nonDecisionThresholdLocal = nonDecisionThreshold;
		require(timeSinceStart <= escalationTimeLength, 'Invalid time');
		if (timeSinceStart == 0) return startBondLocal;
		if (timeSinceStart == escalationTimeLength) return nonDecisionThresholdLocal;

		uint256 exponent = lnRatioScaled * timeSinceStart / escalationTimeLength;
		uint256 exponentPow2 = exponent / carryTreeLn2Scaled;
		uint256 exponentRemainder = exponent - exponentPow2 * carryTreeLn2Scaled;

		uint256 expScaled = carryTreeScale;
		uint256 term = exponentRemainder;
		expScaled += term;

		for (uint256 iteration = 2; iteration < carryTreeMaxExpIterations;) {
			term = term * exponentRemainder / (iteration * carryTreeScale);
			if (term == 0) break;
			expScaled += term;
			unchecked {
				++iteration;
			}
		}

		expScaled <<= exponentPow2;
		uint256 cost = startBondLocal * expScaled / carryTreeScale;
		return cost > nonDecisionThresholdLocal ? nonDecisionThresholdLocal : cost;
	}

	function computeTimeSinceStartFromAttritionCost(uint256 attritionCost) public view returns (uint256) {
		if (attritionCost <= startBond) return 0;
		if (attritionCost >= nonDecisionThreshold) return escalationTimeLength;

		uint256 lnCostRatioScaled = _computeLnRatioScaled(startBond, attritionCost);
		return lnCostRatioScaled * escalationTimeLength / lnRatioScaled;
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

	function getQuestionResolution() public view returns (BinaryOutcomes.BinaryOutcome outcome) {
		uint256 currentTotalCost = totalCost();
		uint8 invalidOver = _getOutcomeBalance(0) >= currentTotalCost ? 1 : 0;
		uint8 yesOver = _getOutcomeBalance(1) >= currentTotalCost ? 1 : 0;
		uint8 noOver = _getOutcomeBalance(2) >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return BinaryOutcomes.BinaryOutcome.None;
		if (_getOutcomeBalance(0) == 0 && _getOutcomeBalance(1) == 0 && _getOutcomeBalance(2) == 0) return BinaryOutcomes.BinaryOutcome.Invalid;
		if (_getOutcomeBalance(0) > _getOutcomeBalance(1) && _getOutcomeBalance(0) > _getOutcomeBalance(2)) return BinaryOutcomes.BinaryOutcome.Invalid;
		if (_getOutcomeBalance(1) > _getOutcomeBalance(0) && _getOutcomeBalance(1) > _getOutcomeBalance(2)) return BinaryOutcomes.BinaryOutcome.Yes;
		return BinaryOutcomes.BinaryOutcome.No;
	}

	function hasReachedNonDecision() public view returns (bool) {
		uint8 invalidOver = _getOutcomeBalance(0) >= nonDecisionThreshold ? 1 : 0;
		uint8 yesOver = _getOutcomeBalance(1) >= nonDecisionThreshold ? 1 : 0;
		uint8 noOver = _getOutcomeBalance(2) >= nonDecisionThreshold ? 1 : 0;
		return invalidOver + yesOver + noOver >= 2;
	}

	function getBindingCapital() public view returns (uint256) {
		if (
			(_getOutcomeBalance(0) >= _getOutcomeBalance(1) && _getOutcomeBalance(0) <= _getOutcomeBalance(2)) ||
			(_getOutcomeBalance(0) >= _getOutcomeBalance(2) && _getOutcomeBalance(0) <= _getOutcomeBalance(1))
		) {
			return _getOutcomeBalance(0);
		}
		if (
			(_getOutcomeBalance(1) >= _getOutcomeBalance(0) && _getOutcomeBalance(1) <= _getOutcomeBalance(2)) ||
			(_getOutcomeBalance(1) >= _getOutcomeBalance(2) && _getOutcomeBalance(1) <= _getOutcomeBalance(0))
		) {
			return _getOutcomeBalance(1);
		}
		return _getOutcomeBalance(2);
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) public returns (uint256 depositAmount) {
		require(nonDecisionTimestamp == 0, 'System has already reached a non-decision');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'System has already timed out');
		require(_getOutcomeBalance(uint8(outcome)) < nonDecisionThreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit');
		uint256 outcomeIndex = uint256(outcome);
		CarryTreeOutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		uint256 currentBalance = _getOutcomeBalance(uint8(outcome));
		uint256 room = nonDecisionThreshold - currentBalance;
		uint256 effectiveDeposit = amount > room ? room : amount;
		uint256 newBalance = currentBalance + effectiveDeposit;

		uint256 invalidBalance = _getOutcomeBalance(0);
		uint256 yesBalance = _getOutcomeBalance(1);
		uint256 noBalance = _getOutcomeBalance(2);
		uint256 maxBalance = invalidBalance > yesBalance ? (invalidBalance > noBalance ? invalidBalance : noBalance) : (yesBalance > noBalance ? yesBalance : noBalance);

		bool otherHasMax = outcomeIndex == 0 ? (yesBalance == maxBalance || noBalance == maxBalance) :
			outcomeIndex == 1 ? (invalidBalance == maxBalance || noBalance == maxBalance) :
			(invalidBalance == maxBalance || yesBalance == maxBalance);
		if (newBalance == maxBalance && otherHasMax && maxBalance < nonDecisionThreshold) {
			effectiveDeposit -= 1;
			require(effectiveDeposit >= startBond, 'tie adjustment would break min deposit');
			newBalance = currentBalance + effectiveDeposit;
		}

		selectedOutcomeState.balance += effectiveDeposit;
		depositAmount = effectiveDeposit;

		CarryTreeDeposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = newBalance;
		selectedOutcomeState.deposits.push(deposit);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		CarryTreeNode storage node = carryNodes[nodeId];
		node.parentNodeId = localHeadNodeIds[outcomeIndex];
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = depositAmount;
		node.parentDepositIndex = stableParentDepositIndex;
		node.cumulativeAmount = deposit.cumulativeAmount;
		localHeadNodeIds[outcomeIndex] = nodeId;
		localCarryUnresolvedTotals[outcomeIndex] += depositAmount;
		_appendCarriedLeafToMerkleMountainRange(
			uint8(outcome),
			CarryTreeMerkleMountainRange.hashLeaf(depositor, outcome, depositAmount, stableParentDepositIndex, deposit.cumulativeAmount, nodeId)
		);
		emit LocalDepositAppended(nodeId, outcome, depositor, depositAmount, stableParentDepositIndex, deposit.cumulativeAmount);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, depositIndex, deposit.cumulativeAmount);
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
		CarryTreeOutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(uint8(outcome), depositIndex, deposit.amount);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 depositStart = deposit.cumulativeAmount - deposit.amount;
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / carryTreeExcessRewardWindowDivisor;
		uint256 winningOutcomeBalance = _getOutcomeBalance(uint8(outcome));
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
		uint8 outcomeIndex = uint8(outcome);
		require(depositIndex <= type(uint128).max, 'carry exports require proofs');
		CarryTreeOutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(outcomeIndex, depositIndex, deposit.amount);
		depositor = deposit.depositor;
		amount = deposit.amount;
		parentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
	}

	function withdrawCarriedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		CarriedDepositProof calldata proof
	) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmount = proof.amount;
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		uint256 depositStart = proof.cumulativeAmount - proof.amount;
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / carryTreeExcessRewardWindowDivisor;
		uint256 winningOutcomeBalance = _getOutcomeBalance(outcomeIndex);
		uint256 rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount;
		uint256 burnAmount;
		if (rewardEligiblePrincipalAmount == 0) {
			amountToWithdraw = originalDepositAmount;
		} else {
			uint256 eligibleEndAmount = proof.cumulativeAmount < rewardEligibleCapAmount ? proof.cumulativeAmount : rewardEligibleCapAmount;
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

	function forfeitCarriedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		CarriedDepositProof calldata proof
	) public returns (address depositor, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		require(outcome != questionResolution, 'Winning deposits must withdraw');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmount = proof.amount;
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		emit WithdrawDeposit(depositor, outcome, 0, proof.parentDepositIndex);
	}

	function exportUnresolvedCarriedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		CarriedDepositProof calldata proof
	) public returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		depositor = proof.depositor;
		amount = proof.amount;
		parentDepositIndex = proof.parentDepositIndex;
	}

	function refundCanceledDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(securityPool.zoltar().getForkTime(securityPool.universeId()) > 0, 'Zoltar has not forked');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		CarryTreeOutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(uint8(outcome), depositIndex, deposit.amount);
		depositor = deposit.depositor;
		amountToWithdraw = deposit.amount;
		emit WithdrawDeposit(depositor, outcome, amountToWithdraw, depositIndex);
	}

	function getCarryLeafPageByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startIndex,
		uint256 numberOfEntries
	) external view returns (CarryTreeLeafView[] memory carryLeaves) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		CarryTreeLeafView[] memory orderedLeaves = _getCarryLeavesByOutcome(outcomeIndex);
		if (startIndex >= orderedLeaves.length || numberOfEntries == 0) return new CarryTreeLeafView[](0);
		uint256 endIndex = startIndex + numberOfEntries;
		if (endIndex > orderedLeaves.length) endIndex = orderedLeaves.length;
		carryLeaves = new CarryTreeLeafView[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			carryLeaves[index - startIndex] = orderedLeaves[index];
		}
	}

	function getProofConsumedCarriedDepositIndexesByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startIndex,
		uint256 numberOfEntries
	) external view returns (uint256[] memory parentDepositIndexes) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint256[] storage consumedIndexes = proofConsumedCarriedDepositIndexesByOutcome[uint8(outcome)];
		if (startIndex >= consumedIndexes.length || numberOfEntries == 0) return new uint256[](0);
		uint256 endIndex = startIndex + numberOfEntries;
		if (endIndex > consumedIndexes.length) endIndex = consumedIndexes.length;
		parentDepositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			parentDepositIndexes[index - startIndex] = consumedIndexes[index];
		}
	}

	function withdrawDeposit(uint256 depositIndex) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
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
		CarryTreeOutcomeState storage selectedOutcomeState = outcomeState[uint8(outcome)];
		require(depositIndex < selectedOutcomeState.deposits.length, 'Invalid deposit index');
		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(uint8(outcome), depositIndex, deposit.amount);
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
		CarryTreeDeposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		if (startIndex >= outcomeDeposits.length || scanCount == 0) return new uint256[](0);
		uint256 endIndex = startIndex + scanCount;
		if (endIndex > outcomeDeposits.length) {
			endIndex = outcomeDeposits.length;
		}

		uint256 matchCount = 0;
		for (uint256 index = startIndex; index < endIndex; index++) {
			CarryTreeDeposit storage deposit = outcomeDeposits[index];
			if (deposit.depositor == depositor && deposit.amount > 0) {
				matchCount += 1;
			}
		}

		depositIndexes = new uint256[](matchCount);
		uint256 writeIndex = 0;
		for (uint256 index = startIndex; index < endIndex; index++) {
			CarryTreeDeposit storage deposit = outcomeDeposits[index];
			if (deposit.depositor == depositor && deposit.amount > 0) {
				depositIndexes[writeIndex] = index;
				writeIndex += 1;
			}
		}
	}

	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (CarryTreeDeposit[] memory returnDeposits) {
		CarryTreeDeposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		uint256 iterateUntil = startIndex + numberOfEntries > outcomeDeposits.length ? outcomeDeposits.length : startIndex + numberOfEntries;
		if (iterateUntil <= startIndex) return new CarryTreeDeposit[](0);
		returnDeposits = new CarryTreeDeposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			returnDeposits[index - startIndex] = outcomeDeposits[index];
		}
	}

	function getNode(
		uint256 nodeId
	)
		external
		view
		returns (
			uint256 parentNodeId,
			address depositor,
			BinaryOutcomes.BinaryOutcome outcome,
			uint256 amount,
			uint256 parentDepositIndex,
			uint256 cumulativeAmount
		)
	{
		CarryTreeNode storage node = carryNodes[nodeId];
		require(node.depositor != address(0x0), 'unknown node');
		parentNodeId = node.parentNodeId;
		depositor = node.depositor;
		outcome = node.outcome;
		amount = node.amount;
		parentDepositIndex = node.parentDepositIndex;
		cumulativeAmount = node.cumulativeAmount;
	}

	function previewLeafHash(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount,
		uint256 sourceNodeId
	) external pure returns (bytes32) {
		return CarryTreeMerkleMountainRange.hashLeaf(depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId);
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
		uint256 z = diff * carryTreeScale / sum;
		if (z == 0) return 0;
		return log2Count * carryTreeLn2Scaled + 2 * _computeAtanhScaled(z);
	}

	function _computeAtanhScaled(uint256 z) internal pure returns (uint256 atanhScaled) {
		uint256 z2 = z * z / carryTreeScale;
		uint256 term = z;
		atanhScaled = term;

		for (uint256 iteration = 1; iteration < carryTreeMaxAtanhIterations;) {
			term = term * z2 * (2 * iteration - 1) / ((2 * iteration + 1) * carryTreeScale);
			if (term == 0) break;
			atanhScaled += term;
			unchecked {
				++iteration;
			}
		}
	}

	function _getOutcomeBalance(uint8 outcomeIndex) private view returns (uint256) {
		return outcomeState[outcomeIndex].balance + inheritedCarryTotals[outcomeIndex];
	}

	function _appendCarriedLeafToMerkleMountainRange(uint8 outcomeIndex, bytes32 leafHash) private {
		uint256 leafCount = currentCarryLeafCounts[outcomeIndex];
		uint256 peakIndex = 0;
		bytes32 carryHash = leafHash;

		while (((leafCount >> peakIndex) & 1) == 1) {
			carryHash = CarryTreeMerkleMountainRange.hashParent(currentCarryPeaks[outcomeIndex][peakIndex], carryHash);
			delete currentCarryPeaks[outcomeIndex][peakIndex];
			peakIndex += 1;
		}

		require(peakIndex < carryTreeMerkleMountainRangeMaxPeaks, 'Merkle Mountain Range peak overflow');
		currentCarryPeaks[outcomeIndex][peakIndex] = carryHash;
		currentCarryLeafCounts[outcomeIndex] = leafCount + 1;
	}

	function _bagCarryPeaks(bytes32[carryTreeMerkleMountainRangeMaxPeaks] memory peakHashes, uint256 leafCount) private pure returns (bytes32) {
		if (leafCount == 0) return bytes32(0);

		uint256 peakCount = 0;
		for (uint256 peakIndex = 0; peakIndex < carryTreeMerkleMountainRangeMaxPeaks; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peakCount += 1;
			}
		}

		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		for (uint256 peakIndex = 0; peakIndex < carryTreeMerkleMountainRangeMaxPeaks; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peaks[writeIndex] = peakHashes[peakIndex];
				writeIndex += 1;
			}
		}

		return CarryTreeMerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function _getCurrentCarryRoot(uint8 outcomeIndex) private view returns (bytes32) {
		return _bagCarryPeaks(currentCarryPeaks[outcomeIndex], currentCarryLeafCounts[outcomeIndex]);
	}

	function _getCurrentNullifierRoot(uint8 outcomeIndex) private view returns (bytes32) {
		bytes32 root = currentNullifierRoots[outcomeIndex];
		if (root != bytes32(0)) return root;
		return _getEmptyNullifierRoot();
	}

	function _getEmptyNullifierRoot() private pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < carryTreeNullifierDepth; depth++) {
			root = CarryTreeMerkleMountainRange.hashParent(root, root);
		}
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private {
		bytes32 leafHash = _verifyCarriedDepositMerkleMountainRangeProof(outcomeIndex, proof);
		_verifyAndAdvanceNullifier(outcomeIndex, proof.parentDepositIndex, proof.nullifierSiblings);
		_consumeCarriedDeposit(outcomeIndex, proof.parentDepositIndex, proof.amount);
		emit CarriedDepositClaimed(BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.depositor, proof.amount, proof.parentDepositIndex, proof.sourceNodeId, leafHash);
	}

	function _verifyCarriedDepositMerkleMountainRangeProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private view returns (bytes32 leafHash) {
		uint256 leafCount = snapshotCarryLeafCounts[outcomeIndex];
		require(leafCount > 0, 'no inherited carry snapshot');
		require(proof.amount > 0, 'amount must be positive');
		leafHash = CarryTreeMerkleMountainRange.hashLeaf(proof.depositor, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.amount, proof.parentDepositIndex, proof.cumulativeAmount, proof.sourceNodeId);
		bytes32 computedRoot = _computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof.leafIndex, proof.merkleMountainRangePeakIndex, proof.merkleMountainRangeSiblings);
		require(computedRoot == _bagCarryPeaks(snapshotCarryPeaks[outcomeIndex], snapshotCarryLeafCounts[outcomeIndex]), 'invalid carry inclusion proof');
	}

	function _computeMerkleMountainRangeRootFromProof(
		bytes32 leafHash,
		uint256 leafCount,
		uint256 leafIndex,
		uint256 peakHeight,
		bytes32[] calldata siblings
	) private pure returns (bytes32) {
		require(((leafCount >> peakHeight) & 1) == 1, 'peak absent');
		require(peakHeight < carryTreeMerkleMountainRangeMaxPeaks, 'invalid peak height');
		require(leafIndex < (uint256(1) << peakHeight), 'leaf index out of range');

		bytes32 peakRoot = leafHash;
		for (uint256 level = 0; level < peakHeight; level++) {
			bytes32 siblingHash = siblings[level];
			if (((leafIndex >> level) & 1) == 0) {
				peakRoot = CarryTreeMerkleMountainRange.hashParent(peakRoot, siblingHash);
			} else {
				peakRoot = CarryTreeMerkleMountainRange.hashParent(siblingHash, peakRoot);
			}
		}

		uint256 peakCount = 0;
		for (uint256 index = 0; index < carryTreeMerkleMountainRangeMaxPeaks; index++) {
			if (((leafCount >> index) & 1) == 1) {
				peakCount += 1;
			}
		}
		require(siblings.length == peakHeight + peakCount - 1, 'invalid Merkle Mountain Range proof length');
		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		uint256 siblingIndex = peakHeight;
		for (uint256 index = 0; index < carryTreeMerkleMountainRangeMaxPeaks; index++) {
			if (((leafCount >> index) & 1) != 1) continue;
			if (index == peakHeight) {
				peaks[writeIndex] = peakRoot;
			} else {
				peaks[writeIndex] = siblings[siblingIndex];
				siblingIndex += 1;
			}
			writeIndex += 1;
		}
		return CarryTreeMerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function _verifyAndAdvanceNullifier(uint8 outcomeIndex, uint256 parentDepositIndex, bytes32[] calldata siblings) private {
		require(siblings.length == carryTreeNullifierDepth, 'invalid nullifier proof length');
		bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);
		bytes32 emptyRoot = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(0));
		require(emptyRoot == currentRoot, 'invalid nullifier proof');
		currentNullifierRoots[outcomeIndex] = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(uint256(1)));
		proofConsumedCarriedDepositIndexesByOutcome[outcomeIndex].push(parentDepositIndex);
	}

	function _computeNullifierRoot(uint256 parentDepositIndex, bytes32[] calldata siblings, bytes32 leafValue) private pure returns (bytes32 root) {
		root = leafValue;
		uint256 path = uint256(keccak256(abi.encode(parentDepositIndex)));
		for (uint256 depth = 0; depth < carryTreeNullifierDepth; depth++) {
			bytes32 siblingHash = siblings[depth];
			if (((path >> depth) & 1) == 0) {
				root = CarryTreeMerkleMountainRange.hashParent(root, siblingHash);
			} else {
				root = CarryTreeMerkleMountainRange.hashParent(siblingHash, root);
			}
		}
	}

	function _getStableLocalParentDepositIndex(uint256 depositIndex) private view returns (uint256) {
		return forkContinuation ? carryTreeForkContinuationLocalDepositIndexPrefix | depositIndex : depositIndex;
	}

	function _markLocalDepositConsumed(uint8 outcomeIndex, uint256 depositIndex, uint256 amount) private {
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		if (consumedParentDepositIndexes[outcomeIndex][stableParentDepositIndex]) return;
		consumedParentDepositIndexes[outcomeIndex][stableParentDepositIndex] = true;
		localCarryUnresolvedTotals[outcomeIndex] -= amount;
		_rebuildCurrentCarryState(outcomeIndex);
	}

	function _consumeCarriedDeposit(uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) private {
		require(!_isCarriedDepositConsumed(outcomeIndex, parentDepositIndex), 'deposit already settled');
		consumedParentDepositIndexes[outcomeIndex][parentDepositIndex] = true;
		inheritedCarryUnresolvedTotals[outcomeIndex] -= amount;
	}

	function _isCarriedDepositConsumed(uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (bool) {
		return consumedParentDepositIndexes[outcomeIndex][parentDepositIndex];
	}

	function _rebuildCurrentCarryState(uint8 outcomeIndex) private {
		currentCarryLeafCounts[outcomeIndex] = snapshotCarryLeafCounts[outcomeIndex];
		for (uint256 peakIndex = 0; peakIndex < carryTreeMerkleMountainRangeMaxPeaks; peakIndex++) {
			currentCarryPeaks[outcomeIndex][peakIndex] = snapshotCarryPeaks[outcomeIndex][peakIndex];
		}

		uint256 nodeId = localHeadNodeIds[outcomeIndex];
		uint256 unresolvedLeafCount = 0;
		while (nodeId != 0) {
			CarryTreeNode storage currentNode = carryNodes[nodeId];
			if (!consumedParentDepositIndexes[outcomeIndex][currentNode.parentDepositIndex]) {
				unresolvedLeafCount += 1;
			}
			nodeId = currentNode.parentNodeId;
		}

		uint256[] memory unresolvedNodeIds = new uint256[](unresolvedLeafCount);
		nodeId = localHeadNodeIds[outcomeIndex];
		uint256 writeIndex = unresolvedLeafCount;
		while (nodeId != 0) {
			CarryTreeNode storage currentNode = carryNodes[nodeId];
			if (!consumedParentDepositIndexes[outcomeIndex][currentNode.parentDepositIndex]) {
				writeIndex -= 1;
				unresolvedNodeIds[writeIndex] = nodeId;
			}
			nodeId = currentNode.parentNodeId;
		}

		for (uint256 unresolvedIndex = 0; unresolvedIndex < unresolvedLeafCount; unresolvedIndex++) {
			uint256 unresolvedNodeId = unresolvedNodeIds[unresolvedIndex];
			CarryTreeNode storage unresolvedNode = carryNodes[unresolvedNodeId];
			_appendCarriedLeafToMerkleMountainRange(
				outcomeIndex,
				CarryTreeMerkleMountainRange.hashLeaf(
					unresolvedNode.depositor,
					unresolvedNode.outcome,
					unresolvedNode.amount,
					unresolvedNode.parentDepositIndex,
					unresolvedNode.cumulativeAmount,
					unresolvedNodeId
				)
			);
		}
	}

	function _getCarryLeavesByOutcome(uint8 outcomeIndex) private view returns (CarryTreeLeafView[] memory carryLeaves) {
		uint256 nodeId = localHeadNodeIds[outcomeIndex];
		uint256 leafCount = 0;
		while (nodeId != 0) {
			CarryTreeNode storage currentNode = carryNodes[nodeId];
			if (!consumedParentDepositIndexes[outcomeIndex][currentNode.parentDepositIndex]) {
				leafCount += 1;
			}
			nodeId = currentNode.parentNodeId;
		}
		carryLeaves = new CarryTreeLeafView[](leafCount);
		uint256 writeIndex = 0;
		nodeId = localHeadNodeIds[outcomeIndex];
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (consumedParentDepositIndexes[outcomeIndex][storedNode.parentDepositIndex]) {
				nodeId = storedNode.parentNodeId;
				continue;
			}
			CarryTreeLeafView memory currentLeaf = CarryTreeLeafView({
				depositor: storedNode.depositor,
				amount: storedNode.amount,
				parentDepositIndex: storedNode.parentDepositIndex,
				cumulativeAmount: storedNode.cumulativeAmount,
				sourceNodeId: nodeId
			});
			uint256 insertIndex = writeIndex;
			while (insertIndex > 0 && _compareParentDepositIndexes(currentLeaf.parentDepositIndex, carryLeaves[insertIndex - 1].parentDepositIndex)) {
				carryLeaves[insertIndex] = carryLeaves[insertIndex - 1];
				insertIndex -= 1;
			}
			carryLeaves[insertIndex] = currentLeaf;
			writeIndex += 1;
			nodeId = storedNode.parentNodeId;
		}
	}

	function _compareParentDepositIndexes(uint256 leftParentDepositIndex, uint256 rightParentDepositIndex) private pure returns (bool) {
		if (leftParentDepositIndex == rightParentDepositIndex) return false;
		if (leftParentDepositIndex == type(uint256).max) return false;
		if (rightParentDepositIndex == type(uint256).max) return true;
		return leftParentDepositIndex < rightParentDepositIndex;
	}
}
