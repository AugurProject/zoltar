// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IDelegateErrorDecoder {
	function decodeError(bytes calldata result) external pure returns (string memory reason);
}

/// @dev Keeps low-level delegatecall handling out of stateful protocol contracts.
library DelegateCallForwarder {
	function invoke(address target, bytes memory callData) internal returns (bytes memory returnData) {
		(bool success, bytes memory result) = target.delegatecall(callData);
		if (!success) revert(IDelegateErrorDecoder(target).decodeError(result));
		return result;
	}
}
