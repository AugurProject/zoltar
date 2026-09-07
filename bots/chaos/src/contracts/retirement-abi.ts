export const retirementErc20TransferAbi = [
	{
		inputs: [
			{ name: 'to', type: 'address' },
			{ name: 'value', type: 'uint256' },
		],
		name: 'transfer',
		outputs: [{ name: '', type: 'bool' }],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const

export const retirementUniswapV3PositionAbi = [
	{
		inputs: [{ name: 'key', type: 'bytes32' }],
		name: 'positions',
		outputs: [
			{ name: 'liquidity', type: 'uint128' },
			{ name: 'feeGrowthInside0LastX128', type: 'uint256' },
			{ name: 'feeGrowthInside1LastX128', type: 'uint256' },
			{ name: 'tokensOwed0', type: 'uint128' },
			{ name: 'tokensOwed1', type: 'uint128' },
		],
		stateMutability: 'view',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'tickLower', type: 'int24' },
			{ name: 'tickUpper', type: 'int24' },
			{ name: 'amount', type: 'uint128' },
		],
		name: 'burn',
		outputs: [
			{ name: 'amount0', type: 'uint256' },
			{ name: 'amount1', type: 'uint256' },
		],
		stateMutability: 'nonpayable',
		type: 'function',
	},
	{
		inputs: [
			{ name: 'recipient', type: 'address' },
			{ name: 'tickLower', type: 'int24' },
			{ name: 'tickUpper', type: 'int24' },
			{ name: 'amount0Requested', type: 'uint128' },
			{ name: 'amount1Requested', type: 'uint128' },
		],
		name: 'collect',
		outputs: [
			{ name: 'amount0', type: 'uint128' },
			{ name: 'amount1', type: 'uint128' },
		],
		stateMutability: 'nonpayable',
		type: 'function',
	},
] as const
