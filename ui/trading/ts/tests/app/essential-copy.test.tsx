import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { App, currentRoute } from '../../app/App.js'
import { ExecutionProtectionFields, renderLiveTradeSummary } from '../../features/LiveTrading.js'

const forbiddenCopy = ['illustrative', 'Demo preview only', 'Demo discovery snapshot', 'Simulated account', 'Demo configuration', 'Demo data is simulated', 'Simulate enter', 'Simulate insured']

describe('essential trading copy', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment('http://localhost/?demo=1#/market').cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('does not let the removed demo query expose a parallel application', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Developer')
		expect(rendered.container.querySelector('nav')?.textContent).toContain('Deploy')
		expect(rendered.container.querySelector('.demo-banner')).toBeNull()
		for (const phrase of forbiddenCopy) expect(rendered.container.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
	})

	test('shows the deployed fee in live entry and exit summaries', async () => {
		const market = { feeBps: 125n }
		const entry = await renderIntoDocument(renderLiveTradeSummary({ kind: 'entry', value: { amount: 10n ** 18n, market, result: { totalLongShares: 2n * 10n ** 18n, invalidInsurance: 3n * 10n ** 17n } } }, 'YES'))
		expect(entry.container.textContent).toContain('Trading fee')
		expect(entry.container.textContent).toContain('1.25%')
		expect(entry.container.textContent).toContain('INVALID received')
		await entry.cleanup()
		const exit = await renderIntoDocument(renderLiveTradeSummary({ kind: 'exit', value: { market, result: { totalLongShares: 2n * 10n ** 18n, invalidInsurance: 3n * 10n ** 17n, ethOut: 8n * 10n ** 17n } } }, 'YES'))
		cleanupRendered = exit.cleanup
		expect(exit.container.textContent).toContain('Trading fee')
		expect(exit.container.textContent).toContain('1.25%')
		expect(exit.container.textContent).toContain('INVALID required')
	})

	test('shows configurable execution-protection controls', async () => {
		const rendered = await renderIntoDocument(<ExecutionProtectionFields slippage='5.01' validityMinutes='0' disabled={false} onSlippageInput={() => undefined} onValidityInput={() => undefined} />)
		cleanupRendered = rendered.cleanup
		const inputs = rendered.container.querySelectorAll<HTMLInputElement>('input')
		const alerts = rendered.container.querySelectorAll<HTMLElement>('[role="alert"]')
		expect(alerts).toHaveLength(2)
		expect(inputs[0]?.getAttribute('aria-describedby')).toBe(alerts[0]?.id)
		expect(inputs[1]?.getAttribute('aria-describedby')).toBe(alerts[1]?.id)
	})

	test('maps the removed developer route to the canonical markets route', () => {
		window.history.replaceState(undefined, '', '/?demo=1#/developer?simulate=1')
		expect(currentRoute()).toBe('markets')
	})
})
