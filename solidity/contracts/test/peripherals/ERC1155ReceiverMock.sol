// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../peripherals/interfaces/IERC1155Receiver.sol';
import '../../peripherals/interfaces/ISecurityPool.sol';
import '../../peripherals/interfaces/IShareToken.sol';

contract ERC1155ReceiverMock is IERC1155Receiver {
	bytes4 private constant ERC1155_RECEIVED_SELECTOR = 0xf23a6e61;
	bytes4 private constant ERC1155_BATCH_RECEIVED_SELECTOR = 0xbc197c81;
	bytes4 private constant ERC1155_RECEIVER_INTERFACE_ID = 0x4e2312e0;
	bytes4 private constant ERC165_INTERFACE_ID = 0x01ffc9a7;

	bool public acceptSingle = true;
	bool public acceptBatch = true;
	bool public revertOnReceive;
	bool public panicOnReceive;
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

	function setPanicOnReceive(bool _panicOnReceive) external {
		panicOnReceive = _panicOnReceive;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == ERC165_INTERFACE_ID || interfaceId == ERC1155_RECEIVER_INTERFACE_ID;
	}

	function onERC1155Received(
		address operator,
		address from,
		uint256 id,
		uint256 value,
		bytes calldata data
	) external returns (bytes4) {
		if (panicOnReceive) assert(false);
		if (revertOnReceive) revert('ERC1155 receiver mock configured to revert on single receive');
		lastOperator = operator;
		lastFrom = from;
		lastId = id;
		lastValue = value;
		lastData = data;
		singleReceiveCount += 1;
		return acceptSingle ? ERC1155_RECEIVED_SELECTOR : bytes4(0);
	}

	function onERC1155BatchReceived(
		address operator,
		address from,
		uint256[] calldata,
		uint256[] calldata,
		bytes calldata data
	) external returns (bytes4) {
		if (panicOnReceive) assert(false);
		if (revertOnReceive) revert('ERC1155 receiver mock configured to revert on batch receive');
		lastOperator = operator;
		lastFrom = from;
		lastData = data;
		batchReceiveCount += 1;
		return acceptBatch ? ERC1155_BATCH_RECEIVED_SELECTOR : bytes4(0);
	}
}

contract ERC1155NonReceiver {}

contract ShareTokenAuthorizationPoolMock {
	IShareToken public immutable shareToken;
	uint248 public immutable universeId;
	SystemState public systemState = SystemState.ForkMigration;
	address public securityPoolForker;

	constructor(IShareToken _shareToken, uint248 _universeId) {
		shareToken = _shareToken;
		universeId = _universeId;
	}

	function authorizePool(ISecurityPool pool) external {
		shareToken.authorize(pool);
	}
}
