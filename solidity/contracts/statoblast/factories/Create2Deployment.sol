// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library Create2Deployment {
	/// @notice Deploys `initCode` with CREATE2 and no value.
	/// @dev Re-raises nonempty constructor revert data unchanged. A failure without revert data
	/// returns the zero address so each caller keeps its own fallback failure.
	function deploy(bytes memory initCode, bytes32 salt) internal returns (address deployed) {
		assembly ('memory-safe') {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
	}
}
