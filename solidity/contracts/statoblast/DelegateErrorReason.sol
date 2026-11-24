// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Decodes delegate failures locally without calling the failed target again.
library DelegateErrorReason {
	string private constant GENERIC_REASON = 'Delegate call failed';

	/// @notice Returns an Error(string) reason, or a generic reason for every other payload.
	/// @dev Validate offsets before reading: callees can return malformed revert data.
	function decode(bytes memory result) internal pure returns (string memory) {
		if (result.length < 68) return GENERIC_REASON;
		bytes4 selector;
		uint256 offset;
		assembly ('memory-safe') {
			selector := mload(add(result, 32))
			offset := mload(add(result, 36))
		}
		uint256 payloadLength = result.length - 4;
		if (selector != bytes4(keccak256('Error(string)')) || offset > payloadLength - 32) return GENERIC_REASON;
		uint256 length;
		assembly ('memory-safe') {
			length := mload(add(add(result, 36), offset))
		}
		if (length > payloadLength - offset - 32) return GENERIC_REASON;
		bytes memory reason = new bytes(length);
		assembly ('memory-safe') {
			mcopy(add(reason, 32), add(add(result, 68), offset), length)
		}
		return string(reason);
	}
}
