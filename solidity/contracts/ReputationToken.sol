// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import './ERC20.sol';

contract ReputationToken is ERC20 {
	uint256 public maxTheoreticalSupply;
	address public immutable zoltar;

	constructor(address _zoltar, uint256 _maxTheoreticalSupply) ERC20('Reputation', 'REP') {
		zoltar = _zoltar;
		maxTheoreticalSupply = _maxTheoreticalSupply;
	}

	function mint(address account, uint256 value) external {
		require(msg.sender == zoltar, "Not zoltar");
		_mint(account, value);
	}

	function burn(address account, uint256 value) external {
		require(msg.sender == zoltar, "Not zoltar");
		_burn(account, value);
		maxTheoreticalSupply -= value;
	}

    function getTotalTheoreticalSupply() external view returns (uint256) {
		return maxTheoreticalSupply;
	}
}
