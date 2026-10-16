// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { Constants } from '../Constants.sol';
import { EscalationGameCalculations } from './EscalationGameCalculations.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
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
	bytes32 private constant CARRY_DEPOSIT_CONSUMED_SIGNATURE = keccak256('CarryDepositConsumed(uint256,uint256,address,uint8,uint256,uint8,uint256,bytes32,bytes32)');
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep, bytes32 nullifierRoot) external {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.initializeForkCarryOutcome, (sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep, nullifierRoot, proofVerifier, claimDelegate, EMPTY_NULLIFIER_ROOT)));
	}

	// Each call installs one complete outcome. No partial snapshot is economically active.
	function forkCarrySnapshotInitialized() public view returns (bool) {
		return forkCarrySnapshotOutcomesInitialized == 3;
	}

	function getOutcomeState(BinaryOutcomes.BinaryOutcome outcome) external view returns (OutcomeStateView memory stateView) {
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
			uint256 currentCarryTotalAttoRep
		) = _getCurrentCarrySnapshot(outcomeIndex);
		stateView.balanceAttoRep = state.balanceAttoRep;
		stateView.snapshotLeafCount = state.snapshotLeafCount;
		stateView.snapshotPeaks = state.snapshotPeaks;
		stateView.inheritedUnresolvedTotalAttoRep = _getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex);
		stateView.currentNullifierRoot = _getCurrentNullifierRoot(outcomeIndex);
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
			uint256[3] memory carryTotalsAttoRep,
			bytes32[3] memory nullifierRoots
		)
	{
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			if (_isRetiredOrdinaryOutcome(outcomeIndex)) {
				nullifierRoots[outcomeIndex] = EMPTY_NULLIFIER_ROOT;
				continue;
			}
			OutcomeState storage state = outcomeState[outcomeIndex];
			carryPeaks[outcomeIndex] = state.currentPeaks;
			carryLeafCounts[outcomeIndex] = state.currentLeafCount;
			carryTotalsAttoRep[outcomeIndex] =
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) + state.localUnresolvedTotalAttoRep;
			nullifierRoots[outcomeIndex] = _getCurrentNullifierRoot(outcomeIndex);
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
		uint256 requiredAttoRep;
		uint256 requiredRepAtForkAttoRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			requiredAttoRep +=
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) +
				outcomeState[outcomeIndex].localUnresolvedTotalAttoRep;
			requiredRepAtForkAttoRep +=
				outcomeState[outcomeIndex].inheritedUnresolvedTotalAttoRep +
				outcomeState[outcomeIndex].localUnresolvedTotalAttoRep;
		}
		if (winnerHaircutPaidByFork) {
			// An own-fork continuation starts with the post-burn REP bucket. At a
			// divisor of five, 80% of the source principal exactly covers the
			// maximum winning payout. Direct pre-resume claims consume that same
			// bucket, so compare the live balance with the unexported remainder.
			uint256 minimumBackingAttoRep =
				requiredRepAtForkAttoRep - requiredRepAtForkAttoRep / Constants.MINIMUM_FORK_BURN_DIVISOR;
			if (forkCarryInitialBackingAttoRep < minimumBackingAttoRep) return false;
			if (forkCarryBackingExportedBeforeResumeAttoRep > forkCarryInitialBackingAttoRep) return false;
			requiredAttoRep = _applyTruthAuctionRetention(forkCarryInitialBackingAttoRep - forkCarryBackingExportedBeforeResumeAttoRep);
		}
		return repToken.balanceOf(address(this)) >= requiredAttoRep;
	}

	// Pages unresolved local carry leaves only, in newest-first local linked-list order.
	// Inherited snapshot leaves are exposed through getForkCarrySnapshot().
	function getCarryLeafPageByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startNodeId, uint256 maxEntries) external view returns (CarryLeafView[] memory carryLeaves, uint256 nextPageNodeId) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (new CarryLeafView[](0), 0);
		uint8 outcomeIndex = uint8(outcome);
		if (_isRetiredOrdinaryOutcome(outcomeIndex)) return (new CarryLeafView[](0), 0);
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
		uint256 endIndex = _sliceEnd(startIndex, numberOfEntries, consumedIndexes.length);
		if (endIndex <= startIndex) return new uint256[](0);
		parentDepositIndexes = new uint256[](endIndex - startIndex);
		for (uint256 index = startIndex; index < endIndex; index++) {
			parentDepositIndexes[index - startIndex] = consumedIndexes[index];
		}
	}

	function _getStableLocalParentDepositIndex(uint8 outcomeIndex, uint256 depositIndex) internal view returns (uint256) {
		if (!forkContinuation) return depositIndex;
		return (uint256(uint160(address(this))) << 96) | (uint256(outcomeIndex) << 88) | depositIndex;
	}

	function _verifyAndConsumeCarriedDepositProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) internal {
		require(forkCarrySnapshotInitialized(), 'Fork snapshot incomplete');
		_verifyCarriedDepositMerkleMountainRangeProof(outcomeIndex, proof);
		_verifyAndAdvanceNullifier(outcomeIndex, proof.parentDepositIndex, proof.nullifierSiblings);
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.consumeCarriedDeposit, (outcomeIndex, proof.parentDepositIndex, proof.amountAttoRep, proof.cumulativeAmountAttoRep, proof.leafIndex, _getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex))));
	}

	function _consumeLocalDeposit(uint8 outcomeIndex, uint256 depositIndex, CarryConsumptionReason reason) internal returns (Deposit memory deposit) {
		require(!forkContinuation || forkCarrySnapshotInitialized(), 'Fork snapshot incomplete');
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		require(depositIndex < selectedOutcomeState.localNodeIds.length, 'Bad deposit index');
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(outcomeIndex, depositIndex);
		require(!selectedOutcomeState.consumedParentDepositIndexes[stableParentDepositIndex], 'Deposit settled');
		uint256 nodeId = selectedOutcomeState.localNodeIds[depositIndex];
		Node storage node = nodes[nodeId];
		deposit = Deposit(node.depositor, node.amountAttoRep, node.cumulativeAmountAttoRep);
		_markLocalDepositConsumed(outcomeIndex, depositIndex, deposit.amountAttoRep, deposit.depositor);
		_emitCarryDepositConsumed(outcomeIndex, deposit.depositor, deposit.amountAttoRep, nodes[nodeId].parentDepositIndex, nodeId, reason);
	}

	function _emitCarryDepositConsumed(uint8 outcomeIndex, address depositor, uint256 amountAttoRep, uint256 parentDepositIndex, uint256 sourceNodeId, CarryConsumptionReason reason) internal {
		(, , bytes32 carryRoot, uint256 carryTotalAttoRep) = _getCurrentCarrySnapshot(outcomeIndex);
		// Every caller supplies a validated outcome; its uint8 ABI word matches the event enum.
		bytes memory eventData = abi.encode(outcomeIndex, amountAttoRep, reason, carryTotalAttoRep, _getCurrentNullifierRoot(outcomeIndex), carryRoot);
		bytes32 eventSignature = CARRY_DEPOSIT_CONSUMED_SIGNATURE;
		assembly ('memory-safe') {
			log4(add(eventData, 0x20), mload(eventData), eventSignature, parentDepositIndex, sourceNodeId, depositor)
		}
	}

	function _clearLocalCarryLeafFromCurrentSnapshot(OutcomeState storage state, uint256 leafIndex) private {
		(uint256 peakHeight, uint256 peakStartIndex) = proofVerifier.getCurrentCarryPeakForLeaf(state.currentLeafCount, leafIndex);
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

	function _verifyCarriedDepositMerkleMountainRangeProof(uint8 outcomeIndex, CarriedDepositProof calldata proof) private view returns (bytes32 leafHash) {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 leafCount = state.snapshotLeafCount;
		require(leafCount > 0, 'Carry peak absent');
		require(proof.amountAttoRep > 0, 'Proof amount zero');
		leafHash = MerkleMountainRange.hashLeaf(proof.depositor, BinaryOutcomes.BinaryOutcome(outcomeIndex), proof.amountAttoRep, proof.parentDepositIndex, proof.cumulativeAmountAttoRep, proof.sourceNodeId);
		bytes32 computedRoot = proofVerifier.computeMerkleMountainRangeRootFromProof(leafHash, leafCount, proof.leafIndex, proof.merkleMountainRangePeakIndex, proof.merkleMountainRangeSiblings);
		require(computedRoot == proofVerifier.bagCarryPeaks(state.snapshotPeaks, state.snapshotLeafCount), 'Bad carry proof');
	}

	function _verifyAndAdvanceNullifier(uint8 outcomeIndex, uint256 parentDepositIndex, bytes32[] calldata siblings) private {
		require(siblings.length == NULLIFIER_DEPTH, 'Bad nullifier length');
		bytes32 currentRoot = _getCurrentNullifierRoot(outcomeIndex);
		bytes32 emptyRoot = proofVerifier.computeNullifierRoot(parentDepositIndex, siblings, bytes32(0));
		require(emptyRoot == currentRoot, 'Bad nullifier proof');
		OutcomeState storage state = outcomeState[outcomeIndex];
		state.currentNullifierRoot = proofVerifier.computeNullifierRoot(parentDepositIndex, siblings, bytes32(uint256(1)));
		state.proofConsumedDepositIndexes.push(parentDepositIndex);
	}

	function _markLocalDepositConsumed(uint8 outcomeIndex, uint256 depositIndex, uint256 amountAttoRep, address depositor) private {
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 stableParentDepositIndex = _getStableLocalParentDepositIndex(outcomeIndex, depositIndex);
		if (state.consumedParentDepositIndexes[stableParentDepositIndex]) return;
		state.consumedParentDepositIndexes[stableParentDepositIndex] = true;
		state.localUnresolvedTotalAttoRep -= amountAttoRep;
		uint256 nodeId = state.localNodeIds[depositIndex];
		_clearLocalCarryLeafFromCurrentSnapshot(state, nodes[nodeId].carryLeafIndex);
		_consumeUnresolvedRepForClaimOwners(depositor, outcomeIndex, amountAttoRep, nodes[nodeId].carryLeafIndex);
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
		uint256 inheritedUnresolvedTotalAttoRep =
			state.inheritedUnresolvedTotalAttoRep + state.inheritedConsumedSourceAttoRep;
		if (forkContinuation) {
			address parentPoolAddress = address(securityPool.parent());
			if (parentPoolAddress != address(0x0)) {
				uint256 directlyClaimedPrincipalAttoRep = ISecurityPoolForker(securityPool.securityPoolForker()).getDirectlyClaimedEscalationPrincipal(securityPool.parent(), BinaryOutcomes.BinaryOutcome(outcomeIndex));
				require(directlyClaimedPrincipalAttoRep <= inheritedUnresolvedTotalAttoRep, 'Direct principal high');
				inheritedUnresolvedTotalAttoRep -= directlyClaimedPrincipalAttoRep;
			}
		}
		BinaryOutcomes.BinaryOutcome finalResolution = getFinalQuestionResolution();
		if (finalResolution != BinaryOutcomes.BinaryOutcome.None && uint8(finalResolution) != outcomeIndex) return 0;
		return _applyTruthAuctionRetention(inheritedUnresolvedTotalAttoRep) - state.inheritedConsumedRetainedAttoRep;
	}
}
