import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

for (const viewport of qaViewports) {
	browserTest(
		`address refunds and escalation deposits page independently at ${viewport.width}x${viewport.height}`,
		async () => {
			const route = `${origin}/address/0x${'1'.repeat(40)}?demo=1&chainId=1&securityPoolMore=1`
			await withBrowserPage(route, viewport, async ({ evaluate, waitFor }) => {
				const selector = (kind: string) => `document.querySelector('[data-security-pool-kind="${kind}"]')`
				const panel = (kind: string) => `${selector(kind)}.closest('.operations-panel')`
				await waitFor(`document.querySelector('#address-profile-content h3') !== null`)
				expect(await evaluate(`${selector('refunds')}?.textContent`)).toBe('Show more refunds')
				await evaluate(`${selector('refunds')}.click()`)
				await waitFor(`${panel('refunds')}.textContent.includes('0.200002 USDC')`)
				expect(await evaluate(`${selector('positions')}.textContent`)).toBe('Show more deposits')
				await evaluate(`${selector('positions')}.click()`)
				await waitFor(`${panel('positions')}.textContent.includes('2 deposits shown')`)
				expect(await evaluate(`document.body.textContent.includes('0.200002 USDC')`)).toBe(true)
				expect(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true)
			})
		},
		120_000,
	)
}
