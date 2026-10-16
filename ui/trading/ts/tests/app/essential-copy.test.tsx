import { installTradingRouting, tradingRouting } from '../../lib/routing.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { App } from '../../app/App.js'
import { TradeEstimatePanel } from '../../features/TradeEstimatePanel.js'
import { DEFAULT_TRADE_SETTINGS } from '../../lib/tradeSettings.js'
import { liveMarketFixture, ticketEstimateFor } from '../support/liveMarketFixture.js'
import { shareBalanceScope } from '../../protocol/live.js'
import { formatOutcomeQuantity } from '../../lib/shareValue.js'

/** The text of each estimate row's value, keyed by its label. */
function estimateRows(container: ParentNode) {
	return new Map(Array.from(container.querySelectorAll('.transaction-review-row, .transaction-review-detail-row')).map(row => [row.querySelector('span')?.textContent ?? '', row.querySelector('strong')?.textContent ?? '']))
}

beforeEach(() => installTradingRouting())

const forbiddenCopy = ['illustrative', 'Demo preview only', 'Demo discovery snapshot', 'Simulated account', 'Demo configuration', 'Demo data is simulated', 'Simulate enter', 'Simulate insured']

describe('essential trading copy', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/?demo=1#/market',
	})

	test('does not let the removed demo query expose a parallel application', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Developer')
		// The deployment tab waits for the deployment check to fail instead of appearing on every boot.
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Deploy')
		expect(rendered.container.querySelector('.demo-banner')).toBeNull()
		for (const phrase of forbiddenCopy) expect(rendered.container.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
	})

	test('shows the average price, minimum received, trading fee, and price impact beside the conditional payout', async () => {
		const market = liveMarketFixture({ feeBps: 125n, settlementCollateralAttoEth: 984_200_000_000_000_000n })
		const buy = ticketEstimateFor(market, 'entry', '1')
		const sell = ticketEstimateFor(market, 'exit', '2', { scope: shareBalanceScope(market), yes: 10n * 10n ** 18n, no: 0n, invalid: 10n * 10n ** 18n, lp: 0n })
		const entry = await renderIntoDocument(<TradeEstimatePanel estimate={buy} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='low' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		for (const phrase of ['You receive ≈', 'Average price', 'Minimum received', 'Price impact', 'Trading fee', '1.25%', 'Invalid insurance', 'ETH if the question resolves Yes', 'Profit if the question resolves Yes', 'ETH if the question resolves Invalid', '0 ETH if No', 'Slippage 0.5%'])
			expect(entry.container.textContent).toContain(phrase)
		// The buy keeps Invalid shares that pay on Invalid, so the headline never says the trade pays nothing otherwise.
		expect(entry.container.textContent).not.toContain('0 ETH otherwise')
		// Each headline value leads with the quantity; what it pays sits on its own line under it instead of inside the figure.
		const payouts = Array.from(entry.container.querySelectorAll('.transaction-review-primary .trade-estimate-value-detail')).map(detail => detail.textContent ?? '')
		expect(payouts).toHaveLength(2)
		expect(payouts[0]).toMatch(/^[\d.]+ ETH if the question resolves Yes · 0 ETH if No$/)
		expect(payouts[1]).toMatch(/^[\d.]+ ETH if the question resolves Invalid$/)
		const entryRows = estimateRows(entry.container)
		expect(entryRows.get('You receive ≈')).toBe(`${formatOutcomeQuantity(buy.quote.totalLongShares, 'YES', 6)}${payouts[0]}`)
		expect(entryRows.get('Minimum received')).toBe(buy.kind === 'entry' ? formatOutcomeQuantity(buy.minimumLongShares, 'YES', 6, 'down') : '')
		// The share mechanics stay available behind one disclosure instead of a second always-open breakdown.
		expect(entry.container.querySelectorAll('details')).toHaveLength(1)
		await entry.cleanup()
		const exit = await renderIntoDocument(<TradeEstimatePanel estimate={sell} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='low' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		cleanupRendered = exit.cleanup
		for (const phrase of ['You sell', 'You receive ≈', 'Average price', 'Minimum received', 'Maximum sold', 'Invalid used', 'Trading fee']) expect(exit.container.textContent).toContain(phrase)
		// A sale names the shares it takes, without a conditional payout beside the ETH it actually pays.
		expect(exit.container.textContent).not.toContain('if the question resolves')
		const exitRows = estimateRows(exit.container)
		if (sell.kind !== 'exit') throw new Error('Expected a sell estimate')
		expect(exitRows.get('You sell')).toBe(formatOutcomeQuantity(sell.quote.totalLongShares, 'YES', 6))
		// The most the wallet signs over is shown beside the minimum it receives, and it never exceeds the 2 Yes typed.
		expect(sell.maximumLongShares).toBeLessThanOrEqual(2n * 10n ** 18n)
		expect(exitRows.get('Maximum sold')).toBe(formatOutcomeQuantity(sell.maximumLongShares, 'YES', 6))
		expect(exit.container.textContent).not.toContain('0 ETH otherwise')
		expect(exit.container.textContent).not.toContain('Profit if the question resolves Yes')
		expect(exit.container.textContent).not.toContain('Holding fees reduce')
	})

	test('escalates price-impact warnings and asks for acknowledgment before a high-impact trade', async () => {
		const market = liveMarketFixture()
		const buy = ticketEstimateFor(market, 'entry', '20')
		const acknowledgements: boolean[] = []
		const warning = await renderIntoDocument(<TradeEstimatePanel estimate={buy} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='warning' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={value => acknowledgements.push(value)} />)
		expect(warning.container.querySelector('.trade-impact-warning')?.textContent).toContain('High price impact')
		// The live region names the tier, not the percentage, so a re-priced estimate in the same tier is not re-announced.
		expect(warning.container.querySelector('[role="alert"]')).toBeNull()
		const announcement = () => warning.container.querySelector('.trade-estimate [role="status"]')?.textContent
		expect(announcement()).toBe('High price impact. Confirm it before trading.')
		await act(() => render(<TradeEstimatePanel estimate={ticketEstimateFor(market, 'entry', '21')} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='warning' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={value => acknowledgements.push(value)} />, warning.container))
		expect(announcement()).toBe('High price impact. Confirm it before trading.')
		warning.container.querySelector<HTMLInputElement>('.trade-impact-acknowledge input')?.click()
		expect(acknowledgements).toEqual([true])
		await warning.cleanup()
		const blocked = await renderIntoDocument(<TradeEstimatePanel estimate={buy} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='blocked' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		cleanupRendered = blocked.cleanup
		expect(blocked.container.textContent).toContain('above the 15% limit')
		expect(blocked.container.querySelector('.trade-impact-acknowledge')).toBeNull()
		expect(blocked.container.querySelector('.trade-estimate [role="status"]')?.textContent).toBe('Price impact above the 15% limit. Trade a smaller amount.')
	})

	test('resolves the retired browse hashes to their lookup landings and defaults to the market lookup', () => {
		window.history.replaceState(undefined, '', '/?demo=1#/developer?simulate=1')
		expect(tradingRouting.resolve(window.location.hash)).toBe('market')
		window.history.replaceState(undefined, '', '/?demo=1#/markets')
		expect(tradingRouting.resolve(window.location.hash)).toBe('market')
		window.history.replaceState(undefined, '', '/?demo=1#/')
		expect(tradingRouting.resolve(window.location.hash)).toBe('market')
		window.history.replaceState(undefined, '', '/?demo=1#/security-pools')
		expect(tradingRouting.resolve(window.location.hash)).toBe('create-market')
	})
})
