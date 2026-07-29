// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './ERC20.sol';

contract TestnetReputationToken is ERC20 {
	uint256 public constant FAUCET_LIMIT = 1_000_000 ether;
	uint256 private constant TOTAL_THEORETICAL_SUPPLY = 11_000_000 ether;

	constructor() ERC20('Testnet Reputation', 'REP') {}

	function faucet(uint256 amount) external {
		require(amount > 0, 'Faucet amount zero');
		require(amount <= FAUCET_LIMIT, 'Faucet amount exceeds limit');
		require(totalSupply() + amount <= TOTAL_THEORETICAL_SUPPLY, 'Faucet exceeds theoretical supply');
		_mint(msg.sender, amount);
	}

	function getTotalTheoreticalSupply() external pure returns (uint256) {
		return TOTAL_THEORETICAL_SUPPLY;
	}
}
