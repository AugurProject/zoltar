import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { LiveMarketBrowser } from '../../features/LiveMarketBrowser.js'
import { FIXTURE_DAY, FIXTURE_NOW, fixtureAddress, liveMarketFixture } from '../support/liveMarketFixture.js'

const page = { start: 0n, total: 2n, previousStart: undefined, nextStart: undefined }

function renderBrowser(lookupRoute: 'market' | 'liquidity') {
	const markets = [liveMarketFixture({ pool: fixtureAddress('01'), title: 'Will it rain in Paris?', yesReserve: 38n * 10n ** 34n, noReserve: 62n * 10n ** 34n }), liveMarketFixture({ pool: fixtureAddress('02'), title: 'Will the bridge open?', endTime: FIXTURE_NOW + 2n * FIXTURE_DAY })]
	return renderIntoDocument(<LiveMarketBrowser lookupRoute={lookupRoute} markets={markets} pageMarketCount={markets.length} discoveryState='ready' discoveryError={undefined} marketPage={page} workflowLocked={false} nowSeconds={FIXTURE_NOW} retry={() => undefined} loadMarketPage={() => undefined} />)
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

test('search and status filters narrow the loaded page and offer a way back from an empty result', async () => {
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
		expect(rendered.container.textContent).toContain('No markets on this page match.')
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
