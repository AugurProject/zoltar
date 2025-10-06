// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import '../ERC20.sol';

contract CompleteSet is ERC20 {

	address public securityPool;

	constructor() ERC20('Reputation', 'REP') {
		securityPool = msg.sender;
	}

	function mint(address account, uint256 value) external {
		require(msg.sender == securityPool, 'Not securityPool');
		_mint(account, value);
	}

	function burn(address account, uint256 value) external {
		require(msg.sender == securityPool, 'Not securityPool');
		_burn(account, value);
	}

	function splitSomehow() external {
		// we need to somehow split this in a way that balances are maintained
	}
}
