// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './ERC20.sol';

contract ReputationToken is ERC20 {
	uint256 private totalTheoreticalSupplyAttoRep;
	address public immutable zoltar;
	event Mint(address indexed account, uint256 valueAttoRep);
	event Burn(address indexed account, uint256 valueAttoRep, uint256 totalTheoreticalSupplyAttoRep);
	event TheoreticalSupplySet(uint256 totalTheoreticalSupplyAttoRep);

	modifier isZoltar() {
		require(msg.sender == zoltar, 'ReputationToken caller must be the Zoltar contract');
		_;
	}

	constructor(address _zoltar) ERC20('Reputation', 'REP') {
		zoltar = _zoltar;
	}

	function setMaxTheoreticalSupplyAttoRep(uint256 totalTheoreticalSupplyAttoRep_) external isZoltar {
		totalTheoreticalSupplyAttoRep = totalTheoreticalSupplyAttoRep_;
		emit TheoreticalSupplySet(totalTheoreticalSupplyAttoRep);
	}

	function mint(address account, uint256 valueAttoRep) external isZoltar {
		// Defense in depth: preserve the theoretical-supply invariant even if future
		// migration accounting changes accidentally route an oversized mint here.
		require(totalSupply() + valueAttoRep <= totalTheoreticalSupplyAttoRep, 'Mint exceeds theoretical supply');
		_mint(account, valueAttoRep);
		emit Mint(account, valueAttoRep);
	}

	function burn(address account, uint256 valueAttoRep) external isZoltar {
		_burn(account, valueAttoRep);
		totalTheoreticalSupplyAttoRep -= valueAttoRep;
		emit Burn(account, valueAttoRep, totalTheoreticalSupplyAttoRep);
	}

	function getTotalTheoreticalSupplyAttoRep() external view returns (uint256) {
		return totalTheoreticalSupplyAttoRep;
	}
}
