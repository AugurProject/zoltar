import type { ArbitrageDirection } from '#core/strategy'

const FEE_DENOMINATOR = 1_000n
const UNISWAP_V2_FEE_FACTOR = 997n

export type Venue = 'uniswap-v2' | 'uniswap-v3' | 'uniswap-v4'

export type VenueQuote = {
	gasCostWethAttoEth: bigint
	quotedWethAttoEth: bigint
	venue: Venue
}

export function constantProductExactInput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint) {
	if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) throw new Error('Constant-product exact-input quote requires positive amounts and reserves')
	const amountInWithFee = amountIn * UNISWAP_V2_FEE_FACTOR
	return (amountInWithFee * reserveOut) / (reserveIn * FEE_DENOMINATOR + amountInWithFee)
}

export function constantProductExactOutput(amountOut: bigint, reserveIn: bigint, reserveOut: bigint) {
	if (amountOut <= 0n || reserveIn <= 0n || reserveOut <= amountOut) throw new Error('Constant-product exact-output quote exceeds available reserves')
	return (reserveIn * amountOut * FEE_DENOMINATOR) / ((reserveOut - amountOut) * UNISWAP_V2_FEE_FACTOR) + 1n
}

export function selectBestVenueQuote(direction: ArbitrageDirection, quotes: readonly VenueQuote[]) {
	return quotes.reduce<VenueQuote | undefined>((best, quote) => {
		if (best === undefined) return quote
		const quoteCost = direction === 'sell-rep' ? quote.gasCostWethAttoEth - quote.quotedWethAttoEth : quote.gasCostWethAttoEth + quote.quotedWethAttoEth
		const bestCost = direction === 'sell-rep' ? best.gasCostWethAttoEth - best.quotedWethAttoEth : best.gasCostWethAttoEth + best.quotedWethAttoEth
		return quoteCost < bestCost ? quote : best
	}, undefined)
}
