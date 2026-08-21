import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { App, currentRoute } from '../../app/App.js'
import { demoMarket } from '../../demo/markets.js'
import { MarketDetail } from '../../features/MarketDetail.js'
import { ExecutionProtectionFields, renderLiveTradeSummary } from '../../features/LiveTrading.js'
import { Help, Liquidity, MarketList, Portfolio, SecurityPoolDetails } from '../../features/Routes.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const forbiddenCopy = [
	'Binary shares for',
	'INVALID is insurance',
	'Canonical SecurityPools',
	'In a live transaction',
	'illustrative',
	'Market signal',
	'Exact identity',
	'Preview ready',
	'Gwei',
	'Two-way trading',
	'Demo preview only',
	'Demo discovery snapshot',
	'Simulated account',
	'Demo configuration',
	'Demo data is simulated',
	'Simulate enter',
	'Simulate insured',
	'INVALID is not traded or priced by this AMM',
	'Positions grouped by SecurityPool',
	'SecurityPool used by this AMM',
]

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

	test('omits removed slogans and demo-value disclaimers from primary routes', async () => {
		const market = demoMarket('baseline')
		const rendered = await renderIntoDocument(
			<>
				<App />
				<MarketList market={market} />
				<MarketDetail market={market} scenario='baseline' onWorkflowLockChange={() => undefined} />
				<Liquidity market={market} />
				<Portfolio market={market} />
				<SecurityPoolDetails market={market} />
				<Help />
			</>,
		)
		cleanupRendered = rendered.cleanup
		for (const phrase of forbiddenCopy) expect(rendered.container.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
		expect(rendered.container.textContent).toContain('2 nETH / gas')
		expect(rendered.container.textContent).toContain('Minting capacity2,468.5 / 10,000 ETH')
		expect(rendered.container.textContent).not.toContain('Available minting capacity')
		expect(rendered.container.textContent).not.toContain('Fork continuation')
	})

	test('does not let the removed demo query hide live deployment or invent pool data', async () => {
		const market = demoMarket('baseline')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Developer')
		expect(rendered.container.querySelector('nav')?.textContent).toContain('Deploy')
		expect(rendered.container.querySelector('.demo-banner')).toBeNull()
		expect(rendered.container.textContent).not.toContain('Outcome token IDs')
		expect(rendered.container.textContent).not.toContain('System state')
		expect(rendered.container.textContent).not.toContain('Security multiplier')
		const poolLink = rendered.container.querySelector(`a[href="#/security-pool/${market.pool}"]`)
		expect(poolLink).toBeNull()
	})

	test('shows technical identifiers and resolved outcome only in security pool details', async () => {
		const unresolved = await renderIntoDocument(<SecurityPoolDetails market={demoMarket('baseline')} />)
		expect(unresolved.container.textContent).toContain('Share token address')
		expect(unresolved.container.textContent).toContain('Outcome token IDs')
		expect(unresolved.container.textContent).toContain('System stateOperational')
		expect(unresolved.container.textContent).toContain('Security multiplier2×')
		expect(unresolved.container.textContent).not.toContain('OutcomeUnresolved')
		await unresolved.cleanup()
		const resolved = await renderIntoDocument(<SecurityPoolDetails market={demoMarket('resolved-invalid')} />)
		cleanupRendered = resolved.cleanup
		expect(resolved.container.textContent).toContain('OutcomeINVALID')
	})

	test('announces and blocks pool-detail navigation during a pending workflow', async () => {
		const market = demoMarket('baseline')
		const rendered = await renderIntoDocument(<MarketDetail market={market} scenario='pending' />)
		cleanupRendered = rendered.cleanup
		const poolLink = rendered.container.querySelector<HTMLAnchorElement>(`a[href="#/security-pool/${market.pool}"]`)
		if (poolLink === null) throw new Error('Security pool link is unavailable')
		expect(poolLink.getAttribute('aria-disabled')).toBe('true')
		const currentHash = window.location.hash
		poolLink.click()
		expect(window.location.hash).toBe(currentHash)
	})

	test('puts the user-facing trade result and action before optional mechanics', async () => {
		const rendered = await renderIntoDocument(<MarketDetail market={{ ...demoMarket('baseline'), feeBps: 47n }} scenario='baseline' />)
		cleanupRendered = rendered.cleanup
		const summary = rendered.container.querySelector('.trade-summary')
		const action = rendered.container.querySelector('.trade-action')
		const breakdown = rendered.container.querySelector('.trade-breakdown')
		if (summary === null || action === null || breakdown === null) throw new Error('Trade hierarchy is incomplete')
		expect(summary.textContent).toContain('You pay0.25 ETH')
		expect(summary.textContent).toContain('You receive0.3611 YES+ 0.2531 INVALID')
		expect(summary.textContent).toContain('Trading fee 0.47%')
		expect(summary.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		expect(action.compareDocumentPosition(breakdown) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
		expect(breakdown.textContent).toContain('Conditional YES price70.0%')
		expect(breakdown.textContent).toContain('YES reserve428.571 YES')
		expect(breakdown.textContent).toContain('NO reserve1,000 NO')
		expect(rendered.container.querySelector('.detail-aside')?.textContent).toContain('Your position')
		expect(rendered.container.querySelector('.detail-aside')?.textContent).not.toContain('Conditional YES price')
		const exit = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent?.trim() === 'Exit')
		if (!(exit instanceof HTMLButtonElement)) throw new Error('Exit mode button is unavailable')
		await act(async () => exit.click())
		expect(rendered.container.querySelector('.trade-summary')?.textContent).toContain('Trading fee 0.47%')
	})

	test('shows the deployed fee in live entry and exit summaries', async () => {
		const market = { feeBps: 125n }
		const entry = await renderIntoDocument(renderLiveTradeSummary({ kind: 'entry', value: { amount: 10n ** 18n, market, result: { totalLongShares: 2n * 10n ** 18n, invalidInsurance: 3n * 10n ** 17n } } }, 'YES'))
		expect(entry.container.textContent).toContain('Trading fee')
		expect(entry.container.textContent).toContain('1.25%')
		expect(entry.container.textContent).toContain('INVALID received')
		expect(entry.container.textContent).not.toContain('INVALID required')
		await entry.cleanup()
		const exit = await renderIntoDocument(renderLiveTradeSummary({ kind: 'exit', value: { market, result: { totalLongShares: 2n * 10n ** 18n, invalidInsurance: 3n * 10n ** 17n, ethOut: 8n * 10n ** 17n } } }, 'YES'))
		cleanupRendered = exit.cleanup
		expect(exit.container.textContent).toContain('Trading fee')
		expect(exit.container.textContent).toContain('1.25%')
		expect(exit.container.textContent).toContain('INVALID required')
		expect(exit.container.textContent).not.toContain('INVALID received')
	})

	test('shows configurable slippage and transaction-validity controls', async () => {
		const rendered = await renderIntoDocument(<ExecutionProtectionFields slippage='0.5' validityMinutes='20' disabled={false} onSlippageInput={() => undefined} onValidityInput={() => undefined} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.textContent).toContain('Slippage tolerance')
		expect(rendered.container.textContent).toContain('Transaction valid for')
		const inputs = rendered.container.querySelectorAll<HTMLInputElement>('input')
		expect(inputs[0]?.value).toBe('0.5')
		expect(inputs[1]?.value).toBe('20')
		await rendered.cleanup()
		const invalid = await renderIntoDocument(<ExecutionProtectionFields slippage='5.01' validityMinutes='0' disabled={false} onSlippageInput={() => undefined} onValidityInput={() => undefined} />)
		cleanupRendered = invalid.cleanup
		const invalidInputs = invalid.container.querySelectorAll<HTMLInputElement>('input')
		const alerts = invalid.container.querySelectorAll<HTMLElement>('[role="alert"]')
		expect(alerts).toHaveLength(2)
		expect(invalidInputs[0]?.getAttribute('aria-describedby')).toBe(alerts[0]?.id)
		expect(invalidInputs[1]?.getAttribute('aria-describedby')).toBe(alerts[1]?.id)
	})

	test('does not preserve removed developer-route behavior', () => {
		window.history.replaceState(undefined, '', '/?demo=1#/developer?simulate=1')
		expect(currentRoute()).toBe('markets')
	})
})
