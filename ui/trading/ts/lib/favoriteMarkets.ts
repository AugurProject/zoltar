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
			return { feeEndTime: stored.bigint('feeEndTime'), projectedCollateralAttoEth: stored.bigint('projectedCollateralAttoEth'), timestamp: stored.bigint('timestamp') }
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

/**
 * The market list: every downloaded market in the selected universe, most recently downloaded first, with the live
 * page's copies replacing the cached ones. Page markets that are not cached (just discovered, or unavailable and so
 * never cached) lead, newest registration first, which is where recording the page moves them.
 */
export function selectBrowseMarkets(downloaded: readonly DownloadedEntry<LiveMarket>[], pageMarkets: readonly LiveMarket[], selectedUniverseId: string | undefined) {
	const newestPageFirst = pageMarkets.toReversed()
	if (selectedUniverseId === undefined) return newestPageFirst
	const pageById = new Map(pageMarkets.map(market => [normalizeEntityId(market.pool), market]))
	const cached = downloaded.filter(entry => entry.data.universeId.toString() === selectedUniverseId)
	const cachedIds = new Set(cached.map(entry => entry.id))
	return [...newestPageFirst.filter(market => !cachedIds.has(normalizeEntityId(market.pool))), ...cached.map(entry => pageById.get(entry.id) ?? entry.data)]
}

/** Favorites lead the arranged list; each group keeps the arranged order. */
export function partitionFavoriteMarkets(markets: readonly LiveMarket[], favorites: readonly FavoriteEntry[]) {
	const favoriteIds = new Set(favorites.map(entry => entry.id))
	const isFavorite = (market: LiveMarket) => market.loadError === undefined && favoriteIds.has(normalizeEntityId(market.pool))
	return { favorites: markets.filter(isFavorite), others: markets.filter(market => !isFavorite(market)) }
}

/**
 * Market objects to write to the download cache, newest registration first. The market list caches every discovered
 * market (`cacheAll`); other routes only refresh the cached copy of favorites. `recordedById` holds the market objects
 * this tab already wrote, so re-renders and cache resets caused by another tab's storage write never trigger another write.
 */
export function selectMarketCacheUpdates(markets: readonly LiveMarket[], recordedById: ReadonlyMap<string, LiveMarket>, favorites: readonly FavoriteEntry[], cacheAll: boolean) {
	const favoriteIds = new Set(favorites.map(entry => entry.id))
	return markets.toReversed().flatMap(candidate => {
		const market = getRememberableMarket(candidate)
		if (market === undefined) return []
		const id = normalizeEntityId(market.pool)
		if ((!cacheAll && !favoriteIds.has(id)) || recordedById.get(id) === market) return []
		return [{ data: market, id }]
	})
}
