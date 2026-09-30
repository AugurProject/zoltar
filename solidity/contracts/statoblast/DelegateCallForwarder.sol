// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IDelegateErrorDecoder {
	function decodeError(bytes calldata result) external pure returns (string memory reason);
}

/// @dev Keeps low-level delegatecall handling out of stateful protocol contracts.
/// Use `DelegateCall.invoke` instead when the caller must re-raise the callee's revert data unchanged.
library DelegateCallForwarder {
	/// @notice Delegatecalls `target` and returns its output.
	/// @dev On failure, asks `target.decodeError` to turn the revert data into an `Error(string)` reason and reverts with it.
	function invokeWithDecodedRevert(address target, bytes memory callData) internal returns (bytes memory returnData) {
		(bool success, bytes memory result) = target.delegatecall(callData);
		if (!success) revert(IDelegateErrorDecoder(target).decodeError(result));
		return result;
	}
}
