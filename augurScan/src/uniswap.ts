import { type Address, encodeAbiParameters, getAddress, type Hex, isAddress, keccak256, zeroAddress } from './ethereum.ts'

type ContractIdentity = { readonly address: Address; readonly kind: string }

export const uniswapV2V3TokenPairs = (contracts: Iterable<ContractIdentity>): readonly { readonly token0: Address; readonly token1: Address }[] => {
	const values = [...contracts]
	const reputationTokens = values.filter(({ kind }) => kind === 'reputationToken').map(({ address }) => address)
	const quoteTokens = values.filter(({ kind }) => kind === 'weth' || kind === 'usdc').map(({ address }) => address)
	return reputationTokens.flatMap((rep) =>
		quoteTokens.flatMap((quote) => [
			{ token0: rep, token1: quote },
			{ token0: quote, token1: rep },
		]),
	)
}

export const uniswapV4PoolConfigurations = [
	{ fee: 100, tickSpacing: 1 },
	{ fee: 500, tickSpacing: 10 },
	{ fee: 3_000, tickSpacing: 60 },
	{ fee: 10_000, tickSpacing: 200 },
] as const

export const uniswapV4PoolId = (reputationToken: Address, fee: number, tickSpacing: number, quoteToken: Address = zeroAddress): Hex => {
	const [currency0, currency1] = BigInt(reputationToken) < BigInt(quoteToken) ? [reputationToken, quoteToken] : [quoteToken, reputationToken]
	return keccak256(
		encodeAbiParameters(
			[{ type: 'address' }, { type: 'address' }, { type: 'uint24' }, { type: 'int24' }, { type: 'address' }],
			[currency0, currency1, fee, tickSpacing, zeroAddress],
		),
	)
}

type UniswapV4MarketIdentity = {
	readonly marketId: string
	readonly token0Address: string
	readonly token1Address: string
	readonly feeHundredthsBip: string
	readonly tickSpacing?: string
	readonly hooksAddress?: string
}

export const isSupportedUniswapV4Market = (market: UniswapV4MarketIdentity): boolean => {
	if (!isAddress(market.token0Address) || !isAddress(market.token1Address) || market.hooksAddress?.toLowerCase() !== zeroAddress) return false
	const configuration = uniswapV4PoolConfigurations.find(
		({ fee, tickSpacing }) => market.feeHundredthsBip === fee.toString() && market.tickSpacing === tickSpacing.toString(),
	)
	if (configuration === undefined) return false
	return (
		market.marketId.toLowerCase() ===
		uniswapV4PoolId(getAddress(market.token0Address), configuration.fee, configuration.tickSpacing, getAddress(market.token1Address))
	)
}
