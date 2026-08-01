// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationClaimSources } from '../../peripherals/SecurityPoolLiquidationDelegate.sol';
import { MAX_CLAIM_SOURCE_DEPTH } from '../../peripherals/EscalationGameTypes.sol';

contract EscalationClaimSourceNode {
	address private immutable sourceGame;

	constructor(address _sourceGame) {
		sourceGame = _sourceGame;
	}

	fallback() external {
		if (msg.sig != bytes4(0xdb05d0b2)) revert('Unknown selector');
		address source = sourceGame;
		assembly ('memory-safe') {
			mstore(0x00, source)
			return(0x00, 0x20)
		}
	}
}

contract EscalationClaimSourcesHarness {
	function collect(
		address initialGame
	) external view returns (address[MAX_CLAIM_SOURCE_DEPTH] memory games, uint256 gameCount) {
		return EscalationClaimSources.collect(initialGame);
	}
}
