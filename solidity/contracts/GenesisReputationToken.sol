// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import './ERC20.sol';
import './IReputationToken.sol';

contract GenesisReputationToken is ERC20, IReputationToken {
	uint256 private immutable totalTheoreticalSupply;

	constructor(address initialHolder, uint256 initialSupply) ERC20('Reputation', 'REP') {
		totalTheoreticalSupply = initialSupply;
		_mint(initialHolder, initialSupply);
	}

	function totalSupply() public view override(ERC20, IReputationToken) returns (uint256) {
		return super.totalSupply();
	}

	function balanceOf(address account) public view override(ERC20, IReputationToken) returns (uint256) {
		return super.balanceOf(account);
	}

	function transfer(address to, uint256 value) public override(ERC20, IReputationToken) returns (bool) {
		return super.transfer(to, value);
	}

	function approve(address spender, uint256 value) public override(ERC20, IReputationToken) returns (bool) {
		return super.approve(spender, value);
	}

	function transferFrom(address from, address to, uint256 value) public override(ERC20, IReputationToken) returns (bool) {
		return super.transferFrom(from, to, value);
	}

	function getTotalTheoreticalSupply() external view override returns (uint256) {
		return totalTheoreticalSupply;
	}
}
