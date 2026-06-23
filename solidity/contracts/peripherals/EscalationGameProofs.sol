// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, NULLIFIER_DEPTH } from './EscalationGameTypes.sol';

library EscalationGameProofs {
	function computeEmptyNullifierRoot() internal pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			root = MerkleMountainRange.hashParent(root, root);
		}
	}

	function getCurrentCarryPeakForLeaf(
		uint256 leafCount,
		uint256 leafIndex
	) internal pure returns (uint256 peakHeight, uint256 peakStartIndex) {
		for (uint256 reverseHeight = MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; reverseHeight > 0; ) {
			unchecked {
				--reverseHeight;
			}
			uint256 currentPeakHeight = reverseHeight;
			if (((leafCount >> currentPeakHeight) & 1) != 1) continue;
			uint256 nextPeakStartIndex = peakStartIndex + (uint256(1) << currentPeakHeight);
			if (leafIndex < nextPeakStartIndex) return (currentPeakHeight, peakStartIndex);
			peakStartIndex = nextPeakStartIndex;
		}
		revert();
	}

	function bagCarryPeaks(
		bytes32[MERKLE_MOUNTAIN_RANGE_MAX_PEAKS] memory peakHashes,
		uint256 leafCount
	) internal pure returns (bytes32) {
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

	function computeMerkleMountainRangeRootFromProof(
		bytes32 leafHash,
		uint256 leafCount,
		uint256 leafIndex,
		uint256 peakHeight,
		bytes32[] calldata siblings
	) internal pure returns (bytes32) {
		require(((leafCount >> peakHeight) & 1) == 1, 'peak absent');
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'iph');
		require(leafIndex < (uint256(1) << peakHeight), 'lior');

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

	function computeNullifierRoot(
		uint256 parentDepositIndex,
		bytes32[] calldata siblings,
		bytes32 leafValue
	) internal pure returns (bytes32 root) {
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
}
