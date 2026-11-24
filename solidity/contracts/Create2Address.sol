// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library Create2Address {
	function predict(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address) {
		return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), deployer, salt, initCodeHash)))));
	}
}
