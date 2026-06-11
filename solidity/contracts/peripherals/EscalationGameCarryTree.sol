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

struct RegisteredCarriedClaim {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
	bool settled;
}

struct CarryTreeOutcomeState {
	// Total principal currently assigned to this outcome by local deposits placed directly in this escalation game.
	uint256 balance;
	// Local deposits placed directly in this escalation game, preserved in arrival order for payout ordering.
	CarryTreeDeposit[] deposits;
}

library CarryTreeMmr {
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
	// Previous unresolved node for this same outcome inside the same branch.
	uint256 parentNodeId;
	// Branch that owns this append-only node.
	uint256 branchId;
	// Whether this node is already treated as carried in the branch that created it.
	bool carriedInOwningBranch;
	address depositor;
	BinaryOutcomes.BinaryOutcome outcome;
	uint256 amount;
	// Stable ordering key inherited from the source escalation game.
	uint256 parentDepositIndex;
	// Prefix-position data needed for payout-order proofs.
	uint256 cumulativeAmount;
}

struct CarryTreeBranch {
	// Parent branch in the fork tree. Zero only for genesis.
	uint256 parentBranchId;
	// Timestamp when this branch snapshot was created.
	uint256 createdAt;
	// Optional node where this child branch forked from its parent lineage.
	uint256 forkedFromNodeId;
	// [outcomeIndex 0..2] => current append-only linked-list head for branch-local unresolved deposits.
	uint256[3] localHeadNodeIds;
	// [outcomeIndex 0..2] => appended carried leaf count for this branch's MMR.
	uint256[3] mmrLeafCounts;
	// [outcomeIndex 0..2][peakIndex] => append-only MMR peaks for carried deposits in this branch.
	bytes32[64][3] mmrPeaks;
	// [outcomeIndex 0..2] => total unresolved carryover principal active in this branch.
	uint256[3] carriedTotals;
	// [outcomeIndex 0..2] => remaining carried principal that can still be exported into descendants.
	uint256[3] carriedUnresolvedTotals;
	// [outcomeIndex 0..2] => unresolved principal created locally in this branch that descendants should inherit.
	uint256[3] localUnresolvedTotals;
}

struct CarriedDepositProof {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
	uint256 leafIndex;
	bytes32[] mmrSiblings;
	uint256 mmrPeakIndex;
	bytes32[] nullifierSiblings;
}

uint256 constant carryTreeEscalationTimeLength = 4233600; // 7 weeks
uint256 constant carryTreeScale = 1e6;
uint256 constant carryTreeLn2Scaled = 693147;
uint256 constant carryTreeMaxAtanhIterations = 16;
uint256 constant carryTreeMaxExpIterations = 16;
uint256 constant carryTreeExcessRewardWindowDivisor = 2;
uint256 constant carryTreeForkContinuationLocalDepositIndexPrefix = 1 << 255;
uint256 constant carryTreeMmrMaxPeaks = 64;
uint256 constant carryTreeNullifierDepth = 64;

