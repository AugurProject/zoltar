// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGameClaimDelegate } from '../../statoblast/EscalationGameClaimDelegate.sol';

contract EscalationClaimSourcesHarness is EscalationGameClaimDelegate {
	function configure(address source) external {
		forkCarrySourceGame = source;
		outcomeState[1].currentLeafCount = 2;
		outcomeState[1].snapshotLeafCount = source == address(0) ? 0 : 2;
	}

	function consume(uint256 leafIndex, uint256 amountAttoRep) external {
		_recordConsumedPrincipal(1, leafIndex, amountAttoRep);
	}
}
