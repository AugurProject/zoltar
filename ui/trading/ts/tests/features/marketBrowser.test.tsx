import { expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { FIXTURE_DAY, FIXTURE_NOW, fixtureAddress, listingMarketFixture as liveMarketFixture } from '../support/liveMarketFixture.js'

const page = { start: 0n, total: 2n, previousStart: undefined, nextStart: undefined }

function renderBrowser(lookupRoute: 'market' | 'liquidity') {
	const markets = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'Will it rain in Paris?', yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Will the bridge open?', endTime: FIXTURE_NOW + 2n * FIXTURE_DAY })]
	return renderIntoDocument(
		<LiveMarketBrowser
			freshness={{ refreshing: false, updatedAt: undefined }}
			lookupRoute={lookupRoute}
			markets={markets}
			pageMarketCount={markets.length}
			discoveryState='ready'
			discoveryError={undefined}
			marketPage={page}
			workflowLocked={false}
			nowSeconds={FIXTURE_NOW}
			retry={() => undefined}
			loadMarketPage={() => undefined}
		/>,
	)
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
		// Closing soon is the default order, so the market ending first leads.
		expect(cardTitles(rendered.container)).toEqual(['Will the bridge open?', 'Will it rain in Paris?'])
		const rain = rendered.container.querySelectorAll('.market-record')[1]
		const yes = rain?.querySelector('.outcome-button--yes')
		const no = rain?.querySelector('.outcome-button--no')
		expect(yes?.textContent).toBe('YES 62%')
		expect(no?.textContent).toBe('NO 38%')
		expect(yes?.getAttribute('aria-label')).toBe('Buy YES at a conditional 62%')
		expect(yes?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&side=yes`)
		expect(no?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&side=no`)
		expect(rain?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Conditional odds: YES 62%, NO 38%')
		expect(rain?.textContent).toContain('Liquidity')
		expect(rain?.textContent).toContain('in 30 days')
		expect(rendered.container.querySelector('.market-record')?.textContent).toContain('in 2 days')
		// Addresses belong to the market page, not the card.
		expect(rendered.container.querySelector('.market-list')?.textContent).not.toContain(fixtureAddress('01'))
		expect(rendered.container.querySelector('[role="status"]')?.textContent).toBe('2 markets')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('search and status filters narrow the downloaded markets and offer a way back from an empty result', async () => {
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
		expect(rendered.container.textContent).toContain('No downloaded markets match.')
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

test('the liquidity landing keeps liquidity as the primary action instead of outcome buttons', async () => {
	const dom = installDomEnvironment('http://localhost/#/liquidity')
	const rendered = await renderBrowser('liquidity')
	try {
		expect(rendered.container.querySelector('.outcome-button')).toBeNull()
		expect(rendered.container.querySelector('.market-record .button-link.primary')?.getAttribute('href')).toBe(`#/liquidity/${fixtureAddress('02')}`)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('search spans every discovered page, and Discover reads the next page into the list', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	// The page holds the second registry page; the first page's markets come from the download cache.
	const secondPage = [liveMarketFixture({ pool: fixtureAddress('03'), title: 'Will the ferry run?' })]
	const firstPageCached = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'Will it rain in Paris?' }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Will the bridge open?' })]
	const requestedStarts: Array<bigint | undefined> = []
	const renderAt = (nextStart: bigint | undefined) => (
		<LiveMarketBrowser
			freshness={{ refreshing: false, updatedAt: Date.now() }}
			lookupRoute='market'
			markets={[...secondPage, ...firstPageCached]}
			pageMarketCount={secondPage.length}
			discoveryState='ready'
			discoveryError={undefined}
			marketPage={{ start: 25n, total: 60n, previousStart: 0n, nextStart }}
			workflowLocked={false}
			nowSeconds={FIXTURE_NOW}
			retry={() => undefined}
			loadMarketPage={start => requestedStarts.push(start)}
		/>
	)
	const rendered = await renderIntoDocument(renderAt(50n))
	try {
		expect(rendered.container.querySelector('.market-list-count')?.textContent).toBe('3 markets')
		expect(rendered.container.querySelector('.discovery-control')?.textContent).toContain('26 of 60 markets scanned')
		// There is no page to step through: the list is the downloaded set.
		expect(Array.from(rendered.container.querySelectorAll('button')).map(button => button.textContent)).not.toContain('Next page')
		await typeSearch(rendered.container, 'paris')
		expect(cardTitles(rendered.container)).toEqual(['Will it rain in Paris?'])
		expect(rendered.container.querySelector('.market-list-count')?.textContent).toBe('1 of 3 markets')
		const discover = () => Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.discovery-control button'))[0]
		expect(discover()?.textContent).toBe('Discover more')
		await act(() => discover()?.click())
		expect(requestedStarts).toEqual([50n])
		// After the last page, the same control starts the scan again from the first page.
		await act(() => render(renderAt(undefined), rendered.container))
		expect(discover()?.textContent).toBe('Scan again')
		await act(() => discover()?.click())
		expect(requestedStarts).toEqual([50n, 0n])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('limits the registry-order label to the positional first-load presentation', async () => {
	const dom = installDomEnvironment('http://localhost/#/market')
	const first = liveMarketFixture({ pool: fixtureAddress('01'), title: 'Registry first', endTime: FIXTURE_NOW + 30n * FIXTURE_DAY })
	const second = liveMarketFixture({ pool: fixtureAddress('02'), title: 'Registry second', endTime: FIXTURE_NOW + FIXTURE_DAY })
	const view = (loaded: boolean) => (
		<LiveMarketBrowser
			lookupRoute='market'
			markets={loaded ? [second, first] : []}
			discoveryRows={loaded ? [first, second] : undefined}
			pageMarketCount={loaded ? 2 : 0}
			discoveryState={loaded ? 'ready' : 'loading'}
			discoveryError={undefined}
			freshness={{ refreshing: false, updatedAt: undefined }}
			marketPage={page}
			workflowLocked={false}
			nowSeconds={FIXTURE_NOW}
			retry={() => undefined}
			loadMarketPage={() => undefined}
		/>
	)
	const rendered = await renderIntoDocument(view(false))
	try {
		await act(() => render(view(true), rendered.container))
		expect(cardTitles(rendered.container)).toEqual(['Registry first', 'Registry second'])
		const sort = () => rendered.container.querySelector<HTMLButtonElement>('.enum-dropdown-trigger')
		expect(sort()?.textContent).toBe('Registry order')
		await act(() => sort()?.click())
		const closing = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('[role="option"]')).find(option => option.textContent === 'Closing soon')
		if (closing === undefined) throw new Error('Closing-soon option missing')
		await act(() => closing.click())
		expect(cardTitles(rendered.container)).toEqual(['Registry second', 'Registry first'])
		await act(() => sort()?.click())
		expect(Array.from(rendered.container.querySelectorAll('[role="option"]')).map(option => option.textContent)).not.toContain('Registry order')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('an empty discovery page on the security-pool list shows its empty state instead of an empty grid', async () => {
	const dom = installDomEnvironment('http://localhost/#/create-market')
	const rendered = await renderIntoDocument(
		<LiveMarketBrowser
			freshness={{ refreshing: false, updatedAt: 1 }}
			lookupRoute='create-market'
			markets={[]}
			discoveryRows={[]}
			pageMarketCount={0}
			discoveryState='ready'
			discoveryError={undefined}
			marketPage={{ start: 0n, total: 0n, previousStart: undefined, nextStart: undefined }}
			workflowLocked={false}
			nowSeconds={FIXTURE_NOW}
			retry={() => undefined}
			loadMarketPage={() => undefined}
		/>,
	)
	try {
		expect(rendered.container.querySelector('.market-list')).toBeNull()
		expect(rendered.container.querySelector('.empty-state')?.textContent).toContain('No security pools on this page are available for a new market.')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
