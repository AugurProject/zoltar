// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Pagination } from '../Pagination.sol';

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCalculations } from './EscalationGameCalculations.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import {
	CarriedDepositProof,
	CarryLeafView,
	Deposit,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	Node,
	OutcomeState,
	OutcomeStateView
} from './EscalationGameTypes.sol';

import { CarryConsumptionReason } from './interfaces/IEscalationGame.sol';

abstract contract EscalationGameCarry is EscalationGameCalculations {
	bytes32 private constant CARRY_DEPOSIT_CONSUMED_SIGNATURE = keccak256('CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32)');
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.initializeForkCarryOutcome, (sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep, proofVerifier)));
	}

	// Each call installs one complete outcome. No partial snapshot is economically active.
	function forkCarrySnapshotInitialized() public view returns (bool) {
		return forkCarrySnapshotOutcomesInitialized == 3;
	}

	function getOutcomeState(BinaryOutcomes.BinaryOutcome outcome) external view returns (OutcomeStateView memory stateView) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return stateView;
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage state = outcomeState[outcomeIndex];
		(
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks,
			uint256 currentLeafCount,
			bytes32 currentCarryRoot,
			uint256 currentCarryTotalAttoRep
		) = _getCurrentCarrySnapshot(outcomeIndex);
		stateView.balanceAttoRep = state.balanceAttoRep;
		stateView.snapshotLeafCount = state.snapshotLeafCount;
		stateView.snapshotCarryRoot = state.snapshotCarryRoot;
		stateView.inheritedUnresolvedTotalAttoRep = _getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex);
		stateView.localHeadNodeId = state.localHeadNodeId;
		stateView.currentLeafCount = currentLeafCount;
		stateView.currentPeaks = currentPeaks;
		stateView.localUnresolvedTotalAttoRep =
			_isRetiredOrdinaryOutcome(outcomeIndex) ? 0 : state.localUnresolvedTotalAttoRep;
		stateView.currentCarryRoot = currentCarryRoot;
		stateView.currentCarryTotalAttoRep = currentCarryTotalAttoRep;
	}

	function getForkCarrySnapshot()
		external
		view
		returns (
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS][3] memory carryPeaks,
			uint256[3] memory carryLeafCounts,
			uint256[3] memory carryTotalsAttoRep
		)
	{
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			if (_isRetiredOrdinaryOutcome(outcomeIndex)) continue;
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryPeaks[outcomeIndex] = state.currentPeaks;
			carryLeafCounts[outcomeIndex] = state.currentLeafCount;
			carryTotalsAttoRep[outcomeIndex] =
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) + state.localUnresolvedTotalAttoRep;
		}
	}

	function getForkCarryRoots() external view returns (bytes32[3] memory carryRoots) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			if (_isRetiredOrdinaryOutcome(outcomeIndex)) continue;
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryRoots[outcomeIndex] = proofVerifier.bagCarryPeaks(state.currentPeaks, state.currentLeafCount);
		}
	}

	function isForkCarryFundingComplete() public view returns (bool) {
		if (forkContinuation && !forkCarrySnapshotInitialized()) return false;
		if (!forkCarrySnapshotRequiresForkedEscrow) return true;
		// The canonical factory binds this inventory to the parent's actual escrow
		// after irrevocable source surplus and any native fork burn. Outcome
		// principals are mutually exclusive, so their sum is not the funding requirement.
		return _reporterRepBalance() >= forkCarryInitialBackingAttoRep;
	}

	// Pages unresolved local carry leaves only, in newest-first local linked-list order.
	// Inherited snapshot leaves are exposed through getForkCarrySnapshot().
	// maxEntries bounds visited nodes, including consumed leaves. Follow nonzero cursors even after empty pages.
	function getCarryLeafPageByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startNodeId, uint256 maxEntries) external view returns (CarryLeafView[] memory carryLeaves, uint256 nextPageNodeId) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (new CarryLeafView[](0), 0);
		uint8 outcomeIndex = uint8(outcome);
		if (_isRetiredOrdinaryOutcome(outcomeIndex)) return (new CarryLeafView[](0), 0);
		if (maxEntries == 0) return (new CarryLeafView[](0), startNodeId);

		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 nodeId = startNodeId == 0 ? state.localHeadNodeId : startNodeId;
		if (nodeId != 0) {
			// An unissued ID reads as a zero node whose default outcome is Invalid.
			require(nodeId < nextNodeId, 'Unknown carry cursor');
			require(nodes[nodeId].outcome == outcome, 'Outcome mismatch');
		}
		carryLeaves = new CarryLeafView[](maxEntries);
		uint256 writeIndex = 0;
		for (uint256 visitedNodes = 0; nodeId != 0 && visitedNodes < maxEntries; visitedNodes++) {
			Node storage currentNode = nodes[nodeId];
			uint256 parentNodeId = currentNode.parentNodeId;
			require(currentNode.outcome == outcome, 'Wrong outcome');
			if (!state.consumedParentDepositIndexes[currentNode.parentDepositIndex]) {
				carryLeaves[writeIndex] = CarryLeafView({depositor: currentNode.depositor, amountAttoRep: currentNode.amountAttoRep, parentDepositIndex: currentNode.parentDepositIndex, cumulativeAmountAttoRep: currentNode.cumulativeAmountAttoRep, sourceNodeId: nodeId});
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
		uint256 endIndex = Pagination.sliceEnd(startIndex, numberOfEntries, consumedIndexes.length);
		if (endIndex <= startIndex) return new uint256[](0);
		parentDepositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			parentDepositIndexes[index - startIndex] = consumedIndexes[index];
		}
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) internal {
		require(forkCarrySnapshotInitialized(), 'Fork snapshot incomplete');
		_verifyCarriedDepositMerkleMountainRangeProof(outcomeIndex, proof);
		outcomeState[outcomeIndex].proofConsumedDepositIndexes.push(proof.parentDepositIndex);
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.consumeCarriedDeposit, (outcomeIndex, proof.parentDepositIndex, proof.amountAttoRep)));
	}

	/// @dev Callers settle only after finality, so live fork exports never contain spent deposits.
	function _consumeLocalDeposit(uint8 outcomeIndex, uint256 depositIndex, CarryConsumptionReason reason) internal returns (Deposit memory deposit, uint256 parentDepositIndex) {
		require(!forkContinuation || forkCarrySnapshotInitialized(), 'Fork snapshot incomplete');
		OutcomeState storage state = outcomeState[outcomeIndex];
		require(depositIndex < state.localNodeIds.length, 'Bad deposit index');
		uint256 nodeId = state.localNodeIds[depositIndex];
		Node storage node = nodes[nodeId];
		parentDepositIndex = node.parentDepositIndex;
		require(!state.consumedParentDepositIndexes[parentDepositIndex], 'Deposit settled');
		state.consumedParentDepositIndexes[parentDepositIndex] = true;
		deposit = Deposit({depositor: node.depositor, amountAttoRep: node.amountAttoRep, cumulativeAmountAttoRep: node.cumulativeAmountAttoRep});
		state.localUnresolvedTotalAttoRep -= deposit.amountAttoRep;
		_consumeUnresolvedRepForClaimOwners(deposit.depositor, outcomeIndex, deposit.amountAttoRep);
		_emitCarryDepositConsumed(outcomeIndex, deposit.depositor, deposit.amountAttoRep, parentDepositIndex, nodeId, reason);
	}

	function _emitCarryDepositConsumed(uint8 outcomeIndex, address depositor, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 sourceNodeId, CarryConsumptionReason reason) internal {
		(, , bytes32 carryRoot, uint256 carryTotalAttoRep) = _getCurrentCarrySnapshot(outcomeIndex);
		// Every caller supplies a validated outcome; its uint8 ABI word matches the event enum.
		bytes memory eventData = abi.encode(outcomeIndex, amountAttoRep, reason, carryTotalAttoRep, carryRoot);
		bytes32 eventSignature = CARRY_DEPOSIT_CONSUMED_SIGNATURE;
		assembly ('memory-safe') {
			log4(add(eventData, 0x20), mload(eventData), eventSignature, parentDepositIndex, sourceNodeId, depositor)
		}
	}

	function _verifyCarriedDepositMerkleMountainRangeProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private view returns (bytes32 leafHash) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 leafCount = state.snapshotLeafCount;
		require(leafCount > 0, 'Carry peak absent');
		require(proof.amountAttoRep > 0, 'Proof amount zero');
		leafHash = MerkleMountainRange.hashLeaf(proof.depositor, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.amountAttoRep, proof.parentDepositIndex, proof.cumulativeAmountAttoRep, proof.sourceNodeId);
		bytes32 computedRoot = proofVerifier.computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof.leafIndex, proof.merkleMountainRangePeakIndex, proof.merkleMountainRangeSiblings);
		require(computedRoot == state.snapshotCarryRoot, 'Bad carry proof');
	}

	function _getCurrentCarrySnapshot(uint8 outcomeIndex)
		private
		view
		returns (
			bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory currentPeaks,
			uint256 currentLeafCount,
			bytes32 currentCarryRoot,
			uint256 currentCarryTotalAttoRep
		)
	{
		if (_isRetiredOrdinaryOutcome(outcomeIndex)) return (currentPeaks, 0, bytes32(0), 0);
		OutcomeState storage state = outcomeState[outcomeIndex];
		currentPeaks = state.currentPeaks;
		currentLeafCount = state.currentLeafCount;
		currentCarryRoot = proofVerifier.bagCarryPeaks(currentPeaks, currentLeafCount);
		currentCarryTotalAttoRep =
			_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) + state.localUnresolvedTotalAttoRep;
	}

	function _getEffectiveInheritedUnresolvedTotalAttoRep(uint8 outcomeIndex) internal view returns (uint256) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		BinaryOutcomes.BinaryOutcome finalResolution = getFinalQuestionResolution();
		if (finalResolution != BinaryOutcomes.BinaryOutcome.None && uint8(finalResolution) != outcomeIndex) return 0;
		return state.inheritedUnresolvedTotalAttoRep;
	}
}
