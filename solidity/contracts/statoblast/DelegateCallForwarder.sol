// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { DelegateErrorReason } from './DelegateErrorReason.sol';

/// @dev Keeps low-level delegatecall handling out of stateful protocol contracts.
/// Use `DelegateCall.invoke` instead when the caller must re-raise the callee's revert data unchanged.
library DelegateCallForwarder {
	/// @notice Delegatecalls `target` and returns its output.
	/// @dev On failure, preserves Error(string) reasons and normalizes other payloads to a generic reason.
	function invokeWithDecodedRevert(address target, bytes memory callData) internal returns (bytes memory returnData) {
		(bool success, bytes memory result) = target.delegatecall(callData);
		if (!success) revert(DelegateErrorReason.decode(result));
		return result;
	}
}
