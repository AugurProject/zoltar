export { erc20Abi, openOracleAbi, openOraclePriceCoordinatorAbi } from '@zoltar/bot-shared/contracts/abi'
export { constantProductPairAbi } from '@zoltar/bot-shared/monitoring/constant-product-markets'

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

export const augurUniverseAbi = [
	{ type: 'function', name: 'getForkingMarket', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'getReputationToken', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'address' }] },
	{ type: 'function', name: 'getChildUniverse', stateMutability: 'view', inputs: [{ name: 'payoutDistributionHash', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
] as const

export const augurMarketAbi = [
	{ type: 'function', name: 'getNumTicks', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
	{ type: 'function', name: 'getNumberOfOutcomes', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const

export { openOracleArbitrageExecutorAbi } from '#contracts/executor-abi.generated'

export const multicall3Abi = [{ type: 'function', name: 'getEthBalance', stateMutability: 'view', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ name: 'balance', type: 'uint256' }] }] as const
