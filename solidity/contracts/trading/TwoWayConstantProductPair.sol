// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../statoblast/BinaryOutcomes.sol';
import { IQuestionLedger, SystemState } from '../statoblast/interfaces/IQuestionLedger.sol';
import { IQuestionForker } from '../statoblast/interfaces/IQuestionForker.sol';
import { IERC165 } from '../statoblast/interfaces/IERC165.sol';
import { IERC1155Receiver } from '../statoblast/interfaces/IERC1155Receiver.sol';
import { Math } from '../statoblast/openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ITradingShareToken } from './interfaces/ITradingShareToken.sol';
import { TradingLiquidityToken } from './TradingLiquidityToken.sol';
import { TwoWayConstantProductMath } from './TwoWayConstantProductMath.sol';

contract TwoWayConstantProductPair is TradingLiquidityToken, IERC1155Receiver {
	enum TradingStatus {
		Open,
		QuestionEnded,
		PoolInactive,
		AwaitingForkContinuation,
		UniverseForked,
		QuestionResolved,
		Uninitialized
	}
	uint256 public constant MINIMUM_LIQUIDITY = 1_000;
	address public constant MINIMUM_LIQUIDITY_LOCK = address(1);

	address public immutable factory;
	IQuestionLedger public immutable questionLedger;
	ITradingShareToken public immutable shareToken;
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	uint256 public immutable invalidTokenId;
	uint256 public immutable yesTokenId;
	uint256 public immutable noTokenId;
	uint256 public immutable feeBps;

	bool private entered;

	event LiquidityInitialized(address indexed provider, address indexed recipient, uint256 yesAmount, uint256 noAmount, uint256 liquidity);
	event LiquidityAdded(address indexed provider, address indexed recipient, uint256 yesAmount, uint256 noAmount, uint256 liquidity);
	event LiquidityRemoved(address indexed provider, address indexed recipient, uint256 yesAmount, uint256 noAmount, uint256 liquidity);
	event Swap(address indexed sender, address indexed recipient, bool yesForNo, bool exactOutput, uint256 amountIn, uint256 amountOut, uint256 feeAmount, uint256 resultingYesReserve, uint256 resultingNoReserve);
	event Sync(uint256 yesReserve, uint256 noReserve);
	event PredeploymentSharesQuarantined(uint256 invalidAmount, uint256 yesAmount, uint256 noAmount);

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

	constructor(address _factory, IQuestionLedger _questionLedger, uint256 _feeBps, address predeploymentShareSink) {
		require(_factory != address(0), 'Factory is zero');
		require(address(_questionLedger) != address(0), 'Question ledger is zero');
		require(_feeBps < TwoWayConstantProductMath.BPS_DENOMINATOR, 'Invalid fee');
		require(predeploymentShareSink != address(0), 'Share sink is zero');
		factory = _factory;
		questionLedger = _questionLedger;
		shareToken = ITradingShareToken(address(_questionLedger.shareToken()));
		universeId = _questionLedger.universeId();
		questionId = _questionLedger.questionId();
		invalidTokenId = shareToken.getTokenId(universeId, BinaryOutcomes.BinaryOutcome.Invalid);
		yesTokenId = shareToken.getTokenId(universeId, BinaryOutcomes.BinaryOutcome.Yes);
		noTokenId = shareToken.getTokenId(universeId, BinaryOutcomes.BinaryOutcome.No);
		feeBps = _feeBps;
		_quarantinePredeploymentShares(predeploymentShareSink);
	}

	function _quarantinePredeploymentShares(address sink) private {
		uint256 invalidAmount = _invalidBalance();
		uint256 yesAmount = _yesBalance();
		uint256 noAmount = _noBalance();
		if (invalidAmount == 0 && yesAmount == 0 && noAmount == 0) return;
		uint256[] memory ids = new uint256[](3);
		uint256[] memory amounts = new uint256[](3);
		ids[0] = invalidTokenId;
		ids[1] = yesTokenId;
		ids[2] = noTokenId;
		amounts[0] = invalidAmount;
		amounts[1] = yesAmount;
		amounts[2] = noAmount;
		shareToken.safeBatchTransferFrom(address(this), sink, ids, amounts, '');
		emit PredeploymentSharesQuarantined(invalidAmount, yesAmount, noAmount);
	}

	function getReserves() external view returns (uint256, uint256) {
		return (_yesBalance(), _noBalance());
	}

	function getEffectiveReserves() external view returns (uint256, uint256) {
		return _effectiveReserves();
	}

	function tradingStatus() public view returns (TradingStatus status) {
		if (totalSupply() == 0) return TradingStatus.Uninitialized;
		if (block.timestamp >= questionLedger.questionData().getQuestionEndDate(questionId))
			return TradingStatus.QuestionEnded;
		if (questionLedger.zoltar().getForkTime(universeId) != 0) return TradingStatus.UniverseForked;
		if (questionLedger.awaitingForkContinuation()) return TradingStatus.AwaitingForkContinuation;
		if (questionLedger.systemState() != SystemState.Operational) return TradingStatus.PoolInactive;
		if (
			IQuestionForker(questionLedger.questionForker()).getQuestionOutcome(questionLedger) !=
			BinaryOutcomes.BinaryOutcome.None
		) return TradingStatus.QuestionResolved;
		return TradingStatus.Open;
	}

	function initialize(uint256 yesAmount, uint256 noAmount, uint256 minLiquidity, address recipient, uint256 deadline) external nonReentrant beforeDeadline(deadline) returns (uint256 liquidity) {
		require(totalSupply() == 0, 'Already initialized');
		_requireLifecycleOpen(false);
		require(recipient != address(0), 'Recipient is zero');
		require(_yesBalance() == 0 && _noBalance() == 0 && _invalidBalance() == 0, 'Nonzero initial balance');
		uint256 scale = yesAmount < noAmount ? yesAmount : noAmount;
		require(scale > MINIMUM_LIQUIDITY, 'Initial liquidity too small');
		shareToken.safeTransferFrom(msg.sender, address(this), yesTokenId, yesAmount, '');
		shareToken.safeTransferFrom(msg.sender, address(this), noTokenId, noAmount, '');
		liquidity = scale - MINIMUM_LIQUIDITY;
		require(liquidity >= minLiquidity, 'Minimum liquidity');
		_mint(MINIMUM_LIQUIDITY_LOCK, MINIMUM_LIQUIDITY);
		_mint(recipient, liquidity);
		_checkReserves(yesAmount, noAmount);
		emit LiquidityInitialized(msg.sender, recipient, yesAmount, noAmount, liquidity);
	}

	function addLiquidity(uint256 maxYes, uint256 maxNo, uint256 minLiquidity, address recipient, uint256 deadline) external nonReentrant beforeDeadline(deadline) returns (uint256 yesUsed, uint256 noUsed, uint256 liquidity) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		(uint256 yesReserve, uint256 noReserve) = _effectiveReserves();
		(yesUsed, noUsed) = TwoWayConstantProductMath.proportionalDeposit(yesReserve, noReserve, maxYes, maxNo);
		require(yesUsed > 0 && noUsed > 0, 'Liquidity rounds to zero');
		uint256 yesLiquidity = Math.mulDiv(yesUsed, totalSupply(), yesReserve);
		uint256 noLiquidity = Math.mulDiv(noUsed, totalSupply(), noReserve);
		liquidity = yesLiquidity < noLiquidity ? yesLiquidity : noLiquidity;
		require(liquidity > 0 && liquidity >= minLiquidity, 'Minimum liquidity');
		shareToken.safeTransferFrom(msg.sender, address(this), yesTokenId, yesUsed, '');
		shareToken.safeTransferFrom(msg.sender, address(this), noTokenId, noUsed, '');
		_mint(recipient, liquidity);
		_checkReserves(yesReserve + yesUsed, noReserve + noUsed);
		emit LiquidityAdded(msg.sender, recipient, yesUsed, noUsed, liquidity);
	}

	function removeLiquidity(uint256 liquidity, uint256 minYes, uint256 minNo, address recipient, uint256 deadline) external nonReentrant beforeDeadline(deadline) returns (uint256 yesOut, uint256 noOut) {
		require(recipient != address(0), 'Recipient is zero');
		require(liquidity > 0, 'Liquidity is zero');
		(uint256 yesReserve, uint256 noReserve) = _effectiveReserves();
		yesOut = Math.mulDiv(yesReserve, liquidity, totalSupply());
		noOut = Math.mulDiv(noReserve, liquidity, totalSupply());
		require(yesOut >= minYes && noOut >= minNo, 'Liquidity slippage');
		// A dust position can round to zero on the scarce side. It must still exit.
		require(yesOut > 0 || noOut > 0, 'Liquidity output is zero');
		_burn(msg.sender, liquidity);
		if (yesOut != 0 && noOut != 0) {
			uint256[] memory ids = new uint256[](2);
			uint256[] memory amounts = new uint256[](2);
			ids[0] = yesTokenId;
			ids[1] = noTokenId;
			amounts[0] = yesOut;
			amounts[1] = noOut;
			shareToken.safeBatchTransferFrom(address(this), recipient, ids, amounts, '');
		} else if (yesOut != 0) shareToken.safeTransferFrom(address(this), recipient, yesTokenId, yesOut, '');
		else shareToken.safeTransferFrom(address(this), recipient, noTokenId, noOut, '');
		_checkReserves(yesReserve - yesOut, noReserve - noOut);
		emit LiquidityRemoved(msg.sender, recipient, yesOut, noOut, liquidity);
	}

	function swapExactInput(bool yesForNo, uint256 amountIn, uint256 minAmountOut, address recipient, uint256 deadline) external nonReentrant beforeDeadline(deadline) returns (uint256 amountOut, uint256 feeAmount) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		(uint256 yesReserve, uint256 noReserve) = _effectiveReserves();
		(uint256 reserveIn, uint256 reserveOut) = yesForNo ? (yesReserve, noReserve) : (noReserve, yesReserve);
		(amountOut, feeAmount) = TwoWayConstantProductMath.quoteExactInput(reserveIn, reserveOut, amountIn, feeBps);
		require(amountOut >= minAmountOut, 'Swap slippage');
		uint256 tokenIn = yesForNo ? yesTokenId : noTokenId;
		uint256 tokenOut = yesForNo ? noTokenId : yesTokenId;
		shareToken.safeTransferFrom(msg.sender, address(this), tokenIn, amountIn, '');
		shareToken.safeTransferFrom(address(this), recipient, tokenOut, amountOut, '');
		_checkReserves(yesForNo ? yesReserve + amountIn : yesReserve - amountOut, yesForNo ? noReserve - amountOut : noReserve + amountIn);
		emit Swap(msg.sender, recipient, yesForNo, false, amountIn, amountOut, feeAmount, _yesBalance(), _noBalance());
	}

	function swapExactOutput(bool yesForNo, uint256 amountOut, uint256 maxAmountIn, address recipient, uint256 deadline) external nonReentrant beforeDeadline(deadline) returns (uint256 amountIn, uint256 feeAmount) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		(uint256 yesReserve, uint256 noReserve) = _effectiveReserves();
		(uint256 reserveIn, uint256 reserveOut) = yesForNo ? (yesReserve, noReserve) : (noReserve, yesReserve);
		(amountIn, feeAmount) = TwoWayConstantProductMath.quoteExactOutput(reserveIn, reserveOut, amountOut, feeBps);
		require(amountIn <= maxAmountIn, 'Swap slippage');
		uint256 tokenIn = yesForNo ? yesTokenId : noTokenId;
		uint256 tokenOut = yesForNo ? noTokenId : yesTokenId;
		shareToken.safeTransferFrom(msg.sender, address(this), tokenIn, amountIn, '');
		shareToken.safeTransferFrom(address(this), recipient, tokenOut, amountOut, '');
		_checkReserves(yesForNo ? yesReserve + amountIn : yesReserve - amountOut, yesForNo ? noReserve - amountOut : noReserve + amountIn);
		emit Swap(msg.sender, recipient, yesForNo, true, amountIn, amountOut, feeAmount, _yesBalance(), _noBalance());
	}

	function sync() external nonReentrant {
		require(totalSupply() > 0, 'Uninitialized');
		(uint256 yesReserve, uint256 noReserve) = _effectiveReserves();
		emit Sync(yesReserve, noReserve);
	}

	function quoteExactInput(bool yesForNo, uint256 amountIn) external view returns (uint256 amountOut, uint256 feeAmount) {
		(uint256 effectiveYes, uint256 effectiveNo) = _effectiveReserves();
		return
			yesForNo
				? TwoWayConstantProductMath.quoteExactInput(effectiveYes, effectiveNo, amountIn, feeBps)
				: TwoWayConstantProductMath.quoteExactInput(effectiveNo, effectiveYes, amountIn, feeBps);
	}

	function quoteExactOutput(bool yesForNo, uint256 amountOut) external view returns (uint256 amountIn, uint256 feeAmount) {
		(uint256 effectiveYes, uint256 effectiveNo) = _effectiveReserves();
		return
			yesForNo
				? TwoWayConstantProductMath.quoteExactOutput(effectiveYes, effectiveNo, amountOut, feeBps)
				: TwoWayConstantProductMath.quoteExactOutput(effectiveNo, effectiveYes, amountOut, feeBps);
	}

	function onERC1155Received(address operator, address, uint256 id, uint256, bytes calldata) external view returns (bytes4) {
		_validateReceivedShare(operator, id);
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(address operator, address, uint256[] calldata ids, uint256[] calldata, bytes calldata) external view returns (bytes4) {
		require(ids.length > 0, 'Empty share batch');
		for (uint256 index = 0; index < ids.length; index++) _validateReceivedShare(operator, ids[index]);
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == type(IERC165).interfaceId;
	}

	function _validateReceivedShare(address operator, uint256 id) private view {
		require(msg.sender == address(shareToken), 'Wrong share token');
		require(id == yesTokenId || id == noTokenId, 'Unsupported share id');
		require(totalSupply() > 0 || operator == address(this), 'Uninitialized donation');
	}

	function _requireLifecycleOpen(bool requireInitialized) private view {
		if (requireInitialized) require(totalSupply() > 0, 'Uninitialized');
		require(block.timestamp < questionLedger.questionData().getQuestionEndDate(questionId), 'Question ended');
		require(questionLedger.zoltar().getForkTime(universeId) == 0, 'Universe forked');
		require(!questionLedger.awaitingForkContinuation(), 'Fork continuation pending');
		require(questionLedger.systemState() == SystemState.Operational, 'Pool inactive');
		require(IQuestionForker(questionLedger.questionForker()).getQuestionOutcome(questionLedger) == BinaryOutcomes.BinaryOutcome.None, 'Question resolved');
	}

	function _effectiveReserves() private view returns (uint256 effectiveYes, uint256 effectiveNo) {
		effectiveYes = _yesBalance();
		effectiveNo = _noBalance();
		require(_invalidBalance() == 0, 'Pair holds INVALID');
	}

	function _checkReserves(uint256 minimumYes, uint256 minimumNo) private {
		(uint256 yesBalance, uint256 noBalance) = _effectiveReserves();
		require(yesBalance >= minimumYes && noBalance >= minimumNo, 'Balance below expected');
		emit Sync(yesBalance, noBalance);
	}

	function _yesBalance() private view returns (uint256) {
		return shareToken.balanceOf(address(this), yesTokenId);
	}

	function _noBalance() private view returns (uint256) {
		return shareToken.balanceOf(address(this), noTokenId);
	}

	function _invalidBalance() private view returns (uint256) {
		return shareToken.balanceOf(address(this), invalidTokenId);
	}
}
