// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../statoblast/interfaces/IERC1155Receiver.sol';
import '../../statoblast/interfaces/ISecurityPool.sol';

contract CompleteSetReentrantReceiver is IERC1155Receiver {
	bytes4 private constant ERC1155_RECEIVED_SELECTOR = IERC1155Receiver.onERC1155Received.selector;
	bytes4 private constant ERC1155_BATCH_RECEIVED_SELECTOR = IERC1155Receiver.onERC1155BatchReceived.selector;

	ISecurityPool public immutable securityPool;
	uint256 public reentrantValue;
	uint256 public reentryCount;

	constructor(ISecurityPool _securityPool) payable {
		securityPool = _securityPool;
	}

	function attack(uint256 initialValue, uint256 _reentrantValue) external payable {
		require(msg.value == initialValue + _reentrantValue, 'Reentrant receiver funding must equal initial plus reentrant value');
		reentrantValue = _reentrantValue;
		securityPool.createCompleteSet{value: initialValue}();
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return ERC1155_RECEIVED_SELECTOR;
	}

	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4) {
		if (reentryCount == 0 && reentrantValue > 0) {
			reentryCount = 1;
			securityPool.createCompleteSet{value: reentrantValue}();
		}
		return ERC1155_BATCH_RECEIVED_SELECTOR;
	}

	receive() external payable {}
}
