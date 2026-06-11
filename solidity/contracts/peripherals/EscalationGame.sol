// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';

uint256 constant escalationTimeLength = 4233600; // 7 weeks
uint256 constant SCALE = 1e6;
uint256 constant LN2_SCALED = 693147;
uint256 constant MAX_ATANH_ITERATIONS = 16;
uint256 constant MAX_EXP_ITERATIONS = 16;
uint256 constant EXCESS_REWARD_WINDOW_DIVISOR = 2;
uint256 constant FORK_CONTINUATION_LOCAL_DEPOSIT_INDEX_PREFIX = 1 << 255;
uint256 constant MERKLE_MOUNTAIN_RANGE_MAX_PEAKS = 64;
uint256 constant NULLIFIER_DEPTH = 64;

struct Deposit {
	address depositor;
	uint256 amount;
	uint256 cumulativeAmount;
}

struct CarryLeafView {
	address depositor;
	uint256 amount;
	uint256 parentDepositIndex;
	uint256 cumulativeAmount;
	uint256 sourceNodeId;
}

struct OutcomeState {
	// Snapshot fields are the inherited proof baseline for this outcome.
	// currentNullifierRoot tracks which inherited proof indexes have been consumed in this instance.
	// localHeadNodeId/localUnresolvedTotal track append-only local carry added after the inherited snapshot.
	// Descendant carry export is rebuilt lazily from the snapshot plus unresolved local nodes.
	// Total principal currently assigned to this outcome by local deposits placed directly in this escalation game.
	uint256 balance;
	// Local deposits placed directly in this escalation game, preserved in arrival order for payout ordering.
	Deposit[] deposits;
	// The inherited carry snapshot this escalation game started with for this outcome.
	uint256 snapshotLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] snapshotPeaks;
	uint256 inheritedUnresolvedTotal;
	// The current unresolved carry state after local and inherited deposits are consumed.
	bytes32 currentNullifierRoot;
	uint256 localHeadNodeId;
	uint256 localUnresolvedTotal;
	// Authoritative settled-set for inherited and local carried parentDepositIndexes in this instance.
	mapping(uint256 => bool) consumedParentDepositIndexes;
	// Enumerable mirror of consumed proof indexes used for recursive offchain proof reconstruction.
	uint256[] proofConsumedDepositIndexes;
}

struct OutcomeStateView {
	uint256 balance;
	uint256 snapshotLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] snapshotPeaks;
	uint256 inheritedUnresolvedTotal;
	bytes32 currentNullifierRoot;
	uint256 localHeadNodeId;
	uint256 currentLeafCount;
	bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] currentPeaks;
	uint256 localUnresolvedTotal;
	bytes32 currentCarryRoot;
	uint256 currentCarryTotal;
}

