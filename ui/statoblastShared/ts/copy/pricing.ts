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
