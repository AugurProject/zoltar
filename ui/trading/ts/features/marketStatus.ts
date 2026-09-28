import { liveCopy } from '../copy/live.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'

export function marketStatusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return liveCopy.marketDataUnavailable
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return liveCopy.pairNotCreated
	return livePairInitialized(market) ? liveCopy.tradingOpen : liveCopy.pairUninitialized
}

export function marketStatusTone(market: LiveMarket, nowSeconds: bigint) {
	return market.loadError === undefined && marketAcceptsNewRisk(market, nowSeconds) ? ('ok' as const) : ('warning' as const)
}
