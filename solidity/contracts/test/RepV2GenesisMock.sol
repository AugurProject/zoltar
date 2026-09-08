// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../ERC20.sol';

/// @notice Minimal external-genesis fixture matching the relevant mainnet REPv2 surface.
contract RepV2GenesisMock is ERC20 {
	uint256 private immutable theoreticalSupply;

	constructor(uint256 supply) ERC20('Reputation', 'REPv2') {
		theoreticalSupply = supply;
		_mint(msg.sender, supply);
	}

	function getTotalTheoreticalSupply() external view returns (uint256) {
		return theoreticalSupply;
	}
}
