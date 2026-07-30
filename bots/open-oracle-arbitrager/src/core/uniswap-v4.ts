import { zeroAddress, type Address } from '#ethereum'

export const STANDARD_UNISWAP_FEES = [100, 500, 3_000, 10_000] as const

export const STANDARD_UNISWAP_V4_POOLS = [
	{ fee: 100, tickSpacing: 1 },
	{ fee: 500, tickSpacing: 10 },
	{ fee: 3_000, tickSpacing: 60 },
	{ fee: 10_000, tickSpacing: 200 },
] as const

export type StandardUniswapFee = (typeof STANDARD_UNISWAP_FEES)[number]

export function v4TickSpacing(fee: StandardUniswapFee) {
	if (fee === 100) return 1
	if (fee === 500) return 10
	if (fee === 3_000) return 60
	return 200
}

export function v4QuoteParameters(token: Address, fee: StandardUniswapFee, exactAmount: bigint, zeroForOne: boolean) {
	if (exactAmount <= 0n || exactAmount > 2n ** 127n - 1n) throw new Error('Uniswap V4 exact amount must fit the signed pool-delta range')
	return {
		exactAmount,
		hookData: '0x' as const,
		poolKey: {
			currency0: zeroAddress,
			currency1: token,
			fee,
			hooks: zeroAddress,
			tickSpacing: v4TickSpacing(fee),
		},
		zeroForOne,
	}
}

export function v4QuotePlan(token: Address, fee: StandardUniswapFee, sellExactAmount: bigint, buyExactAmount: bigint) {
	return {
		buy: v4QuoteParameters(token, fee, buyExactAmount, true),
		fee,
		sell: v4QuoteParameters(token, fee, sellExactAmount, false),
	}
}

export function standardV4QuotePlans(token: Address, sellExactAmount: bigint, buyExactAmount: bigint) {
	return STANDARD_UNISWAP_FEES.map(fee => v4QuotePlan(token, fee, sellExactAmount, buyExactAmount))
}
