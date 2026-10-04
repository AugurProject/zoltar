import { GENESIS_UNISWAP_TICK_LOWER, GENESIS_UNISWAP_TICK_UPPER } from './genesis-uniswap.ts'

// Fixed presets bound discovery and keep every bot-created position recoverable.
export const UNISWAP_POSITION_RANGES = [
	{ id: 'full', tickLower: GENESIS_UNISWAP_TICK_LOWER, tickUpper: GENESIS_UNISWAP_TICK_UPPER },
	{ id: 'narrow', tickLower: -2000, tickUpper: 2000 },
	{ id: 'wide', tickLower: -10000, tickUpper: 10000 },
	{ id: 'above', tickLower: 2000, tickUpper: 4000 },
	{ id: 'below', tickLower: -4000, tickUpper: -2000 },
] as const

export function uniswapPositionRange(tickLower: unknown, tickUpper: unknown) {
	return UNISWAP_POSITION_RANGES.find(range => range.tickLower === tickLower && range.tickUpper === tickUpper)
}
