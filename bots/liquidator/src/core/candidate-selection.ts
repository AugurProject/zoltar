import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { discardDexMarketObservations, marketConsensusAllowsExecution, requireCanonicalDexEvidence, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OperatorSettings } from '#config/settings'
import { initialRuntimeState, type PoolObservation } from '#state/operator-state'

export function marketConfigurations(settings: OperatorSettings) {
	return [settings.centralizedMarkets, ...settings.childMarketConfigurations]
}

function marketConfigurationForPool(pool: Pick<PoolObservation, 'repToken' | 'lastPrice'>, settings: OperatorSettings) {
	return marketConfigurations(settings).find(configuration => configuration.assetAddress.toLowerCase() === pool.repToken.toLowerCase())
}

export function marketPriceAllowsExecution(pool: Pick<PoolObservation, 'repToken' | 'lastPrice'>, settings: OperatorSettings, state: ReturnType<typeof initialRuntimeState>) {
	const configuration = marketConfigurationForPool(pool, settings)
	if (configuration === undefined || !centralizedMarketConfigurationAllowsExecution(configuration)) return false
	const centralizedMarket = state.centralizedMarketsByAsset.get(pool.repToken.toLowerCase())
	const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase())
	if (configuration.venueConsensus === undefined) return configuration.requiredForExecution ? false : centralizedPriceAllowsExecution(pool.lastPrice, centralizedMarket, configuration, pool.repToken)
	return marketConsensusAllowsExecution(
		pool.lastPrice,
		marketConsensus,
		{
			maximumDeviationBps: configuration.maximumDexDeviationBps,
			maximumObservationAgeMilliseconds: configuration.maximumObservationAgeMilliseconds,
			requiredForExecution: configuration.requiredForExecution,
		},
		pool.repToken,
		settings.network.chainId,
	)
}

export async function canonicalMarketPriceAllowsExecution(
	pool: Pick<PoolObservation, 'repToken' | 'lastPrice'>,
	settings: OperatorSettings,
	state: ReturnType<typeof initialRuntimeState>,
	readCanonicalHash: (blockNumber: bigint) => Promise<`0x${string}` | undefined>,
	requireCurrentDexEvidence: (configuration: CentralizedMarketSettings, estimate: MarketConsensusEstimate | undefined) => Promise<void>,
) {
	if (!marketPriceAllowsExecution(pool, settings, state)) return false
	const configuration = marketConfigurationForPool(pool, settings)
	if (configuration === undefined) return false
	const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase())
	try {
		await requireCanonicalDexEvidence(marketConsensus, readCanonicalHash)
		await requireCurrentDexEvidence(configuration, marketConsensus)
		return true
	} catch (error) {
		void error
		state.marketObservations = discardDexMarketObservations(state.marketObservations)
		state.marketConsensus = undefined
		state.marketConsensusByAsset.clear()
		return false
	}
}
