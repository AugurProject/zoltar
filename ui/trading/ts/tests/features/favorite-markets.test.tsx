import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getDownloadedStorageKey, resetLocalEntityStoreForTesting, serializeStoredValue, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { getRememberableMarket, marketDownloadStore, partitionFavoriteMarkets, selectBrowseMarkets, selectMarketCacheUpdates } from '../../lib/favoriteMarkets.js'
import type { LiveMarket } from '../../protocol/liveMarket.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

function createMarket(index: number, overrides: Partial<LiveMarket> = {}): LiveMarket {
	return smallReserveMarketFixture({
		description: 'Favorite market fixture',
		endTime: 2n ** 70n,
		pair: getAddress(`0x${(index + 0x100).toString(16).padStart(40, '0')}`),
		pool: getAddress(`0x${index.toString(16).padStart(40, '0')}`),
		questionId: BigInt(index),
		shareToken: getAddress(`0x${(index + 0x200).toString(16).padStart(40, '0')}`),
		title: `Market ${index.toString()}`,
		tradingStatus: 6,
		...overrides,
	})
}

describe('favorite markets', () => {
	test('round-trips a cached market through storage, including optional fields', () => {
		const dom = installDomEnvironment()
		resetLocalEntityStoreForTesting()
		try {
			const scope = { app: 'trading', kind: 'market', network: 'test-0x1' } as const
			const valuation = {
				feeEndTime: 3n,
				projectedCollateralAttoEth: 4n,
				timestamp: 5n,
				feeAccounting: { settlementCollateralAttoEth: 10n, totalUnderwritingLimitAttoEth: 8n, feeEligibleUnderwritingLimitAttoEth: 7n, currentRetentionRate: 10n ** 18n, lastUpdatedFeeAccumulator: 2n, feeIndexRemainder: 1n, totalFeesOwedRemainder: 0n },
			}
			const market = createMarket(1, { originUniverseId: 7n, tradingStatus: undefined, valuation })
			const withoutCheckpoint = createMarket(2, { oracleValidUntilTimestamp: undefined, valuation: { feeEndTime: 3n, projectedCollateralAttoEth: 4n, timestamp: 5n } })
			const items = [
				{ data: market, fetchedAt: 1, id: market.pool },
				{ data: withoutCheckpoint, fetchedAt: 1, id: withoutCheckpoint.pool },
				{ data: { ...market, pool: 'not an address' }, fetchedAt: 1, id: 'broken' },
				{ data: { ...market, oracleValidUntilTimestamp: 'invalid' }, fetchedAt: 1, id: 'broken-time' },
				{ data: { ...market, valuation: { ...valuation, feeAccounting: { ...valuation.feeAccounting, feeIndexRemainder: 'invalid' } } }, fetchedAt: 1, id: 'broken-accounting' },
			]
			window.localStorage.setItem(getDownloadedStorageKey(scope), serializeStoredValue({ items, version: 1 }))
			expect(marketDownloadStore.read(scope).map(entry => entry.data)).toEqual([market, withoutCheckpoint])
		} finally {
			resetLocalEntityStoreForTesting()
			dom.cleanup()
		}
	})

	test('remembers only loaded markets with a pair', () => {
		expect(getRememberableMarket(createMarket(1))?.title).toBe('Market 1')
		expect(getRememberableMarket(createMarket(1, { pair: undefined }))).toBeUndefined()
		expect(getRememberableMarket(createMarket(1, { loadError: 'failed' }))).toBeUndefined()
		expect(getRememberableMarket(undefined)).toBeUndefined()
	})

	test('browses every downloaded market in the selected universe with the live page replacing cached copies', () => {
		const cachedOne = createMarket(1)
		const downloaded = [createMarket(3), createMarket(2, { universeId: 2n }), cachedOne].map((market, index) => ({ data: market, fetchedAt: 10 - index, id: market.pool.toLowerCase() }))
		const refreshedOne = createMarket(1, { yesReserve: 70n })
		const unavailable = createMarket(4, { loadError: 'unavailable', pair: undefined })
		const fresh = createMarket(5)
		const titles = (markets: readonly LiveMarket[]) => markets.map(market => market.title)
		// Uncached page markets lead, newest registration first; cached ones keep their download order.
		const browse = selectBrowseMarkets(downloaded, [refreshedOne, unavailable, fresh], '1')
		expect(titles(browse)).toEqual(['Market 5', 'Market 4', 'Market 3', 'Market 1'])
		expect(browse[3]).toBe(refreshedOne)
		expect(titles(selectBrowseMarkets(downloaded, [], '2'))).toEqual(['Market 2'])
		expect(titles(selectBrowseMarkets(downloaded, [cachedOne, fresh], undefined))).toEqual(['Market 5', 'Market 1'])
	})

	test('puts favorites first without reordering either group', () => {
		const markets = [createMarket(1), createMarket(2), createMarket(3), createMarket(4, { loadError: 'unavailable' })]
		const favorites = [createMarket(3), createMarket(1), createMarket(4)].map((market, index) => ({ addedAt: index, id: market.pool.toLowerCase() }))
		const { favorites: favoriteMarkets, others } = partitionFavoriteMarkets(markets, favorites)
		expect(favoriteMarkets.map(market => market.title)).toEqual(['Market 1', 'Market 3'])
		// An unavailable favorite has no star to show, so it stays with the other markets.
		expect(others.map(market => market.title)).toEqual(['Market 2', 'Market 4'])
	})

	test('caches every discovered market on the market list and only favorites elsewhere, skipping objects already recorded', () => {
		const recordedMarket = createMarket(1)
		const id = recordedMarket.pool.toLowerCase()
		const recordedById = new Map([[id, recordedMarket]])
		const favorites = [{ addedAt: 1, id }]
		expect(selectMarketCacheUpdates([recordedMarket, createMarket(2)], recordedById, favorites, false)).toEqual([])
		const refreshed = createMarket(1, { yesReserve: 60n })
		expect(selectMarketCacheUpdates([refreshed], recordedById, favorites, false)).toEqual([{ data: refreshed, id }])
		expect(selectMarketCacheUpdates([refreshed], recordedById, [], false)).toEqual([])
		// The market list caches the page newest registration first, skipping markets that cannot be browsed.
		const second = createMarket(2)
		const third = createMarket(3)
		expect(selectMarketCacheUpdates([recordedMarket, second, createMarket(9, { pair: undefined }), third], recordedById, [], true)).toEqual([
			{ data: third, id: third.pool.toLowerCase() },
			{ data: second, id: second.pool.toLowerCase() },
		])
	})

	test('lists favorite markets first, once, with lit stars', async () => {
		const dom = installDomEnvironment()
		resetLocalEntityStoreForTesting()
		const favorite = createMarket(1)
		setEntityFavorite(getLocalEntityScope('trading', 'market'), favorite.pool, true)
		const rendered = await renderIntoDocument(
			<LiveMarketBrowser
				freshness={{ refreshing: false, updatedAt: 1 }}
				lookupRoute='market'
				markets={[createMarket(2), favorite]}
				favorites={[{ addedAt: 1, id: favorite.pool.toLowerCase() }]}
				pageMarketCount={2}
				discoveryState='ready'
				discoveryError={undefined}
				marketPage={{ start: 0n, total: 2n, previousStart: undefined, nextStart: undefined }}
				workflowLocked={false}
				nowSeconds={0n}
				retry={() => undefined}
				loadMarketPage={() => undefined}
			/>,
		)
		try {
			const headings = [...rendered.container.querySelectorAll('.market-list-heading')].map(heading => heading.textContent)
			expect(headings).toEqual(['Favorites', 'Other markets'])
			const stars = [...rendered.container.querySelectorAll('button.favorite-toggle')].map(star => [star.getAttribute('aria-label'), star.getAttribute('aria-pressed')])
			expect(stars).toEqual([
				['Favorite: Market 1', 'true'],
				['Favorite: Market 2', 'false'],
			])
		} finally {
			await rendered.cleanup()
			resetLocalEntityStoreForTesting()
			dom.cleanup()
		}
	})
})
