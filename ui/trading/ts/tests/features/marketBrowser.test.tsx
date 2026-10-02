import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { FIXTURE_DAY, FIXTURE_NOW, fixtureAddress, listingMarketFixture as liveMarketFixture } from '../support/liveMarketFixture.js'

function renderBrowser(lookupRoute: 'market' | 'liquidity') {
	const markets = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'Will it rain in Paris?', yesReserve: 38n * 10n ** 16n, noReserve: 62n * 10n ** 16n }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Will the bridge open?', endTime: FIXTURE_NOW + 2n * FIXTURE_DAY })]
	return renderIntoDocument(<LiveMarketBrowser lookupRoute={lookupRoute} markets={markets} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
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
		expect(yes?.textContent).toBe('Yes 62%')
		expect(no?.textContent).toBe('No 38%')
		expect(yes?.getAttribute('aria-label')).toBe('Buy Yes at a conditional 62%')
		expect(yes?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&side=yes`)
		expect(no?.getAttribute('href')).toBe(`#/market/${fixtureAddress('01')}?simulate=1&simScenario=trading-funded&side=no`)
		expect(rain?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Conditional odds: Yes 62%, No 38%')
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
		expect(rendered.container.textContent).toContain('No favorites match.')
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
		expect(rendered.container.querySelector('.market-record .button-link.primary')?.getAttribute('href')).toBe(`#/liquidity/${fixtureAddress('01')}`)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('an empty favorite pool list shows address lookup and no scan or pagination controls', async () => {
	const dom = installDomEnvironment('http://localhost/#/create-market')
	const rendered = await renderIntoDocument(<LiveMarketBrowser lookupRoute='create-market' markets={[]} discoveryState='ready' discoveryError={undefined} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} />)
	try {
		expect(rendered.container.querySelector('.market-list')).toBeNull()
		expect(rendered.container.querySelector('form.market-list-search')).not.toBeNull()
		expect(rendered.container.querySelector('.discovery-control')).toBeNull()
		expect(rendered.container.querySelector('.empty-state')?.textContent).toContain('No favorite security pools.')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
