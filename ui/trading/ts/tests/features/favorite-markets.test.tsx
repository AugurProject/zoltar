import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getDownloadedStorageKey, resetLocalEntityStoreForTesting, serializeStoredValue, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { getRememberableMarket, marketDownloadStore, selectFavoriteMarkets, selectMarketCacheUpdates } from '../../lib/favoriteMarkets.js'
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
			const withoutCheckpoint = createMarket(2, { valuation: { feeEndTime: 3n, projectedCollateralAttoEth: 4n, timestamp: 5n } })
			const items = [
				{ data: market, fetchedAt: 1, id: market.pool },
				{ data: withoutCheckpoint, fetchedAt: 1, id: withoutCheckpoint.pool },
				{ data: { ...market, pool: 'not an address' }, fetchedAt: 1, id: 'broken' },
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

	test('lists only favorites in the selected universe, newest favorite first', () => {
		const markets = [createMarket(1), createMarket(2), createMarket(3, { universeId: 2n })]
		const downloaded = markets.map(data => ({ data, id: data.pool.toLowerCase(), fetchedAt: 1 }))
		const favorites = [markets[2], markets[0]].flatMap(market => (market === undefined ? [] : [{ id: market.pool.toLowerCase(), addedAt: 1 }]))
		expect(selectFavoriteMarkets(downloaded, favorites, '1').map(market => market.title)).toEqual(['Market 1'])
		expect(selectFavoriteMarkets(downloaded, favorites, '2').map(market => market.title)).toEqual(['Market 3'])
		expect(selectFavoriteMarkets(downloaded, favorites, undefined)).toEqual([])
	})

	test('refreshes cached favorites without saving unrelated discovered markets', () => {
		const recordedMarket = createMarket(1)
		const id = recordedMarket.pool.toLowerCase()
		const recordedById = new Map([[id, recordedMarket]])
		const favorites = [{ addedAt: 1, id }]
		expect(selectMarketCacheUpdates([recordedMarket, createMarket(2)], recordedById, favorites)).toEqual([])
		const refreshed = createMarket(1, { yesReserve: 60n })
		expect(selectMarketCacheUpdates([refreshed], recordedById, favorites)).toEqual([{ data: refreshed, id }])
		expect(selectMarketCacheUpdates([refreshed], recordedById, [])).toEqual([])
	})

	test('renders saved market rows with their favorite controls', async () => {
		const dom = installDomEnvironment()
		resetLocalEntityStoreForTesting()
		const favorite = createMarket(1)
		setEntityFavorite(getLocalEntityScope('trading', 'market'), favorite.pool, true)
		const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[createMarket(2), favorite]} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={0n} retry={() => undefined} />)
		try {
			const headings = [...rendered.container.querySelectorAll('.market-list-heading')].map(heading => heading.textContent)
			expect(headings).toEqual([])
			const stars = [...rendered.container.querySelectorAll('button.favorite-toggle')].map(star => [star.getAttribute('aria-label'), star.getAttribute('aria-pressed')])
			expect(stars).toEqual([
				['Favorite: Market 2', 'false'],
				['Favorite: Market 1', 'true'],
			])
		} finally {
			await rendered.cleanup()
			resetLocalEntityStoreForTesting()
			dom.cleanup()
		}
	})
})
