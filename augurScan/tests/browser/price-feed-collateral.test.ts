import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

for (const viewport of qaViewports) {
	browserTest(
		`shared-feed timeline prices retain REP per collateral units at ${viewport.width}px`,
		async () => {
			await withBrowserPage(`${origin}/operations/timeline?demo=1&chainId=1&feedTimeline=1`, viewport, async ({ evaluate, waitFor }) => {
				const rows = `[...document.querySelectorAll('.operations-exact-evidence')].map(evidence => evidence.parentElement).filter(row => row?.textContent.includes('Price feed'))`
				await waitFor(`${rows}.length === 3`)
				const text = await evaluate(`${rows}.map(row => row.textContent).join(' ')`)
				expect(text).toContain('PriceReported')
				expect(text).toContain('PriceReportRejected')
				expect(text).toContain('PendingReportRecovered')
				expect(String(text).match(/2 REP\/USDC/g)).toHaveLength(3)
				expect(text).not.toContain('2,000,000,000,000,000,000,000,000,000,000')
				expect(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true)
			})
		},
		60_000,
	)
}
