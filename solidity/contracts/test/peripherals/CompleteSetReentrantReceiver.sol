// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../peripherals/interfaces/IERC1155Receiver.sol';
import '../../peripherals/interfaces/ISecurityPool.sol';

contract CompleteSetReentrantReceiver is IERC1155Receiver {
	bytes4 private constant ERC1155_RECEIVED_SELECTOR = 0xf23a6e61;
	bytes4 private constant ERC1155_BATCH_RECEIVED_SELECTOR = 0xbc197c81;
	bytes4 private constant ERC1155_RECEIVER_INTERFACE_ID = 0x4e2312e0;
	bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;

	ISecurityPool public immutable securityPool;
	uint256 public reentrantValue;
	uint256 public reentryCount;

	constructor(ISecurityPool _securityPool) payable {
		securityPool = _securityPool;
	}

	function attack(uint256 initialValue, uint256 _reentrantValue) external payable {
		require(msg.value == initialValue + _reentrantValue, 'funding');
		reentrantValue = _reentrantValue;
		securityPool.createCompleteSet{ value: initialValue }();
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_RECEIVER_INTERFACE_ID;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return ERC1155_RECEIVED_SELECTOR;
	}

	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata
	) external returns (bytes4) {
		if (reentryCount == 0 && reentrantValue > 0) {
			reentryCount = 1;
			securityPool.createCompleteSet{ value: reentrantValue }();
		}
		return ERC1155_BATCH_RECEIVED_SELECTOR;
	}

	receive() external payable {}
}
