// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Keeps low-level delegatecall and revert forwarding out of stateful protocol contracts.
library DelegateCallForwarder {
	function invoke(address target, bytes memory callData) internal returns (bytes memory returnData) {
		(bool success, bytes memory result) = target.delegatecall(callData);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 0x20), mload(result))
			}
		}
		return result;
	}
}
