// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CreationCodeStorage } from './CreationCodeStorage.sol';

/// @dev EIP-1167 runtime followed by immutable, contract-specific bindings.
library SecurityPoolBoundClones {
	uint256 internal constant FORWARDER_LENGTH = 45;

	/// @dev The 45-byte forwarder is followed by one packed 20-byte address.
	function boundAddress() internal view returns (address binding) {
		uint256 offset = FORWARDER_LENGTH;
		require(address(this).code.length == offset + 20, 'Capital module requires a clone');
		assembly ('memory-safe') {
			extcodecopy(address(), 0, offset, 20)
			binding := shr(96, mload(0))
		}
	}

	/// @dev Bindings after the forwarder are a 31-byte uint248 universe ID,
	/// then a 20-byte token address. The shifts discard each word's trailing bytes.
	function universeBindings() internal view returns (uint248 universe, address token) {
		uint256 offset = FORWARDER_LENGTH;
		require(address(this).code.length == offset + 51, 'Universe module requires a clone');
		assembly ('memory-safe') {
			let ptr := mload(0x40)
			extcodecopy(address(), ptr, offset, 51)
			universe := shr(8, mload(ptr))
			token := shr(96, mload(add(ptr, 31)))
		}
	}

	function initCode(address implementation, bytes memory bindings) internal pure returns (bytes memory) {
		bytes memory runtime = abi.encodePacked(hex'363d3d373d3d3d363d73', implementation, hex'5af43d82803e903d91602b57fd5bf3', bindings);
		return abi.encodePacked(hex'3d61', uint16(runtime.length), hex'80600b3d3981f3', runtime);
	}

	function create(address implementation, bytes memory bindings) internal returns (address) {
		return CreationCodeStorage.deploy(initCode(implementation, bindings));
	}
}
