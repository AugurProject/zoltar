import { marketConfigurations } from '#core/candidate-selection'
import { canonicalBlockHash } from '#monitoring/operator-chain'
import type { RuntimeState } from '#state/operator-state'
import { getAddress, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { centralizedMarketConsensusObservations, marketConsensusSettings, observeCentralizedMarkets } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { discardDexMarketObservations, estimateMarketConsensus, marketObservationsForAsset, requireCanonicalBlock } from '@zoltar/bot-shared/monitoring/market-consensus'
import { centralizedExchangeFactory } from './centralized-exchanges.ts'
import { observeConfiguredDex } from './dex-pairs.ts'
import type { LiquidatorDeps, LiquidatorRuntime } from './liquidator-runtime.ts'

type ScannedBlock = { hash: Hash; number: bigint; timestamp: bigint }

/** Drops DEX evidence and every consensus estimate after a DEX read or canonical-block check fails. */
function discardDexEvidence(state: RuntimeState) {
	state.marketObservations = discardDexMarketObservations(state.marketObservations)
	state.marketConsensus = undefined
	state.marketConsensusByAsset.clear()
}

/**
 * Observes the configured CEX and DEX sources for every scanned universe's REP asset at `scannedBlock`, then rebuilds
 * the per-asset consensus estimates. Returns `true` when shutdown was requested before the evidence was complete.
 */
export async function collectMarketEvidence(runtime: LiquidatorRuntime, deps: LiquidatorDeps, scannedBlock: ScannedBlock, rootRepToken: Address) {
	const { shutdown, state } = deps
	const universeRep = new Set(state.universes.map(universe => universe.repToken.toLowerCase()))
	const activeMarketConfigurations = marketConfigurations(runtime.settings).filter(configuration => universeRep.has(configuration.assetAddress.toLowerCase()))
	state.centralizedMarketsByAsset.clear()
	state.marketConsensusByAsset.clear()
	const newMarketObservations = []
	for (const configuration of activeMarketConfigurations) {
		if (shutdown.isRequested()) return true
		const asset = getAddress(configuration.assetAddress)
		const centralizedMarket = await observeCentralizedMarkets(configuration, asset, runtime.settings.network.chainId, centralizedExchangeFactory)
		if (shutdown.isRequested()) return true
		if (centralizedMarket !== undefined) state.centralizedMarketsByAsset.set(asset.toLowerCase(), centralizedMarket)
		newMarketObservations.push(...centralizedMarketConsensusObservations(centralizedMarket))
		let dexMarkets: Awaited<ReturnType<typeof observeConfiguredDex>>
		try {
			dexMarkets = await observeConfiguredDex(runtime, configuration, { hash: scannedBlock.hash, number: scannedBlock.number, timestamp: scannedBlock.timestamp })
			if (shutdown.isRequested()) return true
		} catch (error) {
			discardDexEvidence(state)
			throw error
		}
		newMarketObservations.push(...dexMarkets.observations)
	}
	try {
		await requireCanonicalBlock(scannedBlock.number, scannedBlock.hash, async blockNumber => await canonicalBlockHash(runtime.settings, blockNumber, runtime.readPool))
		if (shutdown.isRequested()) return true
	} catch (error) {
		discardDexEvidence(state)
		throw error
	}
	const observedAt = Date.now()
	const maximumMarketAge = activeMarketConfigurations.reduce((maximum, configuration) => Math.max(maximum, configuration.maximumObservationAgeMilliseconds), 0)
	state.marketObservations = [...state.marketObservations, ...newMarketObservations].filter(observation => observation.observedAt <= observedAt && observedAt - observation.observedAt <= maximumMarketAge).slice(-2_000)
	for (const configuration of activeMarketConfigurations) {
		if (configuration.venueConsensus === undefined) continue
		const assetObservations = marketObservationsForAsset(state.marketObservations, configuration.assetAddress, runtime.settings.network.chainId)
		const estimate = estimateMarketConsensus(assetObservations, marketConsensusSettings(configuration), configuration.assetAddress, runtime.settings.network.chainId, observedAt)
		state.marketConsensusByAsset.set(configuration.assetAddress.toLowerCase(), estimate)
	}
	state.centralizedMarket = state.centralizedMarketsByAsset.get(rootRepToken.toLowerCase())
	state.marketConsensus = state.marketConsensusByAsset.get(rootRepToken.toLowerCase())
	return false
}
