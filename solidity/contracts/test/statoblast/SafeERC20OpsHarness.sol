// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../IERC20.sol';
import { SafeERC20Ops } from '../../SafeERC20Ops.sol';

contract SafeERC20OpsHarness {
	using SafeERC20Ops for IERC20;

	function safeApproveToken(IERC20 token, address spender, uint256 amount) external {
		token.safeApprove(spender, amount);
	}

	function safeTransferToken(IERC20 token, address receiver, uint256 amount) external {
		token.safeTransfer(receiver, amount);
	}

	function safeTransferFromToken(IERC20 token, address sender, address receiver, uint256 amount) external {
		token.safeTransferFrom(sender, receiver, amount);
	}
}
