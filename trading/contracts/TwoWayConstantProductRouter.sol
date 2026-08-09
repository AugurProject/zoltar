// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../../solidity/contracts/peripherals/BinaryOutcomes.sol';
import { ISecurityPool } from '../../solidity/contracts/peripherals/interfaces/ISecurityPool.sol';
import { IERC1155Receiver } from '../../solidity/contracts/peripherals/interfaces/IERC1155Receiver.sol';
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

	struct ExitResult {
		uint256 completeSetShares;
		uint256 longSharesSwapped;
		uint256 totalLongShares;
		uint256 invalidInsurance;
		uint256 ethOut;
		uint256 feeAmount;
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

	ITwoWayConstantProductFactory public immutable factory;
	bool private entered;
	bool private callbackActive;
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

	function enterPosition(
		ITwoWayConstantProductPair pair,
		BinaryOutcomes.BinaryOutcome longOutcome,
		uint256 minLongSharesOut,
		address recipient,
		uint256 deadline
	) external payable nonReentrant beforeDeadline(deadline) returns (EnterResult memory result) {
		_validatePair(pair);
		bool longYes = _isDirectionalOutcome(longOutcome);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		require(msg.value > 0, 'ETH input is zero');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		(uint256 yesBefore, uint256 noBefore) = pair.getEffectiveReserves();
		pool.createCompleteSet{ value: msg.value }();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(
			pool,
			startInvalid,
			startYes,
			startNo
		);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		(uint256 additionalLong, uint256 feeAmount) = pair.swapExactInput(!longYes, mintedInvalid, 0, address(this));
		uint256 totalLong = mintedInvalid + additionalLong;
		require(totalLong >= minLongSharesOut, 'Minimum long shares');
		_transferPosition(pool, recipient, longYes, mintedInvalid, totalLong);
		(uint256 yesAfter, uint256 noAfter) = pair.getReserves();
		_endShareOperation(startInvalid, startYes, startNo);
		result = EnterResult(
			msg.value,
			mintedInvalid,
			mintedInvalid,
			additionalLong,
			totalLong,
			mintedInvalid,
			feeAmount,
			TwoWayConstantProductMath.conditionalYesBps(yesBefore, noBefore),
			TwoWayConstantProductMath.conditionalYesBps(yesAfter, noAfter)
		);
	}

	function exitPosition(
		ITwoWayConstantProductPair pair,
		BinaryOutcomes.BinaryOutcome longOutcome,
		uint256 completeSetSharesToRedeem,
		uint256 maxLongSharesIn,
		uint256 minEthOut,
		address payable recipient,
		uint256 deadline
	) external nonReentrant beforeDeadline(deadline) returns (ExitResult memory result) {
		_validatePair(pair);
		bool longYes = _isDirectionalOutcome(longOutcome);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		require(completeSetSharesToRedeem > 0, 'Complete set is zero');
		ISecurityPool pool = pair.securityPool();
		(uint256 longSwapInput, uint256 feeAmount) = pair.quoteExactOutput(longYes, completeSetSharesToRedeem);
		uint256 totalLong = completeSetSharesToRedeem + longSwapInput;
		require(totalLong <= maxLongSharesIn, 'Maximum long shares');
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		_pullExitShares(pool, msg.sender, longYes, completeSetSharesToRedeem, totalLong);
		_approvePair(pair);
		pair.swapExactOutput(longYes, completeSetSharesToRedeem, longSwapInput, address(this));
		uint256 ethBefore = address(this).balance;
		ethCallbackActive = true;
		pool.redeemCompleteSet(completeSetSharesToRedeem);
		ethCallbackActive = false;
		uint256 ethOut = address(this).balance - ethBefore;
		require(ethOut >= minEthOut, 'Minimum ETH output');
		_endShareOperation(startInvalid, startYes, startNo);
		(bool success, ) = recipient.call{ value: ethOut }('');
		require(success, 'ETH transfer failed');
		result = ExitResult(
			completeSetSharesToRedeem,
			longSwapInput,
			totalLong,
			completeSetSharesToRedeem,
			ethOut,
			feeAmount
		);
	}

	function createPairAndInitializeWithEth(
		ISecurityPool pool,
		uint256 conditionalYesBpsValue,
		uint256 minLiquidity,
		address recipient,
		uint256 deadline
	) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		ITwoWayConstantProductPair pair = factory.createPair(pool);
		require(pair.totalSupply() == 0, 'Pair already initialized');
		result = _initializeWithEth(pair, conditionalYesBpsValue, minLiquidity, recipient);
	}

	function initializeWithEth(
		ITwoWayConstantProductPair pair,
		uint256 conditionalYesBpsValue,
		uint256 minLiquidity,
		address recipient,
		uint256 deadline
	) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		_validatePair(pair);
		require(pair.totalSupply() == 0, 'Pair already initialized');
		result = _initializeWithEth(pair, conditionalYesBpsValue, minLiquidity, recipient);
	}

	function addLiquidityWithEth(
		ITwoWayConstantProductPair pair,
		uint256 minLiquidity,
		address recipient,
		uint256 deadline
	) external payable nonReentrant beforeDeadline(deadline) returns (LiquidityResult memory result) {
		_validatePair(pair);
		require(msg.value > 0, 'ETH input is zero');
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		pool.createCompleteSet{ value: msg.value }();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(
			pool,
			startInvalid,
			startYes,
			startNo
		);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		(uint256 yesUsed, uint256 noUsed, uint256 liquidity) = pair.addLiquidity(
			mintedYes,
			mintedNo,
			minLiquidity,
			recipient
		);
		uint256 yesReturned = mintedYes - yesUsed;
		uint256 noReturned = mintedNo - noUsed;
		_transferShares(pool, recipient, mintedInvalid, yesReturned, noReturned);
		_endShareOperation(startInvalid, startYes, startNo);
		result = LiquidityResult(
			pair,
			mintedInvalid,
			yesUsed,
			noUsed,
			yesReturned,
			noReturned,
			mintedInvalid,
			liquidity
		);
	}

	function removeLiquidity(
		ITwoWayConstantProductPair pair,
		uint256 liquidity,
		uint256 minYesOut,
		uint256 minNoOut,
		address recipient,
		uint256 deadline
	) external nonReentrant beforeDeadline(deadline) returns (uint256 yesOut, uint256 noOut) {
		_validatePair(pair);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		require(pair.transferFrom(msg.sender, address(this), liquidity), 'LP transfer failed');
		return pair.removeLiquidity(liquidity, minYesOut, minNoOut, recipient);
	}

	function onERC1155Received(address, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
		_validateShareCallback(id);
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(
		address,
		address,
		uint256[] calldata ids,
		uint256[] calldata,
		bytes calldata
	) external view returns (bytes4) {
		require(ids.length > 0, 'Empty share batch');
		for (uint256 index = 0; index < ids.length; index++) _validateShareCallback(ids[index]);
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
	}

	receive() external payable {
		require(ethCallbackActive && msg.sender == address(callbackPool), 'Unexpected ETH');
	}

	function _initializeWithEth(
		ITwoWayConstantProductPair pair,
		uint256 conditionalYesBpsValue,
		uint256 minLiquidity,
		address recipient
	) private returns (LiquidityResult memory result) {
		require(msg.value > 0, 'ETH input is zero');
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		ISecurityPool pool = pair.securityPool();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		pool.createCompleteSet{ value: msg.value }();
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(
			pool,
			startInvalid,
			startYes,
			startNo
		);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		(uint256 yesUsed, uint256 noUsed) = TwoWayConstantProductMath.initialLiquidityAmounts(
			mintedInvalid,
			conditionalYesBpsValue
		);
		_approvePair(pair);
		uint256 liquidity = pair.initialize(yesUsed, noUsed, minLiquidity, recipient);
		uint256 yesReturned = mintedYes - yesUsed;
		uint256 noReturned = mintedNo - noUsed;
		_transferShares(pool, recipient, mintedInvalid, yesReturned, noReturned);
		_endShareOperation(startInvalid, startYes, startNo);
		result = LiquidityResult(
			pair,
			mintedInvalid,
			yesUsed,
			noUsed,
			yesReturned,
			noReturned,
			mintedInvalid,
			liquidity
		);
	}

	function _validatePair(ITwoWayConstantProductPair pair) private view {
		require(factory.isPair(address(pair)), 'Unrecognized pair');
		require(address(factory.getPair(pair.securityPool())) == address(pair), 'Noncanonical pair');
	}

	function _isDirectionalOutcome(BinaryOutcomes.BinaryOutcome outcome) private pure returns (bool longYes) {
		require(
			outcome == BinaryOutcomes.BinaryOutcome.Yes || outcome == BinaryOutcomes.BinaryOutcome.No,
			'Outcome must be YES or NO'
		);
		return outcome == BinaryOutcomes.BinaryOutcome.Yes;
	}

	function _beginShareOperation(
		ISecurityPool pool
	) private returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		callbackActive = true;
		callbackPool = pool;
		callbackShareToken = ITradingShareToken(address(pool.shareToken()));
		return _balances();
	}

	function _endShareOperation(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) private {
		(uint256 finalInvalid, uint256 finalYes, uint256 finalNo) = _balances();
		require(
			finalInvalid == invalidBalance && finalYes == yesBalance && finalNo == noBalance,
			'Router share residue'
		);
		callbackActive = false;
		callbackPool = ISecurityPool(payable(address(0)));
		callbackShareToken = ITradingShareToken(address(0));
	}

	function _balanceDeltas(
		ISecurityPool,
		uint256 invalidBefore,
		uint256 yesBefore,
		uint256 noBefore
	) private view returns (uint256, uint256, uint256) {
		(uint256 invalidAfter, uint256 yesAfter, uint256 noAfter) = _balances();
		return (invalidAfter - invalidBefore, yesAfter - yesBefore, noAfter - noBefore);
	}

	function _balances() private view returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		uint248 universe = callbackPool.universeId();
		invalidBalance = callbackShareToken.balanceOf(
			address(this),
			callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid)
		);
		yesBalance = callbackShareToken.balanceOf(
			address(this),
			callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes)
		);
		noBalance = callbackShareToken.balanceOf(
			address(this),
			callbackShareToken.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No)
		);
	}

	function _approvePair(ITwoWayConstantProductPair pair) private {
		if (!callbackShareToken.isApprovedForAll(address(this), address(pair)))
			callbackShareToken.setApprovalForAll(address(pair), true);
	}

	function _pullExitShares(
		ISecurityPool pool,
		address owner,
		bool longYes,
		uint256 invalidAmount,
		uint256 longAmount
	) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](2);
		uint256[] memory values = new uint256[](2);
		ids[0] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = token.getTokenId(
			universe,
			longYes ? BinaryOutcomes.BinaryOutcome.Yes : BinaryOutcomes.BinaryOutcome.No
		);
		values[0] = invalidAmount;
		values[1] = longAmount;
		token.safeBatchTransferFrom(owner, address(this), ids, values, '');
	}

	function _transferPosition(
		ISecurityPool pool,
		address recipient,
		bool longYes,
		uint256 invalidAmount,
		uint256 longAmount
	) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](2);
		uint256[] memory values = new uint256[](2);
		ids[0] = token.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = token.getTokenId(
			universe,
			longYes ? BinaryOutcomes.BinaryOutcome.Yes : BinaryOutcomes.BinaryOutcome.No
		);
		values[0] = invalidAmount;
		values[1] = longAmount;
		token.safeBatchTransferFrom(address(this), recipient, ids, values, '');
	}

	function _transferShares(
		ISecurityPool pool,
		address recipient,
		uint256 invalidAmount,
		uint256 yesAmount,
		uint256 noAmount
	) private {
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
}
