import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { installDomEnvironment } from '../../../../ui/ts/tests/testUtils/domEnvironment.ts'
import { demoMarket } from '../demo/markets.ts'
import { MarketDetail } from '../features/MarketDetail.tsx'
import { Help, MarketList } from '../features/Routes.tsx'
import { renderIntoDocument } from './test-support/renderIntoDocument.tsx'

const forbiddenCopy = ['Binary shares for', 'INVALID is insurance', 'Canonical SecurityPools', 'In a live transaction', 'illustrative', 'Market signal', 'Exact identity', 'Preview ready', 'Gwei']

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
		const rendered = await renderIntoDocument(
			<>
				<MarketList market={demoMarket('baseline')} />
				<MarketDetail market={demoMarket('baseline')} scenario='baseline' onWorkflowLockChange={() => undefined} />
				<Help />
			</>,
		)
		cleanupRendered = rendered.cleanup
		for (const phrase of forbiddenCopy) expect(rendered.container.textContent?.toLowerCase()).not.toContain(phrase.toLowerCase())
		expect(rendered.container.textContent).toContain('2 nETH / gas')
	})
})
