// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Inert STOP-prefixed carriers. Deployment policy stays with each caller.
contract CreationCodeChunk {
	constructor(bytes memory data) {
		assembly ('memory-safe') {
			let length := mload(data)
			mstore8(add(data, 0x1f), 0)
			return(add(data, 0x1f), add(length, 1))
		}
	}
}

library CreationCodeStorage {
	function store(bytes memory creationCode) internal returns (address firstChunk, address secondChunk) {
		require(creationCode.length != 0 && creationCode.length <= 49_150, 'Invalid creation code length');
		uint256 firstLength = creationCode.length / 2;
		bytes memory first = new bytes(firstLength);
		bytes memory second = new bytes(creationCode.length - firstLength);
		assembly ('memory-safe') {
			mcopy(add(first, 0x20), add(creationCode, 0x20), firstLength)
			mcopy(add(second, 0x20), add(add(creationCode, 0x20), firstLength), sub(mload(creationCode), firstLength))
		}
		firstChunk = address(new CreationCodeChunk(first));
		secondChunk = address(new CreationCodeChunk(second));
	}

	function load(address firstChunk, address secondChunk) internal view returns (bytes memory creationCode) {
		uint256 firstLength = firstChunk.code.length;
		uint256 secondLength = secondChunk.code.length;
		creationCode = new bytes(firstLength + secondLength - 2);
		assembly ('memory-safe') {
			extcodecopy(firstChunk, add(creationCode, 0x20), 1, sub(firstLength, 1))
			extcodecopy(secondChunk, add(add(creationCode, 0x1f), firstLength), 1, sub(secondLength, 1))
		}
	}

	/// @notice Deploys `initCode` with CREATE and no value.
	/// @dev Re-raises nonempty constructor revert data unchanged and otherwise reverts with a fixed reason.
	function deploy(bytes memory initCode) internal returns (address deployed) {
		assembly ('memory-safe') {
			deployed := create(0, add(initCode, 0x20), mload(initCode))
		}
		_requireDeployed(deployed);
	}

	/// @notice Deploys `initCode` with CREATE2 under `salt` and no value.
	/// @dev Re-raises nonempty constructor revert data unchanged and otherwise reverts with a fixed reason.
	function deploy2(bytes memory initCode, bytes32 salt) internal returns (address deployed) {
		assembly ('memory-safe') {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
		}
		_requireDeployed(deployed);
	}

	function _requireDeployed(address deployed) private pure {
		if (deployed != address(0)) return;
		assembly ('memory-safe') {
			let size := returndatasize()
			if gt(size, 0) {
				let data := mload(0x40)
				returndatacopy(data, 0, size)
				revert(data, size)
			}
		}
		revert('Contract deployment failed');
	}
}

/// @dev Stores creation bytecode outside a deployer's runtime so both contracts remain
/// deployable under EIP-170. The two chunks are created at this deployer's first two nonces.
abstract contract CreationCodeDeployer {
	address private immutable firstCode;
	address private immutable secondCode;

	constructor(bytes memory code) {
		(firstCode, secondCode) = CreationCodeStorage.store(code);
	}

	/// @dev The stored creation code followed by ABI-encoded constructor `arguments`.
	function _initCode(bytes memory arguments) internal view returns (bytes memory) {
		return abi.encodePacked(CreationCodeStorage.load(firstCode, secondCode), arguments);
	}

	function _deploy(bytes memory arguments) internal returns (address) {
		return CreationCodeStorage.deploy(_initCode(arguments));
	}

	function _deploy2(bytes memory arguments, bytes32 salt) internal returns (address) {
		return CreationCodeStorage.deploy2(_initCode(arguments), salt);
	}
}
