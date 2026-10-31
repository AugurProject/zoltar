// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Store creation bytecode outside a factory's runtime so both contracts
/// remain deployable under EIP-170. Leading STOP bytes make stores inert.
abstract contract SecurityPoolCreationCodeDeployer {
	address private immutable firstCode;
	address private immutable secondCode;

	constructor(bytes memory code) {
		require(code.length != 0 && code.length <= 49_150, 'Invalid creation code length');
		uint256 middle = code.length / 2;
		bytes memory first = new bytes(middle + 1);
		bytes memory second = new bytes(code.length - middle + 1);
		assembly ('memory-safe') {
			mcopy(add(first, 33), add(code, 32), middle)
			mcopy(add(second, 33), add(add(code, 32), middle), sub(mload(code), middle))
		}
		firstCode = address(new SecurityPoolCreationCode(first));
		secondCode = address(new SecurityPoolCreationCode(second));
	}

	function _deploy(bytes memory arguments) internal returns (address deployed) {
		address first = firstCode;
		address second = secondCode;
		uint256 firstLength = first.code.length - 1;
		uint256 secondLength = second.code.length - 1;
		bytes memory code = new bytes(firstLength + secondLength);
		assembly ('memory-safe') {
			extcodecopy(first, add(code, 32), 1, firstLength)
			extcodecopy(second, add(add(code, 32), firstLength), 1, secondLength)
		}
		bytes memory initCode = abi.encodePacked(code, arguments);
		assembly ('memory-safe') {
			deployed := create(0, add(initCode, 32), mload(initCode))
		}
		require(deployed != address(0), 'Module deployment failed');
	}
}

contract SecurityPoolCreationCode {
	constructor(bytes memory code) {
		assembly ('memory-safe') {
			return(add(code, 32), mload(code))
		}
	}
}
