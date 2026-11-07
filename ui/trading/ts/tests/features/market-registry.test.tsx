import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { createDeferred, type Deferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { useMarketRegistry, type MarketRegistry } from '../../features/live/useMarketRegistry.js'
import type { MarketDiscoveryProgress } from '../../protocol/live.js'
import { deploymentConfigurationFixture } from '../support/deploymentConfigurationFixture.js'
import { waitForDom } from '../support/dom.js'
import { fixtureAddress, listingMarketFixture } from '../support/liveMarketFixture.js'
import { offlineControllerServices } from '../support/liveTradingServices.js'

const configuration = deploymentConfigurationFixture()

function listed(index: number) {
	return listingMarketFixture({ pool: fixtureAddress(index.toString(16).padStart(2, '0')), universeId: 1n, title: `Registry market ${index.toString()}` })
}

// Two pages of three markets each, so the second page starts at 25 like the registry's real page size.
const PAGES = new Map([
	[0n, [listed(1), listed(2), listed(3)]],
	[25n, [listed(26), listed(27), listed(28)]],
])

type StagedRead = Readonly<{ start: bigint; progressSent: Deferred<void>; release: Deferred<void> }>

/** A registry read that reports each market as it loads, then holds the completed page until the test releases it. */
function stagedRegistryServices(reads: StagedRead[]) {
	return {
		...offlineControllerServices,
		discoverTradingMarketPage: async (_client: unknown, _configuration: unknown, _universe: bigint | undefined, start = 0n, _pageSize?: bigint, _index?: unknown, _isCurrent?: () => boolean, onProgress?: MarketDiscoveryProgress) => {
			const read = { start, progressSent: createDeferred<void>(), release: createDeferred<void>() }
			reads.push(read)
			const markets = PAGES.get(start) ?? []
			const page = { start, count: BigInt(markets.length), total: 28n, previousStart: start === 0n ? undefined : 0n, nextStart: start === 0n ? 25n : undefined, universeIds: [1n], selectedUniverseId: 1n }
			// The last market is still loading when the read pauses.
			for (let loaded = 1; loaded < markets.length; loaded++) {
				await Promise.resolve()
				onProgress?.({ ...page, markets: markets.map((market, index) => (index < loaded ? market : undefined)) })
			}
			read.progressSent.resolve()
			await read.release.promise
			return { ...page, markets }
		},
	}
}

async function renderRegistry(selectedUniverseId: string | undefined, services: ReturnType<typeof stagedRegistryServices>) {
	let registry: MarketRegistry | undefined
	function Harness() {
		registry = useMarketRegistry({ active: true, configuration, selectedUniverseId, services })
		return null
	}
	const rendered = await renderIntoDocument(<Harness />)
	return {
		...rendered,
		registry: () => {
			if (registry === undefined) throw new Error('Registry has not rendered')
			return registry
		},
	}
}

function titles(registry: MarketRegistry) {
	return registry.markets.map(market => market.title)
}

async function nextRead(reads: readonly StagedRead[], count: number) {
	await waitForDom(() => reads.length === count, `registry read ${count.toString()}`)
	const read = reads[count - 1]
	if (read === undefined) throw new Error(`Registry read ${count.toString()} did not start`)
	await act(async () => {
		await read.progressSent.promise
	})
	return read
}

describe('market registry', () => {
	const lifecycle = installDomTestLifecycle({ url: 'http://localhost/#/market' })

	test('a newly requested page fills in with every market as it loads; re-reading the page on screen keeps it in place', async () => {
		const reads: StagedRead[] = []
		const rendered = lifecycle.trackRendered(await renderRegistry('1', stagedRegistryServices(reads)))
		const first = await nextRead(reads, 1)
		// The empty list fills in as the first page's markets load, not just with the first of them.
		expect(rendered.registry().status).toBe('loading')
		expect(titles(rendered.registry())).toEqual(['Registry market 1', 'Registry market 2'])
		expect(rendered.registry().page?.total).toBe(28n)
		await act(async () => first.release.resolve())
		await waitForDom(() => rendered.registry().status === 'ready', 'first page ready')
		expect(titles(rendered.registry())).toEqual(['Registry market 1', 'Registry market 2', 'Registry market 3'])

		// Another page replaces the one on screen as its markets load.
		await act(() => rendered.registry().loadPage(25n))
		const second = await nextRead(reads, 2)
		expect(titles(rendered.registry())).toEqual(['Registry market 26', 'Registry market 27'])
		expect(rendered.registry().page?.start).toBe(25n)
		await act(async () => second.release.resolve())
		await waitForDom(() => rendered.registry().status === 'ready', 'second page ready')
		expect(titles(rendered.registry())).toEqual(['Registry market 26', 'Registry market 27', 'Registry market 28'])

		// Re-reading the page on screen keeps every market in place until the read completes.
		await act(() => rendered.registry().retry())
		const reread = await nextRead(reads, 3)
		expect(reread.start).toBe(25n)
		expect(titles(rendered.registry())).toEqual(['Registry market 26', 'Registry market 27', 'Registry market 28'])
		await act(async () => reread.release.resolve())
		await waitForDom(() => rendered.registry().status === 'ready', 'reread page ready')
	})

	test('retrying a page change that failed reads the requested page, not the one still on screen', async () => {
		const reads: StagedRead[] = []
		const staged = stagedRegistryServices(reads)
		const starts: bigint[] = []
		let failSecondPage = true
		const services = {
			...staged,
			discoverTradingMarketPage: async (...args: Parameters<typeof staged.discoverTradingMarketPage>) => {
				const start = args[3] ?? 0n
				starts.push(start)
				if (start === 25n && failSecondPage) {
					failSecondPage = false
					throw new Error('Registry RPC unavailable')
				}
				return await staged.discoverTradingMarketPage(...args)
			},
		}
		const rendered = lifecycle.trackRendered(await renderRegistry('1', services))
		const first = await nextRead(reads, 1)
		await act(async () => first.release.resolve())
		await waitForDom(() => rendered.registry().status === 'ready', 'first page ready')

		await act(() => rendered.registry().loadPage(25n))
		await waitForDom(() => rendered.registry().status === 'error', 'second page failed')
		expect(rendered.registry().page?.start).toBe(0n)
		await act(() => rendered.registry().retry())
		expect(starts.at(-1)).toBe(25n)
		const retried = await nextRead(reads, 2)
		await act(async () => retried.release.resolve())
		await waitForDom(() => rendered.registry().status === 'ready', 'retried page ready')
		expect(rendered.registry().page?.start).toBe(25n)
	})

	test('without a universe to list the registry is idle instead of loading forever', async () => {
		const reads: StagedRead[] = []
		const rendered = lifecycle.trackRendered(await renderRegistry(undefined, stagedRegistryServices(reads)))
		await act(async () => {
			await Bun.sleep(20)
		})
		expect(rendered.registry().status).toBe('idle')
		expect(rendered.registry().markets).toEqual([])
		expect(reads).toHaveLength(0)
	})
})
