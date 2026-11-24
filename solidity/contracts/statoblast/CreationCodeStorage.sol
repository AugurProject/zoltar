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
		uint256 firstLength;
		uint256 secondLength;
		assembly ('memory-safe') {
			firstLength := extcodesize(firstChunk)
			secondLength := extcodesize(secondChunk)
		}
		creationCode = new bytes(firstLength + secondLength - 2);
		assembly ('memory-safe') {
			extcodecopy(firstChunk, add(creationCode, 0x20), 1, sub(firstLength, 1))
			extcodecopy(secondChunk, add(add(creationCode, 0x1f), firstLength), 1, sub(secondLength, 1))
		}
	}
}
