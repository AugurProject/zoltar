import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App } from '../app/App.tsx'
import { demoMarket } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Help, Liquidity, MarketList, Portfolio, SecurityPoolDetails } from '../features/Routes.tsx'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

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

	test('keeps deployment out of navigation and pool internals in the security pool view', async () => {
		const market = demoMarket('baseline')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Developer')
		expect(rendered.container.querySelector('nav')?.textContent).not.toContain('Deployment')
		expect(rendered.container.textContent).not.toContain('Outcome token IDs')
		expect(rendered.container.textContent).not.toContain('System state')
		expect(rendered.container.textContent).not.toContain('Security multiplier')
		const poolLink = rendered.container.querySelector(`a[href="#/security-pool/${market.pool}"]`)
		expect(poolLink).not.toBeNull()
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

	test('does not preserve removed developer-route selector behavior', async () => {
		window.history.replaceState(undefined, '', '/?demo=1#/developer')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.universe-selector')).not.toBeNull()
		expect(rendered.container.querySelector('main')?.textContent).toContain('Markets')
	})
})
