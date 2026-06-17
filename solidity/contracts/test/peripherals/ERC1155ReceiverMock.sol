// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../peripherals/interfaces/IERC1155Receiver.sol';

contract ERC1155ReceiverMock is IERC1155Receiver {
	bytes4 private constant ERC1155_RECEIVED_SELECTOR = 0xf23a6e61;
	bytes4 private constant ERC1155_BATCH_RECEIVED_SELECTOR = 0xbc197c81;
	bytes4 private constant ERC1155_RECEIVER_INTERFACE_ID = 0x4e2312e0;
	bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;

	bool public acceptSingle = true;
	bool public acceptBatch = true;
	bool public revertOnReceive;
	address public lastOperator;
	address public lastFrom;
	uint256 public lastId;
	uint256 public lastValue;
	bytes public lastData;
	uint256 public singleReceiveCount;
	uint256 public batchReceiveCount;

	function setBehavior(bool _acceptSingle, bool _acceptBatch, bool _revertOnReceive) external {
		acceptSingle = _acceptSingle;
		acceptBatch = _acceptBatch;
		revertOnReceive = _revertOnReceive;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_RECEIVER_INTERFACE_ID;
	}

	function onERC1155Received(address operator, address from, uint256 id, uint256 value, bytes calldata data) external returns (bytes4) {
		if (revertOnReceive) revert('receiver reverted');
		lastOperator = operator;
		lastFrom = from;
		lastId = id;
		lastValue = value;
		lastData = data;
		singleReceiveCount += 1;
		return acceptSingle ? ERC1155_RECEIVED_SELECTOR : bytes4(0);
	}

	function onERC1155BatchReceived(address operator, address from, uint256[] calldata, uint256[] calldata, bytes calldata data) external returns (bytes4) {
		if (revertOnReceive) revert('receiver reverted');
		lastOperator = operator;
		lastFrom = from;
		lastData = data;
		batchReceiveCount += 1;
		return acceptBatch ? ERC1155_BATCH_RECEIVED_SELECTOR : bytes4(0);
	}
}

contract ERC1155NonReceiver {}
