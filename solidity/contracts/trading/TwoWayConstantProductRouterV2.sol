// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../statoblast/BinaryOutcomes.sol';
import { IERC1155Receiver } from '../statoblast/interfaces/IERC1155Receiver.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../statoblast/interfaces/ISecurityPool.sol';
import { ITradingShareToken } from './interfaces/ITradingShareToken.sol';
import { ITwoWayConstantProductFactoryV2 } from './interfaces/ITwoWayConstantProductFactoryV2.sol';
import { ITwoWayConstantProductPairV2 } from './interfaces/ITwoWayConstantProductPairV2.sol';

contract TwoWayConstantProductRouterV2 is IERC1155Receiver {
	uint256 public constant IMPLEMENTATION_VERSION = 2;
	uint8 public constant CALLBACK_VERSION = 1;

	enum ReceiveOperation {
		ExitPosition,
		RedeemCompleteSet
	}

	struct ReceiveRequest {
		uint8 version;
		ReceiveOperation operation;
		address shareToken;
		ISecurityPool securityPool;
		ITwoWayConstantProductPairV2 pair;
		uint248 universeId;
		uint256 questionId;
		uint256 invalidTokenId;
		uint256 yesTokenId;
		uint256 noTokenId;
		BinaryOutcomes.BinaryOutcome longOutcome;
		uint256 completeSetShares;
		uint256 maxLongSharesIn;
		uint256 minEthOut;
		address payable payoutRecipient;
		address refundRecipient;
		uint256 deadline;
	}

	ITwoWayConstantProductFactoryV2 public immutable factory;
	bool private entered;
	bool private internalShareCallback;
	bool private ethCallbackActive;
	ISecurityPool private callbackPool;
	ITradingShareToken private callbackToken;

	modifier nonReentrant() {
		require(!entered, 'Reentrant call');
		entered = true;
		_;
		entered = false;
	}

	modifier beforeDeadline(uint256 deadline) {
		require(block.timestamp <= deadline, 'Deadline expired');
		_;
	}

	constructor(ITwoWayConstantProductFactoryV2 _factory) {
		require(address(_factory) != address(0), 'Factory is zero');
		factory = _factory;
	}

	function removeLiquidityWithPermit(ITwoWayConstantProductPairV2 pair, uint256 liquidity, uint256 minYesOut, uint256 minNoOut, address recipient, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant beforeDeadline(deadline) returns (uint256 yesOut, uint256 noOut) {
		_validatePair(pair);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		try pair.permit(msg.sender, address(this), liquidity, deadline, v, r, s) {} catch {
			require(pair.allowance(msg.sender, address(this)) >= liquidity, 'LP permit or allowance');
		}
		require(pair.transferFrom(msg.sender, address(this), liquidity), 'LP transfer failed');
		return pair.removeLiquidity(liquidity, minYesOut, minNoOut, recipient, deadline);
	}

	function onERC1155Received(address operator, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
		require(entered && internalShareCallback && msg.sender == address(callbackToken), 'Batch transfer required');
		require(operator == address(factory.getPair(callbackPool)), 'Unexpected callback operator');
		require(id == callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes) || id == callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No), 'Unexpected callback ID');
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address operator, address from, uint256[] calldata ids, uint256[] calldata values, bytes calldata data) external returns (bytes4) {
		if (entered) {
			_validateInternalCallback(operator, ids, values);
			return IERC1155Receiver.onERC1155BatchReceived.selector;
		}
		entered = true;
		require(operator == from && from != address(0), 'Transfer must be owner initiated');
		ReceiveRequest memory request = abi.decode(data, (ReceiveRequest));
		_validateRequest(request);
		require(msg.sender == request.shareToken, 'Wrong share token');
		require(block.timestamp <= request.deadline, 'Deadline expired');
		callbackPool = request.securityPool;
		callbackToken = ITradingShareToken(request.shareToken);
		uint256[3] memory priorBalances = _priorBalances(request, ids, values);
		if (request.operation == ReceiveOperation.ExitPosition) _exitPosition(request, from, ids, values);
		else if (request.operation == ReceiveOperation.RedeemCompleteSet) _redeemCompleteSet(request, ids, values);
		else revert('Unsupported operation');
		_requireBalances(priorBalances);
		callbackPool = ISecurityPool(payable(address(0)));
		callbackToken = ITradingShareToken(address(0));
		entered = false;
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
	}

	receive() external payable {
		require(ethCallbackActive && msg.sender == address(callbackPool), 'Unexpected ETH');
	}

	function _exitPosition(ReceiveRequest memory request, address owner, uint256[] calldata ids, uint256[] calldata values) private {
		bool longYes = _isDirectionalOutcome(request.longOutcome);
		uint256 longTokenId = longYes ? request.yesTokenId : request.noTokenId;
		require(ids.length == 2 && values.length == 2, 'Exit share count');
		require(ids[0] == request.invalidTokenId && ids[1] == longTokenId, 'Exit share IDs');
		require(values[0] == request.completeSetShares && values[1] == request.maxLongSharesIn, 'Exit share amounts');
		(uint256 swapInput, ) = request.pair.quoteExactOutput(longYes, request.completeSetShares);
		uint256 totalLong = request.completeSetShares + swapInput;
		require(totalLong <= request.maxLongSharesIn, 'Maximum long shares');
		bool wasApproved = callbackToken.isApprovedForAll(address(this), address(request.pair));
		if (!wasApproved) callbackToken.setApprovalForAll(address(request.pair), true);
		internalShareCallback = true;
		request.pair.swapExactOutput(longYes, request.completeSetShares, swapInput, address(this));
		internalShareCallback = false;
		if (!wasApproved) callbackToken.setApprovalForAll(address(request.pair), false);
		_redeem(request);
		uint256 refund = request.maxLongSharesIn - totalLong;
		if (refund > 0) callbackToken.safeTransferFrom(address(this), request.refundRecipient, longTokenId, refund, '');
		emit PositionExitedByTransfer(owner, address(request.pair), request.completeSetShares, totalLong, refund, request.payoutRecipient);
	}

	function _redeemCompleteSet(ReceiveRequest memory request, uint256[] calldata ids, uint256[] calldata values) private {
		require(ids.length == 3 && values.length == 3, 'Complete set share count');
		require(ids[0] == request.invalidTokenId && ids[1] == request.yesTokenId && ids[2] == request.noTokenId, 'Complete set IDs');
		require(values[0] == request.completeSetShares && values[1] == request.completeSetShares && values[2] == request.completeSetShares, 'Complete set amounts');
		require(request.maxLongSharesIn == 0 && request.longOutcome == BinaryOutcomes.BinaryOutcome.None, 'Unexpected redeem fields');
		_redeem(request);
		emit CompleteSetRedeemedByTransfer(address(request.securityPool), request.completeSetShares, request.payoutRecipient);
	}

	function _redeem(ReceiveRequest memory request) private {
		uint256 ethBefore = address(this).balance;
		ethCallbackActive = true;
		request.securityPool.redeemCompleteSet(request.completeSetShares);
		ethCallbackActive = false;
		uint256 ethOut = address(this).balance - ethBefore;
		require(ethOut > 0 && ethOut >= request.minEthOut, 'Minimum ETH output');
		(bool success, ) = request.payoutRecipient.call{value: ethOut}('');
		require(success, 'ETH transfer failed');
	}

	function _validateRequest(ReceiveRequest memory request) private view {
		require(request.version == CALLBACK_VERSION, 'Unsupported callback version');
		require(request.completeSetShares > 0, 'Complete set is zero');
		require(request.payoutRecipient != address(0) && request.payoutRecipient != address(this), 'Invalid payout recipient');
		require(request.refundRecipient != address(0) && request.refundRecipient != address(this), 'Invalid refund recipient');
		_validatePair(request.pair);
		require(address(request.securityPool) == address(request.pair.securityPool()), 'Wrong security pool');
		require(request.shareToken == address(request.pair.shareToken()), 'Wrong request share token');
		require(request.universeId == request.securityPool.universeId() && request.universeId == request.pair.universeId(), 'Wrong universe');
		require(request.questionId == request.securityPool.questionId() && request.questionId == request.pair.questionId(), 'Wrong question');
		require(request.invalidTokenId == request.pair.invalidTokenId() && request.yesTokenId == request.pair.yesTokenId() && request.noTokenId == request.pair.noTokenId(), 'Wrong outcome IDs');
		require(address(request.securityPool.shareToken().canonicalPoolByUniverse(request.universeId)) == address(request.securityPool), 'Noncanonical share pool');
	}

	function _validatePair(ITwoWayConstantProductPairV2 pair) private view {
		require(factory.isPair(address(pair)), 'Unrecognized pair');
		require(address(factory.getPair(pair.securityPool())) == address(pair), 'Noncanonical pair');
		ISecurityPoolFactory coreFactory = factory.securityPoolFactory();
		require(address(pair.securityPool().securityPoolFactory()) == address(coreFactory), 'Wrong security pool factory');
	}

	function _validateInternalCallback(address operator, uint256[] calldata ids, uint256[] calldata values) private view {
		require(internalShareCallback && msg.sender == address(callbackToken), 'Unexpected share callback');
		require(operator == address(factory.getPair(callbackPool)), 'Unexpected callback operator');
		require(ids.length == values.length && ids.length > 0, 'Invalid callback batch');
		for (uint256 index = 0; index < ids.length; index++)
			require(ids[index] == callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes) || ids[index] == callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No), 'Unexpected callback ID');
	}

	function _priorBalances(ReceiveRequest memory request, uint256[] calldata ids, uint256[] calldata values) private view returns (uint256[3] memory prior) {
		prior[0] = callbackToken.balanceOf(address(this), request.invalidTokenId);
		prior[1] = callbackToken.balanceOf(address(this), request.yesTokenId);
		prior[2] = callbackToken.balanceOf(address(this), request.noTokenId);
		for (uint256 index = 0; index < ids.length; index++) {
			if (ids[index] == request.invalidTokenId) prior[0] -= values[index];
			else if (ids[index] == request.yesTokenId) prior[1] -= values[index];
			else if (ids[index] == request.noTokenId) prior[2] -= values[index];
			else revert('Unexpected share ID');
		}
	}

	function _requireBalances(uint256[3] memory expected) private view {
		require(callbackToken.balanceOf(address(this), callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Invalid)) == expected[0], 'Router INVALID residue');
		require(callbackToken.balanceOf(address(this), callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes)) == expected[1], 'Router YES residue');
		require(callbackToken.balanceOf(address(this), callbackToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No)) == expected[2], 'Router NO residue');
	}

	function _isDirectionalOutcome(BinaryOutcomes.BinaryOutcome outcome) private pure returns (bool) {
		require(outcome == BinaryOutcomes.BinaryOutcome.Yes || outcome == BinaryOutcomes.BinaryOutcome.No, 'Outcome must be YES or NO');
		return outcome == BinaryOutcomes.BinaryOutcome.Yes;
	}

	event PositionExitedByTransfer(address indexed owner, address indexed pair, uint256 completeSetShares, uint256 longSharesUsed, uint256 longSharesRefunded, address payoutRecipient);
	event CompleteSetRedeemedByTransfer(address indexed securityPool, uint256 completeSetShares, address payoutRecipient);
}
