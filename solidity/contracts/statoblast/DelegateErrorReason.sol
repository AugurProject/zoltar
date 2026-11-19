// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Shared `decodeError` body of the delegates that `DelegateCallForwarder` asks for a reason.
library DelegateErrorReason {
	string private constant GENERIC_REASON = 'Delegate call failed';

	/// @notice Returns the reason of an `Error(string)` revert payload, or a generic reason for anything else.
	/// @dev Never reverts: revert data bubbled up from another contract need not be well formed, and a
	/// reverting decoder would replace the readable reason with an empty revert.
	function decode(bytes calldata result) internal pure returns (string memory) {
		if (result.length < 68 || bytes4(result[:4]) != bytes4(keccak256('Error(string)'))) return GENERIC_REASON;
		bytes calldata payload = result[4:];
		uint256 offset = uint256(bytes32(payload[:32]));
		if (offset > payload.length - 32) return GENERIC_REASON;
		uint256 length = uint256(bytes32(payload[offset:offset + 32]));
		if (length > payload.length - offset - 32) return GENERIC_REASON;
		return string(payload[offset + 32:offset + 32 + length]);
	}
}
