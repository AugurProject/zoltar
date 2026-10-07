import { liveCopy } from '../copy/live.js'
import { marketAcceptsNewRisk, marketNewRiskBlocker, type LiveMarket } from '../protocol/live.js'
import { livePairInitialized } from './liveTradingControllerHelpers.js'

export function marketStatusLabel(market: LiveMarket, nowSeconds: bigint) {
	if (market.loadError !== undefined) return liveCopy.marketDataUnavailable
	const blocker = marketNewRiskBlocker(market, nowSeconds)
	if (blocker !== undefined) return blocker
	if (market.pair === undefined) return liveCopy.marketNotCreated
	return livePairInitialized(market) ? liveCopy.tradingOpen : liveCopy.noLiquidityYet
}

/** Only an open market that can trade reads as healthy; a pool without a market or without liquidity is neutral, and a closed or broken one warns. */
export function marketStatusTone(market: LiveMarket, nowSeconds: bigint): 'ok' | 'muted' | 'warning' {
	if (market.loadError !== undefined || !marketAcceptsNewRisk(market, nowSeconds)) return 'warning'
	return market.pair !== undefined && livePairInitialized(market) ? 'ok' : 'muted'
}
