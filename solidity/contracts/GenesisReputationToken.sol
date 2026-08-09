// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './ERC20.sol';

contract GenesisReputationToken is ERC20 {
	uint256 private immutable totalTheoreticalSupplyAttoRep;

	constructor(address[] memory initialHolders, uint256[] memory initialBalances) ERC20('Reputation', 'REP') {
		require(initialHolders.length != 0, 'Genesis REP requires at least one initial holder');
		require(initialHolders.length == initialBalances.length, 'Genesis REP holder and balance counts must match');

		uint256 supply;
		for (uint256 index = 0; index < initialHolders.length; index++) {
			address holder = initialHolders[index];
			uint256 balance = initialBalances[index];
			require(holder != address(0), 'Genesis REP holder must not be the zero address');
			require(balance != 0, 'Genesis REP balance must be non-zero');
			for (uint256 previousIndex = 0; previousIndex < index; previousIndex++) {
				require(holder != initialHolders[previousIndex], 'Genesis REP holders must be unique');
			}
			_mint(holder, balance);
			supply += balance;
		}
		totalTheoreticalSupplyAttoRep = supply;
	}

	function getTotalTheoreticalSupplyAttoRep() external view returns (uint256) {
		return totalTheoreticalSupplyAttoRep;
	}
}
