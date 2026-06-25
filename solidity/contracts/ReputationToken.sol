// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './ERC20.sol';

contract ReputationToken is ERC20 {
	uint256 private totalTheoreticalSupply;
	address public immutable zoltar;
	event Mint(address account, uint256 value);
	event Burn(address account, uint256 value, uint256 totalTheoreticalSupply);
	event TheoreticalSupplySet(uint256 totalTheoreticalSupply);

	modifier isZoltar() {
		require(msg.sender == zoltar, 'ReputationToken caller must be the Zoltar contract');
		_;
	}

	constructor(address _zoltar) ERC20('Reputation', 'REP') {
		zoltar = _zoltar;
	}

	function setMaxTheoreticalSupply(uint256 _totalTheoreticalSupply) external isZoltar {
		totalTheoreticalSupply = _totalTheoreticalSupply;
		emit TheoreticalSupplySet(totalTheoreticalSupply);
	}

	function mint(address account, uint256 value) external isZoltar {
		_mint(account, value);
		emit Mint(account, value);
	}

	function burn(address account, uint256 value) external isZoltar {
		_burn(account, value);
		totalTheoreticalSupply -= value;
		emit Burn(account, value, totalTheoreticalSupply);
	}

	function getTotalTheoreticalSupply() external view returns (uint256) {
		return totalTheoreticalSupply;
	}
}
