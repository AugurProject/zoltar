export const openOracleBadgeLabel = 'Open Oracle'
export const openOraclePriceSourceDetail = 'Uses the latest price reported by the selected pool Open Oracle.'
export const priceFromOpenOracle = 'Price from the selected pool Open Oracle'
export const targetCollateralizationAtOpenOraclePrice = 'Target Collateralization @ Open Oracle Price'
export const openOracleRepEth = 'Open Oracle REP / ETH'
export const viaUniswap = 'via Uniswap'
export const viaOpenOracle = 'via Open Oracle'
export const liveQuote = 'live'
export const openOracleExpiredFallback = 'Open Oracle expired'
export const openOracleMissingFallback = 'no Open Oracle price'
export const stalePrice = 'Stale'
export const stalePriceIcon = '⚠'
export const repPriceStatusSeparator = ' · '
export const openOraclePriceNotValid = 'Open Oracle price not valid'
export const noRepPrice = 'No REP price'
export const noOpenOraclePrice = 'No Open Oracle price'
export const uniswapPriceUnavailable = 'Uniswap price unavailable'

export function formatPriceObservedAgo(duration: string) {
	return `${duration} ago`
}

export function formatOpenOraclePriceExpiredAgo(duration: string) {
	return `Open Oracle price expired ${duration} ago`
}

export function formatPendingPriceAvailability(remainingSeconds: bigint, hasSettledPrice = false) {
	if (remainingSeconds <= 0n) return 'Awaiting settlement'
	const prefix = hasSettledPrice ? 'New price available in' : 'Available in'
	if (remainingSeconds < 60n) return `${prefix} ${remainingSeconds}s`
	if (remainingSeconds < 3600n) return `${prefix} ${remainingSeconds / 60n}m ${remainingSeconds % 60n}s`
	return `${prefix} ${remainingSeconds / 3600n}h ${(remainingSeconds % 3600n) / 60n}m ${remainingSeconds % 60n}s`
}
