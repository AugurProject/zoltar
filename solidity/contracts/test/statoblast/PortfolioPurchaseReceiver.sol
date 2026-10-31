// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC1155Receiver } from '../../statoblast/interfaces/IERC1155Receiver.sol';
import { IERC165 } from '../../statoblast/interfaces/IERC165.sol';
import { SecurityPoolPortfolioServices } from '../../statoblast/SecurityPoolPortfolioServices.sol';

/// @dev Records the premium visible at the first untrusted recipient callback.
contract PortfolioPurchaseReceiver is IERC1155Receiver {
	SecurityPoolPortfolioServices public immutable services;
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	uint256 public observedPremium;
	constructor(SecurityPoolPortfolioServices service, uint248 universe, uint256 question) {
		services = service;
		universeId = universe;
		questionId = question;
	}
	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}
	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4) {
		(, observedPremium) = services.questionPremium(universeId, questionId);
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}
	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
	}
}
