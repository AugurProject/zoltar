// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../statoblast/BinaryOutcomes.sol';
import { IQuestionLedger, ISecurityPoolFactory } from '../statoblast/interfaces/IQuestionLedger.sol';
import { IERC165 } from '../statoblast/interfaces/IERC165.sol';
import { IERC1155Receiver } from '../statoblast/interfaces/IERC1155Receiver.sol';
import { ITwoWayConstantProductFactory } from './interfaces/ITwoWayConstantProductFactory.sol';
import { ITwoWayConstantProductPair } from './interfaces/ITwoWayConstantProductPair.sol';
import { ITradingShareToken } from './interfaces/ITradingShareToken.sol';
import { TwoWayConstantProductMath } from './TwoWayConstantProductMath.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from '../statoblast/interfaces/ICollateralConfig.sol';
import { IWeth9 } from '../statoblast/interfaces/IWeth9.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { TokenId } from '../statoblast/tokens/TokenId.sol';

interface ITradingSecurityPoolSettlement {
	function settlement() external view returns (address);
	function services() external view returns (address);
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 cash) external view returns (uint256 fee, uint256 premium);
	function createCompleteSet(uint248 universeId, uint256 questionId, uint256 cash, address recipient, uint256 minimumShares, uint256 maximumFee) external returns (uint256);
}

