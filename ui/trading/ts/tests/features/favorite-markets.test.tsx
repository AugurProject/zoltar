import { describe, expect, test } from 'bun:test'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { getDownloadedStorageKey, resetLocalEntityStoreForTesting, serializeStoredValue, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { getRememberableMarket, marketDownloadStore, selectFavoriteMarketUpdates, selectFavoriteMarkets } from '../../lib/favoriteMarkets.js'
import type { LiveMarket } from '../../protocol/liveMarket.js'

function createMarket(index: number, overrides: Partial<LiveMarket> = {}): LiveMarket {
	return {
		availableMintingCapacityAttoEth: 100n,
		awaitingForkContinuation: false,
		currentRetentionRate: 10n ** 18n,
		description: 'Favorite market fixture',
		endTime: 2n ** 70n,
		feeBps: 30n,
		feeEligibleCapacityOwnershipAttoRep: 1n,
		initialReportPriorityFeeAttoEthPerGas: 1n,
		lpTotalSupply: 50n,
		mintingCapacityCeilingAttoEth: 100n,
		noReserve: 50n,
		pair: getAddress(`0x${(index + 0x100).toString(16).padStart(40, '0')}`),
		pool: getAddress(`0x${index.toString(16).padStart(40, '0')}`),
		questionId: BigInt(index),
		questionOutcome: 3,
		settlementCollateralAttoEth: 100n,
		shareToken: getAddress(`0x${(index + 0x200).toString(16).padStart(40, '0')}`),
		shareTokenSupplyAttoShares: 100n,
		statoblastSecurityMultiplierBps: 20_000n,
		systemState: 0,
		title: `Market ${index.toString()}`,
		totalCapacityOwnershipAttoRep: 1n,
		tradingStatus: 6,
		universeForkTime: 0n,
		universeId: 1n,
		vaultCount: 1n,
		yesReserve: 50n,
		...overrides,
	}
}

describe('favorite markets', () => {
	test('round-trips a cached market through storage, including optional fields', () => {
		const dom = installDomEnvironment()
		resetLocalEntityStoreForTesting()
		try {
			const scope = { app: 'trading', kind: 'market', network: 'test-0x1' } as const
			const market = createMarket(1, { originUniverseId: 7n, tradingStatus: undefined, valuation: { feeEndTime: 3n, projectedCollateralAttoEth: 4n, timestamp: 5n } })
			const items = [
				{ data: market, fetchedAt: 1, id: market.pool },
				{ data: { ...market, pool: 'not an address' }, fetchedAt: 1, id: 'broken' },
			]
			window.localStorage.setItem(getDownloadedStorageKey(scope), serializeStoredValue({ items, version: 1 }))
			expect(marketDownloadStore.read(scope).map(entry => entry.data)).toEqual([market])
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

	test('selects favorites in the selected universe, newest favorite first', () => {
		const downloaded = [createMarket(1), createMarket(2, { universeId: 2n }), createMarket(3)].map((market, index) => ({ data: market, fetchedAt: index, id: market.pool.toLowerCase() }))
		const favorites = [createMarket(3), createMarket(2), createMarket(1)].map((market, index) => ({ addedAt: 10 - index, id: market.pool.toLowerCase() }))
		expect(selectFavoriteMarkets(downloaded, favorites, '1').map(market => market.title)).toEqual(['Market 3', 'Market 1'])
		expect(selectFavoriteMarkets(downloaded, favorites, undefined)).toEqual([])
	})

	test('refreshes cached favorites only for market objects this tab has not recorded yet', () => {
		const recordedMarket = createMarket(1)
		const id = recordedMarket.pool.toLowerCase()
		const recordedById = new Map([[id, recordedMarket]])
		const favorites = [{ addedAt: 1, id }]
		expect(selectFavoriteMarketUpdates([recordedMarket, createMarket(2)], recordedById, favorites)).toEqual([])
		const refreshed = createMarket(1, { yesReserve: 60n })
		expect(selectFavoriteMarketUpdates([refreshed], recordedById, favorites)).toEqual([{ data: refreshed, id }])
		expect(selectFavoriteMarketUpdates([refreshed], recordedById, [])).toEqual([])
	})

	test('lists favorite markets above the discovered page with lit stars', async () => {
		const dom = installDomEnvironment()
		resetLocalEntityStoreForTesting()
		const favorite = createMarket(1)
		setEntityFavorite(getLocalEntityScope('trading', 'market'), favorite.pool, true)
		const rendered = await renderIntoDocument(
			<LiveMarketBrowser
				lookupRoute='market'
				markets={[favorite, createMarket(2)]}
				favoriteMarkets={[favorite]}
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
			expect(headings).toEqual(['Favorites', 'All markets'])
			const stars = [...rendered.container.querySelectorAll('button.favorite-toggle')].map(star => [star.getAttribute('aria-label'), star.getAttribute('aria-pressed')])
			expect(stars).toEqual([
				['Favorite: Market 1', 'true'],
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
