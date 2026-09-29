/** Uniswap V3 factory pool lookup. */
export const uniswapV3FactoryAbi = [
	{
		type: 'function',
		name: 'getPool',
		stateMutability: 'view',
		inputs: [
			{ name: 'tokenA', type: 'address' },
			{ name: 'tokenB', type: 'address' },
			{ name: 'fee', type: 'uint24' },
		],
		outputs: [{ name: 'pool', type: 'address' }],
	},
] as const

/** Uniswap V3 QuoterV2 single-pool quotes. */
export const uniswapV3QuoterAbi = [
	{
		type: 'function',
		name: 'quoteExactInputSingle',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'amountIn', type: 'uint256' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
		],
		outputs: [
			{ name: 'amountOut', type: 'uint256' },
			{ name: 'sqrtPriceX96After', type: 'uint160' },
			{ name: 'initializedTicksCrossed', type: 'uint32' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
	{
		type: 'function',
		name: 'quoteExactOutputSingle',
		stateMutability: 'nonpayable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'amount', type: 'uint256' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
		],
		outputs: [
			{ name: 'amountIn', type: 'uint256' },
			{ name: 'sqrtPriceX96After', type: 'uint160' },
			{ name: 'initializedTicksCrossed', type: 'uint32' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
] as const

const v4QuoteParameters = [
	{
		name: 'poolKey',
		type: 'tuple',
		components: [
			{ name: 'currency0', type: 'address' },
			{ name: 'currency1', type: 'address' },
			{ name: 'fee', type: 'uint24' },
			{ name: 'tickSpacing', type: 'int24' },
			{ name: 'hooks', type: 'address' },
		],
	},
	{ name: 'zeroForOne', type: 'bool' },
	{ name: 'exactAmount', type: 'uint128' },
	{ name: 'hookData', type: 'bytes' },
] as const

/** Uniswap V4 Quoter single-pool quotes. */
export const uniswapV4QuoterAbi = [
	{
		type: 'function',
		name: 'quoteExactInputSingle',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'params', type: 'tuple', components: v4QuoteParameters }],
		outputs: [
			{ name: 'amountOut', type: 'uint256' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
	{
		type: 'function',
		name: 'quoteExactOutputSingle',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'params', type: 'tuple', components: v4QuoteParameters }],
		outputs: [
			{ name: 'amountIn', type: 'uint256' },
			{ name: 'gasEstimate', type: 'uint256' },
		],
	},
] as const
