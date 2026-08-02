import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { discardDexMarketObservations, marketConsensusAllowsExecution, requireCanonicalDexEvidence } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OperatorSettings } from '#config/settings'
import { initialRuntimeState, type PoolObservation } from '#state/operator-state'
import { sortCandidates } from '#core/strategy'

export function selectedCandidate(pools: readonly PoolObservation[], settings: OperatorSettings) {
	const candidates = pools.flatMap(pool => pool.candidates)
	const candidate = sortCandidates(candidates, settings.strategy.candidatePriority)[0]
	if (candidate === undefined) return undefined
	const pool = pools.find(pool => pool.address.toLowerCase() === candidate.pool.address.toLowerCase())
	if (pool === undefined) throw new Error('Selected candidate pool disappeared from the scan')
	return { candidate, pool }
}

export function marketConfigurations(settings: OperatorSettings) {
	return [settings.centralizedMarkets, ...settings.childMarketConfigurations]
}

function marketConfigurationForPool(pool: PoolObservation, settings: OperatorSettings) {
	return marketConfigurations(settings).find(configuration => configuration.assetAddress.toLowerCase() === pool.repToken.toLowerCase())
}

export function marketPriceAllowsExecution(pool: PoolObservation, settings: OperatorSettings, state: ReturnType<typeof initialRuntimeState>) {
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

export async function canonicalMarketPriceAllowsExecution(pool: PoolObservation, settings: OperatorSettings, state: ReturnType<typeof initialRuntimeState>, readCanonicalHash: (blockNumber: bigint) => Promise<`0x${string}` | undefined>) {
	if (!marketPriceAllowsExecution(pool, settings, state)) return false
	const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase())
	try {
		await requireCanonicalDexEvidence(marketConsensus, readCanonicalHash)
		return true
	} catch (error) {
		void error
		state.marketObservations = discardDexMarketObservations(state.marketObservations)
		state.marketConsensus = undefined
		state.marketConsensusByAsset.clear()
		return false
	}
}
