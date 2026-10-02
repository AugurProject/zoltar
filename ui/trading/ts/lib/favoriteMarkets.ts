import { createDownloadedEntityStore, normalizeEntityId, type DownloadedEntry, type FavoriteEntry } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { decodeStoredValue } from '@zoltar/ui-core-shared/lib/storedValueReader.js'
import type { LiveMarket } from '../protocol/liveMarket.js'

function decodeCachedLiveMarket(value: unknown) {
	return decodeStoredValue(value, (read): LiveMarket => {
		const pair = read.optional('pair', read.address)
		const originUniverseId = read.optional('originUniverseId', read.bigint)
		const tradingStatus = read.optional('tradingStatus', read.number)
		const valuation = read.optional('valuation', key => {
			const stored = read.record(key)
			const feeAccounting = stored.optional('feeAccounting', key => {
				const accounting = stored.record(key)
				return {
					settlementCollateralAttoEth: accounting.bigint('settlementCollateralAttoEth'),
					totalUnderwritingLimitAttoEth: accounting.bigint('totalUnderwritingLimitAttoEth'),
					feeEligibleUnderwritingLimitAttoEth: accounting.bigint('feeEligibleUnderwritingLimitAttoEth'),
					currentRetentionRate: accounting.bigint('currentRetentionRate'),
					lastUpdatedFeeAccumulator: accounting.bigint('lastUpdatedFeeAccumulator'),
					feeIndexRemainder: accounting.bigint('feeIndexRemainder'),
					totalFeesOwedRemainder: accounting.bigint('totalFeesOwedRemainder'),
				}
			})
			return { feeEndTime: stored.bigint('feeEndTime'), projectedCollateralAttoEth: stored.bigint('projectedCollateralAttoEth'), timestamp: stored.bigint('timestamp'), ...(feeAccounting === undefined ? {} : { feeAccounting }) }
		})
		return {
			availableMintingCapacityAttoEth: read.bigint('availableMintingCapacityAttoEth'),
			awaitingForkContinuation: read.boolean('awaitingForkContinuation'),
			currentRetentionRate: read.bigint('currentRetentionRate'),
			description: read.string('description'),
			endTime: read.bigint('endTime'),
			feeBps: read.bigint('feeBps'),
			feeEligibleUnderwritingLimitAttoEth: read.bigint('feeEligibleUnderwritingLimitAttoEth'),
			initialReportPriorityFeeAttoEthPerGas: read.bigint('initialReportPriorityFeeAttoEthPerGas'),
			lpTotalSupply: read.bigint('lpTotalSupply'),
			mintingCapacityCeilingAttoEth: read.bigint('mintingCapacityCeilingAttoEth'),
			noReserve: read.bigint('noReserve'),
			pair,
			pool: read.address('pool'),
			questionId: read.bigint('questionId'),
			questionOutcome: read.number('questionOutcome'),
			settlementCollateralAttoEth: read.bigint('settlementCollateralAttoEth'),
			shareToken: read.address('shareToken'),
			shareTokenSupplyAttoShares: read.bigint('shareTokenSupplyAttoShares'),
			statoblastSecurityMultiplierBps: read.bigint('statoblastSecurityMultiplierBps'),
			systemState: read.number('systemState'),
			title: read.string('title'),
			totalUnderwritingLimitAttoEth: read.bigint('totalUnderwritingLimitAttoEth'),
			tradingStatus,
			universeForkTime: read.bigint('universeForkTime'),
			universeId: read.bigint('universeId'),
			vaultCount: read.bigint('vaultCount'),
			yesReserve: read.bigint('yesReserve'),
			...(originUniverseId === undefined ? {} : { originUniverseId }),
			...(valuation === undefined ? {} : { valuation }),
		}
	})
}

export const marketDownloadStore = createDownloadedEntityStore(decodeCachedLiveMarket)

/** Only a loaded market with a trading pair is worth remembering; unloaded or pair-less pools are not markets yet. */
export function getRememberableMarket(market: LiveMarket | undefined) {
	return market === undefined || market.loadError !== undefined || market.pair === undefined ? undefined : market
}

/** Favorites in the selected universe, most recently saved first. Cached data is only for browsing. */
export function selectFavoriteMarkets(downloaded: readonly DownloadedEntry<LiveMarket>[], favorites: readonly FavoriteEntry[], selectedUniverseId: string | undefined) {
	if (selectedUniverseId === undefined) return []
	const byId = new Map(downloaded.map(entry => [entry.id, entry.data]))
	return favorites.flatMap(favorite => {
		const market = byId.get(favorite.id)
		return market !== undefined && market.universeId.toString() === selectedUniverseId ? [market] : []
	})
}

/**
 * Market objects to write to the download cache, newest registration first. Refresh only existing favorites. `recordedById` holds the market objects
 * this tab already wrote, so re-renders and cache resets caused by another tab's storage write never trigger another write.
 */
export function selectMarketCacheUpdates(markets: readonly LiveMarket[], recordedById: ReadonlyMap<string, LiveMarket>, favorites: readonly FavoriteEntry[]) {
	const favoriteIds = new Set(favorites.map(entry => entry.id))
	return markets.toReversed().flatMap(candidate => {
		const market = getRememberableMarket(candidate)
		if (market === undefined) return []
		const id = normalizeEntityId(market.pool)
		if (!favoriteIds.has(id) || recordedById.get(id) === market) return []
		return [{ data: market, id }]
	})
}
