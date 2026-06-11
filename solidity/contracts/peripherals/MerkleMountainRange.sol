// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';

library MerkleMountainRange {
	function hashLeaf(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 parentDepositIndex, uint256 cumulativeAmount, uint256 sourceNodeId) internal pure returns (bytes32) {
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
