// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../solidity/contracts/IERC20.sol';

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
		uint96 settlerRewardAttoEth;
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

interface IWETH is IERC20 {
	function deposit() external payable;

	function withdraw(uint256 amount) external;
}

interface IUniswapV4PoolManager {
	struct PoolKey {
		address currency0;
		address currency1;
		uint24 fee;
		int24 tickSpacing;
		address hooks;
	}

	struct SwapParams {
		bool zeroForOne;
		int256 amountSpecified;
		uint160 sqrtPriceLimitX96;
	}

	function unlock(bytes calldata data) external returns (bytes memory);

	function swap(
		PoolKey calldata key,
		SwapParams calldata params,
		bytes calldata hookData
	) external returns (int256 delta);

	function sync(address currency) external;

	function take(address currency, address to, uint256 amount) external;

	function settle() external payable returns (uint256 paid);
}
