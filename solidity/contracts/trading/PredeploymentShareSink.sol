// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC1155Receiver } from '../statoblast/interfaces/IERC1155Receiver.sol';

/// @notice Irrecoverably quarantines shares sent to a counterfactual pair address before deployment.
contract PredeploymentShareSink is IERC1155Receiver {
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
	}
}
