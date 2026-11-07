// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import '../../statoblast/interfaces/IERC1155Receiver.sol';
import { SecurityPoolPortfolio } from '../../statoblast/SecurityPoolPortfolio.sol';

contract CompleteSetReentrantReceiver is IERC1155Receiver {
	SecurityPoolPortfolio public immutable portfolio;
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	uint256 public reentrantValue;
	uint256 public reentryCount;

	constructor(SecurityPoolPortfolio root, uint248 universe, uint256 question) {
		portfolio = root;
		universeId = universe;
		questionId = question;
	}

	function attack(uint256 initialValue, uint256 nestedValue) external payable {
		reentrantValue = nestedValue;
		(uint256 fee, ) = portfolio.purchaseQuote(universeId, questionId, initialValue);
		portfolio.createCompleteSet{value: initialValue + fee}(universeId, questionId, initialValue, address(this), 0);
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC165).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
	}

	function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external returns (bytes4) {
		if (reentryCount == 0 && reentrantValue > 0) {
			reentryCount = 1;
			(uint256 fee, ) = portfolio.purchaseQuote(universeId, questionId, reentrantValue);
			portfolio.createCompleteSet{value: reentrantValue + fee}(universeId, questionId, reentrantValue, address(this), 0);
		}
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	receive() external payable {}
}