// Alternative escalation game design:
// - includes the full local escalation-game feature surface from EscalationGame
// - adds a fork-branching carry tree for no-migration carryover
// - tracks append-only carried-deposit commitments as Merkle mountain ranges per branch/outcome
// - keeps the old external surface, but backs fork-carried state with branch/tree bookkeeping instead of the old imported-deposit storage model
contract EscalationGameCarryTree {
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
	mapping(uint256 => CarryTreeOutcomeState[3]) private branchOutcomeState;

	uint256 public genesisBranchId;
	uint256 public currentBranchId;
	uint256 public nextBranchId = 1;
	uint256 public nextNodeId = 1;
	bytes32[3] private inheritedCarryRoots;
	uint256[3] private inheritedCarryLeafCounts;
	bytes32[3] private inheritedNullifierRoots;
	bytes32[3] private currentNullifierRoots;

	mapping(uint256 => CarryTreeBranch) private carryBranches;
	mapping(uint256 => CarryTreeNode) private carryNodes;
	mapping(uint256 => mapping(uint8 => mapping(uint256 => RegisteredCarriedClaim))) private registeredCarriedClaims;
	mapping(uint256 => mapping(uint8 => uint256[])) private eagerImportedClaimOrder;
	mapping(uint256 => mapping(uint8 => mapping(address => uint256[]))) private unsettledRegisteredCarriedIndexesByDepositor;
	mapping(uint256 => mapping(uint8 => mapping(address => mapping(uint256 => uint256)))) private registeredCarriedIndexPosition;
	mapping(uint256 => mapping(uint8 => mapping(uint256 => bool))) private branchConsumedParentDepositIndexes;
	mapping(uint256 => mapping(uint8 => uint256[])) private proofConsumedCarriedDepositIndexesByBranch;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkCarrySnapshotInitialized(bytes32[3] inheritedCarryRoots, uint256[3] inheritedCarryLeafCounts, uint256[3] inheritedCarryTotals, bytes32[3] inheritedNullifierRoots);
	event ForkContinuationResumed(uint256 resumedAt);
	event DepositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountToWithdraw, uint256 depositIndex);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);
	event ImportedForkDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 parentDepositIndex, uint256 amount);
	event BranchActivated(uint256 indexed branchId);
	event CarriedClaimRegistered(
		uint256 indexed branchId,
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 parentDepositIndex,
		uint256 amount,
		uint256 cumulativeAmount,
		uint256 sourceNodeId,
		bytes32 leafHash
	);
	event BranchCreated(uint256 indexed branchId, uint256 indexed parentBranchId, uint256 forkedFromNodeId);
	event LocalDepositAppended(
		uint256 indexed branchId,
		uint256 indexed nodeId,
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount
	);
	event BranchRootCommitted(uint256 indexed branchId, BinaryOutcomes.BinaryOutcome outcome, bytes32 carriedRoot, uint256 carriedTotal, uint256 localHeadNodeId);
	event CarriedDepositClaimed(
		uint256 indexed branchId,
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
		genesisBranchId = nextBranchId;
		currentBranchId = genesisBranchId;
		nextBranchId += 1;
		carryBranches[genesisBranchId].createdAt = block.timestamp;
		emit BranchCreated(genesisBranchId, 0, 0);
	}

	function activateBranch(uint256 branchId) external onlyOwner {
		_requireKnownBranch(branchId);
		currentBranchId = branchId;
		emit BranchActivated(branchId);
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
		require(elapsedAtFork <= carryTreeEscalationTimeLength, 'Invalid time');
		forkContinuation = true;
		forkContinuationResumed = false;
		forkElapsedAtStart = elapsedAtFork;
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = _computeLnRatioScaled(_startBond, _nonDecisionThreshold);
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function initializeForkCarrySnapshot(
		bytes32[3] memory snapshotCarryRoots,
		uint256[3] memory snapshotCarryLeafCounts,
		uint256[3] memory snapshotCarryTotals,
		bytes32[3] memory snapshotNullifierRoots
	) public {
		require(msg.sender == address(securityPool), 'only security pool can initialize carry snapshot');
		require(forkContinuation, 'not fork continuation');
		require(!forkCarrySnapshotInitialized, 'carry snapshot already initialized');

		forkCarrySnapshotInitialized = true;
		inheritedCarryRoots = snapshotCarryRoots;
		inheritedCarryLeafCounts = snapshotCarryLeafCounts;
		inheritedNullifierRoots = snapshotNullifierRoots;
		currentNullifierRoots = snapshotNullifierRoots;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			carryBranches[currentBranchId].carriedTotals[outcomeIndex] = snapshotCarryTotals[outcomeIndex];
			carryBranches[currentBranchId].carriedUnresolvedTotals[outcomeIndex] = snapshotCarryTotals[outcomeIndex];
		}

		emit ForkCarrySnapshotInitialized(snapshotCarryRoots, snapshotCarryLeafCounts, snapshotCarryTotals, snapshotNullifierRoots);
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
		CarryTreeDeposit storage deposit = branchOutcomeState[currentBranchId][outcomeIndex].deposits[depositIndex];
		return (deposit.depositor, deposit.amount, deposit.cumulativeAmount);
	}

	function importedDeposits(uint256 outcomeIndex, uint256 parentDepositIndex) public view returns (address depositor, uint256 amount, uint256 cumulativeAmount, bool settled) {
		RegisteredCarriedClaim storage registeredClaim = registeredCarriedClaims[currentBranchId][uint8(outcomeIndex)][parentDepositIndex];
		return (registeredClaim.depositor, registeredClaim.amount, registeredClaim.cumulativeAmount, registeredClaim.settled);
	}

	function importedBalances(uint256 outcomeIndex) public view returns (uint256) {
		return carryBranches[currentBranchId].carriedTotals[outcomeIndex];
	}

	function getCarryRoot(BinaryOutcomes.BinaryOutcome outcome) external view returns (bytes32) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return _getCurrentCarryRoot(uint8(outcome));
	}

	function getCarryLeafCount(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return inheritedCarryLeafCounts[uint8(outcome)] + carryBranches[currentBranchId].mmrLeafCounts[uint8(outcome)];
	}

	function getCarryTotal(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		uint8 outcomeIndex = uint8(outcome);
		return carryBranches[currentBranchId].carriedUnresolvedTotals[outcomeIndex] + carryBranches[currentBranchId].localUnresolvedTotals[outcomeIndex];
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
		require(timeSinceStart <= carryTreeEscalationTimeLength, 'Invalid time');
		if (timeSinceStart == 0) return startBondLocal;
		if (timeSinceStart == carryTreeEscalationTimeLength) return nonDecisionThresholdLocal;

		uint256 exponent = lnRatioScaled * timeSinceStart / carryTreeEscalationTimeLength;
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
		if (attritionCost >= nonDecisionThreshold) return carryTreeEscalationTimeLength;

		uint256 lnCostRatioScaled = _computeLnRatioScaled(startBond, attritionCost);
		return lnCostRatioScaled * carryTreeEscalationTimeLength / lnRatioScaled;
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
			if (forkElapsed >= carryTreeEscalationTimeLength) return nonDecisionThreshold;
			return computeIterativeAttritionCost(forkElapsed);
		}
		if (activationTime >= block.timestamp) return 0;
		uint256 elapsedSinceActivation = block.timestamp - activationTime;
		if (elapsedSinceActivation >= carryTreeEscalationTimeLength) return nonDecisionThreshold;
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
		CarryTreeOutcomeState storage selectedOutcomeState = branchOutcomeState[currentBranchId][outcomeIndex];
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
		CarryTreeBranch storage branch = carryBranches[currentBranchId];
		CarryTreeNode storage node = carryNodes[nodeId];
		node.parentNodeId = branch.localHeadNodeIds[outcomeIndex];
		node.branchId = currentBranchId;
		node.carriedInOwningBranch = false;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = depositAmount;
		node.parentDepositIndex = stableParentDepositIndex;
		node.cumulativeAmount = deposit.cumulativeAmount;
		branch.localHeadNodeIds[outcomeIndex] = nodeId;
		branch.localUnresolvedTotals[outcomeIndex] += depositAmount;
		_appendCarriedLeafToMmr(
			currentBranchId,
			uint8(outcome),
			CarryTreeMmr.hashLeaf(depositor, outcome, depositAmount, stableParentDepositIndex, deposit.cumulativeAmount, nodeId)
		);
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
		CarryTreeOutcomeState storage selectedOutcomeState = branchOutcomeState[currentBranchId][uint8(outcome)];
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
		CarryTreeOutcomeState storage selectedOutcomeState = branchOutcomeState[currentBranchId][outcomeIndex];
		if (depositIndex > type(uint128).max) {
			uint256 carriedDepositIndex = ~depositIndex;
			RegisteredCarriedClaim storage registeredClaim = registeredCarriedClaims[currentBranchId][outcomeIndex][carriedDepositIndex];
			if (registeredClaim.depositor != address(0x0)) {
				require(!registeredClaim.settled, 'deposit already settled');
				registeredClaim.settled = true;
				depositor = registeredClaim.depositor;
				amount = registeredClaim.amount;
				parentDepositIndex = carriedDepositIndex;
				_removeUnsettledRegisteredCarriedClaim(currentBranchId, outcomeIndex, depositor, carriedDepositIndex);
				_consumeCarriedDeposit(currentBranchId, outcomeIndex, carriedDepositIndex, amount);
				return (depositor, amount, parentDepositIndex);
			}

			CarryTreeNode memory carriedNode = _requireAvailableCarriedNode(currentBranchId, outcomeIndex, carriedDepositIndex);
			depositor = carriedNode.depositor;
			amount = carriedNode.amount;
			parentDepositIndex = carriedDepositIndex;
			_consumeCarriedDeposit(currentBranchId, outcomeIndex, carriedDepositIndex, amount);
			return (depositor, amount, parentDepositIndex);
		}

		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(outcomeIndex, depositIndex, deposit.amount);
		depositor = deposit.depositor;
		amount = deposit.amount;
		parentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
	}

	function registerCarriedDepositClaim(
		uint256 branchId,
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 parentDepositIndex,
		uint256 amount,
		uint256 cumulativeAmount,
		uint256 sourceNodeId,
		bytes32[] calldata proof
	) public returns (bytes32 leafHash) {
		branchId;
		depositor;
		outcome;
		parentDepositIndex;
		amount;
		cumulativeAmount;
		sourceNodeId;
		proof;
		revert('MMR proof carry path removed');
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
		CarryTreeBranch storage branch = carryBranches[currentBranchId];
		RegisteredCarriedClaim storage registeredClaim = registeredCarriedClaims[currentBranchId][outcomeIndex][parentDepositIndex];
		require(registeredClaim.depositor == address(0x0), 'deposit already imported');

		uint256 cumulativeAmount = _insertRegisteredCarriedClaim(currentBranchId, outcomeIndex, parentDepositIndex, amount);
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;

		CarryTreeNode storage node = carryNodes[nodeId];
		node.parentNodeId = branch.localHeadNodeIds[outcomeIndex];
		node.branchId = currentBranchId;
		node.carriedInOwningBranch = true;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = amount;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmount = cumulativeAmount + amount;

		branch.localHeadNodeIds[outcomeIndex] = nodeId;
		branch.carriedTotals[outcomeIndex] += amount;
		branch.carriedUnresolvedTotals[outcomeIndex] += amount;
		_appendCarriedLeafToMmr(
			currentBranchId,
			outcomeIndex,
			CarryTreeMmr.hashLeaf(depositor, outcome, amount, parentDepositIndex, cumulativeAmount + amount, nodeId)
		);

		registeredClaim.depositor = depositor;
		registeredClaim.amount = amount;
		registeredClaim.cumulativeAmount = cumulativeAmount;
		registeredClaim.sourceNodeId = nodeId;
		unsettledRegisteredCarriedIndexesByDepositor[currentBranchId][outcomeIndex][depositor].push(parentDepositIndex);
		registeredCarriedIndexPosition[currentBranchId][outcomeIndex][depositor][parentDepositIndex] = unsettledRegisteredCarriedIndexesByDepositor[currentBranchId][outcomeIndex][depositor].length;

		emit LocalDepositAppended(currentBranchId, nodeId, outcome, depositor, amount, parentDepositIndex, cumulativeAmount);
		emit ImportedForkDeposit(depositor, outcome, parentDepositIndex, amount);
	}

	function withdrawImportedForkDeposit(uint256 parentDepositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker can withdraw'
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		RegisteredCarriedClaim storage registeredClaim = registeredCarriedClaims[currentBranchId][outcomeIndex][parentDepositIndex];
		uint256 depositStart;
		if (registeredClaim.depositor != address(0x0)) {
			require(!registeredClaim.settled, 'deposit already settled');
			registeredClaim.settled = true;
			depositor = registeredClaim.depositor;
			originalDepositAmount = registeredClaim.amount;
			_removeUnsettledRegisteredCarriedClaim(currentBranchId, outcomeIndex, depositor, parentDepositIndex);
			depositStart = registeredClaim.cumulativeAmount;
		} else {
			CarryTreeNode memory carriedNode = _requireAvailableCarriedNode(currentBranchId, outcomeIndex, parentDepositIndex);
			depositor = carriedNode.depositor;
			originalDepositAmount = carriedNode.amount;
			depositStart = _getAvailableCarriedPrefixAmount(currentBranchId, outcomeIndex, parentDepositIndex);
		}
		_consumeCarriedDeposit(currentBranchId, outcomeIndex, parentDepositIndex, originalDepositAmount);
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / carryTreeExcessRewardWindowDivisor;
		uint256 winningOutcomeBalance = _getOutcomeBalance(outcomeIndex);
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
		RegisteredCarriedClaim storage registeredClaim = registeredCarriedClaims[currentBranchId][outcomeIndex][parentDepositIndex];
		if (registeredClaim.depositor != address(0x0)) {
			require(!registeredClaim.settled, 'deposit already settled');
			registeredClaim.settled = true;
			depositor = registeredClaim.depositor;
			originalDepositAmount = registeredClaim.amount;
			_removeUnsettledRegisteredCarriedClaim(currentBranchId, outcomeIndex, depositor, parentDepositIndex);
		} else {
			CarryTreeNode memory carriedNode = _requireAvailableCarriedNode(currentBranchId, outcomeIndex, parentDepositIndex);
			depositor = carriedNode.depositor;
			originalDepositAmount = carriedNode.amount;
		}
		_consumeCarriedDeposit(currentBranchId, outcomeIndex, parentDepositIndex, originalDepositAmount);
		emit WithdrawDeposit(depositor, outcome, 0, parentDepositIndex);
	}

	function refundCanceledDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(securityPool.zoltar().getForkTime(securityPool.universeId()) > 0, 'Zoltar has not forked');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		CarryTreeOutcomeState storage selectedOutcomeState = branchOutcomeState[currentBranchId][uint8(outcome)];
		CarryTreeDeposit memory deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(uint8(outcome), depositIndex, deposit.amount);
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
		depositIndexes = _getAvailableCarriedDepositIndexesByOutcomeAndDepositor(currentBranchId, uint8(outcome), depositor, startIndex, scanCount);
	}

	function getCarryLeafPageByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startIndex,
		uint256 numberOfEntries
	) external view returns (CarryTreeLeafView[] memory carryLeaves) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome: None');
		uint8 outcomeIndex = uint8(outcome);
		CarryTreeLeafView[] memory orderedLeaves = _getCarryLeavesByOutcome(currentBranchId, outcomeIndex);
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
		uint256[] storage consumedIndexes = proofConsumedCarriedDepositIndexesByBranch[currentBranchId][uint8(outcome)];
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
		CarryTreeOutcomeState storage selectedOutcomeState = branchOutcomeState[currentBranchId][uint8(outcome)];
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
		CarryTreeDeposit[] storage outcomeDeposits = branchOutcomeState[currentBranchId][uint8(outcome)].deposits;
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
		CarryTreeDeposit[] storage outcomeDeposits = branchOutcomeState[currentBranchId][uint8(outcome)].deposits;
		uint256 iterateUntil = startIndex + numberOfEntries > outcomeDeposits.length ? outcomeDeposits.length : startIndex + numberOfEntries;
		if (iterateUntil <= startIndex) return new CarryTreeDeposit[](0);
		returnDeposits = new CarryTreeDeposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			returnDeposits[index - startIndex] = outcomeDeposits[index];
		}
	}

	function branchFromFork(uint256 parentBranchId, uint256 forkedFromNodeId) external onlyOwner returns (uint256 branchId) {
		_requireKnownBranch(parentBranchId);
		branchId = nextBranchId;
		nextBranchId += 1;

		CarryTreeBranch storage parentBranch = carryBranches[parentBranchId];
		CarryTreeBranch storage childBranch = carryBranches[branchId];
		childBranch.parentBranchId = parentBranchId;
		childBranch.createdAt = block.timestamp;
		childBranch.forkedFromNodeId = forkedFromNodeId;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			childBranch.localHeadNodeIds[outcomeIndex] = parentBranch.localHeadNodeIds[outcomeIndex];
			childBranch.carriedTotals[outcomeIndex] = parentBranch.carriedUnresolvedTotals[outcomeIndex] + parentBranch.localUnresolvedTotals[outcomeIndex];
			childBranch.carriedUnresolvedTotals[outcomeIndex] = childBranch.carriedTotals[outcomeIndex];
			childBranch.mmrLeafCounts[outcomeIndex] = parentBranch.mmrLeafCounts[outcomeIndex];
			for (uint256 peakIndex = 0; peakIndex < carryTreeMmrMaxPeaks; peakIndex++) {
				childBranch.mmrPeaks[outcomeIndex][peakIndex] = parentBranch.mmrPeaks[outcomeIndex][peakIndex];
			}
		}

		emit BranchCreated(branchId, parentBranchId, forkedFromNodeId);
	}

	function appendLocalDeposit(
		uint256 branchId,
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount
	) external onlyOwner returns (uint256 nodeId, bytes32 leafHash) {
		_requireKnownBranch(branchId);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		require(amount > 0, 'amount must be positive');

		uint8 outcomeIndex = uint8(outcome);
		CarryTreeBranch storage branch = carryBranches[branchId];
		nodeId = nextNodeId;
		nextNodeId += 1;

		CarryTreeNode storage node = carryNodes[nodeId];
		node.parentNodeId = branch.localHeadNodeIds[outcomeIndex];
		node.branchId = branchId;
		node.carriedInOwningBranch = true;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = amount;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmount = cumulativeAmount;

		branch.localHeadNodeIds[outcomeIndex] = nodeId;
		branch.carriedTotals[outcomeIndex] += amount;
		branch.carriedUnresolvedTotals[outcomeIndex] += amount;
		leafHash = CarryTreeMmr.hashLeaf(depositor, outcome, amount, parentDepositIndex, cumulativeAmount, nodeId);
		_appendCarriedLeafToMmr(branchId, outcomeIndex, leafHash);

		emit LocalDepositAppended(branchId, nodeId, outcome, depositor, amount, parentDepositIndex, cumulativeAmount);
	}

	function commitBranchOutcomeRoot(
		uint256 branchId,
		BinaryOutcomes.BinaryOutcome outcome,
		bytes32 carriedRoot,
		uint256 carriedTotal,
		uint256 localHeadNodeId
	) external onlyOwner {
		branchId;
		outcome;
		carriedRoot;
		carriedTotal;
		localHeadNodeId;
		revert('manual MMR root commits removed');
	}

	function claimCarriedDeposit(
		uint256 branchId,
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount,
		uint256 sourceNodeId,
		bytes32[] calldata proof
	) external returns (bytes32 leafHash) {
		branchId;
		depositor;
		outcome;
		amount;
		parentDepositIndex;
		cumulativeAmount;
		sourceNodeId;
		proof;
		revert('MMR proof carry path removed');
	}

	function getBranch(
		uint256 branchId
	)
		external
		view
		returns (
			uint256 parentBranchId,
			uint256 createdAt,
			uint256 forkedFromNodeId,
		uint256[3] memory localHeadNodeIds,
		bytes32[3] memory carriedRoots,
		uint256[3] memory carriedTotals,
			uint256[3] memory carriedUnresolvedTotals,
			uint256[3] memory localUnresolvedTotals
		)
	{
		_requireKnownBranch(branchId);
		CarryTreeBranch storage branch = carryBranches[branchId];
		parentBranchId = branch.parentBranchId;
		createdAt = branch.createdAt;
		forkedFromNodeId = branch.forkedFromNodeId;
		localHeadNodeIds = branch.localHeadNodeIds;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			carriedRoots[outcomeIndex] = _getBranchCarryRoot(branchId, uint8(outcomeIndex));
		}
		carriedTotals = branch.carriedTotals;
		carriedUnresolvedTotals = branch.carriedUnresolvedTotals;
		localUnresolvedTotals = branch.localUnresolvedTotals;
	}

	function getBranchCarriedRoot(uint256 branchId, BinaryOutcomes.BinaryOutcome outcome) external view returns (bytes32) {
		_requireKnownBranch(branchId);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return _getBranchCarryRoot(branchId, uint8(outcome));
	}

	function getBranchCarriedTotal(uint256 branchId, BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		_requireKnownBranch(branchId);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return carryBranches[branchId].carriedTotals[uint8(outcome)];
	}

	function getBranchLocalHeadNodeId(uint256 branchId, BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		_requireKnownBranch(branchId);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid outcome');
		return carryBranches[branchId].localHeadNodeIds[uint8(outcome)];
	}

	function getNode(
		uint256 nodeId
	)
		external
		view
		returns (
			uint256 parentNodeId,
			uint256 branchId,
			address depositor,
			BinaryOutcomes.BinaryOutcome outcome,
			uint256 amount,
			uint256 parentDepositIndex,
			uint256 cumulativeAmount
		)
	{
		CarryTreeNode storage node = carryNodes[nodeId];
		require(node.branchId != 0, 'unknown node');
		parentNodeId = node.parentNodeId;
		branchId = node.branchId;
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
		return CarryTreeMmr.hashLeaf(depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId);
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
		return branchOutcomeState[currentBranchId][outcomeIndex].balance + carryBranches[currentBranchId].carriedTotals[outcomeIndex];
	}

	function _appendCarriedLeafToMmr(uint256 branchId, uint8 outcomeIndex, bytes32 leafHash) private {
		CarryTreeBranch storage branch = carryBranches[branchId];
		uint256 leafCount = branch.mmrLeafCounts[outcomeIndex];
		uint256 peakIndex = 0;
		bytes32 carryHash = leafHash;

		while (((leafCount >> peakIndex) & 1) == 1) {
			carryHash = CarryTreeMmr.hashParent(branch.mmrPeaks[outcomeIndex][peakIndex], carryHash);
			delete branch.mmrPeaks[outcomeIndex][peakIndex];
			peakIndex += 1;
		}

		require(peakIndex < carryTreeMmrMaxPeaks, 'MMR peak overflow');
		branch.mmrPeaks[outcomeIndex][peakIndex] = carryHash;
		branch.mmrLeafCounts[outcomeIndex] = leafCount + 1;
	}

	function _getBranchCarryRoot(uint256 branchId, uint8 outcomeIndex) private view returns (bytes32) {
		CarryTreeBranch storage branch = carryBranches[branchId];
		uint256 leafCount = branch.mmrLeafCounts[outcomeIndex];
		if (leafCount == 0) return bytes32(0);

		uint256 peakCount = 0;
		for (uint256 peakIndex = 0; peakIndex < carryTreeMmrMaxPeaks; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peakCount += 1;
			}
		}

		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		for (uint256 peakIndex = 0; peakIndex < carryTreeMmrMaxPeaks; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peaks[writeIndex] = branch.mmrPeaks[outcomeIndex][peakIndex];
				writeIndex += 1;
			}
		}

		return CarryTreeMmr.bagPeaks(peaks, peakCount);
	}

	function _getCurrentCarryRoot(uint8 outcomeIndex) private view returns (bytes32) {
		bytes32 inheritedRoot = inheritedCarryRoots[outcomeIndex];
		bytes32 localRoot = _getBranchCarryRoot(currentBranchId, outcomeIndex);
		if (inheritedRoot == bytes32(0)) return localRoot;
		if (localRoot == bytes32(0)) return inheritedRoot;
		bytes32[] memory peaks = new bytes32[](2);
		peaks[0] = inheritedRoot;
		peaks[1] = localRoot;
		return CarryTreeMmr.bagPeaks(peaks, 2);
	}

	function _getCurrentNullifierRoot(uint8 outcomeIndex) private view returns (bytes32) {
		bytes32 root = currentNullifierRoots[outcomeIndex];
		if (root != bytes32(0)) return root;
		return _getEmptyNullifierRoot();
	}

	function _getEmptyNullifierRoot() private pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < carryTreeNullifierDepth; depth++) {
			root = CarryTreeMmr.hashParent(root, root);
		}
	}

	function _requireKnownBranch(uint256 branchId) private view {
		require(branchId >= genesisBranchId && branchId < nextBranchId, 'unknown branch');
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private {
		bytes32 leafHash = _verifyCarriedDepositMmrProof(outcomeIndex, proof);
		_verifyAndAdvanceNullifier(outcomeIndex, proof.parentDepositIndex, proof.nullifierSiblings);
		_consumeCarriedDeposit(currentBranchId, outcomeIndex, proof.parentDepositIndex, proof.amount);
		emit CarriedDepositClaimed(currentBranchId, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.depositor, proof.amount, proof.parentDepositIndex, proof.sourceNodeId, leafHash);
	}

	function _verifyCarriedDepositMmrProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private view returns (bytes32 leafHash) {
		uint256 leafCount = inheritedCarryLeafCounts[outcomeIndex];
		require(leafCount > 0, 'no inherited carry snapshot');
		require(proof.amount > 0, 'amount must be positive');
		leafHash = CarryTreeMmr.hashLeaf(proof.depositor, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.amount, proof.parentDepositIndex, proof.cumulativeAmount, proof.sourceNodeId);
		bytes32 computedRoot = _computeMmrRootFromProof(leafHash, leafCount, proof.leafIndex, proof.mmrPeakIndex, proof.mmrSiblings);
		require(computedRoot == inheritedCarryRoots[outcomeIndex], 'invalid carry inclusion proof');
	}

	function _computeMmrRootFromProof(
		bytes32 leafHash,
		uint256 leafCount,
		uint256 leafIndex,
		uint256 peakHeight,
		bytes32[] calldata siblings
	) private pure returns (bytes32) {
		require(((leafCount >> peakHeight) & 1) == 1, 'peak absent');
		require(peakHeight < carryTreeMmrMaxPeaks, 'invalid peak height');
		require(leafIndex < (uint256(1) << peakHeight), 'leaf index out of range');

		bytes32 peakRoot = leafHash;
		for (uint256 level = 0; level < peakHeight; level++) {
			bytes32 siblingHash = siblings[level];
			if (((leafIndex >> level) & 1) == 0) {
				peakRoot = CarryTreeMmr.hashParent(peakRoot, siblingHash);
			} else {
				peakRoot = CarryTreeMmr.hashParent(siblingHash, peakRoot);
			}
		}

		uint256 peakCount = 0;
		for (uint256 index = 0; index < carryTreeMmrMaxPeaks; index++) {
			if (((leafCount >> index) & 1) == 1) {
				peakCount += 1;
			}
		}
		require(siblings.length == peakHeight + peakCount - 1, 'invalid mmr proof length');
		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		uint256 siblingIndex = peakHeight;
		for (uint256 index = 0; index < carryTreeMmrMaxPeaks; index++) {
			if (((leafCount >> index) & 1) != 1) continue;
			if (index == peakHeight) {
				peaks[writeIndex] = peakRoot;
			} else {
				peaks[writeIndex] = siblings[siblingIndex];
				siblingIndex += 1;
			}
			writeIndex += 1;
		}
		return CarryTreeMmr.bagPeaks(peaks, peakCount);
	}

	function _verifyAndAdvanceNullifier(uint8 outcomeIndex, uint256 parentDepositIndex, bytes32[] calldata siblings) private {
		require(siblings.length == carryTreeNullifierDepth, 'invalid nullifier proof length');
		bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);
		bytes32 emptyRoot = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(0));
		require(emptyRoot == currentRoot, 'invalid nullifier proof');
		currentNullifierRoots[outcomeIndex] = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(uint256(1)));
		proofConsumedCarriedDepositIndexesByBranch[currentBranchId][outcomeIndex].push(parentDepositIndex);
	}

	function _computeNullifierRoot(uint256 parentDepositIndex, bytes32[] calldata siblings, bytes32 leafValue) private pure returns (bytes32 root) {
		root = leafValue;
		uint256 path = uint256(keccak256(abi.encode(parentDepositIndex)));
		for (uint256 depth = 0; depth < carryTreeNullifierDepth; depth++) {
			bytes32 siblingHash = siblings[depth];
			if (((path >> depth) & 1) == 0) {
				root = CarryTreeMmr.hashParent(root, siblingHash);
			} else {
				root = CarryTreeMmr.hashParent(siblingHash, root);
			}
		}
	}

	function _getStableLocalParentDepositIndex(uint256 depositIndex) private view returns (uint256) {
		return forkContinuation ? carryTreeForkContinuationLocalDepositIndexPrefix | depositIndex : depositIndex;
	}

	function _markLocalDepositConsumed(uint8 outcomeIndex, uint256 depositIndex, uint256 amount) private {
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		if (branchConsumedParentDepositIndexes[currentBranchId][outcomeIndex][stableParentDepositIndex]) return;
		branchConsumedParentDepositIndexes[currentBranchId][outcomeIndex][stableParentDepositIndex] = true;
		carryBranches[currentBranchId].localUnresolvedTotals[outcomeIndex] -= amount;
	}

	function _consumeCarriedDeposit(uint256 branchId, uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) private {
		require(!_isCarriedDepositConsumed(branchId, outcomeIndex, parentDepositIndex), 'deposit already settled');
		branchConsumedParentDepositIndexes[branchId][outcomeIndex][parentDepositIndex] = true;
		carryBranches[branchId].carriedUnresolvedTotals[outcomeIndex] -= amount;
	}

	function _isCarriedDepositConsumed(uint256 branchId, uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (bool) {
		uint256 currentCheckBranchId = branchId;
		while (currentCheckBranchId != 0) {
			if (branchConsumedParentDepositIndexes[currentCheckBranchId][outcomeIndex][parentDepositIndex]) return true;
			currentCheckBranchId = carryBranches[currentCheckBranchId].parentBranchId;
		}
		return false;
	}

	function _isNodeCarriedInBranch(CarryTreeNode storage node, uint256 branchId) private view returns (bool) {
		return node.branchId != branchId || node.carriedInOwningBranch;
	}

	function _requireAvailableCarriedNode(uint256 branchId, uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (CarryTreeNode memory carriedNode) {
		uint256 nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (
				storedNode.parentDepositIndex == parentDepositIndex &&
				_isNodeCarriedInBranch(storedNode, branchId) &&
				!_isCarriedDepositConsumed(branchId, outcomeIndex, parentDepositIndex)
			) {
				return storedNode;
			}
			nodeId = storedNode.parentNodeId;
		}
		revert('unknown imported deposit');
	}

	function _getAvailableCarriedPrefixAmount(uint256 branchId, uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (uint256 prefixAmount) {
		uint256 nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (
				_isNodeCarriedInBranch(storedNode, branchId) &&
				_compareParentDepositIndexes(storedNode.parentDepositIndex, parentDepositIndex)
			) {
				prefixAmount += storedNode.amount;
			}
			nodeId = storedNode.parentNodeId;
		}
	}

	function _getAvailableCarriedDepositIndexesByOutcomeAndDepositor(
		uint256 branchId,
		uint8 outcomeIndex,
		address depositor,
		uint256 startIndex,
		uint256 scanCount
	) private view returns (uint256[] memory depositIndexes) {
		if (scanCount == 0) return new uint256[](0);
		uint256 nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		uint256 matchCount = 0;
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (
				storedNode.depositor == depositor &&
				_isNodeCarriedInBranch(storedNode, branchId) &&
				!_isCarriedDepositConsumed(branchId, outcomeIndex, storedNode.parentDepositIndex)
			) {
				matchCount += 1;
			}
			nodeId = storedNode.parentNodeId;
		}
		if (startIndex >= matchCount) return new uint256[](0);

		uint256[] memory orderedMatches = new uint256[](matchCount);
		uint256 matchIndex = 0;
		nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (
				storedNode.depositor == depositor &&
				_isNodeCarriedInBranch(storedNode, branchId) &&
				!_isCarriedDepositConsumed(branchId, outcomeIndex, storedNode.parentDepositIndex)
			) {
				uint256 insertIndex = matchIndex;
				while (insertIndex > 0 && _compareParentDepositIndexes(storedNode.parentDepositIndex, orderedMatches[insertIndex - 1])) {
					orderedMatches[insertIndex] = orderedMatches[insertIndex - 1];
					insertIndex -= 1;
				}
				orderedMatches[insertIndex] = storedNode.parentDepositIndex;
				matchIndex += 1;
			}
			nodeId = storedNode.parentNodeId;
		}

		uint256 availableCount = matchCount - startIndex;
		uint256 resultCount = availableCount < scanCount ? availableCount : scanCount;
		depositIndexes = new uint256[](resultCount);
		for (uint256 index = 0; index < resultCount; index++) {
			depositIndexes[index] = orderedMatches[startIndex + index];
		}
	}

	function _getCarryLeavesByOutcome(uint256 branchId, uint8 outcomeIndex) private view returns (CarryTreeLeafView[] memory carryLeaves) {
		uint256 nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		uint256 leafCount = 0;
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (!_isCarriedDepositConsumed(branchId, outcomeIndex, storedNode.parentDepositIndex)) {
				leafCount += 1;
			}
			nodeId = storedNode.parentNodeId;
		}
		carryLeaves = new CarryTreeLeafView[](leafCount);
		uint256 writeIndex = 0;
		nodeId = carryBranches[branchId].localHeadNodeIds[outcomeIndex];
		while (nodeId != 0) {
			CarryTreeNode storage storedNode = carryNodes[nodeId];
			if (!_isCarriedDepositConsumed(branchId, outcomeIndex, storedNode.parentDepositIndex)) {
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
			}
			nodeId = storedNode.parentNodeId;
		}
	}

	function _removeUnsettledRegisteredCarriedClaim(uint256 branchId, uint8 outcomeIndex, address depositor, uint256 parentDepositIndex) private {
		uint256[] storage depositorIndexes = unsettledRegisteredCarriedIndexesByDepositor[branchId][outcomeIndex][depositor];
		uint256 positionPlusOne = registeredCarriedIndexPosition[branchId][outcomeIndex][depositor][parentDepositIndex];
		require(positionPlusOne != 0, 'deposit not unsettled');
		uint256 position = positionPlusOne - 1;
		uint256 lastIndex = depositorIndexes.length - 1;
		if (position != lastIndex) {
			uint256 movedDepositIndex = depositorIndexes[lastIndex];
			depositorIndexes[position] = movedDepositIndex;
			registeredCarriedIndexPosition[branchId][outcomeIndex][depositor][movedDepositIndex] = positionPlusOne;
		}
		depositorIndexes.pop();
		delete registeredCarriedIndexPosition[branchId][outcomeIndex][depositor][parentDepositIndex];
	}

	function _insertRegisteredCarriedClaim(uint256 branchId, uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) private returns (uint256 cumulativeAmount) {
		uint256[] storage orderedIndexes = eagerImportedClaimOrder[branchId][outcomeIndex];
		cumulativeAmount = _getAvailableCarriedPrefixAmount(branchId, outcomeIndex, parentDepositIndex);
		uint256 insertIndex = orderedIndexes.length;
		for (uint256 index = 0; index < orderedIndexes.length; index++) {
			uint256 existingParentDepositIndex = orderedIndexes[index];
			if (_compareParentDepositIndexes(parentDepositIndex, existingParentDepositIndex)) {
				insertIndex = index;
				break;
			}
		}

		orderedIndexes.push(parentDepositIndex);
		for (uint256 index = orderedIndexes.length - 1; index > insertIndex; index--) {
			orderedIndexes[index] = orderedIndexes[index - 1];
		}
		orderedIndexes[insertIndex] = parentDepositIndex;

		for (uint256 index = insertIndex + 1; index < orderedIndexes.length; index++) {
			uint256 laterParentDepositIndex = orderedIndexes[index];
			registeredCarriedClaims[branchId][outcomeIndex][laterParentDepositIndex].cumulativeAmount += amount;
		}
	}

	function _compareParentDepositIndexes(uint256 leftParentDepositIndex, uint256 rightParentDepositIndex) private pure returns (bool) {
		if (leftParentDepositIndex == rightParentDepositIndex) return false;
		if (leftParentDepositIndex == type(uint256).max) return false;
		if (rightParentDepositIndex == type(uint256).max) return true;
		return leftParentDepositIndex < rightParentDepositIndex;
	}
}
