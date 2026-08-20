// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../IERC20.sol';

contract FalseReturningERC20 is IERC20 {
	function totalSupply() external pure returns (uint256) {
		return 0;
	}

	function balanceOf(address) external pure returns (uint256) {
		return 0;
	}

	function transfer(address, uint256) external pure returns (bool) {
		return false;
	}

	function allowance(address, address) external pure returns (uint256) {
		return 0;
	}

	function approve(address, uint256) external pure returns (bool) {
		return false;
	}

	function transferFrom(address, address, uint256) external pure returns (bool) {
		return false;
	}
}