struct Node {
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

contract EscalationGame {
	uint256 public constant activationDelay = 3 days;
	uint256 public activationTime;
	ISecurityPool public immutable securityPool;
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	uint256 public lnRatioScaled;
	address public immutable owner;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	bytes32 private immutable EMPTY_NULLIFIER_ROOT;
	// Outcome-indexed state uses 0 = Invalid, 1 = Yes, 2 = No.
	OutcomeState[3] private outcomeState;
	uint256 public nextNodeId = 1;
	mapping(uint256 => Node) public nodes;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkCarrySnapshotInitialized(uint256[3] snapshotLeafCounts, uint256[3] inheritedTotals, bytes32[3] inheritedNullifierRoots);
	event ForkContinuationResumed(uint256 resumedAt);
	event DepositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 depositIndex, uint256 cumulativeAmount);
	event WithdrawDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountToWithdraw, uint256 depositIndex);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);
	event LocalDepositAppended(uint256 indexed nodeId, BinaryOutcomes.BinaryOutcome outcome, address depositor, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount);
	event CarriedDepositClaimed(BinaryOutcomes.BinaryOutcome outcome, address depositor, uint256 amount, uint256 parentDepositIndex, uint256 sourceNodeId, bytes32 leafHash);

	modifier onlySecurityPoolOrForker() {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker'
		);
		_;
	}

	constructor(ISecurityPool _securityPool) {
		securityPool = _securityPool;
		owner = msg.sender;
		EMPTY_NULLIFIER_ROOT = _computeEmptyNullifierRoot();
	}

	function start(uint256 _startBond, uint256 _nonDecisionThreshold) external {
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

	function startFromFork(uint256 _startBond, uint256 _nonDecisionThreshold, uint256 elapsedAtFork) external {
		require(owner == msg.sender, 'only owner can start');
		require(activationTime == 0, 'already started');
		require(_nonDecisionThreshold > _startBond, 'threshold must exceed start bond');
		require(_startBond > 0, 'start bond must be positive');
		require(_startBond >= 1e18, 'start bond must be at least 1 ether');
		require(_nonDecisionThreshold >= 1e18, 'threshold must be at least 1 ether');
		require(elapsedAtFork <= escalationTimeLength, 'Invalid time');
		forkContinuation = true;
		forkElapsedAtStart = elapsedAtFork;
		startBond = _startBond;
		nonDecisionThreshold = _nonDecisionThreshold;
		lnRatioScaled = _computeLnRatioScaled(_startBond, _nonDecisionThreshold);
		emit GameContinuedFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function initializeForkCarrySnapshot(bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory snapshotPeaksInput, uint256[3] memory snapshotLeafCountsInput, uint256[3] memory snapshotCarryTotals, bytes32[3] memory snapshotNullifierRoots) external {
		require(msg.sender == address(securityPool), 'only security pool can initialize carry snapshot');
		require(forkContinuation, 'not fork continuation');
		require(!forkCarrySnapshotInitialized(), 'carry snapshot already initialized');

		bytes32[3] memory normalizedNullifierRoots;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			OutcomeState storage state = outcomeState[outcomeIndex];
			bytes32 normalizedNullifierRoot = snapshotNullifierRoots[outcomeIndex] == bytes32(0) ? EMPTY_NULLIFIER_ROOT : snapshotNullifierRoots[outcomeIndex];
			normalizedNullifierRoots[outcomeIndex] = normalizedNullifierRoot;
			state.currentNullifierRoot = normalizedNullifierRoot;
			state.snapshotLeafCount = snapshotLeafCountsInput[outcomeIndex];
			for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
				bytes32 peak = snapshotPeaksInput[outcomeIndex][peakIndex];
				state.snapshotPeaks[peakIndex] = peak;
			}
			state.balance = snapshotCarryTotals[outcomeIndex];
			state.inheritedUnresolvedTotal = snapshotCarryTotals[outcomeIndex];
		}

		emit ForkCarrySnapshotInitialized(snapshotLeafCountsInput, snapshotCarryTotals, normalizedNullifierRoots);
	}

	function resumeFromFork() external {
		require(owner == msg.sender || address(securityPool) == msg.sender, 'only owner can resume');
		require(forkContinuation, 'not fork continuation');
		require(forkResumedAt == 0, 'already resumed');
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function forkContinuationResumed() public view returns (bool) {
		return forkResumedAt != 0;
	}

	// Snapshot initialization is contract-wide, and outcome 0 is used as the sentinel because
	// initializeForkCarrySnapshot() sets every outcome's nullifier root in the same loop.
	function forkCarrySnapshotInitialized() public view returns (bool) {
		return outcomeState[0].currentNullifierRoot != bytes32(0);
	}

	function getOutcomeState(BinaryOutcomes.BinaryOutcome outcome) external view returns (OutcomeStateView memory stateView) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) {
			stateView.currentNullifierRoot = EMPTY_NULLIFIER_ROOT;
			return stateView;
		}
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage state = outcomeState[outcomeIndex];
		(bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks, uint256 currentLeafCount, bytes32 currentCarryRoot, uint256 currentCarryTotal) = _getMaterializedCarrySnapshot(outcomeIndex);
		stateView.balance = state.balance;
		stateView.snapshotLeafCount = state.snapshotLeafCount;
		stateView.snapshotPeaks = state.snapshotPeaks;
		stateView.inheritedUnresolvedTotal = state.inheritedUnresolvedTotal;
		stateView.currentNullifierRoot = _getCurrentNullifierRoot(outcomeIndex);
		stateView.localHeadNodeId = state.localHeadNodeId;
		stateView.currentLeafCount = currentLeafCount;
		stateView.currentPeaks = currentPeaks;
		stateView.localUnresolvedTotal = state.localUnresolvedTotal;
		stateView.currentCarryRoot = currentCarryRoot;
		stateView.currentCarryTotal = currentCarryTotal;
	}

	function getForkCarrySnapshot() external view returns (
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory carryPeaks,
		uint256[3] memory carryLeafCounts,
		uint256[3] memory carryTotals,
		bytes32[3] memory nullifierRoots
	) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			(carryPeaks[outcomeIndex], carryLeafCounts[outcomeIndex]) = _materializeCurrentCarrySnapshot(outcomeIndex);
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryTotals[outcomeIndex] = state.inheritedUnresolvedTotal + state.localUnresolvedTotal;
			nullifierRoots[outcomeIndex] = _getCurrentNullifierRoot(outcomeIndex);
		}
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
		uint256 expScaled = SCALE; // k=0
		uint256 term = exponentRemainder;
		expScaled += term;

		for (uint256 k = 2; k < MAX_EXP_ITERATIONS;) {
			term = term * exponentRemainder / (k * SCALE);
			if (term == 0) break;
			expScaled += term;
			unchecked {
				++k;
			}
		}

		expScaled <<= exponentPow2;
		uint256 cost = startBondLocal * expScaled / SCALE;
		// Clamp (should be ≤ nonDecisionThreshold, but rounding may cause slight overshoot)
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
		uint8 invalidOver = outcomeState[0].balance >= currentTotalCost ? 1 : 0;
		uint8 yesOver = outcomeState[1].balance >= currentTotalCost ? 1 : 0;
		uint8 noOver = outcomeState[2].balance >= currentTotalCost ? 1 : 0;
		if (invalidOver + yesOver + noOver >= 2) return BinaryOutcomes.BinaryOutcome.None;
		if (outcomeState[0].balance == 0 && outcomeState[1].balance == 0 && outcomeState[2].balance == 0) return BinaryOutcomes.BinaryOutcome.Invalid;
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
		}
		if (
			(outcomeState[1].balance >= outcomeState[0].balance && outcomeState[1].balance <= outcomeState[2].balance) ||
			(outcomeState[1].balance >= outcomeState[2].balance && outcomeState[1].balance <= outcomeState[0].balance)
		) {
			return outcomeState[1].balance;
		}
		return outcomeState[2].balance;
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256 depositAmount) {
		require(nonDecisionTimestamp == 0, 'System has already reached a non-decision');
		require(msg.sender == address(securityPool), 'Only Security Pool can deposit');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		require(getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None, 'System has already timed out');
		require(outcomeState[uint8(outcome)].balance < nonDecisionThreshold, 'Already full');
		require(amount >= startBond, 'all amounts need to be bigger or equal to start deposit');
		uint256 outcomeIndex = uint256(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		uint256 currentBalance = selectedOutcomeState.balance;
		uint256 room = nonDecisionThreshold - currentBalance;
		(uint256 effectiveDeposit, uint256 newBalance) = _getAcceptedDepositAmount(outcomeIndex, amount, currentBalance, room);

		selectedOutcomeState.balance += effectiveDeposit;
		depositAmount = effectiveDeposit;

		Deposit memory deposit;
		deposit.depositor = depositor;
		deposit.amount = depositAmount;
		deposit.cumulativeAmount = newBalance;
		selectedOutcomeState.deposits.push(deposit);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		Node storage node = nodes[nodeId];
		node.parentNodeId = selectedOutcomeState.localHeadNodeId;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amount = depositAmount;
		node.parentDepositIndex = stableParentDepositIndex;
		node.cumulativeAmount = deposit.cumulativeAmount;
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotal += depositAmount;
		emit LocalDepositAppended(nodeId, outcome, depositor, depositAmount, stableParentDepositIndex, deposit.cumulativeAmount);
		emit DepositOnOutcome(depositor, outcome, deposit.amount, depositIndex, deposit.cumulativeAmount);
		if (hasReachedNonDecision()) {
			nonDecisionTimestamp = block.timestamp;
		}
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public onlySecurityPoolOrForker returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		require(getQuestionResolution() == outcome, 'outcome not winning');
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 burnAmount;
		(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(uint8(outcome), deposit.amount, deposit.cumulativeAmount);

		emit ClaimDeposit(amountToWithdraw, burnAmount);
	}

	function exportUnresolvedDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public onlySecurityPoolOrForker returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		uint8 outcomeIndex = uint8(outcome);
		Deposit memory deposit = _consumeLocalDeposit(outcomeIndex, depositIndex);
		depositor = deposit.depositor;
		amount = deposit.amount;
		parentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
	}

	function withdrawDeposit(CarriedDepositProof calldata proof, BinaryOutcomes.BinaryOutcome outcome) public onlySecurityPoolOrForker returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmount = proof.amount;
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		if (outcome == questionResolution) {
			uint256 burnAmount;
			(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(outcomeIndex, proof.amount, proof.cumulativeAmount);
			emit ClaimDeposit(amountToWithdraw, burnAmount);
			emit WithdrawDeposit(depositor, outcome, amountToWithdraw, proof.parentDepositIndex);
			return (depositor, amountToWithdraw, originalDepositAmount);
		}
		emit WithdrawDeposit(depositor, outcome, 0, proof.parentDepositIndex);
	}

	function exportUnresolvedDeposit(CarriedDepositProof calldata proof, BinaryOutcomes.BinaryOutcome outcome) public onlySecurityPoolOrForker returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		uint8 outcomeIndex = uint8(outcome);
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		depositor = proof.depositor;
		amount = proof.amount;
		parentDepositIndex = proof.parentDepositIndex;
	}

	// Pages unresolved local carry leaves only, in newest-first local linked-list order.
	// Inherited snapshot leaves are exposed through getForkCarrySnapshot().
	function getCarryLeafPageByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startNodeId, uint256 maxEntries) external view returns (CarryLeafView[] memory carryLeaves, uint256 nextPageNodeId) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (new CarryLeafView[](0), 0);
		uint8 outcomeIndex = uint8(outcome);
		if (maxEntries == 0) return (new CarryLeafView[](0), startNodeId);

		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 nodeId = startNodeId == 0 ? state.localHeadNodeId : startNodeId;
		if (nodeId != 0) {
			require(nodes[nodeId].outcome == outcome, 'cursor outcome mismatch');
		}
		carryLeaves = new CarryLeafView[](maxEntries);
		uint256 writeIndex = 0;
		while (nodeId != 0 && writeIndex < maxEntries) {
			Node storage currentNode = nodes[nodeId];
			uint256 parentNodeId = currentNode.parentNodeId;
			require(currentNode.outcome == outcome, 'cursor outcome mismatch');
			if (!state.consumedParentDepositIndexes[currentNode.parentDepositIndex]) {
				carryLeaves[writeIndex] = CarryLeafView({
					depositor: currentNode.depositor,
					amount: currentNode.amount,
					parentDepositIndex: currentNode.parentDepositIndex,
					cumulativeAmount: currentNode.cumulativeAmount,
					sourceNodeId: nodeId
				});
				writeIndex += 1;
			}
			nodeId = parentNodeId;
		}
		nextPageNodeId = nodeId;
		if (writeIndex == maxEntries) return (carryLeaves, nextPageNodeId);
		CarryLeafView[] memory trimmedCarryLeaves = new CarryLeafView[](writeIndex);
		for (uint256 index = 0; index < writeIndex; index++) {
			trimmedCarryLeaves[index] = carryLeaves[index];
		}
		return (trimmedCarryLeaves, nextPageNodeId);
	}

	// Returns proof-consumed inherited indexes in proof-consumption order, not sorted parentDepositIndex order.
	function getProofConsumedCarriedDepositIndexesByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (uint256[] memory parentDepositIndexes) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new uint256[](0);
		uint256[] storage consumedIndexes = outcomeState[uint8(outcome)].proofConsumedDepositIndexes;
		if (startIndex >= consumedIndexes.length || numberOfEntries == 0) return new uint256[](0);
		uint256 endIndex = startIndex + numberOfEntries;
		if (endIndex > consumedIndexes.length) endIndex = consumedIndexes.length;
		parentDepositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			parentDepositIndexes[index - startIndex] = consumedIndexes[index];
		}
	}

	function withdrawDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only Security Pool can withdraw');
		require(nonDecisionTimestamp == 0, 'System has reached non-decision');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Outcome must not be None');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question has not finalized!');
		if (outcome == questionResolution) {
			(depositor, amountToWithdraw, originalDepositAmount) = claimDepositForWinning(depositIndex, questionResolution);
			emit WithdrawDeposit(depositor, questionResolution, amountToWithdraw, depositIndex);
			return (depositor, amountToWithdraw, originalDepositAmount);
		}
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		emit WithdrawDeposit(depositor, outcome, 0, depositIndex);
	}

	function getUnsettledDepositIndexesByOutcomeAndDepositor(BinaryOutcomes.BinaryOutcome outcome, address depositor, uint256 startIndex, uint256 scanCount) external view returns (uint256[] memory depositIndexes) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new uint256[](0);
		Deposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		if (startIndex >= outcomeDeposits.length || scanCount == 0) return new uint256[](0);
		uint256 endIndex = startIndex + scanCount;
		if (endIndex > outcomeDeposits.length) {
			endIndex = outcomeDeposits.length;
		}
		uint256 writeIndex = 0;
		depositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			Deposit storage deposit = outcomeDeposits[index];
			if (deposit.depositor == depositor && deposit.amount > 0) {
				depositIndexes[writeIndex] = index;
				writeIndex += 1;
			}
		}
		if (writeIndex == depositIndexes.length) return depositIndexes;
		uint256[] memory trimmedDepositIndexes = new uint256[](writeIndex);
		for (uint256 index = 0; index < writeIndex; index++) {
			trimmedDepositIndexes[index] = depositIndexes[index];
		}
		return trimmedDepositIndexes;
	}

	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new Deposit[](0);
		Deposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		uint256 iterateUntil = startIndex + numberOfEntries > outcomeDeposits.length ? outcomeDeposits.length : startIndex + numberOfEntries;
		if (iterateUntil <= startIndex) return new Deposit[](0);
		returnDeposits = new Deposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			returnDeposits[index - startIndex] = outcomeDeposits[index];
		}
	}

	function previewLeafHash(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount, uint256 sourceNodeId) external pure returns (bytes32) {
		return MerkleMountainRange.hashLeaf(depositor, outcome, amount, parentDepositIndex, cumulativeAmount, sourceNodeId);
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

	function _appendCarriedLeafToMerkleMountainRange(bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks, uint256 currentLeafCount, bytes32 leafHash) private pure returns (bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory updatedPeaks, uint256 updatedLeafCount) {
		updatedPeaks = currentPeaks;
		uint256 leafCount = currentLeafCount;
		uint256 peakIndex = 0;
		bytes32 carryHash = leafHash;

		while (((leafCount >> peakIndex) & 1) == 1) {
			carryHash = MerkleMountainRange.hashParent(updatedPeaks[peakIndex], carryHash);
			delete updatedPeaks[peakIndex];
			peakIndex += 1;
		}

		require(peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'Merkle Mountain Range peak overflow');
		updatedPeaks[peakIndex] = carryHash;
		updatedLeafCount = leafCount + 1;
	}

	function _bagCarryPeaks(bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes, uint256 leafCount) private pure returns (bytes32) {
		if (leafCount == 0) return bytes32(0);

		uint256 peakCount = 0;
		for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peakCount += 1;
			}
		}

		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
			if (((leafCount >> peakIndex) & 1) == 1) {
				peaks[writeIndex] = peakHashes[peakIndex];
				writeIndex += 1;
			}
		}

		return MerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function _getCurrentNullifierRoot(uint8 outcomeIndex) private view returns (bytes32) {
		bytes32 root = outcomeState[outcomeIndex].currentNullifierRoot;
		if (root != bytes32(0)) return root;
		return EMPTY_NULLIFIER_ROOT;
	}

	function _computeEmptyNullifierRoot() private pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			root = MerkleMountainRange.hashParent(root, root);
		}
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private {
		bytes32 leafHash = _verifyCarriedDepositMerkleMountainRangeProof(outcomeIndex, proof);
		_verifyAndAdvanceNullifier(outcomeIndex, proof.parentDepositIndex, proof.nullifierSiblings);
		_consumeCarriedDeposit(outcomeIndex, proof.parentDepositIndex, proof.amount);
		emit CarriedDepositClaimed(BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.depositor, proof.amount, proof.parentDepositIndex, proof.sourceNodeId, leafHash);
	}

	function _verifyCarriedDepositMerkleMountainRangeProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private view returns (bytes32 leafHash) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 leafCount = state.snapshotLeafCount;
		require(leafCount > 0, 'no inherited carry snapshot');
		require(proof.amount > 0, 'amount must be positive');
		leafHash = MerkleMountainRange.hashLeaf(proof.depositor, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.amount, proof.parentDepositIndex, proof.cumulativeAmount, proof.sourceNodeId);
		bytes32 computedRoot = _computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof.leafIndex, proof.merkleMountainRangePeakIndex, proof.merkleMountainRangeSiblings);
		require(computedRoot == _bagCarryPeaks(state.snapshotPeaks, state.snapshotLeafCount), 'invalid carry inclusion proof');
	}

	function _computeMerkleMountainRangeRootFromProof(bytes32 leafHash, uint256 leafCount, uint256 leafIndex, uint256 peakHeight, bytes32[] calldata siblings) private pure returns (bytes32) {
		require(((leafCount >> peakHeight) & 1) == 1, 'peak absent');
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'invalid peak height');
		require(leafIndex < (uint256(1) << peakHeight), 'leaf index out of range');

		bytes32 peakRoot = leafHash;
		for (uint256 level = 0; level < peakHeight; level++) {
			bytes32 siblingHash = siblings[level];
			if (((leafIndex >> level) & 1) == 0) {
				peakRoot = MerkleMountainRange.hashParent(peakRoot, siblingHash);
			} else {
				peakRoot = MerkleMountainRange.hashParent(siblingHash, peakRoot);
			}
		}

		uint256 peakCount = 0;
		for (uint256 index = 0; index < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; index++) {
			if (((leafCount >> index) & 1) == 1) {
				peakCount += 1;
			}
		}
		require(siblings.length == peakHeight + peakCount - 1, 'invalid Merkle Mountain Range proof length');
		bytes32[] memory peaks = new bytes32[](peakCount);
		uint256 writeIndex = 0;
		uint256 siblingIndex = peakHeight;
		for (uint256 index = 0; index < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; index++) {
			if (((leafCount >> index) & 1) != 1) continue;
			if (index == peakHeight) {
				peaks[writeIndex] = peakRoot;
			} else {
				peaks[writeIndex] = siblings[siblingIndex];
				siblingIndex += 1;
			}
			writeIndex += 1;
		}
		return MerkleMountainRange.bagPeaks(peaks, peakCount);
	}

	function _verifyAndAdvanceNullifier(uint8 outcomeIndex, uint256 parentDepositIndex, bytes32[] calldata siblings) private {
		require(siblings.length == NULLIFIER_DEPTH, 'invalid nullifier proof length');
		bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);
		bytes32 emptyRoot = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(0));
		require(emptyRoot == currentRoot, 'invalid nullifier proof');
		OutcomeState storage state = outcomeState[outcomeIndex];
		state.currentNullifierRoot = _computeNullifierRoot(parentDepositIndex, siblings, bytes32(uint256(1)));
		state.proofConsumedDepositIndexes.push(parentDepositIndex);
	}

	function _computeNullifierRoot(uint256 parentDepositIndex, bytes32[] calldata siblings, bytes32 leafValue) private pure returns (bytes32 root) {
		root = leafValue;
		uint256 path = uint256(keccak256(abi.encode(parentDepositIndex)));
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			bytes32 siblingHash = siblings[depth];
			if (((path >> depth) & 1) == 0) {
				root = MerkleMountainRange.hashParent(root, siblingHash);
			} else {
				root = MerkleMountainRange.hashParent(siblingHash, root);
			}
		}
	}

	function _getAcceptedDepositAmount(uint256 outcomeIndex, uint256 requestedAmount, uint256 currentBalance, uint256 room) private view returns (uint256 acceptedAmount, uint256 newBalance) {
		acceptedAmount = requestedAmount > room ? room : requestedAmount;
		newBalance = currentBalance + acceptedAmount;

		uint256 invalidBalance = outcomeState[0].balance;
		uint256 yesBalance = outcomeState[1].balance;
		uint256 noBalance = outcomeState[2].balance;
		uint256 maxBalance = invalidBalance > yesBalance ? (invalidBalance > noBalance ? invalidBalance : noBalance) : (yesBalance > noBalance ? yesBalance : noBalance);
		bool otherHasMax = outcomeIndex == 0 ? (yesBalance == maxBalance || noBalance == maxBalance) :
			outcomeIndex == 1 ? (invalidBalance == maxBalance || noBalance == maxBalance) :
			(invalidBalance == maxBalance || yesBalance == maxBalance);

		if (newBalance == maxBalance && otherHasMax && maxBalance < nonDecisionThreshold) {
			acceptedAmount -= 1;
			require(acceptedAmount >= startBond, 'tie adjustment would break min deposit');
			newBalance = currentBalance + acceptedAmount;
		}
	}

	function _getStableLocalParentDepositIndex(uint256 depositIndex) private view returns (uint256) {
		return forkContinuation ? FORK_CONTINUATION_LOCAL_DEPOSIT_INDEX_PREFIX | depositIndex : depositIndex;
	}

	function _markLocalDepositConsumed(uint8 outcomeIndex, uint256 depositIndex, uint256 amount) private {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(depositIndex);
		if (state.consumedParentDepositIndexes[stableParentDepositIndex]) return;
		state.consumedParentDepositIndexes[stableParentDepositIndex] = true;
		state.localUnresolvedTotal -= amount;
	}

	function _consumeCarriedDeposit(uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) private {
		require(!_isCarriedDepositConsumed(outcomeIndex, parentDepositIndex), 'deposit already settled');
		OutcomeState storage state = outcomeState[outcomeIndex];
		state.consumedParentDepositIndexes[parentDepositIndex] = true;
		state.inheritedUnresolvedTotal -= amount;
	}

	function _isCarriedDepositConsumed(uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (bool) {
		return outcomeState[outcomeIndex].consumedParentDepositIndexes[parentDepositIndex];
	}

	function _getMaterializedCarrySnapshot(uint8 outcomeIndex) private view returns (bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks, uint256 currentLeafCount, bytes32 currentCarryRoot, uint256 currentCarryTotal) {
		(currentPeaks, currentLeafCount) = _materializeCurrentCarrySnapshot(outcomeIndex);
		currentCarryRoot = _bagCarryPeaks(currentPeaks, currentLeafCount);
		OutcomeState storage state = outcomeState[outcomeIndex];
		currentCarryTotal = state.inheritedUnresolvedTotal + state.localUnresolvedTotal;
	}

	function _computeWinningWithdrawal(uint8 outcomeIndex, uint256 depositAmount, uint256 cumulativeAmount) private view returns (uint256 amountToWithdraw, uint256 burnAmount) {
		uint256 depositStart = cumulativeAmount - depositAmount;
		uint256 bindingCapitalAmount = getBindingCapital();
		uint256 rewardEligibleCapAmount = bindingCapitalAmount + bindingCapitalAmount / EXCESS_REWARD_WINDOW_DIVISOR;
		uint256 winningOutcomeBalance = outcomeState[outcomeIndex].balance;
		uint256 rewardEligiblePrincipalAmount = winningOutcomeBalance < rewardEligibleCapAmount ? winningOutcomeBalance : rewardEligibleCapAmount;
		if (rewardEligiblePrincipalAmount == 0) {
			amountToWithdraw = depositAmount;
		} else {
			uint256 eligibleEndAmount = cumulativeAmount < rewardEligibleCapAmount ? cumulativeAmount : rewardEligibleCapAmount;
			uint256 rewardEligibleDepositAmount = eligibleEndAmount > depositStart ? eligibleEndAmount - depositStart : 0;
			if (rewardEligibleDepositAmount > depositAmount) rewardEligibleDepositAmount = depositAmount;
			uint256 rewardBonusPoolAmount = (bindingCapitalAmount * 3) / 5;
			uint256 totalHaircutAmount = (bindingCapitalAmount * 2) / 5;
			uint256 bonusShare = rewardEligibleDepositAmount * rewardBonusPoolAmount / rewardEligiblePrincipalAmount;
			burnAmount = rewardEligibleDepositAmount * totalHaircutAmount / rewardEligiblePrincipalAmount;
			amountToWithdraw = depositAmount + bonusShare;
		}

		uint256 actualForkThreshold = securityPool.zoltar().getForkThreshold(securityPool.universeId());
		if (actualForkThreshold < nonDecisionThreshold) {
			amountToWithdraw = (amountToWithdraw * actualForkThreshold) / nonDecisionThreshold;
		}
	}

	function _consumeLocalDeposit(uint8 outcomeIndex, uint256 depositIndex) private returns (Deposit memory deposit) {
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		require(depositIndex < selectedOutcomeState.deposits.length, 'Invalid deposit index');
		deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'deposit already settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(outcomeIndex, depositIndex, deposit.amount);
	}

	function _materializeCurrentCarrySnapshot(uint8 outcomeIndex) private view returns (bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks, uint256 currentLeafCount) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		currentLeafCount = state.snapshotLeafCount;
		for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
			currentPeaks[peakIndex] = state.snapshotPeaks[peakIndex];
		}

		uint256[] memory unresolvedNodeIds = _getUnresolvedLocalNodeIds(state);
		uint256 unresolvedLeafCount = unresolvedNodeIds.length;
		for (uint256 unresolvedIndex = 0; unresolvedIndex < unresolvedLeafCount; unresolvedIndex++) {
			uint256 unresolvedNodeId = unresolvedNodeIds[unresolvedIndex];
			Node storage unresolvedNode = nodes[unresolvedNodeId];
			(currentPeaks, currentLeafCount) = _appendCarriedLeafToMerkleMountainRange(
				currentPeaks,
				currentLeafCount,
				MerkleMountainRange.hashLeaf(
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

	function _getUnresolvedLocalNodeIds(OutcomeState storage state) private view returns (uint256[] memory unresolvedNodeIds) {
		uint256 nodeId = state.localHeadNodeId;
		uint256 unresolvedLeafCount = 0;
		while (nodeId != 0) {
			Node storage currentNode = nodes[nodeId];
			if (!state.consumedParentDepositIndexes[currentNode.parentDepositIndex]) {
				unresolvedLeafCount += 1;
			}
			nodeId = currentNode.parentNodeId;
		}

		unresolvedNodeIds = new uint256[](unresolvedLeafCount);
		nodeId = state.localHeadNodeId;
		uint256 writeIndex = unresolvedLeafCount;
		while (nodeId != 0) {
			Node storage currentNode = nodes[nodeId];
			if (!state.consumedParentDepositIndexes[currentNode.parentDepositIndex]) {
				writeIndex -= 1;
				unresolvedNodeIds[writeIndex] = nodeId;
			}
			nodeId = currentNode.parentNodeId;
		}
	}
}
