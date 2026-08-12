import { type Address, encodeAbiParameters, getAddress, type Hex, isAddress, keccak256, zeroAddress } from './ethereum.ts'

export const uniswapV4PoolConfigurations = [
	{ fee: 100, tickSpacing: 1 },
	{ fee: 500, tickSpacing: 10 },
	{ fee: 3_000, tickSpacing: 60 },
	{ fee: 10_000, tickSpacing: 200 },
] as const

export const uniswapV4PoolId = (reputationToken: Address, fee: number, tickSpacing: number): Hex =>
	keccak256(
		encodeAbiParameters(
			[{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
			[zeroAddress, reputationToken, fee, tickSpacing, zeroAddress],
		),
	)

type UniswapV4MarketIdentity = {
	readonly marketId: string
	readonly token0Address: string
	readonly token1Address: string
	readonly feeHundredthsBip: string
	readonly tickSpacing?: string
	readonly hooksAddress?: string
}

export const isSupportedUniswapV4Market = (market: UniswapV4MarketIdentity): boolean => {
	if (market.token0Address.toLowerCase() !== zeroAddress || market.hooksAddress?.toLowerCase() !== zeroAddress) return false
	if (!isAddress(market.token1Address)) return false
	const configuration = uniswapV4PoolConfigurations.find(
		({ fee, tickSpacing }) => market.feeHundredthsBip === fee.toString() && market.tickSpacing === tickSpacing.toString(),
	)
	if (configuration === undefined) return false
	return market.marketId.toLowerCase() === uniswapV4PoolId(getAddress(market.token1Address), configuration.fee, configuration.tickSpacing)
}
