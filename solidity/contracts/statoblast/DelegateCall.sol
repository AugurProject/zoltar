// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Low-level call helpers that re-raise the callee's revert data byte for byte.
/// `DelegateCallForwarder` is the separate variant that converts revert data into an `Error(string)` reason.
library DelegateCall {
	/// @notice Delegatecalls `target` and returns its output.
	/// @dev On failure, reverts with the callee's exact revert data, including empty data.
	function invoke(address target, bytes memory callData) internal returns (bytes memory returnData) {
		bool success;
		(success, returnData) = target.delegatecall(callData);
		if (!success) bubbleRevert(returnData);
	}

	/// @notice Reverts with `revertData` as the complete revert payload.
	function bubbleRevert(bytes memory revertData) internal pure {
		assembly ('memory-safe') {
			revert(add(revertData, 0x20), mload(revertData))
		}
	}
}
