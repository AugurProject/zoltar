export const factoryAbi = [
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

export const poolAbi = [
	{ type: 'function', name: 'liquidity', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint128' }] },
	{
		type: 'function',
		name: 'slot0',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'sqrtPriceX96', type: 'uint160' },
			{ name: 'tick', type: 'int24' },
			{ name: 'observationIndex', type: 'uint16' },
			{ name: 'observationCardinality', type: 'uint16' },
			{ name: 'observationCardinalityNext', type: 'uint16' },
			{ name: 'feeProtocol', type: 'uint8' },
			{ name: 'unlocked', type: 'bool' },
		],
	},
	{
		type: 'function',
		name: 'observe',
		stateMutability: 'view',
		inputs: [{ name: 'secondsAgos', type: 'uint32[]' }],
		outputs: [
			{ name: 'tickCumulatives', type: 'int56[]' },
			{ name: 'secondsPerLiquidityCumulativeX128s', type: 'uint160[]' },
		],
	},
] as const

const quoteParameters = [
	{ name: 'tokenIn', type: 'address' },
	{ name: 'tokenOut', type: 'address' },
	{ name: 'amountIn', type: 'uint256' },
	{ name: 'fee', type: 'uint24' },
	{ name: 'sqrtPriceLimitX96', type: 'uint160' },
] as const

export const quoterAbi = [
	{
		type: 'function',
		name: 'quoteExactInputSingle',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'params', type: 'tuple', components: quoteParameters }],
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

export const erc20Abi = [
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: 'balance', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
] as const

const gameComponents = [
	{ name: 'currentAmount1', type: 'uint128' },
	{ name: 'currentAmount2', type: 'uint128' },
	{ name: 'currentReporter', type: 'address' },
	{ name: 'reportTimestamp', type: 'uint48' },
	{ name: 'settlementTimestamp', type: 'uint48' },
	{ name: 'token1', type: 'address' },
	{ name: 'lastReportOppoTime', type: 'uint48' },
	{ name: 'settlementTime', type: 'uint48' },
	{ name: 'escalationHalt', type: 'uint128' },
	{ name: 'protocolFeeRecipient', type: 'address' },
	{ name: 'settlerReward', type: 'uint96' },
	{ name: 'token2', type: 'address' },
	{ name: 'numReports', type: 'uint24' },
	{ name: 'disputeDelay', type: 'uint24' },
	{ name: 'feePercentage', type: 'uint24' },
	{ name: 'multiplier', type: 'uint16' },
	{ name: 'callbackContract', type: 'address' },
	{ name: 'callbackGasLimit', type: 'uint32' },
	{ name: 'protocolFee', type: 'uint24' },
	{ name: 'flags', type: 'uint8' },
] as const

const helperComponents = [
	{ name: 'reportId', type: 'uint256' },
	{ name: 'creator', type: 'address' },
	{ name: 'blockTimestamp', type: 'uint256' },
	{ name: 'blockNumber', type: 'uint256' },
] as const

export const openOracleAbi = [
	{ type: 'function', name: 'oracleGame', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }] },
	{
		type: 'function',
		name: 'dispute',
		stateMutability: 'payable',
		inputs: [
			{ name: 'reportId', type: 'uint256' },
			{ name: 'newAmount1', type: 'uint128' },
			{ name: 'newAmount2', type: 'uint128' },
			{ name: 'disputer', type: 'address' },
			{ name: 'tryInternalBalance1', type: 'bool' },
			{ name: 'tryInternalBalance2', type: 'bool' },
			{ name: 'params', type: 'tuple', components: gameComponents },
			{ name: 'helper', type: 'tuple', components: helperComponents },
			{
				name: 'timing',
				type: 'tuple',
				components: [
					{ name: 'blockNumber', type: 'uint256' },
					{ name: 'blockNumberBound', type: 'uint256' },
					{ name: 'blockTimestamp', type: 'uint256' },
					{ name: 'blockTimestampBound', type: 'uint256' },
				],
			},
		],
		outputs: [],
	},
] as const
