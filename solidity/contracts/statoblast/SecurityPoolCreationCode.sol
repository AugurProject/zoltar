// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CreationCodeStorage } from './CreationCodeStorage.sol';

/// @dev Store creation bytecode outside a factory's runtime so both contracts
/// remain deployable under EIP-170. Leading STOP bytes make stores inert.
abstract contract SecurityPoolCreationCodeDeployer {
	address private immutable firstCode;
	address private immutable secondCode;

	constructor(bytes memory code) {
		(firstCode, secondCode) = CreationCodeStorage.store(code);
	}

	function _deploy(bytes memory arguments) internal returns (address deployed) {
		bytes memory code = CreationCodeStorage.load(firstCode, secondCode);
		bytes memory initCode = abi.encodePacked(code, arguments);
		assembly ('memory-safe') {
			deployed := create(0, add(initCode, 32), mload(initCode))
			if and(iszero(deployed), gt(returndatasize(), 0)) {
				let pointer := mload(0x40)
				returndatacopy(pointer, 0, returndatasize())
				revert(pointer, returndatasize())
			}
		}
		require(deployed != address(0), 'Module deployment failed');
	}
}
