import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { App } from '../app/App.tsx'
import { demoMarket } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Developer, Help, Liquidity, MarketList, Portfolio } from '../features/Routes.tsx'
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
				<Developer demo />
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
})
