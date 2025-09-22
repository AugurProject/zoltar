pragma solidity 0.8.30;

import './ERC20.sol';
import './IZoltar.sol';

contract ReputationToken is ERC20 {

	IZoltar public zoltar;

	constructor() ERC20('Reputation', 'REP') {
		zoltar = IZoltar(msg.sender);
	}

	function mint(address account, uint256 value) external {
		require(msg.sender == address(zoltar), "Not zoltar");
		_mint(account, value);
	}

	function burn(address account, uint256 value) external {
		require(msg.sender == address(zoltar), "Not zoltar");
		_burn(account, value);
	}
}
