// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import './ERC20.sol';

contract ReputationToken is ERC20 {
	uint256 private totalTheoreticalSupply;
	address public immutable zoltar;
	event Mint(address account, uint256 value);
	event Burn(address account, uint256 value);

	modifier isZoltar {
		require(msg.sender == zoltar, 'Not zoltar');
		_;
	}

	constructor(address _zoltar) ERC20('Reputation', 'REP') {
		zoltar = _zoltar;
	}

	function setMaxTheoreticalSupply(uint256 _totalTheoreticalSupply) external isZoltar {
		totalTheoreticalSupply = _totalTheoreticalSupply;
	}

	function mint(address account, uint256 value) external isZoltar {
		_mint(account, value);
		emit Mint(account, value);
	}

	function burn(address account, uint256 value) external isZoltar {
		_burn(account, value);
		totalTheoreticalSupply -= value;
		emit Burn(account, value);
	}

    function getTotalTheoreticalSupply() external view returns (uint256) {
		return totalTheoreticalSupply;
	}
}
