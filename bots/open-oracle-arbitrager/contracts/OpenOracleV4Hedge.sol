// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../solidity/contracts/IERC20.sol';
import { SafeERC20Ops } from '../../solidity/contracts/SafeERC20Ops.sol';
import { IWETH, IUniswapV4PoolManager } from './OpenOracleExecutionInterfaces.sol';

/// @dev One-shot authenticated V4 swaps and native/WETH settlement for the executor.
/// The shared execution guard stays active across dispute, hedge and lifecycle external calls.
abstract contract OpenOracleV4Hedge {
	using SafeERC20Ops for IERC20;

	uint160 private constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
	uint160 private constant MAX_SQRT_PRICE_MINUS_ONE =
		1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;
	bool internal entered;
	address private activeV4PoolManager;
	bytes32 private activeV4CallbackHash;

	struct V4SwapCallbackData {
		address token;
		uint24 poolFee;
		bool buyToken;
		uint256 amount;
		uint256 limit;
	}

	receive() external payable {
		require(entered, 'OpenOracle arbitrage executor rejects unsolicited ETH');
	}

	/// @notice Settles one hookless Uniswap V4 pool swap while its authenticated PoolManager is unlocked.
	/// @dev Only the PoolManager and exact one-shot payload selected by the active parent-bound hedge are accepted.
	function unlockCallback(bytes calldata data) external returns (bytes memory result) {
		require(entered && msg.sender == activeV4PoolManager, 'Unauthorized Uniswap V4 unlock callback');
		require(keccak256(data) == activeV4CallbackHash, 'Unauthorized Uniswap V4 callback payload');
		activeV4PoolManager = address(0);
		activeV4CallbackHash = bytes32(0);
		V4SwapCallbackData memory callback = abi.decode(data, (V4SwapCallbackData));
		IUniswapV4PoolManager manager = IUniswapV4PoolManager(msg.sender);
		IUniswapV4PoolManager.PoolKey memory key = IUniswapV4PoolManager.PoolKey({
			currency0: address(0),
			currency1: callback.token,
			fee: callback.poolFee,
			tickSpacing: _v4TickSpacing(callback.poolFee),
			hooks: address(0)
		});
		int256 delta = manager.swap(
			key,
			IUniswapV4PoolManager.SwapParams({
				zeroForOne: callback.buyToken,
				amountSpecified: callback.buyToken ? int256(callback.amount) : -int256(callback.amount),
				sqrtPriceLimitX96: callback.buyToken ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
			}),
			bytes('')
		);
		int128 nativeDelta = int128(delta >> 128);
		int128 tokenDelta = int128(uint128(uint256(delta)));
		if (callback.buyToken) {
			require(tokenDelta == int128(int256(callback.amount)), 'Uniswap V4 buy output was not exact');
			require(nativeDelta < 0, 'Uniswap V4 buy input was invalid');
			uint256 amountIn = uint256(uint128(-nativeDelta));
			require(amountIn <= callback.limit, 'Uniswap V4 buy hedge exceeded maximum WETH');
			manager.sync(address(0));
			require(manager.settle{ value: amountIn }() == amountIn, 'Uniswap V4 native settlement was not exact');
			manager.take(callback.token, address(this), callback.amount);
			return abi.encode(amountIn);
		}
		require(tokenDelta == -int128(int256(callback.amount)), 'Uniswap V4 sell input was not exact');
		require(nativeDelta > 0, 'Uniswap V4 sell output was invalid');
		uint256 amountOut = uint256(uint128(nativeDelta));
		require(amountOut >= callback.limit, 'Uniswap V4 sell hedge received too little WETH');
		manager.sync(callback.token);
		IERC20(callback.token).safeTransfer(address(manager), callback.amount);
		require(manager.settle() == callback.amount, 'Uniswap V4 token settlement was not exact');
		manager.take(address(0), address(this), amountOut);
		return abi.encode(amountOut);
	}

	function _executeV4Hedge(
		address router,
		uint24 poolFee,
		uint256 wethLimitAttoEth,
		address weth,
		address token,
		uint256 amount,
		bool buyToken
	) internal returns (uint256 hedgeAmountAttoWeth) {
		_v4TickSpacing(poolFee);
		require(amount <= uint256(uint128(type(int128).max)), 'Uniswap V4 hedge amount exceeds signed delta bounds');
		uint256 ethBalanceAttoEth = address(this).balance;
		if (buyToken) IWETH(weth).withdraw(wethLimitAttoEth);
		activeV4PoolManager = router;
		bytes memory callbackData = abi.encode(
			V4SwapCallbackData({
				token: token,
				poolFee: poolFee,
				buyToken: buyToken,
				amount: amount,
				limit: wethLimitAttoEth
			})
		);
		activeV4CallbackHash = keccak256(callbackData);
		bytes memory encodedResult = IUniswapV4PoolManager(router).unlock(callbackData);
		require(
			activeV4PoolManager == address(0) && activeV4CallbackHash == bytes32(0),
			'Uniswap V4 callback was not consumed'
		);
		hedgeAmountAttoWeth = abi.decode(encodedResult, (uint256));
		uint256 expectedAttoEth = buyToken ? wethLimitAttoEth - hedgeAmountAttoWeth : hedgeAmountAttoWeth;
		require(
			address(this).balance == ethBalanceAttoEth + expectedAttoEth,
			'Uniswap V4 native balance delta was not exact'
		);
		if (expectedAttoEth != 0) IWETH(weth).deposit{ value: expectedAttoEth }();
	}

	function _v4TickSpacing(uint24 poolFee) private pure returns (int24) {
		if (poolFee == 100) return 1;
		if (poolFee == 500) return 10;
		if (poolFee == 3000) return 60;
		if (poolFee == 10000) return 200;
		revert('Unsupported Uniswap V4 pool fee');
	}
}
