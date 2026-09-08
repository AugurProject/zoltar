// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../statoblast/BinaryOutcomes.sol';
import { ISecurityPool, ISecurityPoolFactory } from '../statoblast/interfaces/ISecurityPool.sol';
import { IERC1155Receiver } from '../statoblast/interfaces/IERC1155Receiver.sol';
import { ITwoWayConstantProductFactory } from './interfaces/ITwoWayConstantProductFactory.sol';
import { ITwoWayConstantProductPair } from './interfaces/ITwoWayConstantProductPair.sol';
import { ITradingShareToken } from './interfaces/ITradingShareToken.sol';
import { TwoWayConstantProductMath } from './TwoWayConstantProductMath.sol';

contract TwoWayConstantProductRouter is IERC1155Receiver {
	struct EnterResult {
		uint256 ethSpent;
		uint256 completeSetShares;
		uint256 oppositeSharesSwapped;
		uint256 additionalLongShares;
		uint256 totalLongShares;
		uint256 invalidInsurance;
		uint256 feeAmount;
		uint256 conditionalYesBpsBefore;
		uint256 conditionalYesBpsAfter;
	}

	struct LiquidityResult {
		ITwoWayConstantProductPair pair;
		uint256 completeSetShares;
		uint256 yesUsed;
		uint256 noUsed;
		uint256 yesReturned;
		uint256 noReturned;
		uint256 invalidInsurance;
		uint256 liquidity;
	}

	enum ReceiveOperation {
		ExitPosition,
		RedeemCompleteSet
	}

	struct ReceiveRequest {
		uint8 version;
		ReceiveOperation operation;
		address shareToken;
		ISecurityPool securityPool;
		ITwoWayConstantProductPair pair;
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

	uint8 public constant CALLBACK_VERSION = 1;

	ITwoWayConstantProductFactory public immutable factory;
	bool private entered;
	bool private callbackActive;
	bool private receiveInternalShareCallback;
	bool private ethCallbackActive;
	ISecurityPool private callbackPool;
	ITradingShareToken private callbackShareToken;

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

	constructor(ITwoWayConstantProductFactory _factory) {
		require(address(_factory) != address(0), 'Factory is zero');
		factory = _factory;
	}

	function enterPosition(ITwoWayConstantProductPair pair, BinaryOutcomes.BinaryOutcome longOutcome, uint256 minLongSharesOut, address recipient, uint256 deadline) external payable nonReentrant beforeDeadline(deadline) returns (EnterResult memory result) {
		_validatePair(pair);
		bool longYes = _isDirectionalOutcome(longOutcome);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		require(msg.value > 0, 'ETH input is zero');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		(uint256 yesBefore, uint256 noBefore) = pair.getEffectiveReserves();
		pool.createCompleteSet{value: msg.value}();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(pool, startInvalid, startYes, startNo);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		(uint256 additionalLong, uint256 feeAmount) = pair.swapExactInput(!longYes, mintedInvalid, 0, address(this));
		uint256 totalLong = mintedInvalid + additionalLong;
		require(totalLong >= minLongSharesOut, 'Minimum long shares');
		_transferPosition(pool, recipient, longYes, mintedInvalid, totalLong);
		(uint256 yesAfter, uint256 noAfter) = pair.getReserves();
		_endShareOperation(startInvalid, startYes, startNo);
		result = EnterResult(msg.value, mintedInvalid, mintedInvalid, additionalLong, totalLong, mintedInvalid, feeAmount, TwoWayConstantProductMath.conditionalYesBps(yesBefore, noBefore), TwoWayConstantProductMath.conditionalYesBps(yesAfter, noAfter));
	}

	function createPairAndInitializeWithEth(ISecurityPool pool, uint256 conditionalYesBpsValue, uint256 minLiquidity, address recipient, uint256 deadline) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		ITwoWayConstantProductPair pair = factory.createPair(pool);
		require(pair.totalSupply() == 0, 'Pair already initialized');
		result = _initializeWithEth(pair, conditionalYesBpsValue, minLiquidity, recipient);
	}

	function initializeWithEth(ITwoWayConstantProductPair pair, uint256 conditionalYesBpsValue, uint256 minLiquidity, address recipient, uint256 deadline) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		_validatePair(pair);
		require(pair.totalSupply() == 0, 'Pair already initialized');
		result = _initializeWithEth(pair, conditionalYesBpsValue, minLiquidity, recipient);
	}

	function addLiquidityWithEth(ITwoWayConstantProductPair pair, uint256 minLiquidity, address recipient, uint256 deadline) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		_validatePair(pair);
		require(msg.value > 0, 'ETH input is zero');
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		pool.createCompleteSet{value: msg.value}();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(pool, startInvalid, startYes, startNo);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		(uint256 yesUsed, uint256 noUsed, uint256 liquidity) = pair.addLiquidity(mintedYes, mintedNo, minLiquidity, recipient);
		uint256 yesReturned = mintedYes - yesUsed;
		uint256 noReturned = mintedNo - noUsed;
		_transferShares(pool, recipient, mintedInvalid, yesReturned, noReturned);
		_endShareOperation(startInvalid, startYes, startNo);
		result = LiquidityResult(pair, mintedInvalid, yesUsed, noUsed, yesReturned, noReturned, mintedInvalid, liquidity);
	}

	function removeLiquidityWithPermit(ITwoWayConstantProductPair pair, uint256 liquidity, uint256 minYesOut, uint256 minNoOut, address recipient, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant beforeDeadline(deadline) returns (uint256 yesOut, uint256 noOut) {
		_validatePair(pair);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		try pair.permit(msg.sender, address(this), liquidity, deadline, v, r, s) {} catch {
			require(pair.allowance(msg.sender, address(this)) >= liquidity, 'LP permit or allowance');
		}
		require(pair.transferFrom(msg.sender, address(this), liquidity), 'LP transfer failed');
		return pair.removeLiquidity(liquidity, minYesOut, minNoOut, recipient, deadline);
	}

	function onERC1155Received(address operator, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
		if (receiveInternalShareCallback) {
			require(entered && msg.sender == address(callbackShareToken), 'Batch transfer required');
			require(operator == address(factory.getPair(callbackPool)), 'Unexpected callback operator');
			require(id == callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes) || id == callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No), 'Unexpected callback ID');
		} else _validateShareCallback(id);
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address operator, address from, uint256[] calldata ids, uint256[] calldata values, bytes calldata data) external returns (bytes4) {
		if (entered) {
			if (receiveInternalShareCallback) _validateReceiveInternalCallback(operator, ids, values);
			else {
				require(ids.length > 0, 'Empty share batch');
				for (uint256 index = 0; index < ids.length; index++) _validateShareCallback(ids[index]);
			}
			return IERC1155Receiver.onERC1155BatchReceived.selector;
		}
		entered = true;
		require(operator == from && from != address(0), 'Transfer must be owner initiated');
		ReceiveRequest memory request = abi.decode(data, (ReceiveRequest));
		_validateReceiveRequest(request);
		require(msg.sender == request.shareToken, 'Wrong share token');
		require(block.timestamp <= request.deadline, 'Deadline expired');
		callbackPool = request.securityPool;
		callbackShareToken = ITradingShareToken(request.shareToken);
		uint256[3] memory priorBalances = _priorReceiveBalances(request, ids, values);
		if (request.operation == ReceiveOperation.ExitPosition) _exitReceivedPosition(request, from, ids, values);
		else if (request.operation == ReceiveOperation.RedeemCompleteSet) _redeemReceivedCompleteSet(request, ids, values);
		else revert('Unsupported operation');
		_requireReceiveBalances(priorBalances);
		callbackPool = ISecurityPool(payable(address(0)));
		callbackShareToken = ITradingShareToken(address(0));
		entered = false;
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
	}

	receive() external payable {
		require(ethCallbackActive && msg.sender == address(callbackPool), 'Unexpected ETH');
	}

	function _exitReceivedPosition(ReceiveRequest memory request, address owner, uint256[] calldata ids, uint256[] calldata values) private {
		bool longYes = _isDirectionalOutcome(request.longOutcome);
		uint256 longTokenId = longYes ? request.yesTokenId : request.noTokenId;
		require(ids.length == 2 && values.length == 2, 'Exit share count');
		require(ids[0] == request.invalidTokenId && ids[1] == longTokenId, 'Exit share IDs');
		require(values[0] == request.completeSetShares && values[1] == request.maxLongSharesIn, 'Exit share amounts');
		(uint256 swapInput, ) = request.pair.quoteExactOutput(longYes, request.completeSetShares);
		uint256 totalLong = request.completeSetShares + swapInput;
		require(totalLong <= request.maxLongSharesIn, 'Maximum long shares');
		bool wasApproved = callbackShareToken.isApprovedForAll(address(this), address(request.pair));
		if (!wasApproved) callbackShareToken.setApprovalForAll(address(request.pair), true);
		receiveInternalShareCallback = true;
		request.pair.swapExactOutput(longYes, request.completeSetShares, swapInput, address(this));
		receiveInternalShareCallback = false;
		if (!wasApproved) callbackShareToken.setApprovalForAll(address(request.pair), false);
		_redeemReceivedShares(request);
		uint256 refund = request.maxLongSharesIn - totalLong;
		if (refund > 0) callbackShareToken.safeTransferFrom(address(this), request.refundRecipient, longTokenId, refund, '');
		emit PositionExitedByTransfer(owner, address(request.pair), request.completeSetShares, totalLong, refund, request.payoutRecipient);
	}

	function _redeemReceivedCompleteSet(ReceiveRequest memory request, uint256[] calldata ids, uint256[] calldata values) private {
		require(ids.length == 3 && values.length == 3, 'Complete set share count');
		require(ids[0] == request.invalidTokenId && ids[1] == request.yesTokenId && ids[2] == request.noTokenId, 'Complete set IDs');
		require(values[0] == request.completeSetShares && values[1] == request.completeSetShares && values[2] == request.completeSetShares, 'Complete set amounts');
		require(request.maxLongSharesIn == 0 && request.longOutcome == BinaryOutcomes.BinaryOutcome.None, 'Unexpected redeem fields');
		_redeemReceivedShares(request);
		emit CompleteSetRedeemedByTransfer(address(request.securityPool), request.completeSetShares, request.payoutRecipient);
	}

	function _redeemReceivedShares(ReceiveRequest memory request) private {
		uint256 ethBefore = address(this).balance;
		ethCallbackActive = true;
		request.securityPool.redeemCompleteSet(request.completeSetShares);
		ethCallbackActive = false;
		uint256 ethOut = address(this).balance - ethBefore;
		require(ethOut > 0 && ethOut >= request.minEthOut, 'Minimum ETH output');
		(bool success, ) = request.payoutRecipient.call{value: ethOut}('');
		require(success, 'ETH transfer failed');
	}

	function _validateReceiveRequest(ReceiveRequest memory request) private view {
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

	function _validateReceiveInternalCallback(address operator, uint256[] calldata ids, uint256[] calldata values) private view {
		require(receiveInternalShareCallback && msg.sender == address(callbackShareToken), 'Unexpected share callback');
		require(operator == address(factory.getPair(callbackPool)), 'Unexpected callback operator');
		require(ids.length == values.length && ids.length > 0, 'Invalid callback batch');
		for (uint256 index = 0; index < ids.length; index++)
			require(ids[index] == callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes) || ids[index] == callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No), 'Unexpected callback ID');
	}

	function _priorReceiveBalances(ReceiveRequest memory request, uint256[] calldata ids, uint256[] calldata values) private view returns (uint256[3] memory prior) {
		prior[0] = callbackShareToken.balanceOf(address(this), request.invalidTokenId);
		prior[1] = callbackShareToken.balanceOf(address(this), request.yesTokenId);
		prior[2] = callbackShareToken.balanceOf(address(this), request.noTokenId);
		for (uint256 index = 0; index < ids.length; index++) {
			if (ids[index] == request.invalidTokenId) prior[0] -= values[index];
			else if (ids[index] == request.yesTokenId) prior[1] -= values[index];
			else if (ids[index] == request.noTokenId) prior[2] -= values[index];
			else revert('Unexpected share ID');
		}
	}

	function _requireReceiveBalances(uint256[3] memory expected) private view {
		require(callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Invalid)) == expected[0], 'Router INVALID residue');
		require(callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.Yes)) == expected[1], 'Router YES residue');
		require(callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(callbackPool.universeId(), BinaryOutcomes.BinaryOutcome.No)) == expected[2], 'Router NO residue');
	}

	function _initializeWithEth(ITwoWayConstantProductPair pair, uint256 conditionalYesBpsValue, uint256 minLiquidity, address recipient) private returns (LiquidityResult memory result) {
		require(msg.value > 0, 'ETH input is zero');
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		pool.createCompleteSet{value: msg.value}();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(pool, startInvalid, startYes, startNo);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		(uint256 yesUsed, uint256 noUsed) = TwoWayConstantProductMath.initialLiquidityAmounts(mintedInvalid, conditionalYesBpsValue);
		_approvePair(pair);
		uint256 liquidity = pair.initialize(yesUsed, noUsed, minLiquidity, recipient);
		uint256 yesReturned = mintedYes - yesUsed;
		uint256 noReturned = mintedNo - noUsed;
		_transferShares(pool, recipient, mintedInvalid, yesReturned, noReturned);
		_endShareOperation(startInvalid, startYes, startNo);
		result = LiquidityResult(pair, mintedInvalid, yesUsed, noUsed, yesReturned, noReturned, mintedInvalid, liquidity);
	}

	function _validatePair(ITwoWayConstantProductPair pair) private view {
		require(factory.isPair(address(pair)), 'Unrecognized pair');
		require(address(factory.getPair(pair.securityPool())) == address(pair), 'Noncanonical pair');
	}

	function _validateCanonicalPool(ISecurityPool pool) private view {
		require(address(pool) != address(0), 'Security pool is zero');
		ISecurityPoolFactory securityPoolFactory = factory.securityPoolFactory();
		require(address(pool.securityPoolFactory()) == address(securityPoolFactory), 'Wrong security pool factory');
		bytes32 originId = securityPoolFactory.getSecurityPoolOriginId(pool);
		require(address(securityPoolFactory.getSecurityPool(originId, pool.universeId())) == address(pool), 'Noncanonical security pool');
		require(address(pool.shareToken().canonicalPoolByUniverse(pool.universeId())) == address(pool), 'Noncanonical share pool');
	}

	function _isDirectionalOutcome(BinaryOutcomes.BinaryOutcome outcome) private pure returns (bool longYes) {
		require(outcome == BinaryOutcomes.BinaryOutcome.Yes || outcome == BinaryOutcomes.BinaryOutcome.No, 'Outcome must be YES or NO');
		return outcome == BinaryOutcomes.BinaryOutcome.Yes;
	}

	function _beginShareOperation(ISecurityPool pool) private returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		callbackActive = true;
		callbackPool = pool;
		callbackShareToken = ITradingShareToken(address(pool.shareToken()));
		return _balances();
	}

	function _endShareOperation(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) private {
		(uint256 finalInvalid, uint256 finalYes, uint256 finalNo) = _balances();
		require(finalInvalid == invalidBalance && finalYes == yesBalance && finalNo == noBalance, 'Router share residue');
		callbackActive = false;
		callbackPool = ISecurityPool(payable(address(0)));
		callbackShareToken = ITradingShareToken(address(0));
	}

	function _balanceDeltas(ISecurityPool, uint256 invalidBefore, uint256 yesBefore, uint256 noBefore) private view returns (uint256, uint256, uint256) {
		(uint256 invalidAfter, uint256 yesAfter, uint256 noAfter) = _balances();
		return (invalidAfter - invalidBefore, yesAfter - yesBefore, noAfter - noBefore);
	}

	function _balances() private view returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		uint248 universe = callbackPool.universeId();
		invalidBalance = callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid));
		yesBalance = callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes));
		noBalance = callbackShareToken.balanceOf(address(this), callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No));
	}

	function _approvePair(ITwoWayConstantProductPair pair) private {
		if (!callbackShareToken.isApprovedForAll(address(this), address(pair)))
			callbackShareToken.setApprovalForAll(address(pair), true);
	}

	function _transferPosition(ISecurityPool pool, address recipient, bool longYes, uint256 invalidAmount, uint256 longAmount) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](2);
		uint256[] memory values = new uint256[](2);
		ids[0] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = token.getTokenId(universe, longYes ? BinaryOutcomes.BinaryOutcome.Yes : BinaryOutcomes.BinaryOutcome.No);
		values[0] = invalidAmount;
		values[1] = longAmount;
		token.safeBatchTransferFrom(address(this), recipient, ids, values, '');
	}

	function _transferShares(ISecurityPool pool, address recipient, uint256 invalidAmount, uint256 yesAmount, uint256 noAmount) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](3);
		uint256[] memory values = new uint256[](3);
		ids[0] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes);
		ids[2] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No);
		values[0] = invalidAmount;
		values[1] = yesAmount;
		values[2] = noAmount;
		token.safeBatchTransferFrom(address(this), recipient, ids, values, '');
	}

	function _validateShareCallback(uint256 id) private view {
		require(callbackActive && msg.sender == address(callbackShareToken), 'Unexpected share callback');
		uint248 universe = callbackPool.universeId();
		uint256 invalidId = callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		uint256 yesId = callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes);
		uint256 noId = callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No);
		require(id == invalidId || id == yesId || id == noId, 'Unexpected share id');
	}

	event PositionExitedByTransfer(address indexed owner, address indexed pair, uint256 completeSetShares, uint256 longSharesUsed, uint256 longSharesRefunded, address payoutRecipient);
	event CompleteSetRedeemedByTransfer(address indexed securityPool, uint256 completeSetShares, address payoutRecipient);
}
