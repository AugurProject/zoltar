import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { marketStatusTone } from '../../features/marketStatus.js'
import { FIXTURE_DAY, FIXTURE_NOW, fixtureAddress, listingMarketFixture as liveMarketFixture } from '../support/liveMarketFixture.js'
import { readyMarketRegistry } from '../support/liveTradingServices.js'

function renderBrowser(lookupRoute: 'market' | 'liquidity') {
	const markets = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'Will it rain in Paris?', yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Will the bridge open?', endTime: FIXTURE_NOW + 2n * FIXTURE_DAY })]
	return renderIntoDocument(<LiveMarketBrowser lookupRoute={lookupRoute} markets={markets} registry={readyMarketRegistry()} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
}

function cardTitles(container: HTMLElement) {
	return Array.from(container.querySelectorAll('.market-record h3')).map(heading => heading.textContent)
}

async function typeSearch(container: HTMLElement, value: string) {
	const input = container.querySelector<HTMLInputElement>('input[type="search"]')
	if (input === null) throw new Error('Market search did not render')
	await act(() => {
		input.value = value
		input.dispatchEvent(new Event('input', { bubbles: true }))
	})
}

function pressFilter(container: HTMLElement, label: string) {
	const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('.market-list-filters button')).find(button => button.textContent === label)
	if (chip === undefined) throw new Error(`Missing ${label} filter`)
	return act(() => chip.click())
}

