// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from './IERC20.sol';
import { SafeERC20Ops } from './SafeERC20Ops.sol';

/// @dev Amounts are raw token units. No metadata or decimals method is required.
library Collateral {
	using SafeERC20Ops for IERC20;
	function pull(IERC20 token, address from, address to, uint256 amount) internal {
		if (amount == 0) return;
		uint256 beforeBalance = token.balanceOf(to);
		uint256 beforeSender = token.balanceOf(from);
		token.safeTransferFrom(from, to, amount);
		require(token.balanceOf(to) == beforeBalance + amount && token.balanceOf(from) + amount == beforeSender, 'Collateral transfer amount mismatch');
	}
	function send(IERC20 token, address to, uint256 amount) internal {
		if (amount == 0) return;
		uint256 beforeBalance = token.balanceOf(to);
		uint256 beforeSender = token.balanceOf(address(this));
		token.safeTransfer(to, amount);
		require(token.balanceOf(to) == beforeBalance + amount && token.balanceOf(address(this)) + amount == beforeSender, 'Collateral transfer amount mismatch');
	}
}
