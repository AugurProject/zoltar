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

export const constantProductFactoryAbi = [
	{
		type: 'function',
		name: 'getPair',
		stateMutability: 'view',
		inputs: [
			{ name: 'tokenA', type: 'address' },
			{ name: 'tokenB', type: 'address' },
		],
		outputs: [{ name: 'pair', type: 'address' }],
	},
] as const

export const constantProductPairAbi = [
	{ type: 'function', name: 'token0', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'token1', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{
		type: 'function',
		name: 'getReserves',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'reserve0', type: 'uint112' },
			{ name: 'reserve1', type: 'uint112' },
			{ name: 'blockTimestampLast', type: 'uint32' },
		],
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

const v4PoolKeyComponents = [
	{ name: 'currency0', type: 'address' },
	{ name: 'currency1', type: 'address' },
	{ name: 'fee', type: 'uint24' },
	{ name: 'tickSpacing', type: 'int24' },
	{ name: 'hooks', type: 'address' },
] as const

const v4QuoteParameters = [
	{ name: 'poolKey', type: 'tuple', components: v4PoolKeyComponents },
	{ name: 'zeroForOne', type: 'bool' },
	{ name: 'exactAmount', type: 'uint128' },
	{ name: 'hookData', type: 'bytes' },
] as const

export const v4QuoterAbi = [
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

export const erc20Abi = [
	{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
	{ type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
	{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'string' }] },
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: 'balance', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'allowance',
		stateMutability: 'view',
		inputs: [
			{ name: 'owner', type: 'address' },
			{ name: 'spender', type: 'address' },
		],
		outputs: [{ name: '', type: 'uint256' }],
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

export const openOraclePriceCoordinatorAbi = [
	{ type: 'function', name: 'openOracle', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'pendingReportId', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
	{ type: 'function', name: 'reputationToken', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'weth', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'settlementTime', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint48' }] },
	{ type: 'function', name: 'disputeDelay', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint24' }] },
	{ type: 'function', name: 'protocolFee', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint24' }] },
	{ type: 'function', name: 'feePercentage', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint24' }] },
	{ type: 'function', name: 'multiplier', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint16' }] },
	{ type: 'function', name: 'timeType', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
	{ type: 'function', name: 'trackDisputes', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'bool' }] },
	{ type: 'function', name: 'protocolFeeRecipient', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'getSettlementCallbackGasLimit', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint32' }] },
] as const

export const augurUniverseAbi = [
	{ type: 'function', name: 'getForkingMarket', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'getReputationToken', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'getChildUniverse', stateMutability: 'view', inputs: [{ name: 'payoutDistributionHash', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
] as const

export const augurMarketAbi = [
	{ type: 'function', name: 'getNumTicks', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
	{ type: 'function', name: 'getNumberOfOutcomes', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
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

const timingComponents = [
	{ name: 'blockNumber', type: 'uint256' },
	{ name: 'blockNumberBound', type: 'uint256' },
	{ name: 'blockTimestamp', type: 'uint256' },
	{ name: 'blockTimestampBound', type: 'uint256' },
] as const

export const openOracleAbi = [
	{ type: 'function', name: 'oracleGame', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: [{ name: '', type: 'bytes32' }] },
	{
		type: 'function',
		name: 'disputeHistory',
		stateMutability: 'view',
		inputs: [
			{ name: '', type: 'uint256' },
			{ name: '', type: 'uint256' },
		],
		outputs: [
			{ name: 'amount1', type: 'uint128' },
			{ name: 'amount2', type: 'uint128' },
			{ name: 'baseFee', type: 'uint128' },
			{ name: 'reportTimestamp', type: 'uint48' },
		],
	},
	{ type: 'function', name: 'storedGame', stateMutability: 'view', inputs: [{ name: '', type: 'uint256' }], outputs: gameComponents },
	{
		type: 'function',
		name: 'storedHelper',
		stateMutability: 'view',
		inputs: [{ name: '', type: 'uint256' }],
		outputs: [
			{ name: 'creator', type: 'address' },
			{ name: 'blockTimestamp', type: 'uint48' },
			{ name: 'blockNumber', type: 'uint48' },
		],
	},
	{
		type: 'function',
		name: 'tokenHolder',
		stateMutability: 'view',
		inputs: [
			{ name: '', type: 'address' },
			{ name: '', type: 'address' },
		],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'internalAllowance',
		stateMutability: 'view',
		inputs: [
			{ name: '', type: 'address' },
			{ name: '', type: 'address' },
			{ name: '', type: 'address' },
		],
		outputs: [{ name: '', type: 'uint256' }],
	},
	{
		type: 'function',
		name: 'settle',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'reportId', type: 'uint256' },
			{ name: 'params', type: 'tuple', components: gameComponents },
			{ name: 'helper', type: 'tuple', components: helperComponents },
		],
		outputs: [],
	},
	{
		type: 'function',
		name: 'withdraw',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'tokenToGet', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: 'sent', type: 'uint256' }],
	},
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
			{ name: 'timing', type: 'tuple', components: timingComponents },
		],
		outputs: [],
	},
] as const
export { openOracleArbitrageExecutorAbi } from '#contracts/executor-abi.generated'
