// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../../solidity/contracts/peripherals/BinaryOutcomes.sol';
import { ISecurityPool, SystemState } from '../../solidity/contracts/peripherals/interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from '../../solidity/contracts/peripherals/interfaces/ISecurityPoolForker.sol';
import { IERC1155Receiver } from '../../solidity/contracts/peripherals/interfaces/IERC1155Receiver.sol';
import { Math } from '../../solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ITradingShareToken } from './interfaces/ITradingShareToken.sol';
import { ITwoWayConstantProductPair } from './interfaces/ITwoWayConstantProductPair.sol';
import { TwoWayConstantProductMath } from './TwoWayConstantProductMath.sol';

contract TwoWayConstantProductPair is ITwoWayConstantProductPair, IERC1155Receiver {
	string public constant name = 'Zoltar Two-Way LP';
	string public constant symbol = 'Z2LP';
	uint8 public constant decimals = 18;
	uint256 public constant MINIMUM_LIQUIDITY = 1_000;

	address public immutable factory;
	ISecurityPool public immutable securityPool;
	ITradingShareToken public immutable shareToken;
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	uint256 public immutable invalidTokenId;
	uint256 public immutable yesTokenId;
	uint256 public immutable noTokenId;
	uint256 public immutable feeBps;

	uint256 public totalSupply;
	mapping(address => uint256) public balanceOf;
	mapping(address => mapping(address => uint256)) public allowance;
	uint256 private yesReserve;
	uint256 private noReserve;
	bool private entered;

	event Transfer(address indexed from, address indexed to, uint256 amount);
	event Approval(address indexed owner, address indexed spender, uint256 amount);
	event LiquidityInitialized(
		address indexed provider,
		address indexed recipient,
		uint256 yesAmount,
		uint256 noAmount,
		uint256 liquidity
	);
	event LiquidityAdded(
		address indexed provider,
		address indexed recipient,
		uint256 yesAmount,
		uint256 noAmount,
		uint256 liquidity
	);
	event LiquidityRemoved(
		address indexed provider,
		address indexed recipient,
		uint256 yesAmount,
		uint256 noAmount,
		uint256 liquidity
	);
	event Swap(
		address indexed sender,
		address indexed recipient,
		bool yesForNo,
		bool exactOutput,
		uint256 amountIn,
		uint256 amountOut,
		uint256 feeAmount,
		uint256 resultingYesReserve,
		uint256 resultingNoReserve
	);
	event Sync(uint256 yesReserve, uint256 noReserve);
	event PredeploymentSharesQuarantined(uint256 invalidAmount, uint256 yesAmount, uint256 noAmount);

	modifier nonReentrant() {
		require(!entered, 'Reentrant call');
		entered = true;
		_;
		entered = false;
	}

	constructor(address _factory, ISecurityPool _securityPool, uint256 _feeBps, address predeploymentShareSink) {
		require(_factory != address(0), 'Factory is zero');
		require(address(_securityPool) != address(0), 'Security pool is zero');
		require(_feeBps < 10_000, 'Invalid fee');
		require(predeploymentShareSink != address(0), 'Share sink is zero');
		factory = _factory;
		securityPool = _securityPool;
		shareToken = ITradingShareToken(address(_securityPool.shareToken()));
		universeId = _securityPool.universeId();
		questionId = _securityPool.questionId();
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

	function approve(address spender, uint256 amount) external returns (bool) {
		allowance[msg.sender][spender] = amount;
		emit Approval(msg.sender, spender, amount);
		return true;
	}

	function transfer(address recipient, uint256 amount) external returns (bool) {
		_transfer(msg.sender, recipient, amount);
		return true;
	}

	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
		uint256 approved = allowance[sender][msg.sender];
		if (approved != type(uint256).max) {
			require(approved >= amount, 'LP allowance');
			allowance[sender][msg.sender] = approved - amount;
			emit Approval(sender, msg.sender, approved - amount);
		}
		_transfer(sender, recipient, amount);
		return true;
	}

	function getReserves() external view returns (uint256, uint256) {
		return (yesReserve, noReserve);
	}

	function getEffectiveReserves() external view returns (uint256, uint256) {
		return _effectiveReserves();
	}

	function tradingStatus() public view returns (TradingStatus status) {
		if (totalSupply == 0) return TradingStatus.Uninitialized;
		if (securityPool.zoltar().getForkTime(universeId) != 0) return TradingStatus.UniverseForked;
		if (securityPool.awaitingForkContinuation()) return TradingStatus.AwaitingForkContinuation;
		if (securityPool.systemState() != SystemState.Operational) return TradingStatus.PoolInactive;
		if (
			ISecurityPoolForker(securityPool.securityPoolForker()).getQuestionOutcome(securityPool) !=
			BinaryOutcomes.BinaryOutcome.None
		) return TradingStatus.QuestionResolved;
		if (block.timestamp >= securityPool.questionData().getQuestionEndDate(questionId))
			return TradingStatus.QuestionEnded;
		return TradingStatus.Open;
	}

	function initialize(
		uint256 yesAmount,
		uint256 noAmount,
		uint256 minLiquidity,
		address recipient
	) external nonReentrant returns (uint256 liquidity) {
		require(totalSupply == 0, 'Already initialized');
		_requireLifecycleOpen(false);
		require(recipient != address(0), 'Recipient is zero');
		require(_yesBalance() == 0 && _noBalance() == 0 && _invalidBalance() == 0, 'Nonzero initial balance');
		uint256 scale = yesAmount < noAmount ? yesAmount : noAmount;
		require(scale > MINIMUM_LIQUIDITY, 'Initial liquidity too small');
		shareToken.safeTransferFrom(msg.sender, address(this), yesTokenId, yesAmount, '');
		shareToken.safeTransferFrom(msg.sender, address(this), noTokenId, noAmount, '');
		liquidity = scale - MINIMUM_LIQUIDITY;
		require(liquidity >= minLiquidity, 'Minimum liquidity');
		_mint(address(0), MINIMUM_LIQUIDITY);
		_mint(recipient, liquidity);
		_updateReserves();
		emit LiquidityInitialized(msg.sender, recipient, yesAmount, noAmount, liquidity);
	}

	function addLiquidity(
		uint256 maxYes,
		uint256 maxNo,
		uint256 minLiquidity,
		address recipient
	) external nonReentrant returns (uint256 yesUsed, uint256 noUsed, uint256 liquidity) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		_synchronize();
		(yesUsed, noUsed) = TwoWayConstantProductMath.proportionalDeposit(yesReserve, noReserve, maxYes, maxNo);
		require(yesUsed > 0 && noUsed > 0, 'Liquidity rounds to zero');
		uint256 yesLiquidity = Math.mulDiv(yesUsed, totalSupply, yesReserve);
		uint256 noLiquidity = Math.mulDiv(noUsed, totalSupply, noReserve);
		liquidity = yesLiquidity < noLiquidity ? yesLiquidity : noLiquidity;
		require(liquidity > 0 && liquidity >= minLiquidity, 'Minimum liquidity');
		shareToken.safeTransferFrom(msg.sender, address(this), yesTokenId, yesUsed, '');
		shareToken.safeTransferFrom(msg.sender, address(this), noTokenId, noUsed, '');
		_mint(recipient, liquidity);
		_updateReserves();
		emit LiquidityAdded(msg.sender, recipient, yesUsed, noUsed, liquidity);
	}

	function removeLiquidity(
		uint256 liquidity,
		uint256 minYes,
		uint256 minNo,
		address recipient
	) external nonReentrant returns (uint256 yesOut, uint256 noOut) {
		require(recipient != address(0), 'Recipient is zero');
		require(liquidity > 0, 'Liquidity is zero');
		_synchronize();
		yesOut = Math.mulDiv(yesReserve, liquidity, totalSupply);
		noOut = Math.mulDiv(noReserve, liquidity, totalSupply);
		require(yesOut >= minYes && noOut >= minNo, 'Liquidity slippage');
		require(yesOut > 0 && noOut > 0, 'Liquidity output is zero');
		_burn(msg.sender, liquidity);
		shareToken.safeTransferFrom(address(this), recipient, yesTokenId, yesOut, '');
		shareToken.safeTransferFrom(address(this), recipient, noTokenId, noOut, '');
		_updateReserves();
		emit LiquidityRemoved(msg.sender, recipient, yesOut, noOut, liquidity);
	}

	function swapExactInput(
		bool yesForNo,
		uint256 amountIn,
		uint256 minAmountOut,
		address recipient
	) external nonReentrant returns (uint256 amountOut, uint256 feeAmount) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		_synchronize();
		(uint256 reserveIn, uint256 reserveOut) = yesForNo ? (yesReserve, noReserve) : (noReserve, yesReserve);
		(amountOut, feeAmount) = TwoWayConstantProductMath.quoteExactInput(reserveIn, reserveOut, amountIn, feeBps);
		require(amountOut >= minAmountOut, 'Swap slippage');
		uint256 tokenIn = yesForNo ? yesTokenId : noTokenId;
		uint256 tokenOut = yesForNo ? noTokenId : yesTokenId;
		shareToken.safeTransferFrom(msg.sender, address(this), tokenIn, amountIn, '');
		shareToken.safeTransferFrom(address(this), recipient, tokenOut, amountOut, '');
		_updateReserves();
		emit Swap(msg.sender, recipient, yesForNo, false, amountIn, amountOut, feeAmount, yesReserve, noReserve);
	}

	function swapExactOutput(
		bool yesForNo,
		uint256 amountOut,
		uint256 maxAmountIn,
		address recipient
	) external nonReentrant returns (uint256 amountIn, uint256 feeAmount) {
		_requireLifecycleOpen(true);
		require(recipient != address(0), 'Recipient is zero');
		_synchronize();
		(uint256 reserveIn, uint256 reserveOut) = yesForNo ? (yesReserve, noReserve) : (noReserve, yesReserve);
		(amountIn, feeAmount) = TwoWayConstantProductMath.quoteExactOutput(reserveIn, reserveOut, amountOut, feeBps);
		require(amountIn <= maxAmountIn, 'Swap slippage');
		uint256 tokenIn = yesForNo ? yesTokenId : noTokenId;
		uint256 tokenOut = yesForNo ? noTokenId : yesTokenId;
		shareToken.safeTransferFrom(msg.sender, address(this), tokenIn, amountIn, '');
		shareToken.safeTransferFrom(address(this), recipient, tokenOut, amountOut, '');
		_updateReserves();
		emit Swap(msg.sender, recipient, yesForNo, true, amountIn, amountOut, feeAmount, yesReserve, noReserve);
	}

	function sync() external nonReentrant {
		require(totalSupply > 0, 'Uninitialized');
		_synchronize();
	}

	function quoteExactInput(
		bool yesForNo,
		uint256 amountIn
	) external view returns (uint256 amountOut, uint256 feeAmount) {
		(uint256 effectiveYes, uint256 effectiveNo) = _effectiveReserves();
		return
			yesForNo
				? TwoWayConstantProductMath.quoteExactInput(effectiveYes, effectiveNo, amountIn, feeBps)
				: TwoWayConstantProductMath.quoteExactInput(effectiveNo, effectiveYes, amountIn, feeBps);
	}

	function quoteExactOutput(
		bool yesForNo,
		uint256 amountOut
	) external view returns (uint256 amountIn, uint256 feeAmount) {
		(uint256 effectiveYes, uint256 effectiveNo) = _effectiveReserves();
		return
			yesForNo
				? TwoWayConstantProductMath.quoteExactOutput(effectiveYes, effectiveNo, amountOut, feeBps)
				: TwoWayConstantProductMath.quoteExactOutput(effectiveNo, effectiveYes, amountOut, feeBps);
	}

	function onERC1155Received(
		address operator,
		address,
		uint256 id,
		uint256,
		bytes calldata
	) external view returns (bytes4) {
		_validateReceivedShare(operator, id);
		return IERC1155Receiver.onERC1155Received.selector;
	}

	function onERC1155BatchReceived(
		address operator,
		address,
		uint256[] calldata ids,
		uint256[] calldata,
		bytes calldata
	) external view returns (bytes4) {
		require(ids.length > 0, 'Empty share batch');
		for (uint256 index = 0; index < ids.length; index++) _validateReceivedShare(operator, ids[index]);
		return IERC1155Receiver.onERC1155BatchReceived.selector;
	}

	function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
		return interfaceId == type(IERC1155Receiver).interfaceId || interfaceId == 0x01ffc9a7;
	}

	function _validateReceivedShare(address operator, uint256 id) private view {
		require(msg.sender == address(shareToken), 'Wrong share token');
		require(id == yesTokenId || id == noTokenId, 'Unsupported share id');
		require(totalSupply > 0 || operator == address(this), 'Uninitialized donation');
	}

	function _requireLifecycleOpen(bool requireInitialized) private view {
		if (requireInitialized) require(totalSupply > 0, 'Uninitialized');
		require(block.timestamp < securityPool.questionData().getQuestionEndDate(questionId), 'Question ended');
		require(securityPool.zoltar().getForkTime(universeId) == 0, 'Universe forked');
		require(!securityPool.awaitingForkContinuation(), 'Fork continuation pending');
		require(securityPool.systemState() == SystemState.Operational, 'Pool inactive');
		require(
			ISecurityPoolForker(securityPool.securityPoolForker()).getQuestionOutcome(securityPool) ==
				BinaryOutcomes.BinaryOutcome.None,
			'Question resolved'
		);
	}

	function _effectiveReserves() private view returns (uint256 effectiveYes, uint256 effectiveNo) {
		effectiveYes = _yesBalance();
		effectiveNo = _noBalance();
		require(effectiveYes >= yesReserve && effectiveNo >= noReserve, 'Balance below reserve');
		require(_invalidBalance() == 0, 'Pair holds INVALID');
	}

	function _synchronize() private {
		(uint256 currentYes, uint256 currentNo) = _effectiveReserves();
		yesReserve = currentYes;
		noReserve = currentNo;
		emit Sync(currentYes, currentNo);
	}

	function _updateReserves() private {
		require(_invalidBalance() == 0, 'Pair holds INVALID');
		yesReserve = _yesBalance();
		noReserve = _noBalance();
		emit Sync(yesReserve, noReserve);
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

	function _mint(address recipient, uint256 amount) private {
		totalSupply += amount;
		balanceOf[recipient] += amount;
		emit Transfer(address(0), recipient, amount);
	}

	function _burn(address holder, uint256 amount) private {
		require(balanceOf[holder] >= amount, 'LP balance');
		balanceOf[holder] -= amount;
		totalSupply -= amount;
		emit Transfer(holder, address(0), amount);
	}

	function _transfer(address sender, address recipient, uint256 amount) private {
		require(recipient != address(0), 'Recipient is zero');
		require(balanceOf[sender] >= amount, 'LP balance');
		balanceOf[sender] -= amount;
		balanceOf[recipient] += amount;
		emit Transfer(sender, recipient, amount);
	}
}
