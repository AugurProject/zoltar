// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { MerkleMountainRange } from '../../peripherals/MerkleMountainRange.sol';
import { NULLIFIER_DEPTH } from '../../peripherals/EscalationGameTypes.sol';

contract IncompatibleEscalationGameProofVerifier {
	function computeEmptyNullifierRoot() external pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			root = MerkleMountainRange.hashParent(root, root);
		}
	}

	function computeLnRatioScaled(uint256, uint256) external pure returns (uint256) {
		return 0;
	}
}
