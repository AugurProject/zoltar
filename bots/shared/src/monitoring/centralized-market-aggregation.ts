import type { CentralizedMarketEstimate, CentralizedMarketObservation, CentralizedMarketSettings } from './centralized-markets.ts'
import { compareBigint } from '../infrastructure/compare.ts'

const BPS = 10_000n

function median(values: readonly bigint[]) {
	if (values.length === 0) throw new Error('Cannot calculate a median without observations')
	const sorted = [...values].sort(compareBigint)
	const middle = Math.floor(sorted.length / 2)
	const upper = sorted[middle]
	if (upper === undefined) throw new Error('Median observation disappeared')
	if (sorted.length % 2 === 1) return upper
	const lower = sorted[middle - 1]
	if (lower === undefined) throw new Error('Median observation disappeared')
	return (lower + upper) / 2n
}

export function aggregateCentralizedMarketObservations(observations: readonly CentralizedMarketObservation[], settings: CentralizedMarketSettings, assetId: string, now = Date.now()): CentralizedMarketEstimate | undefined {
	if (settings.sources.length === 0 && observations.length === 0) return undefined
	if (settings.assetAddress.toLowerCase() !== assetId.toLowerCase() || observations.some(observation => observation.assetId.toLowerCase() !== assetId.toLowerCase() || observation.chainId !== settings.assetChainId)) {
		throw new Error('Centralized market observations must describe one exact REP asset and chain')
	}
	const fresh = observations.filter(observation => {
		if (settings.requiredForExecution && (observation.orderBookTimestamp === undefined || (observation.usesEthTicker && observation.ethTickerTimestamp === undefined))) return false
		const timestamps = [observation.orderBookTimestamp ?? observation.observedAt, ...(observation.usesEthTicker ? [observation.ethTickerTimestamp ?? observation.observedAt] : [])]
		return timestamps.every(timestamp => timestamp <= now && now - timestamp <= settings.maximumObservationAgeMilliseconds)
	})
	const reasons: string[] = []
	if (fresh.length < settings.minimumSourceCount) reasons.push(`Only ${fresh.length.toString()} fresh CEX source(s); ${settings.minimumSourceCount.toString()} required`)
	if (fresh.length === 0) {
		return {
			assetId,
			askDepthAttoEth: 0n,
			bidDepthAttoEth: 0n,
			chainId: settings.assetChainId,
			maximumPriceRepPerEth: 0n,
			minimumPriceRepPerEth: 0n,
			observations: fresh,
			priceRepPerEth: 0n,
			reliable: false,
			reasons,
		}
	}
	const prices = fresh.map(observation => observation.priceRepPerEth)
	const minimumPriceRepPerEth = prices.reduce((minimum, price) => (price < minimum ? price : minimum))
	const maximumPriceRepPerEth = prices.reduce((maximum, price) => (price > maximum ? price : maximum))
	const priceRepPerEth = median(prices)
	const dispersionBps = priceRepPerEth === 0n ? BPS : ((maximumPriceRepPerEth - minimumPriceRepPerEth) * BPS) / priceRepPerEth
	if (dispersionBps > settings.maximumVenueDispersionBps) reasons.push(`CEX venue dispersion is ${dispersionBps.toString()} bps`)
	const bidDepthAttoEth = fresh.reduce((total, observation) => total + observation.bidDepthAttoEth, 0n)
	const askDepthAttoEth = fresh.reduce((total, observation) => total + observation.askDepthAttoEth, 0n)
	if (bidDepthAttoEth < settings.minimumBidDepthAttoEth) reasons.push('CEX bid depth is below the configured minimum')
	if (askDepthAttoEth < settings.minimumAskDepthAttoEth) reasons.push('CEX ask depth is below the configured minimum')
	return {
		assetId,
		askDepthAttoEth,
		bidDepthAttoEth,
		chainId: settings.assetChainId,
		maximumPriceRepPerEth,
		minimumPriceRepPerEth,
		observations: fresh,
		priceRepPerEth,
		reliable: reasons.length === 0,
		reasons,
	}
}
