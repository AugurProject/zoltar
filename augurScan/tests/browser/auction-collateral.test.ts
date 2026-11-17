import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

const auction = `0x${'8'.repeat(40)}`
const bidder = `0x${'1'.repeat(40)}`
const panel = (title: string) => `[...document.querySelectorAll('.operations-panel')].find(panel => panel.querySelector('h3')?.textContent === ${JSON.stringify(title)})`
const noOverflow = `document.documentElement.scrollWidth <= document.documentElement.clientWidth`

// The demo auction and refund settle in 6-decimal USDC; native 18-decimal ETH units would show dust amounts.
for (const viewport of qaViewports) {
	const size = `${viewport.width}x${viewport.height}`
	browserTest(
		`auction snapshot and demand curve use the auction collateral token units at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/operations/auction/${auction}?demo=1&chainId=1&tab=history`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Demand curve data')} !== undefined`)
				expect(await evaluate(`${panel('Demand curve data')}.textContent`)).toContain('3 lots (3 USDC) · cumulative 3 lots (3 USDC)')
				expect(await evaluate(noOverflow)).toBe(true)
			})
			await withBrowserPage(`${origin}/operations/auction/${auction}?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Current-state snapshot')} !== undefined`)
				const snapshot = await evaluate(`${panel('Current-state snapshot')}.textContent`)
				expect(snapshot).toContain('Lot1 USDC')
				expect(snapshot).toContain('Raised: 3 USDC')
				expect(await evaluate(noOverflow)).toBe(true)
			})
			await withBrowserPage(`${origin}/operations/auction/${auction}?demo=1&chainId=1&tab=evidence`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Auction finalization')} !== undefined`)
				expect(await evaluate(`${panel('Auction finalization')}.textContent`)).toContain('Raised: 3 USDC')
			})
		},
		30_000,
	)
	browserTest(
		`address profile shows pending auction refunds in the auction collateral token at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/address/${bidder}?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`${panel('Pending auction refunds')} !== undefined`)
				expect(await evaluate(`${panel('Pending auction refunds')}.textContent`)).toContain('0.100001 USDC')
				expect(await evaluate(noOverflow)).toBe(true)
			})
		},
		30_000,
	)
}
