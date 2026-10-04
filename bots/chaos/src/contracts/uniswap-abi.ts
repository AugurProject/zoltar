export const chaosUniswapV3RouterAbi = [
	{ type: 'function', name: 'factory', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'WETH9', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{
		type: 'function',
		name: 'exactInputSingle',
		stateMutability: 'payable',
		inputs: [
			{
				name: 'params',
				type: 'tuple',
				components: [
					{ name: 'tokenIn', type: 'address' },
					{ name: 'tokenOut', type: 'address' },
					{ name: 'fee', type: 'uint24' },
					{ name: 'recipient', type: 'address' },
					{ name: 'deadline', type: 'uint256' },
					{ name: 'amountIn', type: 'uint256' },
					{ name: 'amountOutMinimum', type: 'uint256' },
					{ name: 'sqrtPriceLimitX96', type: 'uint160' },
				],
			},
		],
		outputs: [{ name: 'amountOut', type: 'uint256' }],
	},
] as const

export const chaosUniswapV3FeesAbi = [
	{ type: 'function', name: 'feeGrowthGlobal0X128', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
	{ type: 'function', name: 'feeGrowthGlobal1X128', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
	{
		type: 'function',
		name: 'ticks',
		stateMutability: 'view',
		inputs: [{ name: 'tick', type: 'int24' }],
		outputs: [
			{ name: 'liquidityGross', type: 'uint128' },
			{ name: 'liquidityNet', type: 'int128' },
			{ name: 'feeGrowthOutside0X128', type: 'uint256' },
			{ name: 'feeGrowthOutside1X128', type: 'uint256' },
			{ name: 'tickCumulativeOutside', type: 'int56' },
			{ name: 'secondsPerLiquidityOutsideX128', type: 'uint160' },
			{ name: 'secondsOutside', type: 'uint32' },
			{ name: 'initialized', type: 'bool' },
		],
	},
] as const