contract TwoWayConstantProductRouter is IERC1155Receiver {
	using SafeERC20Ops for IERC20;
	struct EnterResult {
		uint256 ethSpent;
		// Minted complete sets: the opposite shares swapped and the INVALID shares kept.
		uint256 completeSetShares;
		uint256 additionalLongShares;
		uint256 totalLongShares;
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
		uint256 liquidity;
	}

	enum FundingMode {
		NativeEth,
		CollateralToken
	}

	struct Funding {
		FundingMode mode;
		uint256 budget;
	}

	struct LiquidityRequest {
		uint256 cash;
		uint256 conditionalYesBps;
		uint256 maxYes;
		uint256 maxNo;
		uint256 minYes;
		uint256 minNo;
		uint256 minimumLiquidity;
		address recipient;
		uint256 deadline;
	}

	enum ReceiveOperation {
		ExitPosition,
		RedeemCompleteSet
	}

	struct ReceiveRequest {
		uint8 version;
		ReceiveOperation operation;
		IQuestionLedger questionLedger;
		ITwoWayConstantProductPair pair;
		BinaryOutcomes.BinaryOutcome longOutcome;
		uint256 completeSetShares;
		uint256 maxLongSharesIn;
		uint256 minEthOut;
		address payable payoutRecipient;
		address refundRecipient;
		uint256 deadline;
		uint256 minRepOut;
	}

	struct ReceiveContext {
		ReceiveOperation operation;
		address shareToken;
		IQuestionLedger questionLedger;
		ITwoWayConstantProductPair pair;
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
		uint256 minRepOut;
	}

	uint8 public constant CALLBACK_VERSION = 3;

	ITwoWayConstantProductFactory public immutable factory;
	bool private entered;
	// Enabled by _beginShareOperation until _endShareOperation for ordinary share callbacks.
	bool private callbackActive;
	// Enabled only around the exit swap to accept its internal YES/NO share callbacks.
	bool private receiveInternalShareCallback;
	// Enabled only around redemption or WETH withdrawal; receive() also checks the sender.
	bool private ethCallbackActive;
	// Ordinary operations bind this context in _beginShareOperation and clear it in
	// _endShareOperation. Transfer-driven operations bind and clear it in the batch receiver.
	IQuestionLedger private callbackPool;
	ITradingShareToken private callbackShareToken;
	// Additional ETH sender during redemption/withdrawal; cleared after each external call.
	address private callbackSettlement;

	modifier nonReentrant() {
		require(!entered, 'Reentrant call');
		entered = true;
		_;
		entered = false;
	}

	constructor(ITwoWayConstantProductFactory _factory) {
		require(address(_factory) != address(0), 'Factory is zero');
		factory = _factory;
	}

	modifier validTokenBudget(uint256 budget) {
		require(!entered && budget != 0, 'Invalid token budget');
		_;
	}

	function enterPositionWithCollateral(ITwoWayConstantProductPair pair, uint256 cash, BinaryOutcomes.BinaryOutcome outcome, uint256 minimum, address recipient, uint256 deadline, uint256 budget) external validTokenBudget(budget) nonReentrant returns (EnterResult memory) {
		return
			_enterPosition(pair, cash, outcome, minimum, recipient, deadline, Funding(FundingMode.CollateralToken, budget));
	}

	function createPairAndInitializeWithCollateral(IQuestionLedger pool, uint256 cash, uint256 probability, uint256 maxYes, uint256 maxNo, uint256 minYes, uint256 minNo, uint256 minimum, address recipient, uint256 deadline, uint256 budget) external validTokenBudget(budget) nonReentrant returns (LiquidityResult memory) {
		return
			_provideLiquidity(factory.createPair(pool), LiquidityRequest({cash: cash, conditionalYesBps: probability, maxYes: maxYes, maxNo: maxNo, minYes: minYes, minNo: minNo, minimumLiquidity: minimum, recipient: recipient, deadline: deadline}), Funding(FundingMode.CollateralToken, budget));
	}

	function initializeWithCollateral(ITwoWayConstantProductPair pair, uint256 cash, uint256 probability, uint256 maxYes, uint256 maxNo, uint256 minYes, uint256 minNo, uint256 minimum, address recipient, uint256 deadline, uint256 budget) external validTokenBudget(budget) nonReentrant returns (LiquidityResult memory) {
		_validatePair(pair);
		return
			_provideLiquidity(pair, LiquidityRequest({cash: cash, conditionalYesBps: probability, maxYes: maxYes, maxNo: maxNo, minYes: minYes, minNo: minNo, minimumLiquidity: minimum, recipient: recipient, deadline: deadline}), Funding(FundingMode.CollateralToken, budget));
	}

	function addLiquidityWithCollateral(ITwoWayConstantProductPair pair, uint256 cash, uint256 maxYes, uint256 maxNo, uint256 minimum, address recipient, uint256 deadline, uint256 budget) external validTokenBudget(budget) nonReentrant returns (LiquidityResult memory) {
		_validatePair(pair);
		return
			_provideLiquidity(pair, LiquidityRequest({cash: cash, conditionalYesBps: 0, maxYes: maxYes, maxNo: maxNo, minYes: 0, minNo: 0, minimumLiquidity: minimum, recipient: recipient, deadline: deadline}), Funding(FundingMode.CollateralToken, budget));
	}

	function enterPosition(ITwoWayConstantProductPair pair, uint256 mintAttoEth, BinaryOutcomes.BinaryOutcome longOutcome, uint256 minLongSharesOut, address recipient, uint256 deadline) public payable nonReentrant returns (EnterResult memory result) {
		return
			_enterPosition(pair, mintAttoEth, longOutcome, minLongSharesOut, recipient, deadline, Funding(FundingMode.NativeEth, msg.value));
	}

	function _enterPosition(ITwoWayConstantProductPair pair, uint256 cash, BinaryOutcomes.BinaryOutcome longOutcome, uint256 minLongSharesOut, address recipient, uint256 deadline, Funding memory funding) private returns (EnterResult memory result) {
		_validatePair(pair);
		bool longYes = _isDirectionalOutcome(longOutcome);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		IQuestionLedger pool = pair.questionLedger();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		(uint256 yesBefore, uint256 noBefore) = pair.getEffectiveReserves();
		uint256 spent = _mintCompleteSets(pool, cash, funding);
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(startInvalid, startYes, startNo);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		(uint256 additionalLong, uint256 feeAmount) = pair.swapExactInput(!longYes, mintedInvalid, 0, address(this), deadline);
		uint256 totalLong = mintedInvalid + additionalLong;
		require(totalLong >= minLongSharesOut, 'Minimum long shares');
		_transferPosition(pool, recipient, longYes, mintedInvalid, totalLong);
		(uint256 yesAfter, uint256 noAfter) = pair.getReserves();
		_endShareOperation(startInvalid, startYes, startNo);
		_refundBudget(spent, funding);
		result = EnterResult({ethSpent: spent, completeSetShares: mintedInvalid, additionalLongShares: additionalLong, totalLongShares: totalLong, feeAmount: feeAmount, conditionalYesBpsBefore: TwoWayConstantProductMath.conditionalYesBps(yesBefore, noBefore), conditionalYesBpsAfter: TwoWayConstantProductMath.conditionalYesBps(yesAfter, noAfter)});
	}

	/// @notice Seeds the pair at `conditionalYesBpsValue`. If anyone already initialized it, the same call adds
	/// liquidity at the pair's price instead, subject to the caller's signed minimum and maximum deposit bounds.
	function createPairAndInitializeWithEth(IQuestionLedger pool, uint256 mintAttoEth, uint256 conditionalYesBpsValue, uint256 maxYesUsed, uint256 maxNoUsed, uint256 minYesUsed, uint256 minNoUsed, uint256 minLiquidity, address recipient, uint256 deadline) public payable nonReentrant returns (LiquidityResult memory result) {
		result = _provideLiquidity(factory.createPair(pool), LiquidityRequest({cash: mintAttoEth, conditionalYesBps: conditionalYesBpsValue, maxYes: maxYesUsed, maxNo: maxNoUsed, minYes: minYesUsed, minNo: minNoUsed, minimumLiquidity: minLiquidity, recipient: recipient, deadline: deadline}), Funding(FundingMode.NativeEth, msg.value));
	}

	function initializeWithEth(ITwoWayConstantProductPair pair, uint256 mintAttoEth, uint256 conditionalYesBpsValue, uint256 maxYesUsed, uint256 maxNoUsed, uint256 minYesUsed, uint256 minNoUsed, uint256 minLiquidity, address recipient, uint256 deadline) public payable nonReentrant returns (LiquidityResult memory result) {
		_validatePair(pair);
		result = _provideLiquidity(pair, LiquidityRequest({cash: mintAttoEth, conditionalYesBps: conditionalYesBpsValue, maxYes: maxYesUsed, maxNo: maxNoUsed, minYes: minYesUsed, minNo: minNoUsed, minimumLiquidity: minLiquidity, recipient: recipient, deadline: deadline}), Funding(FundingMode.NativeEth, msg.value));
	}

	function addLiquidityWithEth(ITwoWayConstantProductPair pair, uint256 mintAttoEth, uint256 maxYesUsed, uint256 maxNoUsed, uint256 minLiquidity, address recipient, uint256 deadline) public payable nonReentrant returns (LiquidityResult memory result) {
		_validatePair(pair);
		result = _provideLiquidity(pair, LiquidityRequest({cash: mintAttoEth, conditionalYesBps: 0, maxYes: maxYesUsed, maxNo: maxNoUsed, minYes: 0, minNo: 0, minimumLiquidity: minLiquidity, recipient: recipient, deadline: deadline}), Funding(FundingMode.NativeEth, msg.value));
	}

	function removeLiquidityWithPermit(ITwoWayConstantProductPair pair, uint256 liquidity, uint256 minYesOut, uint256 minNoOut, address recipient, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external nonReentrant returns (uint256 yesOut, uint256 noOut) {
		_validatePair(pair);
		require(recipient != address(0) && recipient != address(this), 'Invalid recipient');
		try pair.permit(msg.sender, address(this), liquidity, deadline, v, r, s) {} catch {
			require(pair.allowance(msg.sender, address(this)) >= liquidity, 'LP permit or allowance');
		}
		require(pair.transferFrom(msg.sender, address(this), liquidity), 'LP transfer failed');
		return pair.removeLiquidity(liquidity, minYesOut, minNoOut, recipient, deadline);
	}

	function onERC1155Received(address operator, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
		if (receiveInternalShareCallback) _validateReceiveInternalShare(operator, id);
		else _validateShareCallback(id);
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
		ReceiveContext memory request = _validateReceiveRequest(abi.decode(data, (ReceiveRequest)));
		require(msg.sender == request.shareToken, 'Wrong share token');
		require(block.timestamp <= request.deadline, 'Deadline expired');
		callbackPool = request.questionLedger;
		callbackShareToken = ITradingShareToken(request.shareToken);
		uint256[3] memory priorBalances = _priorReceiveBalances(request, ids, values);
		if (request.operation == ReceiveOperation.ExitPosition) _exitReceivedPosition(request, from, ids, values);
		else if (request.operation == ReceiveOperation.RedeemCompleteSet)
			_redeemReceivedCompleteSet(request, ids, values);
		else revert('Unsupported operation');
		_requireReceiveBalances(priorBalances);
		callbackPool = IQuestionLedger(payable(address(0)));
		callbackShareToken = ITradingShareToken(address(0));
		entered = false;
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
	}

	receive() external payable {
		require(ethCallbackActive && (msg.sender == address(callbackPool) || msg.sender == callbackSettlement), 'Unexpected ETH');
	}

	function _exitReceivedPosition(ReceiveContext memory request, address owner, uint256[] calldata ids, uint256[] calldata values) private {
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
		request.pair.swapExactOutput(longYes, request.completeSetShares, swapInput, address(this), request.deadline);
		receiveInternalShareCallback = false;
		if (!wasApproved) callbackShareToken.setApprovalForAll(address(request.pair), false);
		_redeemReceivedShares(request);
		uint256 refund = request.maxLongSharesIn - totalLong;
		if (refund > 0)
			callbackShareToken.safeTransferFrom(address(this), request.refundRecipient, longTokenId, refund, '');
		emit PositionExitedByTransfer(owner, address(request.pair), request.completeSetShares, totalLong, refund, request.payoutRecipient);
	}

	function _redeemReceivedCompleteSet(ReceiveContext memory request, uint256[] calldata ids, uint256[] calldata values) private {
		require(ids.length == 3 && values.length == 3, 'Complete set share count');
		require(ids[0] == request.invalidTokenId && ids[1] == request.yesTokenId && ids[2] == request.noTokenId, 'Complete set IDs');
		require(values[0] == request.completeSetShares && values[1] == request.completeSetShares && values[2] == request.completeSetShares, 'Complete set amounts');
		require(request.maxLongSharesIn == 0 && request.longOutcome == BinaryOutcomes.BinaryOutcome.None, 'Unexpected redeem fields');
		_redeemReceivedShares(request);
		emit CompleteSetRedeemedByTransfer(address(request.questionLedger), request.completeSetShares, request.payoutRecipient);
	}

	function _redeemReceivedShares(ReceiveContext memory request) private {
		address securityPool = request.questionLedger.securityPoolFactory().securityPoolOf(request.questionLedger);
		IERC20 collateral = ICollateralConfig(securityPool).collateralToken();
		uint256 collateralBefore = collateral.balanceOf(address(this));
		IERC20 rep = IERC20(address(request.questionLedger.repToken()));
		uint256 repBefore = rep.balanceOf(address(this));
		if (request.questionLedger.securityPoolCustody() != address(0))
			callbackSettlement = ITradingSecurityPoolSettlement(securityPool).settlement();
		ethCallbackActive = true;
		request.questionLedger.redeemCompleteSet(request.completeSetShares);
		ethCallbackActive = false;
		callbackSettlement = address(0);
		uint256 collateralOut = collateral.balanceOf(address(this)) - collateralBefore;
		uint256 repOut = rep.balanceOf(address(this)) - repBefore;
		require(collateralOut >= request.minEthOut && (collateralOut > 0 || repOut > 0), 'Minimum ETH output');
		require(repOut >= request.minRepOut, 'Minimum REP output');
		if (repOut != 0) rep.safeTransfer(request.payoutRecipient, repOut);
		if (collateralOut != 0) {
			if (address(collateral) == address(request.questionLedger.priceFeed().weth())) {
				callbackSettlement = address(collateral);
				ethCallbackActive = true;
				IWeth9(address(collateral)).withdraw(collateralOut);
				ethCallbackActive = false;
				callbackSettlement = address(0);
				(bool success, ) = request.payoutRecipient.call{value: collateralOut}('');
				require(success, 'ETH transfer failed');
			} else Collateral.send(collateral, request.payoutRecipient, collateralOut);
		}
	}

	function _validateReceiveRequest(ReceiveRequest memory request) private view returns (ReceiveContext memory context) {
		require(request.version == CALLBACK_VERSION, 'Unsupported callback version');
		require(request.completeSetShares > 0, 'Complete set is zero');
		require(request.payoutRecipient != address(0) && request.payoutRecipient != address(this), 'Invalid payout recipient');
		require(request.refundRecipient != address(0) && request.refundRecipient != address(this), 'Invalid refund recipient');
		uint248 universe;
		if (address(request.pair) != address(0) || request.operation != ReceiveOperation.RedeemCompleteSet) {
			// The pair factory authenticated this ledger and its write-once share-token canonicity at pair creation.
			_validatePair(request.pair);
			require(address(request.questionLedger) == address(request.pair.questionLedger()), 'Wrong question ledger');
			universe = request.questionLedger.universeId();
			context.shareToken = address(request.questionLedger.shareToken());
		} else {
			ISecurityPoolFactory poolFactory = factory.securityPoolFactory();
			require(address(request.questionLedger.securityPoolFactory()) == address(poolFactory), 'Wrong security pool factory');
			universe = request.questionLedger.universeId();
			require(address(poolFactory.getQuestionLedger(poolFactory.getQuestionLedgerOriginId(request.questionLedger), universe)) == address(request.questionLedger), 'Noncanonical question ledger');
			// Derive metadata only after the configured factory authenticates this ledger.
			ITradingShareToken shares = ITradingShareToken(address(request.questionLedger.shareToken()));
			require(address(shares.canonicalQuestionLedgerByUniverse(universe)) == address(request.questionLedger), 'Noncanonical share pool');
			context.shareToken = address(shares);
		}
		context.invalidTokenId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		context.yesTokenId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes);
		context.noTokenId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No);
		context.operation = request.operation;
		context.questionLedger = request.questionLedger;
		context.pair = request.pair;
		context.longOutcome = request.longOutcome;
		context.completeSetShares = request.completeSetShares;
		context.maxLongSharesIn = request.maxLongSharesIn;
		context.minEthOut = request.minEthOut;
		context.payoutRecipient = request.payoutRecipient;
		context.refundRecipient = request.refundRecipient;
		context.deadline = request.deadline;
		context.minRepOut = request.minRepOut;
	}

	function _validateReceiveInternalCallback(address operator, uint256[] calldata ids, uint256[] calldata values) private view {
		require(ids.length == values.length && ids.length > 0, 'Invalid callback batch');
		for (uint256 index = 0; index < ids.length; index++) _validateReceiveInternalShare(operator, ids[index]);
	}

	/// @dev While enabled, only the bound pair's exit swap may send this ledger's YES or NO to the router.
	function _validateReceiveInternalShare(address operator, uint256 id) private view {
		require(msg.sender == address(callbackShareToken), 'Unexpected share callback');
		require(operator == address(factory.getPair(callbackPool)), 'Unexpected callback operator');
		uint248 universe = callbackPool.universeId();
		require(id == TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes) || id == TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No), 'Unexpected callback ID');
	}

	function _priorReceiveBalances(ReceiveContext memory request, uint256[] calldata ids, uint256[] calldata values) private view returns (uint256[3] memory prior) {
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
		(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) = _balances();
		require(invalidBalance == expected[0], 'Router INVALID residue');
		require(yesBalance == expected[1], 'Router YES residue');
		require(noBalance == expected[2], 'Router NO residue');
	}

	/// @dev An empty pair requires a nonzero requested conditional YES price.
	/// An initialized pair adds complete sets proportionally at the pair's own price.
	function _provideLiquidity(ITwoWayConstantProductPair pair, LiquidityRequest memory request, Funding memory funding) private returns (LiquidityResult memory result) {
		require(request.recipient != address(0) && request.recipient != address(this), 'Invalid recipient');
		IQuestionLedger pool = pair.questionLedger();
		(uint256 startInvalid, uint256 startYes, uint256 startNo) = _beginShareOperation(pool);
		uint256 spent = _mintCompleteSets(pool, request.cash, funding);
		(uint256 mintedInvalid, uint256 mintedYes, uint256 mintedNo) = _balanceDeltas(startInvalid, startYes, startNo);
		require(mintedInvalid > 0 && mintedInvalid == mintedYes && mintedYes == mintedNo, 'Unequal complete set');
		_approvePair(pair);
		uint256 yesUsed;
		uint256 noUsed;
		uint256 liquidity;
		if (request.conditionalYesBps != 0 && pair.totalSupply() == 0) {
			(yesUsed, noUsed) = TwoWayConstantProductMath.initialLiquidityAmounts(mintedInvalid, request.conditionalYesBps);
			liquidity = pair.initialize(yesUsed, noUsed, request.minimumLiquidity, request.recipient, request.deadline);
		} else
			(yesUsed, noUsed, liquidity) = pair.addLiquidity(mintedYes, mintedNo, request.minimumLiquidity, request.recipient, request.deadline);
		// Complete sets supply equal YES and NO, so the reserve ratio alone sets the deposit mix. A swap toward even
		// odds raises the minority-side deposit and the minted LP together, which the minimum liquidity alone cannot detect.
		require(yesUsed >= request.minYes && noUsed >= request.minNo && yesUsed <= request.maxYes && noUsed <= request.maxNo, 'Liquidity price slippage');
		uint256 yesReturned = mintedYes - yesUsed;
		uint256 noReturned = mintedNo - noUsed;
		_transferShares(pool, request.recipient, mintedInvalid, yesReturned, noReturned);
		_endShareOperation(startInvalid, startYes, startNo);
		_refundBudget(spent, funding);
		result = LiquidityResult({pair: pair, completeSetShares: mintedInvalid, yesUsed: yesUsed, noUsed: noUsed, yesReturned: yesReturned, noReturned: noReturned, liquidity: liquidity});
	}

	function _mintCompleteSets(IQuestionLedger pool, uint256 cash, Funding memory funding) private returns (uint256 spent) {
		require(cash > 0, 'Mint amount is zero');
		address root = pool.securityPoolFactory().securityPoolOf(pool);
		require(root != address(0), 'Question has no security pool');
		// Quote after the same-block capital/fee checkpoint used by purchase.
		pool.refreshSecurityPoolFees();
		ITradingSecurityPoolSettlement securityPool = ITradingSecurityPoolSettlement(root);
		(uint256 fee, ) = securityPool.purchaseQuote(pool.universeId(), pool.questionId(), cash);
		spent = cash + fee;
		IERC20 collateral = ICollateralConfig(root).collateralToken();
		require(spent <= funding.budget, 'Purchase fee exceeds budget');
		if (funding.mode == FundingMode.CollateralToken) {
			Collateral.pull(collateral, msg.sender, address(this), spent);
		} else {
			require(address(collateral) == address(pool.priceFeed().weth()), 'Use collateral token entry');
			IWeth9(address(collateral)).deposit{value: spent}();
		}
		collateral.safeApprove(securityPool.services(), spent);
		securityPool.createCompleteSet(pool.universeId(), pool.questionId(), cash, address(this), 0, spent - cash);
	}

	function _refundBudget(uint256 spent, Funding memory funding) private {
		if (funding.mode == FundingMode.CollateralToken) return;
		uint256 refund = funding.budget - spent;
		if (refund == 0) return;
		(bool success, ) = msg.sender.call{value: refund}('');
		require(success, 'Fee budget refund failed');
	}

	function _validatePair(ITwoWayConstantProductPair pair) private view {
		// The factory registers exactly one pair per canonical question ledger.
		require(factory.isPair(address(pair)), 'Unrecognized pair');
	}

	function _isDirectionalOutcome(BinaryOutcomes.BinaryOutcome outcome) private pure returns (bool longYes) {
		require(outcome == BinaryOutcomes.BinaryOutcome.Yes || outcome == BinaryOutcomes.BinaryOutcome.No, 'Outcome must be YES or NO');
		return outcome == BinaryOutcomes.BinaryOutcome.Yes;
	}

	function _beginShareOperation(IQuestionLedger pool) private returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		callbackActive = true;
		callbackPool = pool;
		callbackShareToken = ITradingShareToken(address(pool.shareToken()));
		return _balances();
	}

	function _endShareOperation(uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) private {
		(uint256 finalInvalid, uint256 finalYes, uint256 finalNo) = _balances();
		require(finalInvalid == invalidBalance && finalYes == yesBalance && finalNo == noBalance, 'Router share residue');
		callbackActive = false;
		callbackPool = IQuestionLedger(payable(address(0)));
		callbackShareToken = ITradingShareToken(address(0));
	}

	function _balanceDeltas(uint256 invalidBefore, uint256 yesBefore, uint256 noBefore) private view returns (uint256, uint256, uint256) {
		(uint256 invalidAfter, uint256 yesAfter, uint256 noAfter) = _balances();
		return (invalidAfter - invalidBefore, yesAfter - yesBefore, noAfter - noBefore);
	}

	function _balances() private view returns (uint256 invalidBalance, uint256 yesBalance, uint256 noBalance) {
		uint248 universe = callbackPool.universeId();
		invalidBalance = callbackShareToken.balanceOf(address(this), TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid));
		yesBalance = callbackShareToken.balanceOf(address(this), TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes));
		noBalance = callbackShareToken.balanceOf(address(this), TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No));
	}

	function _approvePair(ITwoWayConstantProductPair pair) private {
		if (!callbackShareToken.isApprovedForAll(address(this), address(pair)))
			callbackShareToken.setApprovalForAll(address(pair), true);
	}

	function _transferPosition(IQuestionLedger pool, address recipient, bool longYes, uint256 invalidAmount, uint256 longAmount) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](2);
		uint256[] memory values = new uint256[](2);
		ids[0] = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = TokenId.getTokenId(universe, longYes ? BinaryOutcomes.BinaryOutcome.Yes : BinaryOutcomes.BinaryOutcome.No);
		values[0] = invalidAmount;
		values[1] = longAmount;
		token.safeBatchTransferFrom(address(this), recipient, ids, values, '');
	}

	function _transferShares(IQuestionLedger pool, address recipient, uint256 invalidAmount, uint256 yesAmount, uint256 noAmount) private {
		ITradingShareToken token = ITradingShareToken(address(pool.shareToken()));
		uint248 universe = pool.universeId();
		uint256[] memory ids = new uint256[](3);
		uint256[] memory values = new uint256[](3);
		ids[0] = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		ids[1] = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes);
		ids[2] = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No);
		values[0] = invalidAmount;
		values[1] = yesAmount;
		values[2] = noAmount;
		token.safeBatchTransferFrom(address(this), recipient, ids, values, '');
	}

	function _validateShareCallback(uint256 id) private view {
		require(callbackActive && msg.sender == address(callbackShareToken), 'Unexpected share callback');
		uint248 universe = callbackPool.universeId();
		uint256 invalidId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Invalid);
		uint256 yesId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.Yes);
		uint256 noId = TokenId.getTokenId(universe, BinaryOutcomes.BinaryOutcome.No);
		require(id == invalidId || id == yesId || id == noId, 'Unexpected share ID');
	}

	event PositionExitedByTransfer(address indexed owner, address indexed pair, uint256 completeSetShares, uint256 longSharesUsed, uint256 longSharesRefunded, address payoutRecipient);
	event CompleteSetRedeemedByTransfer(address indexed questionLedger, uint256 completeSetShares, address payoutRecipient);
}
