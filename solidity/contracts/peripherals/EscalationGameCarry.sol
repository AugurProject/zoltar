// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCalculations } from './EscalationGameCalculations.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import {
	CarriedDepositProof,
	CarryLeafView,
	Deposit,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	Node,
	NULLIFIER_DEPTH,
	OutcomeState,
	OutcomeStateView
} from './EscalationGameTypes.sol';
import { CarryConsumptionReason } from './interfaces/IEscalationGame.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';

abstract contract EscalationGameCarry is EscalationGameCalculations {
	bytes32 private constant FORK_CARRY_CHECKPOINT_SIGNATURE = keccak256(
		'ForkCarryCheckpoint(address,bytes32,bytes32[3],bytes32[3],uint256[3],uint256[3],uint256[3])'
	);
	bytes32 private constant CARRY_DEPOSIT_CONSUMED_SIGNATURE = keccak256(
		'CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)'
	);
	function initializeForkCarrySnapshotWithResolutionBalances(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory snapshotPeaksInput,
		uint256[3] memory snapshotLeafCountsInput,
		uint256[3] memory snapshotCarryTotals,
		uint256[3] memory snapshotResolutionBalances,
		bytes32[3] memory snapshotNullifierRoots
	) external {
		_initializeForkCarrySnapshot(
			sourceGame,
			snapshotId,
			snapshotPeaksInput,
			snapshotLeafCountsInput,
			snapshotCarryTotals,
			snapshotResolutionBalances,
			snapshotNullifierRoots
		);
	}

	// Snapshot initialization is contract-wide, and outcome 0 is used as the sentinel because
	// initializeForkCarrySnapshot() sets every outcome's nullifier root in the same loop.
	function forkCarrySnapshotInitialized() public view returns (bool) {
		return outcomeState[0].currentNullifierRoot != bytes32(0);
	}

	function getOutcomeState(
		BinaryOutcomes.BinaryOutcome outcome
	) external view returns (OutcomeStateView memory stateView) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) {
			stateView.currentNullifierRoot = EMPTY_NULLIFIER_ROOT;
			return stateView;
		}
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage state = outcomeState[outcomeIndex];
		(
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks,
			uint256 currentLeafCount,
			bytes32 currentCarryRoot,
			uint256 currentCarryTotal
		) = _getCurrentCarrySnapshot(outcomeIndex);
		stateView.balance = state.balance;
		stateView.snapshotLeafCount = state.snapshotLeafCount;
		stateView.snapshotPeaks = state.snapshotPeaks;
		stateView.inheritedUnresolvedTotal = _getEffectiveInheritedUnresolvedTotal(outcomeIndex);
		stateView.currentNullifierRoot = _getCurrentNullifierRoot(outcomeIndex);
		stateView.localHeadNodeId = state.localHeadNodeId;
		stateView.currentLeafCount = currentLeafCount;
		stateView.currentPeaks = currentPeaks;
		stateView.localUnresolvedTotal = state.localUnresolvedTotal;
		stateView.currentCarryRoot = currentCarryRoot;
		stateView.currentCarryTotal = currentCarryTotal;
	}

	function getForkCarrySnapshot()
		external
		view
		returns (
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotals,
			bytes32[3] memory nullifierRoots
		)
	{
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryPeaks[outcomeIndex] = state.currentPeaks;
			carryLeafCounts[outcomeIndex] = state.currentLeafCount;
			carryTotals[outcomeIndex] =
				_getEffectiveInheritedUnresolvedTotal(outcomeIndex) + state.localUnresolvedTotal;
			nullifierRoots[outcomeIndex] = _getCurrentNullifierRoot(outcomeIndex);
		}
	}

	function getForkCarryRoots() external view returns (bytes32[3] memory carryRoots) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryRoots[outcomeIndex] = proofVerifier.bagCarryPeaks(state.currentPeaks, state.currentLeafCount);
		}
	}

	function isForkCarryFundingComplete() external view returns (bool) {
		if (!forkCarrySnapshotRequiresForkedEscrow) return true;
		uint256 requiredRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			requiredRep +=
				_getEffectiveInheritedUnresolvedTotal(outcomeIndex) + outcomeState[outcomeIndex].localUnresolvedTotal;
		}
		return repToken.balanceOf(address(this)) >= requiredRep;
	}

	// Pages unresolved local carry leaves only, in newest-first local linked-list order.
	// Inherited snapshot leaves are exposed through getForkCarrySnapshot().
	function getCarryLeafPageByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startNodeId,
		uint256 maxEntries
	) external view returns (CarryLeafView[] memory carryLeaves, uint256 nextPageNodeId) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (new CarryLeafView[](0), 0);
		uint8 outcomeIndex = uint8(outcome);
		if (maxEntries == 0) return (new CarryLeafView[](0), startNodeId);

		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 nodeId = startNodeId == 0 ? state.localHeadNodeId : startNodeId;
		if (nodeId != 0) {
			require(nodes[nodeId].outcome == outcome, 'Outcome mismatch');
		}
		carryLeaves = new CarryLeafView[](maxEntries);
		uint256 writeIndex = 0;
		while (nodeId != 0 && writeIndex < maxEntries) {
			Node storage currentNode = nodes[nodeId];
			uint256 parentNodeId = currentNode.parentNodeId;
			require(currentNode.outcome == outcome, 'Wrong outcome');
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
	function getProofConsumedCarriedDepositIndexesByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startIndex,
		uint256 numberOfEntries
	) external view returns (uint256[] memory parentDepositIndexes) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new uint256[](0);
		uint256[] storage consumedIndexes = outcomeState[uint8(outcome)].proofConsumedDepositIndexes;
		uint256 endIndex = _sliceEnd(startIndex, numberOfEntries, consumedIndexes.length);
		if (endIndex <= startIndex) return new uint256[](0);
		parentDepositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			parentDepositIndexes[index - startIndex] = consumedIndexes[index];
		}
	}

	function _initializeForkCarrySnapshot(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory snapshotPeaksInput,
		uint256[3] memory snapshotLeafCountsInput,
		uint256[3] memory snapshotCarryTotals,
		uint256[3] memory snapshotResolutionBalances,
		bytes32[3] memory snapshotNullifierRoots
	) private {
		require(msg.sender == address(securityPool), 'Only pool');
		require(forkContinuation, 'No fork mode');
		require(!forkCarrySnapshotInitialized(), 'Snapshot initialized');

		bytes32[3] memory normalizedNullifierRoots;
		bytes32[3] memory carryRoots;
		uint256 totalCarry;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			OutcomeState storage state = outcomeState[outcomeIndex];
			require(
				snapshotLeafCountsInput[outcomeIndex] < (uint256(1) << MERKLE_MOUNTAIN_RANGE_MAX_PEAKS),
				'Leaf count high'
			);
			bytes32 normalizedNullifierRoot =
				snapshotNullifierRoots[outcomeIndex] == bytes32(0)
					? EMPTY_NULLIFIER_ROOT
					: snapshotNullifierRoots[outcomeIndex];
			normalizedNullifierRoots[outcomeIndex] = normalizedNullifierRoot;
			state.currentNullifierRoot = normalizedNullifierRoot;
			state.snapshotLeafCount = snapshotLeafCountsInput[outcomeIndex];
			state.currentLeafCount = snapshotLeafCountsInput[outcomeIndex];
			for (uint256 peakIndex = 0; peakIndex < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; peakIndex++) {
				bytes32 peak = snapshotPeaksInput[outcomeIndex][peakIndex];
				state.snapshotPeaks[peakIndex] = peak;
				state.currentPeaks[peakIndex] = peak;
			}
			_storeCurrentCarryPeaks(state, snapshotLeafCountsInput[outcomeIndex]);
			state.balance = snapshotResolutionBalances[outcomeIndex];
			state.inheritedUnresolvedTotal = snapshotCarryTotals[outcomeIndex];
			carryRoots[outcomeIndex] = proofVerifier.bagCarryPeaks(
				snapshotPeaksInput[outcomeIndex],
				snapshotLeafCountsInput[outcomeIndex]
			);
			totalCarry += snapshotCarryTotals[outcomeIndex];
		}
		forkCarrySnapshotRequiresForkedEscrow = totalCarry > 0;

		_emitForkCarryCheckpoint(
			sourceGame,
			snapshotId,
			carryRoots,
			normalizedNullifierRoots,
			snapshotLeafCountsInput,
			snapshotCarryTotals,
			snapshotResolutionBalances
		);
	}

	function _emitForkCarryCheckpoint(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[3] memory carryRoots,
		bytes32[3] memory nullifierRoots,
		uint256[3] memory leafCounts,
		uint256[3] memory unresolvedTotals,
		uint256[3] memory resolutionBalances
	) private {
		bytes32 computedSnapshotId = keccak256(
			abi.encode(sourceGame, carryRoots, nullifierRoots, leafCounts, unresolvedTotals, resolutionBalances)
		);
		if (snapshotId == bytes32(0)) snapshotId = computedSnapshotId;
		require(snapshotId == computedSnapshotId, 'Snapshot id mismatch');
		bytes memory eventData = abi.encode(
			carryRoots,
			nullifierRoots,
			leafCounts,
			unresolvedTotals,
			resolutionBalances
		);
		bytes32 eventSignature = FORK_CARRY_CHECKPOINT_SIGNATURE;
		assembly ('memory-safe') {
			log3(add(eventData, 0x20), mload(eventData), eventSignature, sourceGame, snapshotId)
		}
	}

	function _getStableLocalParentDepositIndex(
		uint8 outcomeIndex,
		uint256 depositIndex
	) internal view returns (uint256) {
		if (!forkContinuation) return depositIndex;
		return uint256(keccak256(abi.encode(address(this), outcomeIndex, depositIndex)));
	}

	function _appendLocalCarryLeafToCurrentSnapshot(OutcomeState storage state, uint256 nodeId) internal {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(
			node.depositor,
			node.outcome,
			node.amount,
			node.parentDepositIndex,
			node.cumulativeAmount,
			nodeId
		);
		uint256 leafCount = state.currentLeafCount;
		uint256 peakHeight = 0;
		uint256 carryStartIndex = leafCount;
		state.currentCarryNodeHashes[0][carryStartIndex] = carryHash;

		while (((leafCount >> peakHeight) & 1) == 1) {
			uint256 siblingStartIndex = carryStartIndex - (uint256(1) << peakHeight);
			carryHash = MerkleMountainRange.hashParent(state.currentPeaks[peakHeight], carryHash);
			delete state.currentPeaks[peakHeight];
			peakHeight += 1;
			carryStartIndex = siblingStartIndex;
			state.currentCarryNodeHashes[peakHeight][carryStartIndex] = carryHash;
		}

		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'MMR too tall');
		state.currentPeaks[peakHeight] = carryHash;
		state.currentLeafCount = leafCount + 1;
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) internal {
		_verifyCarriedDepositMerkleMountainRangeProof(outcomeIndex, proof);
		_verifyAndAdvanceNullifier(outcomeIndex, proof.parentDepositIndex, proof.nullifierSiblings);
		_consumeCarriedDeposit(outcomeIndex, proof.parentDepositIndex, proof.amount);
	}

	function _consumeLocalDeposit(
		uint8 outcomeIndex,
		uint256 depositIndex,
		CarryConsumptionReason reason
	) internal returns (Deposit memory deposit) {
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		require(depositIndex < selectedOutcomeState.deposits.length, 'Bad deposit index');
		deposit = selectedOutcomeState.deposits[depositIndex];
		require(deposit.amount > 0, 'Deposit settled');
		selectedOutcomeState.deposits[depositIndex].amount = 0;
		_markLocalDepositConsumed(outcomeIndex, depositIndex, deposit.amount, deposit.depositor);
		uint256 nodeId = selectedOutcomeState.localNodeIds[depositIndex];
		_emitCarryDepositConsumed(
			outcomeIndex,
			deposit.depositor,
			deposit.amount,
			nodes[nodeId].parentDepositIndex,
			nodeId,
			reason
		);
	}

	function _emitCarryDepositConsumed(
		uint8 outcomeIndex,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 sourceNodeId,
		CarryConsumptionReason reason
	) internal {
		(, , bytes32 carryRoot, uint256 carryTotal) = _getCurrentCarrySnapshot(outcomeIndex);
		bytes memory eventData = abi.encode(
			BinaryOutcomes.BinaryOutcome(outcomeIndex),
			amount,
			reason,
			carryTotal,
			_getCurrentNullifierRoot(outcomeIndex),
			carryRoot
		);
		bytes32 eventSignature = CARRY_DEPOSIT_CONSUMED_SIGNATURE;
		assembly ('memory-safe') {
			log4(add(eventData, 0x20), mload(eventData), eventSignature, parentDepositIndex, sourceNodeId, depositor)
		}
	}

	function _storeCurrentCarryPeaks(OutcomeState storage state, uint256 leafCount) private {
		uint256 peakStartIndex;
		for (uint256 reverseHeight = MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; reverseHeight > 0; ) {
			unchecked {
				--reverseHeight;
			}
			uint256 peakHeight = reverseHeight;
			if (((leafCount >> peakHeight) & 1) != 1) continue;
			state.currentCarryNodeHashes[peakHeight][peakStartIndex] = state.currentPeaks[peakHeight];
			peakStartIndex += uint256(1) << peakHeight;
		}
	}

	function _clearLocalCarryLeafFromCurrentSnapshot(OutcomeState storage state, uint256 leafIndex) private {
		(uint256 peakHeight, uint256 peakStartIndex) = proofVerifier.getCurrentCarryPeakForLeaf(
			state.currentLeafCount,
			leafIndex
		);
		bytes32 nodeHash = bytes32(0);
		uint256 nodeStartIndex = leafIndex;
		state.currentCarryNodeHashes[0][nodeStartIndex] = nodeHash;

		for (uint256 height = 0; height < peakHeight; height++) {
			uint256 subtreeLeafCount = uint256(1) << height;
			bool isRightNode = (((nodeStartIndex - peakStartIndex) >> height) & 1) == 1;
			uint256 siblingStartIndex =
				isRightNode ? nodeStartIndex - subtreeLeafCount : nodeStartIndex + subtreeLeafCount;
			bytes32 siblingHash = state.currentCarryNodeHashes[height][siblingStartIndex];
			if (isRightNode) {
				nodeHash = MerkleMountainRange.hashParent(siblingHash, nodeHash);
				nodeStartIndex = siblingStartIndex;
			} else {
				nodeHash = MerkleMountainRange.hashParent(nodeHash, siblingHash);
			}
			state.currentCarryNodeHashes[height + 1][nodeStartIndex] = nodeHash;
		}

		state.currentPeaks[peakHeight] = nodeHash;
	}

	function _getCurrentNullifierRoot(uint8 outcomeIndex) private view returns (bytes32) {
		bytes32 root = outcomeState[outcomeIndex].currentNullifierRoot;
		if (root != bytes32(0)) return root;
		return EMPTY_NULLIFIER_ROOT;
	}

	function _verifyCarriedDepositMerkleMountainRangeProof(
		uint8 outcomeIndex,
		CarriedDepositProof calldata proof
	) private view returns (bytes32 leafHash) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 leafCount = state.snapshotLeafCount;
		require(leafCount > 0, 'Carry peak absent');
		require(proof.amount > 0, 'Proof amount zero');
		leafHash = MerkleMountainRange.hashLeaf(
			proof.depositor,
			BinaryOutcomes.BinaryOutcome(outcomeIndex),
			proof.amount,
			proof.parentDepositIndex,
			proof.cumulativeAmount,
			proof.sourceNodeId
		);
		bytes32 computedRoot = proofVerifier.computeMerkleMountainRangeRootFromProof(
			leafHash,
			leafCount,
			proof.leafIndex,
			proof.merkleMountainRangePeakIndex,
			proof.merkleMountainRangeSiblings
		);
		require(
			computedRoot == proofVerifier.bagCarryPeaks(state.snapshotPeaks, state.snapshotLeafCount),
			'Bad carry proof'
		);
	}

	function _verifyAndAdvanceNullifier(
		uint8 outcomeIndex,
		uint256 parentDepositIndex,
		bytes32[] calldata siblings
	) private {
		require(siblings.length == NULLIFIER_DEPTH, 'Bad nullifier length');
		bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);
		bytes32 emptyRoot = proofVerifier.computeNullifierRoot(parentDepositIndex, siblings, bytes32(0));
		require(emptyRoot == currentRoot, 'Bad nullifier proof');
		OutcomeState storage state = outcomeState[outcomeIndex];
		state.currentNullifierRoot = proofVerifier.computeNullifierRoot(
			parentDepositIndex,
			siblings,
			bytes32(uint256(1))
		);
		state.proofConsumedDepositIndexes.push(parentDepositIndex);
	}

	function _markLocalDepositConsumed(
		uint8 outcomeIndex,
		uint256 depositIndex,
		uint256 amount,
		address depositor
	) private {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(outcomeIndex, depositIndex);
		if (state.consumedParentDepositIndexes[stableParentDepositIndex]) return;
		state.consumedParentDepositIndexes[stableParentDepositIndex] = true;
		state.localUnresolvedTotal -= amount;
		localUnresolvedPrincipalByVaultAndOutcome[depositor][outcomeIndex] -= amount;
		uint256 nodeId = state.localNodeIds[depositIndex];
		_clearLocalCarryLeafFromCurrentSnapshot(state, nodes[nodeId].carryLeafIndex);
		_consumeUnresolvedRepForVault(depositor, amount);
	}

	function _consumeCarriedDeposit(uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amount) private {
		require(!_isCarriedDepositConsumed(outcomeIndex, parentDepositIndex), 'Deposit settled');
		OutcomeState storage state = outcomeState[outcomeIndex];
		require(
			_getEffectiveInheritedUnresolvedTotal(outcomeIndex) + state.localUnresolvedTotal >= amount,
			'Carried REP low'
		);
		state.consumedParentDepositIndexes[parentDepositIndex] = true;
		uint256 inheritedAmountToConsume =
			amount > state.inheritedUnresolvedTotal ? state.inheritedUnresolvedTotal : amount;
		state.inheritedUnresolvedTotal -= inheritedAmountToConsume;
		if (amount > inheritedAmountToConsume) {
			state.localUnresolvedTotal -= amount - inheritedAmountToConsume;
		}
	}

	function _isCarriedDepositConsumed(uint8 outcomeIndex, uint256 parentDepositIndex) private view returns (bool) {
		return outcomeState[outcomeIndex].consumedParentDepositIndexes[parentDepositIndex];
	}

	function _getCurrentCarrySnapshot(
		uint8 outcomeIndex
	)
		private
		view
		returns (
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks,
			uint256 currentLeafCount,
			bytes32 currentCarryRoot,
			uint256 currentCarryTotal
		)
	{
		OutcomeState storage state = outcomeState[outcomeIndex];
		currentPeaks = state.currentPeaks;
		currentLeafCount = state.currentLeafCount;
		currentCarryRoot = proofVerifier.bagCarryPeaks(currentPeaks, currentLeafCount);
		currentCarryTotal = _getEffectiveInheritedUnresolvedTotal(outcomeIndex) + state.localUnresolvedTotal;
	}

	function _getEffectiveInheritedUnresolvedTotal(uint8 outcomeIndex) internal view returns (uint256) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 inheritedUnresolvedTotal = state.inheritedUnresolvedTotal;
		if (forkContinuation) {
			address parentPoolAddress = address(securityPool.parent());
			if (parentPoolAddress != address(0x0)) {
				uint256 directlyClaimedPrincipal = ISecurityPoolForker(securityPool.securityPoolForker())
					.getDirectlyClaimedEscalationPrincipal(
						securityPool.parent(),
						BinaryOutcomes.BinaryOutcome(outcomeIndex)
					);
				require(directlyClaimedPrincipal <= inheritedUnresolvedTotal, 'Direct principal high');
				inheritedUnresolvedTotal -= directlyClaimedPrincipal;
			}
		}
		BinaryOutcomes.BinaryOutcome finalResolution = getFinalQuestionResolution();
		if (finalResolution != BinaryOutcomes.BinaryOutcome.None && uint8(finalResolution) != outcomeIndex) return 0;
		return inheritedUnresolvedTotal;
	}
}
