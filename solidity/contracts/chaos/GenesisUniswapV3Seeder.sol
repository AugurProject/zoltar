// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IGenesisSeederErc20 {
	function balanceOf(address account) external view returns (uint256);

	function transfer(address recipient, uint256 amount) external returns (bool);

	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

interface IGenesisSeederUniswapV3Pool {
	function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 liquidity, bytes calldata data) external returns (uint256 amount0, uint256 amount1);
}

interface IGenesisUniswapV3Factory {
	function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);

	function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);
}

interface IGenesisUniswapV3PoolState {
	function factory() external view returns (address);

	function token0() external view returns (address);

	function token1() external view returns (address);

	function fee() external view returns (uint24);

	function liquidity() external view returns (uint128);

	function slot0()
		external
		view
		returns (
			uint160 sqrtPriceX96,
			int24 tick,
			uint16 observationIndex,
			uint16 observationCardinality,
			uint16 observationCardinalityNext,
			uint8 feeProtocol,
			bool unlocked
		);

	function initialize(uint160 sqrtPriceX96) external;
}

contract GenesisUniswapV3Seeder {
	struct CallbackData {
		address pool;
		address token0;
		address token1;
		uint256 maximumAmount0;
		uint256 maximumAmount1;
	}

	function seed(address pool, address token0, address token1, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 maximumAmount0, uint256 maximumAmount1, address recipient) external returns (uint256 amount0, uint256 amount1) {
		require(pool != address(0) && token0 != address(0) && token1 != address(0) && recipient != address(0), 'Zero address');
		require(token0 != token1, 'Same token');
		require(liquidity > 0 && maximumAmount0 > 0 && maximumAmount1 > 0, 'Zero seed');
		_safeTransferFrom(token0, msg.sender, address(this), maximumAmount0);
		_safeTransferFrom(token1, msg.sender, address(this), maximumAmount1);
		(amount0, amount1) = IGenesisSeederUniswapV3Pool(pool).mint(recipient, tickLower, tickUpper, liquidity, abi.encode(CallbackData(pool, token0, token1, maximumAmount0, maximumAmount1)));
		require(amount0 <= maximumAmount0 && amount1 <= maximumAmount1, 'Seed maximum');
		_refund(token0, msg.sender);
		_refund(token1, msg.sender);
	}

	function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data) external {
		CallbackData memory callback = abi.decode(data, (CallbackData));
		require(msg.sender == callback.pool, 'Unexpected pool');
		require(amount0Owed <= callback.maximumAmount0 && amount1Owed <= callback.maximumAmount1, 'Seed maximum');
		if (amount0Owed > 0) _safeTransfer(callback.token0, msg.sender, amount0Owed);
		if (amount1Owed > 0) _safeTransfer(callback.token1, msg.sender, amount1Owed);
	}

	function _refund(address token, address recipient) private {
		uint256 balance = IGenesisSeederErc20(token).balanceOf(address(this));
		if (balance > 0) _safeTransfer(token, recipient, balance);
	}

	function _safeTransfer(address token, address recipient, uint256 amount) private {
		(bool success, bytes memory result) = token.call(abi.encodeCall(IGenesisSeederErc20.transfer, (recipient, amount)));
		require(success && (result.length == 0 || abi.decode(result, (bool))), 'Transfer failed');
	}

	function _safeTransferFrom(address token, address sender, address recipient, uint256 amount) private {
		(bool success, bytes memory result) = token.call(abi.encodeCall(IGenesisSeederErc20.transferFrom, (sender, recipient, amount)));
		require(success && (result.length == 0 || abi.decode(result, (bool))), 'TransferFrom failed');
	}
}
