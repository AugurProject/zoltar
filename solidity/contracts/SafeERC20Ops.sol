// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from './IERC20.sol';

library SafeERC20Ops {
	function safeApprove(IERC20 token, address spender, uint256 amount) internal {
		_callOptionalReturn(token, abi.encodeCall(IERC20.approve, (spender, amount)));
	}

	function safeTransfer(IERC20 token, address receiver, uint256 amount) internal {
		_callOptionalReturn(token, abi.encodeCall(IERC20.transfer, (receiver, amount)));
	}

	function safeTransferFrom(IERC20 token, address sender, address receiver, uint256 amount) internal {
		_callOptionalReturn(token, abi.encodeCall(IERC20.transferFrom, (sender, receiver, amount)));
	}

	function _callOptionalReturn(IERC20 token, bytes memory callData) private {
		require(address(token).code.length > 0, 'SafeERC20Ops token address must contain contract code');
		(bool success, bytes memory returnData) = address(token).call(callData);
		require(success, 'SafeERC20Ops token call reverted');
		if (returnData.length > 0) {
			require(abi.decode(returnData, (bool)), 'SafeERC20Ops token returned false from ERC20 call');
		}
	}
}