test('market cards lead with odds and one-click outcome buttons that keep the environment and preselect the side', async () => {
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&simScenario=trading-funded')
	const rendered = await renderBrowser('market')
	try {
		// Favorites keep their saved order by default.
		expect(cardTitles(rendered.container)).toEqual(['Will it rain in Paris?', 'Will the bridge open?'])
		const rain = rendered.container.querySelectorAll('.market-record')[0]
		const yes = rain?.querySelector('.outcome-button--yes')
		const no = rain?.querySelector('.outcome-button--no')
		expect(yes?.textContent).toBe('Yes 62.0%')
		expect(no?.textContent).toBe('No 38.0%')
		expect(yes?.getAttribute('aria-label')).toBe('Buy Yes: 62.0%, the price if not Invalid')
		expect(yes?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&ticket=buy-yes`)
		expect(no?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&ticket=buy-no`)
		expect(rain?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Price if not Invalid: Yes 62.0%, No 38.0%')
		expect(rain?.textContent).toContain('Liquidity')
		expect(rain?.textContent).toContain('in 30 days')
		expect(rendered.container.querySelectorAll('.market-record')[1]?.textContent).toContain('in 2 days')
		// Addresses belong to the market page, not the card.
		expect(rendered.container.querySelector('.market-list')?.textContent).not.toContain(fixtureAddress('01'))
		expect(rendered.container.textContent).toContain('Favorites (2)')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('search and status filters narrow saved favorites and offer a way back from an empty result', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const rendered = await renderBrowser('market')
	try {
		await typeSearch(rendered.container, 'paris')
		expect(cardTitles(rendered.container)).toEqual(['Will it rain in Paris?'])
		expect(rendered.container.querySelector('[role="status"]')?.textContent).toBe('1 of 2 markets')
		await typeSearch(rendered.container, '')
		await pressFilter(rendered.container, 'Closing soon')
		expect(cardTitles(rendered.container)).toEqual(['Will the bridge open?'])
		expect(rendered.container.querySelector('.market-list-filters button[aria-pressed="true"]')?.textContent).toBe('Closing soon')
		await pressFilter(rendered.container, 'Resolved')
		expect(rendered.container.querySelector('.market-record')).toBeNull()
		expect(rendered.container.textContent).toContain('No matches')
		const clear = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent === 'Clear filters')
		if (clear === undefined) throw new Error('Clear filters action did not render')
		await act(() => clear.click())
		expect(cardTitles(rendered.container)).toHaveLength(2)
		expect(rendered.container.querySelector('.market-list-filters button[aria-pressed="true"]')?.textContent).toBe('All')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('search, status filter, and sort live in the hash query, so Back and refresh restore them', async () => {
	const dom = installDomEnvironment('http://localhost/#/market?simulate=1&q=paris&status=open&sort=liquidity')
	const rendered = await renderBrowser('market')
	try {
		expect(rendered.container.querySelector<HTMLInputElement>('input[type="search"]')?.value).toBe('paris')
		expect(rendered.container.querySelector('.market-list-filters button[aria-pressed="true"]')?.textContent).toBe('Open')
		expect(rendered.container.querySelector('.enum-dropdown-trigger')?.textContent).toBe('Liquidity')
		expect(cardTitles(rendered.container)).toEqual(['Will it rain in Paris?'])
		const historyLength = window.history.length
		await typeSearch(rendered.container, 'bridge')
		await pressFilter(rendered.container, 'Closing soon')
		// The list options replace the current entry: Back still leaves the list.
		expect(window.history.length).toBe(historyLength)
		expect(window.location.hash).toBe('#/market?simulate=1&q=bridge&status=closing-soon&sort=liquidity')
		// Market links leave the list's options behind.
		expect(rendered.container.querySelector('.market-record .outcome-button--yes')?.getAttribute('href')).toBe(`#/market/${fixtureAddress('02')}?simulate=1&ticket=buy-yes`)
		const clear = async () => {
			await typeSearch(rendered.container, '')
			await pressFilter(rendered.container, 'All')
		}
		await clear()
		expect(window.location.hash).toBe('#/market?simulate=1&sort=liquidity')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('list options written before the app has a route hash keep the page query that selects the simulation', async () => {
	const dom = installDomEnvironment('http://localhost/?simulate=1&simScenario=trading-funded')
	const rendered = await renderBrowser('market')
	try {
		await typeSearch(rendered.container, 'bridge')
		expect(window.location.search).toBe('?simulate=1&simScenario=trading-funded')
		expect(window.location.hash).toBe('#/market?q=bridge')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('the liquidity landing keeps liquidity as the primary action instead of outcome buttons', async () => {
	const dom = installDomEnvironment('http://localhost/#/liquidity')
	const rendered = await renderBrowser('liquidity')
	try {
		expect(rendered.container.querySelector('.outcome-button')).toBeNull()
		expect(rendered.container.querySelector('.market-record .button-link.primary')?.getAttribute('href')).toBe(`#/liquidity/${fixtureAddress('01')}`)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('an empty favorite pool list shows address lookup and no scan or pagination controls', async () => {
	const dom = installDomEnvironment('http://localhost/#/create-market')
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='create-market' markets={[]} registry={undefined} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		expect(rendered.container.querySelector('.market-list')).toBeNull()
		expect(rendered.container.querySelector('form.market-list-search')).not.toBeNull()
		expect(rendered.container.querySelector('.discovery-control')).toBeNull()
		const empty = rendered.container.querySelector('.empty-state')
		expect(empty?.textContent).toContain('No favorite security pools yet')
		// The list only covers this browser, so the empty state says so and points to where pool addresses come from.
		expect(empty?.textContent).toContain('only shows security pools opened in this browser')
		const guide = empty?.querySelector('a')
		expect(guide?.textContent).toBe('How to find a security pool')
		expect(guide?.getAttribute('href')).toContain('tutorials/trading-first-market.html#find-pool')
		expect(guide?.getAttribute('target')).toBe('_blank')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('a pool card states a status that rules out creating its market and stops promoting creation', async () => {
	const dom = installDomEnvironment('http://localhost/#/create-market')
	const open = liveMarketFixture({ pool: fixtureAddress('01'), title: 'Open pool', pair: undefined, endTime: FIXTURE_NOW + FIXTURE_DAY })
	const ended = liveMarketFixture({ pool: fixtureAddress('02'), title: 'Ended pool', pair: undefined, endTime: FIXTURE_NOW - FIXTURE_DAY })
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='create-market' markets={[open, ended]} registry={undefined} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		const card = (title: string) => Array.from(rendered.container.querySelectorAll('.market-record')).find(candidate => candidate.textContent?.includes(title) === true)
		// Every listed pool lacks a market, so only the ended pool carries a status, in the warning tone.
		expect(card('Open pool')?.textContent).not.toContain('Market not created')
		expect(card('Ended pool')?.textContent).toContain('Question ended')
		expect(card('Open pool')?.querySelector('.button-link.primary')?.textContent).toBe('Create market')
		expect(card('Ended pool')?.querySelector('.button-link.primary')).toBeNull()
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('only a market that can trade reads as healthy; a pool without a market or liquidity is neutral', () => {
	const market = liveMarketFixture({ pool: fixtureAddress('01'), endTime: FIXTURE_NOW + FIXTURE_DAY, yesReserve: 10n ** 18n, noReserve: 10n ** 18n, lpTotalSupply: 10n ** 18n })
	expect(marketStatusTone(market, FIXTURE_NOW)).toBe('ok')
	expect(marketStatusTone({ ...market, pair: undefined }, FIXTURE_NOW)).toBe('muted')
	expect(marketStatusTone({ ...market, yesReserve: 0n, noReserve: 0n, lpTotalSupply: 0n }, FIXTURE_NOW)).toBe('muted')
	expect(marketStatusTone({ ...market, endTime: FIXTURE_NOW - 1n }, FIXTURE_NOW)).toBe('warning')
})

test('a resolved market card shows its final outcome instead of a price, and an ended one its last price', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const resolved = liveMarketFixture({ pool: fixtureAddress('01'), title: 'Resolved market', questionOutcome: 1, tradingStatus: 5 })
	const ended = liveMarketFixture({ pool: fixtureAddress('02'), title: 'Ended market', endTime: FIXTURE_NOW - FIXTURE_DAY, yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n })
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[]} registry={readyMarketRegistry([resolved, ended])} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		const card = (title: string) => Array.from(rendered.container.querySelectorAll('.market-record')).find(candidate => candidate.textContent?.includes(title) === true)
		// A resolved market pays out by outcome, so no price bar remains to read as a live quote.
		expect(card('Resolved market')?.querySelector('.market-odds')).toBeNull()
		expect(card('Resolved market')?.querySelector('.market-resolution')?.textContent).toBe('Final outcomeYes')
		// An ended but unresolved market keeps its last price, labelled and muted, with no outcome buttons.
		expect(card('Ended market')?.querySelector('.market-odds--last')).not.toBeNull()
		expect(card('Ended market')?.querySelector('.outcome-button')).toBeNull()
		expect(card('Ended market')?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Last price if not Invalid: Yes 62.0%, No 38.0%')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('a new browser sees the registry page of markets without favorites, and pages through the rest', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const pages: bigint[] = []
	const markets = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'First listed market' }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Second listed market' })]
	const registry = readyMarketRegistry(markets, { page: { start: 25n, total: 52n, previousStart: 0n, nextStart: 50n }, loadPage: start => pages.push(start) })
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[]} registry={registry} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		expect(cardTitles(rendered.container)).toEqual(['First listed market', 'Second listed market'])
		// Without favorites the list needs no group headings.
		expect(rendered.container.querySelector('.market-list-heading')).toBeNull()
		expect(rendered.container.textContent).toContain('Markets 26–27 of 52')
		const pageButton = (label: string) => Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent === label)
		await act(() => pageButton('Next page')?.click())
		await act(() => pageButton('Previous page')?.click())
		expect(pages).toEqual([50n, 0n])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('favorites lead the registry page under their own heading and are not repeated below', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const savedCopy = liveMarketFixture({ pool: fixtureAddress('01'), title: 'Saved market', yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n })
	const liveCopyOfSaved = { ...savedCopy, yesReserve: 62n * 10n ** 16n, noReserve: 38n * 10n ** 16n }
	const other = liveMarketFixture({ pool: fixtureAddress('02'), title: 'Other market' })
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[savedCopy]} registry={readyMarketRegistry([liveCopyOfSaved, other])} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		expect(Array.from(rendered.container.querySelectorAll('.market-list-heading')).map(heading => heading.textContent)).toEqual(['Favorites (1)', 'Other markets'])
		expect(cardTitles(rendered.container)).toEqual(['Saved market', 'Other market'])
		// The favorite shows the page's fresher copy rather than the cached one.
		expect(rendered.container.querySelector('.market-record .outcome-button--yes')?.textContent).toBe('Yes 38.0%')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('a favorite whose read on the registry page failed keeps its saved card', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const savedCopy = liveMarketFixture({ pool: fixtureAddress('01'), title: 'Saved market', yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n })
	// A failed read on the page stands in for the market with a placeholder that carries only its load error.
	const failedPageCopy = { ...savedCopy, pair: undefined, title: `Security pool ${fixtureAddress('01')}`, loadError: 'Market data could not be read.' }
	const other = liveMarketFixture({ pool: fixtureAddress('02'), title: 'Other market' })
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[savedCopy]} registry={readyMarketRegistry([failedPageCopy, other])} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		expect(cardTitles(rendered.container)).toEqual(['Saved market', 'Other market'])
		expect(rendered.container.querySelector('.market-record .outcome-button--yes')?.textContent).toBe('Yes 62.0%')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('the market list explains an empty universe, a loading page, and a failed registry read', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	let retries = 0
	const render = (registry: Parameters<typeof readyMarketRegistry>[1], discoveryState: 'loading' | 'ready' | 'error' = 'ready') =>
		renderIntoDocument(<LiveMarketBrowser lookupRoute='market' markets={[]} registry={readyMarketRegistry([], registry)} discoveryState={discoveryState} discoveryError={discoveryState === 'error' ? 'RPC unavailable' : undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		const empty = await render({})
		const emptyState = empty.container.querySelector('.empty-state')
		expect(emptyState?.textContent).toContain('No markets in this universe yet')
		expect(emptyState?.querySelector('a')?.getAttribute('href')).toBe('#/create-market')
		await empty.cleanup()
		const loading = await render({ status: 'loading', page: undefined })
		expect(loading.container.querySelector('.skeleton-list')?.textContent).toBe('Loading markets…')
		expect(loading.container.querySelector('.empty-state')).toBeNull()
		await loading.cleanup()
		// Without a universe the registry has nothing to read: it waits with the list while discovery names one, and shows nothing once discovery fails.
		const waitingForUniverse = await render({ status: 'idle', page: undefined }, 'loading')
		expect(waitingForUniverse.container.querySelector('.skeleton-list')?.textContent).toBe('Loading markets…')
		await waitingForUniverse.cleanup()
		const noUniverse = await render({ status: 'idle', page: undefined }, 'error')
		expect(noUniverse.container.textContent).toContain('Security pool discovery failed: RPC unavailable')
		expect(noUniverse.container.querySelector('.skeleton-list')).toBeNull()
		expect(noUniverse.container.querySelector('.empty-state')).toBeNull()
		expect(noUniverse.container.querySelector('.market-browser')?.getAttribute('aria-busy')).not.toBe('true')
		await noUniverse.cleanup()
		const failed = await render({ status: 'error', page: undefined, error: 'RPC unavailable', retry: () => retries++ })
		expect(failed.container.textContent).toContain('Market discovery failed: RPC unavailable')
		const retry = Array.from(failed.container.querySelectorAll('button')).find(button => button.textContent === 'Retry discovery')
		await act(() => retry?.click())
		expect(retries).toBe(1)
		await failed.cleanup()
	} finally {
		dom.cleanup()
	}
})
