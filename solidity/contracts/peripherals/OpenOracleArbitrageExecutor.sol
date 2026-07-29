// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';

interface IOpenOracleDispute {
	struct OracleGame {
		uint128 currentAmount1;
		uint128 currentAmount2;
		address currentReporter;
		uint48 reportTimestamp;
		uint48 settlementTimestamp;
		address token1;
		uint48 lastReportOppoTime;
		uint48 settlementTime;
		uint128 escalationHalt;
		address protocolFeeRecipient;
		uint96 settlerReward;
		address token2;
		uint24 numReports;
		uint24 disputeDelay;
		uint24 feePercentage;
		uint16 multiplier;
		address callbackContract;
		uint32 callbackGasLimit;
		uint24 protocolFee;
		uint8 flags;
	}

	struct PreimageHelper {
		uint256 reportId;
		address creator;
		uint256 blockTimestamp;
		uint256 blockNumber;
	}

	struct TimingBoundaries {
		uint256 blockNumber;
		uint256 blockNumberBound;
		uint256 blockTimestamp;
		uint256 blockTimestampBound;
	}

	function dispute(
		uint256 reportId,
		uint128 newAmount1,
		uint128 newAmount2,
		address disputer,
		bool tryInternalBalance1,
		bool tryInternalBalance2,
		OracleGame calldata params,
		PreimageHelper calldata helper,
		TimingBoundaries calldata timing
	) external payable;
}

interface IOpenOracleLifecycle {
	function settle(
		uint256 reportId,
		IOpenOracleDispute.OracleGame calldata params,
		IOpenOracleDispute.PreimageHelper calldata helper
	) external;

	function internalTransferFrom(address from, address to, address token, uint128 amount) external;

	function withdrawTo(address tokenToGet, uint256 amount, address to) external returns (uint256 sent);
}

interface IUniswapV3SwapRouter {
	struct ExactInputSingleParams {
		address tokenIn;
		address tokenOut;
		uint24 fee;
		address recipient;
		uint256 deadline;
		uint256 amountIn;
		uint256 amountOutMinimum;
		uint160 sqrtPriceLimitX96;
	}

	struct ExactOutputSingleParams {
		address tokenIn;
		address tokenOut;
		uint24 fee;
		address recipient;
		uint256 deadline;
		uint256 amountOut;
		uint256 amountInMaximum;
		uint160 sqrtPriceLimitX96;
	}

	function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

	function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256 amountIn);
}

interface IUniswapV2Router {
	function swapExactTokensForTokens(
		uint256 amountIn,
		uint256 amountOutMin,
		address[] calldata path,
		address to,
		uint256 deadline
	) external returns (uint256[] memory amounts);

	function swapTokensForExactTokens(
		uint256 amountOut,
		uint256 amountInMax,
		address[] calldata path,
		address to,
		uint256 deadline
	) external returns (uint256[] memory amounts);
}

