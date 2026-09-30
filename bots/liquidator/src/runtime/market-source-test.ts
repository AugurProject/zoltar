import { marketConfigurations } from '#core/candidate-selection'
import { recordActivity, saveDurableState } from '#state/operator-state'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { logEvent } from '@zoltar/bot-shared/infrastructure/log-event'
import { observeCentralizedMarkets } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { centralizedExchangeFactory } from './centralized-exchanges.ts'
import { observeConfiguredDex } from './dex-pairs.ts'
import type { LiquidatorDeps, LiquidatorRuntime } from './liquidator-runtime.ts'

/** Observes every configured CEX and DEX source once at the current head and reports which ones responded. */
export function testMarketSources(runtime: LiquidatorRuntime, deps: LiquidatorDeps) {
	return deps.configurationMutationGate.run(async () => {
		let block: Awaited<ReturnType<typeof runtime.client.getBlock>>
		try {
			block = await runtime.client.getBlock()
		} catch (error) {
			logEvent('liquidator', 'marketSourceTestBlockUnavailable', { error: errorMessage(error) }, 'warning')
			throw new Error('Market source test could not read the configured network')
		}
		if (block.hash === undefined || block.number === undefined) throw new Error('Market source test block is missing canonical identity')
		const results = []
		for (const configuration of marketConfigurations(runtime.settings)) {
			const asset = getAddress(configuration.assetAddress)
			const centralized = await observeCentralizedMarkets(configuration, asset, runtime.settings.network.chainId, centralizedExchangeFactory)
			const dex = await observeConfiguredDex(runtime, configuration, { hash: block.hash, number: block.number, timestamp: block.timestamp })
			results.push({
				assetId: asset,
				sources: [
					...configuration.sources.map(source => {
						const observed = centralized?.observations.some(observation => observation.exchangeId === source.exchangeId) === true
						return {
							id: source.exchangeId,
							kind: 'cex' as const,
							market: source.repMarket,
							reason: observed ? undefined : (centralized?.reasons.find(reason => reason.startsWith(`${source.exchangeId} `)) ?? 'Observation was stale, shallow, or unavailable'),
							status: observed ? ('observed' as const) : ('failed' as const),
						}
					}),
					...(configuration.venueConsensus?.dexSources.map(source => {
						const observed = dex.observations.some(observation => observation.sourceId === source.sourceId)
						return { id: source.sourceId, kind: 'dex' as const, market: source.pair, reason: observed ? undefined : (dex.reasons.find(reason => reason.startsWith(`${source.sourceId} `)) ?? 'Observation unavailable'), status: observed ? ('observed' as const) : ('failed' as const) }
					}) ?? []),
				],
			})
		}
		recordActivity(deps.state, { details: `${results.reduce((total, result) => total + result.sources.filter(source => source.status === 'observed').length, 0).toString()} source(s) responded`, kind: 'configuration', message: 'Read-only market source test completed', status: 'info' })
		await saveDurableState(runtime.settings.runtime.stateFile, deps.state)
		return { assets: results, blockNumber: block.number.toString(), observedAt: new Date().toISOString() }
	})
}
