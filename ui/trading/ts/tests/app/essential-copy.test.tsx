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

	test('always shows the pool fee, minimum received, and price impact beside the conditional payout', async () => {
		const market = liveMarketFixture({ feeBps: 125n, settlementCollateralAttoEth: 984_200_000_000_000_000n })
		const buy = ticketEstimateFor(market, 'entry', '1')
		const sell = ticketEstimateFor(market, 'exit', '2', { scope: shareBalanceScope(market), yes: 10n * 10n ** 18n, no: 0n, invalid: 10n * 10n ** 18n, lp: 0n })
		const entry = await renderIntoDocument(<TradeEstimatePanel estimate={buy} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='low' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		for (const phrase of ['You receive ≈', 'Minimum received', 'Price impact', 'Pool fee', '1.25%', 'Invalid insurance', 'ETH if Yes wins', '0 ETH otherwise', 'Slippage 0.5%']) expect(entry.container.textContent).toContain(phrase)
		// The share mechanics stay available behind one disclosure instead of a second always-open breakdown.
		expect(entry.container.querySelectorAll('details')).toHaveLength(1)
		await entry.cleanup()
		const exit = await renderIntoDocument(<TradeEstimatePanel estimate={sell} market={market} settings={DEFAULT_TRADE_SETTINGS} impactTier='low' impactAcknowledged={false} disabled={false} onAcknowledgeImpact={() => undefined} />)
		cleanupRendered = exit.cleanup
		for (const phrase of ['You sell', 'You receive ≈', 'Minimum received', 'Invalid used', 'Pool fee']) expect(exit.container.textContent).toContain(phrase)
		expect(exit.container.textContent).toContain('2 Yes (1.9684 ETH if Yes wins)')
		expect(exit.container.textContent).not.toContain('0 ETH otherwise')
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
