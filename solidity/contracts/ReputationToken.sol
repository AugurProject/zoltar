// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import './ERC20.sol';

contract ReputationToken is ERC20 {

	address public zoltar;

	constructor(address _zoltar) ERC20('Reputation', 'REP') {
		zoltar = _zoltar;
	}

	function mint(address account, uint256 value) external {
		require(msg.sender == zoltar, "Not zoltar");
		_mint(account, value);
	}

	function burn(address account, uint256 value) external {
		require(msg.sender == zoltar, "Not zoltar");
		_burn(account, value);
	}
}
