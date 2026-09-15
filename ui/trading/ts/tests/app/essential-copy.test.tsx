import { installTradingRouting, tradingRouting } from '../../lib/routing.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { App } from '../../app/App.js'
import { ExecutionProtectionFields, renderLiveTradeSummary } from '../../features/LiveTradingTransactionUi.js'

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

	test('shows the deployed fee and stable quantities separately from conditional payouts', async () => {
		const market = { feeBps: 125n, settlementCollateralAttoEth: 984_200_000_000_000_000n, shareTokenSupplyAttoShares: 10n ** 36n }
		const entry = await renderIntoDocument(renderLiveTradeSummary({ kind: 'entry', value: { amount: 10n ** 18n, market, result: { totalLongShares: 2n * 10n ** 36n, invalidInsurance: 3n * 10n ** 35n } } }, 'YES'))
		expect(entry.container.textContent).toContain('Trading fee')
		expect(entry.container.textContent).toContain('1.25%')
		expect(entry.container.textContent).toContain('INVALID received')
		expect(entry.container.textContent).toContain('2 YES')
		expect(entry.container.textContent).toContain('0.3 INVALID')
		expect(entry.container.textContent).toContain('1.9684 ETH if YES wins')
		expect(entry.container.textContent).toContain('0 ETH otherwise')
		await entry.cleanup()
		const exit = await renderIntoDocument(renderLiveTradeSummary({ kind: 'exit', value: { market, result: { totalLongShares: 2n * 10n ** 36n, invalidInsurance: 3n * 10n ** 35n, ethOut: 8n * 10n ** 17n } } }, 'YES'))
		cleanupRendered = exit.cleanup
		expect(exit.container.textContent).toContain('Trading fee')
		expect(exit.container.textContent).toContain('1.25%')
		expect(exit.container.textContent).toContain('INVALID required')
		expect(exit.container.textContent).toContain('2 YES')
		expect(exit.container.textContent).toContain('0.3 INVALID')
		expect(exit.container.textContent).toContain('0.8 ETH')
		expect(exit.container.textContent).not.toContain('if YES wins')
	})

	test('shows configurable execution-protection controls', async () => {
		const rendered = await renderIntoDocument(<ExecutionProtectionFields slippage='5.01' validityMinutes='0' disabled={false} onSlippageInput={() => undefined} onValidityInput={() => undefined} />)
		cleanupRendered = rendered.cleanup
		const inputs = rendered.container.querySelectorAll<HTMLInputElement>('input')
		const errors = rendered.container.querySelectorAll<HTMLElement>('.field-error')
		expect(errors).toHaveLength(2)
		expect(inputs[0]?.getAttribute('aria-invalid')).toBe('true')
		expect(inputs[0]?.getAttribute('aria-describedby')?.split(' ')).toContain(errors[0]?.id)
		expect(inputs[1]?.getAttribute('aria-describedby')?.split(' ')).toContain(errors[1]?.id)
	})

	test('maps the removed developer route to the markets browse route and defaults to the market lookup', () => {
		window.history.replaceState(undefined, '', '/?demo=1#/developer?simulate=1')
		expect(tradingRouting.resolve(window.location.hash)).toBe('markets')
		window.history.replaceState(undefined, '', '/?demo=1#/')
		expect(tradingRouting.resolve(window.location.hash)).toBe('market')
		window.history.replaceState(undefined, '', '/?demo=1#/security-pools')
		expect(tradingRouting.resolve(window.location.hash)).toBe('security-pools')
	})
})
