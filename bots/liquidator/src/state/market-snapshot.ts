import type { Address } from '@zoltar/bot-shared/ethereum'
import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, centralizedPriceDeviationBps, type CentralizedMarketEstimate, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { marketConsensusAllowsExecution, marketConsensusDeviationBps, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'

export function marketConfigurationList(marketConfigurations: CentralizedMarketSettings | readonly CentralizedMarketSettings[] | undefined): readonly CentralizedMarketSettings[] {
	if (marketConfigurations === undefined) return []
	return 'assetAddress' in marketConfigurations ? [marketConfigurations] : marketConfigurations
}

export function poolCentralizedPriceAllowed(pool: { lastPrice: bigint; repToken: Address }, noConfigurations: boolean, settings: CentralizedMarketSettings | undefined, centralizedMarket: CentralizedMarketEstimate | undefined, marketConsensus: MarketConsensusEstimate | undefined) {
	if (settings === undefined) return noConfigurations
	if (!centralizedMarketConfigurationAllowsExecution(settings)) return false
	if (settings.venueConsensus === undefined) return settings.requiredForExecution ? false : centralizedPriceAllowsExecution(pool.lastPrice, centralizedMarket, settings, pool.repToken)
	return marketConsensusAllowsExecution(
		pool.lastPrice,
		marketConsensus,
		{
			maximumDeviationBps: settings.maximumDexDeviationBps,
			maximumObservationAgeMilliseconds: settings.maximumObservationAgeMilliseconds,
			requiredForExecution: settings.requiredForExecution,
		},
		pool.repToken,
		settings.assetChainId,
	)
}

export function poolCentralizedPriceDeviationBps(pool: { lastPrice: bigint; repToken: Address }, settings: CentralizedMarketSettings | undefined, centralizedMarket: CentralizedMarketEstimate | undefined, marketConsensus: MarketConsensusEstimate | undefined) {
	if (settings?.venueConsensus !== undefined) return marketConsensusDeviationBps(pool.lastPrice, marketConsensus, pool.repToken)
	if (centralizedMarket === undefined || settings === undefined) return undefined
	return centralizedPriceDeviationBps(pool.lastPrice, centralizedMarket, pool.repToken)
}