/// @notice Funds one OpenOracle dispute atomically and rejects non-exact ERC-20 transfers.
/// @dev The caller remains the OpenOracle disputer. A successful dispute retains no operation-pulled token balance or OpenOracle allowance.
contract OpenOracleArbitrageExecutor {
	using SafeERC20Ops for IERC20;

	uint256 private constant PERCENTAGE_PRECISION = 1e7;
	bool private entered;

	struct HedgeRequest {
		address openOracle;
		address router;
		uint8 venue;
		uint24 poolFee;
		uint128 newAmount1;
		uint128 newAmount2;
		uint256 hedgeWethLimit;
		uint256 swapDeadline;
		bytes32 expectedParentBlockHash;
	}

	struct LifecycleRequest {
		address openOracle;
		uint256 parentBlockNumber;
		bytes32 expectedParentBlockHash;
		uint128 amount1;
		uint128 amount2;
	}

	struct ReplacementWithdrawalRequest {
		address openOracle;
		address token;
		uint256 parentBlockNumber;
		bytes32 expectedParentBlockHash;
		uint256 amount;
	}

	struct ExecutionBalances {
		uint256 executorToken1;
		uint256 executorToken2;
		uint256 oracleToken1;
		uint256 oracleToken2;
	}

	struct HedgeResult {
		bool boughtToken2;
		uint256 contribution1;
		uint256 contribution2;
		uint256 hedgeAmountToken2;
		uint256 hedgeAmountWeth;
	}

	event HedgeAndDisputeExecuted(
		address indexed account,
		uint256 indexed reportId,
		bool boughtToken2,
		uint256 hedgeAmountToken2,
		uint256 hedgeAmountWeth,
		uint256 contribution1,
		uint256 contribution2
	);

	event LifecycleExecuted(
		address indexed account,
		uint256 indexed reportId,
		address indexed token1,
		uint256 amount1,
		address token2,
		uint256 amount2,
		uint256 settlerReward
	);

	event ReplacementCreditWithdrawn(
		address indexed account,
		uint256 indexed reportId,
		address indexed token,
		uint256 amount
	);

	function dispute(
		address openOracle,
		uint128 newAmount1,
		uint128 newAmount2,
		IOpenOracleDispute.OracleGame calldata game,
		IOpenOracleDispute.PreimageHelper calldata helper,
		IOpenOracleDispute.TimingBoundaries calldata timing
	) external {
		require(!entered, 'OpenOracle arbitrage executor reentrancy');
		require(openOracle.code.length > 0, 'OpenOracle address must contain contract code');
		require(
			game.token1 != address(0) && game.token2 != address(0),
			'OpenOracle arbitrage executor requires ERC20 tokens'
		);
		require(game.token1 != game.token2, 'OpenOracle arbitrage executor tokens must differ');
		require(msg.sender != game.currentReporter, 'OpenOracle arbitrage executor does not support self-disputes');
		entered = true;

		(uint256 contribution1, uint256 contribution2) = _contributions(game, newAmount1, newAmount2);
		uint256 executorBalance1 = IERC20(game.token1).balanceOf(address(this));
		uint256 executorBalance2 = IERC20(game.token2).balanceOf(address(this));
		uint256 oracleBalance1 = IERC20(game.token1).balanceOf(openOracle);
		uint256 oracleBalance2 = IERC20(game.token2).balanceOf(openOracle);

		_pullExact(IERC20(game.token1), contribution1, executorBalance1);
		_pullExact(IERC20(game.token2), contribution2, executorBalance2);
		_approveExact(IERC20(game.token1), openOracle, contribution1);
		_approveExact(IERC20(game.token2), openOracle, contribution2);

		IOpenOracleDispute(openOracle).dispute(
			helper.reportId,
			newAmount1,
			newAmount2,
			msg.sender,
			false,
			false,
			game,
			helper,
			timing
		);

		_approveExact(IERC20(game.token1), openOracle, 0);
		_approveExact(IERC20(game.token2), openOracle, 0);
		require(
			IERC20(game.token1).balanceOf(address(this)) == executorBalance1,
			'Token1 transfer amount was not exact'
		);
		require(
			IERC20(game.token2).balanceOf(address(this)) == executorBalance2,
			'Token2 transfer amount was not exact'
		);
		require(
			IERC20(game.token1).balanceOf(openOracle) == oracleBalance1 + contribution1,
			'OpenOracle token1 receipt was not exact'
		);
		require(
			IERC20(game.token2).balanceOf(openOracle) == oracleBalance2 + contribution2,
			'OpenOracle token2 receipt was not exact'
		);

		entered = false;
	}

	/// @notice Atomically hedges the OpenOracle replacement exposure and funds the dispute.
	/// @dev `hedgeWethLimit` is the minimum WETH output when selling token2 and the maximum WETH
	///      input when buying token2. The caller remains the OpenOracle reporter and owns all
	///      immediate and eventual OpenOracle balances.
	function hedgeAndDispute(
		HedgeRequest calldata request,
		IOpenOracleDispute.OracleGame calldata game,
		IOpenOracleDispute.PreimageHelper calldata helper,
		IOpenOracleDispute.TimingBoundaries calldata timing
	) external {
		require(!entered, 'OpenOracle arbitrage executor reentrancy');
		assertParentBlock(timing.blockNumber, request.expectedParentBlockHash);
		require(request.openOracle.code.length > 0, 'OpenOracle address must contain contract code');
		require(request.router.code.length > 0, 'Uniswap router address must contain contract code');
		require(
			game.token1 != address(0) && game.token2 != address(0),
			'OpenOracle arbitrage executor requires ERC20 tokens'
		);
		require(game.token1 != game.token2, 'OpenOracle arbitrage executor tokens must differ');
		require(msg.sender != game.currentReporter, 'OpenOracle arbitrage executor does not support self-disputes');
		require(block.timestamp <= request.swapDeadline, 'OpenOracle arbitrage hedge deadline expired');
		entered = true;

		IERC20 token1 = IERC20(game.token1);
		IERC20 token2 = IERC20(game.token2);
		ExecutionBalances memory balances = ExecutionBalances({
			executorToken1: token1.balanceOf(address(this)),
			executorToken2: token2.balanceOf(address(this)),
			oracleToken1: token1.balanceOf(request.openOracle),
			oracleToken2: token2.balanceOf(request.openOracle)
		});
		HedgeResult memory result = _executeHedge(request, game, balances);

		_approveExact(token1, request.openOracle, result.contribution1);
		_approveExact(token2, request.openOracle, result.contribution2);
		IOpenOracleDispute(request.openOracle).dispute(
			helper.reportId,
			request.newAmount1,
			request.newAmount2,
			msg.sender,
			false,
			false,
			game,
			helper,
			timing
		);
		_approveExact(token1, request.openOracle, 0);
		_approveExact(token2, request.openOracle, 0);

		uint256 wethRefund =
			result.boughtToken2 ? request.hedgeWethLimit - result.hedgeAmountWeth : result.hedgeAmountWeth;
		if (wethRefund != 0) token1.safeTransfer(msg.sender, wethRefund);
		require(token1.balanceOf(address(this)) == balances.executorToken1, 'Token1 transfer amount was not exact');
		require(token2.balanceOf(address(this)) == balances.executorToken2, 'Token2 transfer amount was not exact');
		require(
			token1.balanceOf(request.openOracle) == balances.oracleToken1 + result.contribution1,
			'OpenOracle token1 receipt was not exact'
		);
		require(
			token2.balanceOf(request.openOracle) == balances.oracleToken2 + result.contribution2,
			'OpenOracle token2 receipt was not exact'
		);

		emit HedgeAndDisputeExecuted(
			msg.sender,
			helper.reportId,
			result.boughtToken2,
			result.hedgeAmountToken2,
			result.hedgeAmountWeth,
			result.contribution1,
			result.contribution2
		);
		entered = false;
	}

	/// @notice Atomically settles when needed and withdraws only one position's exact proceeds.
	/// @dev The caller must approve this executor through OpenOracle's internal allowance for both tokens.
	///      Permissionless credits and proceeds belonging to other positions remain in the caller's OpenOracle balance.
	function settleAndWithdraw(
		LifecycleRequest calldata request,
		IOpenOracleDispute.OracleGame calldata game,
		IOpenOracleDispute.PreimageHelper calldata helper
	) external {
		require(!entered, 'OpenOracle arbitrage executor reentrancy');
		assertParentBlock(request.parentBlockNumber, request.expectedParentBlockHash);
		require(request.openOracle.code.length > 0, 'OpenOracle address must contain contract code');
		require(
			game.token1 != address(0) && game.token2 != address(0),
			'OpenOracle arbitrage executor requires ERC20 tokens'
		);
		require(game.token1 != game.token2, 'OpenOracle arbitrage executor tokens must differ');
		require(request.amount1 != 0 && request.amount2 != 0, 'OpenOracle lifecycle amounts must be positive');
		entered = true;

		IOpenOracleLifecycle openOracle = IOpenOracleLifecycle(request.openOracle);
		uint256 settlerReward;
		if (game.currentReporter == msg.sender && game.settlementTimestamp == 0) {
			openOracle.settle(helper.reportId, game, helper);
			settlerReward = game.settlerReward;
		}

		uint256 walletBalance1 = IERC20(game.token1).balanceOf(msg.sender);
		uint256 walletBalance2 = IERC20(game.token2).balanceOf(msg.sender);
		openOracle.internalTransferFrom(msg.sender, address(this), game.token1, request.amount1);
		openOracle.internalTransferFrom(msg.sender, address(this), game.token2, request.amount2);
		require(
			openOracle.withdrawTo(game.token1, request.amount1, msg.sender) == request.amount1,
			'OpenOracle lifecycle token1 withdrawal was not exact'
		);
		require(
			openOracle.withdrawTo(game.token2, request.amount2, msg.sender) == request.amount2,
			'OpenOracle lifecycle token2 withdrawal was not exact'
		);
		require(
			IERC20(game.token1).balanceOf(msg.sender) == walletBalance1 + request.amount1,
			'OpenOracle lifecycle token1 receipt was not exact'
		);
		require(
			IERC20(game.token2).balanceOf(msg.sender) == walletBalance2 + request.amount2,
			'OpenOracle lifecycle token2 receipt was not exact'
		);
		if (settlerReward != 0) {
			uint256 walletEthBalance = msg.sender.balance;
			require(
				openOracle.withdrawTo(address(0), settlerReward, msg.sender) == settlerReward,
				'OpenOracle lifecycle settler reward withdrawal was not exact'
			);
			require(
				msg.sender.balance == walletEthBalance + settlerReward,
				'OpenOracle lifecycle settler reward receipt was not exact'
			);
		}

		emit LifecycleExecuted(
			msg.sender,
			helper.reportId,
			game.token1,
			request.amount1,
			game.token2,
			request.amount2,
			settlerReward
		);
		entered = false;
	}

	/// @notice Withdraws the exact credit created when a later dispute replaces the caller's report.
	/// @dev The caller must approve this executor through OpenOracle's internal allowance for the credited token.
	///      Unrelated holder balances remain inside OpenOracle.
	function withdrawReplacementCredit(ReplacementWithdrawalRequest calldata request, uint256 reportId) external {
		require(!entered, 'OpenOracle arbitrage executor reentrancy');
		assertParentBlock(request.parentBlockNumber, request.expectedParentBlockHash);
		require(request.openOracle.code.length > 0, 'OpenOracle address must contain contract code');
		require(request.token.code.length > 0, 'Replacement credit token must contain contract code');
		require(request.amount != 0, 'Replacement credit amount must be positive');
		require(request.amount <= uint256(type(uint128).max) * 4, 'Replacement credit amount exceeds report bounds');
		entered = true;

		uint256 walletBalance = IERC20(request.token).balanceOf(msg.sender);
		IOpenOracleLifecycle openOracle = IOpenOracleLifecycle(request.openOracle);
		uint256 remaining = request.amount;
		while (remaining != 0) {
			uint128 chunk = remaining > type(uint128).max ? type(uint128).max : uint128(remaining);
			openOracle.internalTransferFrom(msg.sender, address(this), request.token, chunk);
			remaining -= chunk;
		}
		require(
			openOracle.withdrawTo(request.token, request.amount, msg.sender) == request.amount,
			'OpenOracle replacement credit withdrawal was not exact'
		);
		require(
			IERC20(request.token).balanceOf(msg.sender) == walletBalance + request.amount,
			'OpenOracle replacement credit receipt was not exact'
		);

		emit ReplacementCreditWithdrawn(msg.sender, reportId, request.token, request.amount);
		entered = false;
	}

	/// @notice Reverts unless execution occurs in the direct child of the signed canonical parent.
	/// @dev This guard can be included as the first transaction in any atomic private bundle.
	function assertParentBlock(uint256 parentBlockNumber, bytes32 expectedParentBlockHash) public view {
		require(block.number != 0 && parentBlockNumber == block.number - 1, 'Execution must target the next block');
		require(
			expectedParentBlockHash != bytes32(0) && blockhash(parentBlockNumber) == expectedParentBlockHash,
			'Execution canonical parent block changed'
		);
	}

	function _executeHedge(
		HedgeRequest calldata request,
		IOpenOracleDispute.OracleGame calldata game,
		ExecutionBalances memory balances
	) private returns (HedgeResult memory result) {
		(result.contribution1, result.contribution2) = _contributions(game, request.newAmount1, request.newAmount2);
		result.boughtToken2 =
			uint256(request.newAmount2) * game.currentAmount1 >
			uint256(game.currentAmount2) * request.newAmount1;
		if (result.boughtToken2) {
			return _executeBuyHedge(request, game, balances, result);
		}
		return _executeSellHedge(request, game, balances, result);
	}

	function _executeBuyHedge(
		HedgeRequest calldata request,
		IOpenOracleDispute.OracleGame calldata game,
		ExecutionBalances memory balances,
		HedgeResult memory result
	) private returns (HedgeResult memory) {
		IERC20 token1 = IERC20(game.token1);
		IERC20 token2 = IERC20(game.token2);
		result.hedgeAmountToken2 =
			uint256(game.currentAmount2) +
			_fee(game.currentAmount2, game.feePercentage) +
			_fee(game.currentAmount2, game.protocolFee);
		require(result.contribution2 >= result.hedgeAmountToken2, 'OpenOracle buy hedge exceeds token2 contribution');
		_pullExact(token1, result.contribution1 + request.hedgeWethLimit, balances.executorToken1);
		_pullExact(token2, result.contribution2 - result.hedgeAmountToken2, balances.executorToken2);
		_approveExact(token1, request.router, request.hedgeWethLimit);
		if (request.venue == 0) {
			result.hedgeAmountWeth = IUniswapV3SwapRouter(request.router).exactOutputSingle(
				IUniswapV3SwapRouter.ExactOutputSingleParams({
					tokenIn: game.token1,
					tokenOut: game.token2,
					fee: request.poolFee,
					recipient: address(this),
					deadline: request.swapDeadline,
					amountOut: result.hedgeAmountToken2,
					amountInMaximum: request.hedgeWethLimit,
					sqrtPriceLimitX96: 0
				})
			);
		} else {
			require(request.venue == 1, 'Unsupported hedge venue');
			address[] memory path = new address[](2);
			path[0] = game.token1;
			path[1] = game.token2;
			uint256[] memory amounts = IUniswapV2Router(request.router).swapTokensForExactTokens(
				result.hedgeAmountToken2,
				request.hedgeWethLimit,
				path,
				address(this),
				request.swapDeadline
			);
			require(amounts.length == 2 && amounts[1] == result.hedgeAmountToken2, 'Uniswap V2 buy amounts invalid');
			result.hedgeAmountWeth = amounts[0];
		}
		require(result.hedgeAmountWeth <= request.hedgeWethLimit, 'Uniswap buy hedge exceeded maximum WETH');
		_approveExact(token1, request.router, 0);
		return result;
	}

	function _executeSellHedge(
		HedgeRequest calldata request,
		IOpenOracleDispute.OracleGame calldata game,
		ExecutionBalances memory balances,
		HedgeResult memory result
	) private returns (HedgeResult memory) {
		IERC20 token1 = IERC20(game.token1);
		IERC20 token2 = IERC20(game.token2);
		result.hedgeAmountToken2 = game.currentAmount2;
		_pullExact(token1, result.contribution1, balances.executorToken1);
		_pullExact(token2, result.contribution2 + result.hedgeAmountToken2, balances.executorToken2);
		_approveExact(token2, request.router, result.hedgeAmountToken2);
		if (request.venue == 0) {
			result.hedgeAmountWeth = IUniswapV3SwapRouter(request.router).exactInputSingle(
				IUniswapV3SwapRouter.ExactInputSingleParams({
					tokenIn: game.token2,
					tokenOut: game.token1,
					fee: request.poolFee,
					recipient: address(this),
					deadline: request.swapDeadline,
					amountIn: result.hedgeAmountToken2,
					amountOutMinimum: request.hedgeWethLimit,
					sqrtPriceLimitX96: 0
				})
			);
		} else {
			require(request.venue == 1, 'Unsupported hedge venue');
			address[] memory path = new address[](2);
			path[0] = game.token2;
			path[1] = game.token1;
			uint256[] memory amounts = IUniswapV2Router(request.router).swapExactTokensForTokens(
				result.hedgeAmountToken2,
				request.hedgeWethLimit,
				path,
				address(this),
				request.swapDeadline
			);
			require(amounts.length == 2 && amounts[0] == result.hedgeAmountToken2, 'Uniswap V2 sell amounts invalid');
			result.hedgeAmountWeth = amounts[1];
		}
		require(result.hedgeAmountWeth >= request.hedgeWethLimit, 'Uniswap sell hedge received too little WETH');
		_approveExact(token2, request.router, 0);
		return result;
	}

	function contributions(
		IOpenOracleDispute.OracleGame calldata game,
		uint128 newAmount1,
		uint128 newAmount2
	) external pure returns (uint256 contribution1, uint256 contribution2) {
		return _contributions(game, newAmount1, newAmount2);
	}

	function _contributions(
		IOpenOracleDispute.OracleGame calldata game,
		uint128 newAmount1,
		uint128 newAmount2
	) private pure returns (uint256 contribution1, uint256 contribution2) {
		bool swapToken2 = uint256(newAmount2) * game.currentAmount1 > uint256(game.currentAmount2) * newAmount1;
		if (swapToken2) {
			contribution1 = newAmount1 > game.currentAmount1 ? newAmount1 - game.currentAmount1 : 0;
			contribution2 =
				uint256(newAmount2) +
				game.currentAmount2 +
				_fee(game.currentAmount2, game.feePercentage) +
				_fee(game.currentAmount2, game.protocolFee);
		} else {
			contribution1 =
				uint256(newAmount1) +
				game.currentAmount1 +
				_fee(game.currentAmount1, game.feePercentage) +
				_fee(game.currentAmount1, game.protocolFee);
			contribution2 = newAmount2 > game.currentAmount2 ? newAmount2 - game.currentAmount2 : 0;
		}
	}

	function _fee(uint256 amount, uint256 rate) private pure returns (uint256) {
		return (amount * rate) / PERCENTAGE_PRECISION;
	}

	function _pullExact(IERC20 token, uint256 amount, uint256 balanceBefore) private {
		if (amount == 0) return;
		token.safeTransferFrom(msg.sender, address(this), amount);
		require(token.balanceOf(address(this)) == balanceBefore + amount, 'Token transfer to executor was not exact');
	}

	function _approveExact(IERC20 token, address spender, uint256 amount) private {
		if (token.allowance(address(this), spender) != 0) token.safeApprove(spender, 0);
		if (amount != 0) token.safeApprove(spender, amount);
	}
}
