export const openOracleBadgeLabel = 'OpenOracle'
export const openOraclePriceSourceDetail = 'Uses the latest price reported by the selected pool OpenOracle.'
export const priceFromOpenOracle = 'Price from the selected pool OpenOracle'
export const targetCollateralizationAtOpenOraclePrice = 'Target collateralization @ OpenOracle price'
export const openOracleRepEth = 'OpenOracle REP per ETH'
export const viaUniswap = 'via Uniswap'
export const viaOpenOracle = 'via OpenOracle'
export const liveQuote = 'live'
export const openOracleExpiredFallback = 'OpenOracle expired'
export const openOracleMissingFallback = 'no OpenOracle price'
export const stalePrice = 'Stale'
export const stalePriceIcon = '⚠'
export const repPriceStatusSeparator = ' · '
export const openOraclePriceNotValid = 'OpenOracle price not valid'
export const noRepPrice = 'No REP price'
export const noOpenOraclePrice = 'No OpenOracle price'
export const uniswapPriceUnavailable = 'Uniswap price unavailable'

export function formatPriceObservedAgo(duration: string) {
	return `${duration} ago`
}

export function formatOpenOraclePriceExpiredAgo(duration: string) {
	return `OpenOracle price expired ${duration} ago`
}

export function formatPendingPriceAvailability(remainingSeconds: bigint, hasSettledPrice = false) {
	if (remainingSeconds <= 0n) return 'Awaiting settlement'
	const prefix = hasSettledPrice ? 'New price available in' : 'Available in'
	if (remainingSeconds < 60n) return `${prefix} ${remainingSeconds}s`
	if (remainingSeconds < 3600n) return `${prefix} ${remainingSeconds / 60n}m ${remainingSeconds % 60n}s`
	return `${prefix} ${remainingSeconds / 3600n}h ${(remainingSeconds % 3600n) / 60n}m ${remainingSeconds % 60n}s`
}
