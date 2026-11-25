import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports, writeScreenshot } from './browser-test.ts'

for (const viewport of qaViewports) {
	const size = `${viewport.width}x${viewport.height}`
	browserTest(`flat candles and their exact data at ${size}`, async () => {
		await withBrowserPage(`${origin}/trading/0x${'1'.repeat(40)}?demo=1&chainId=1&tab=history`, viewport, async session => {
			await session.waitFor("[...document.querySelectorAll('svg[aria-label*=candles] g[aria-label=rule] line')].some(line => line.x2.baseVal.value > line.x1.baseVal.value && line.y2.baseVal.value === line.y1.baseVal.value)")
			await session.evaluate("document.querySelector('.chart-data-disclosure summary').click(); document.querySelector('.chart-data-disclosure').scrollIntoView({block:'center'})")
			expect(await session.evaluate("document.querySelector('.chart-data-disclosure')?.textContent")).toContain('O 1/10000000000')
			expect(await session.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBeTrue()
			await writeScreenshot(session, `/tmp/augur10-candles-${size}.png`)
			expect(session.issues).toEqual([])
		})
	})

	browserTest(
		`rich-list refresh preserves position focus and reports capped balances at ${size}`,
		async () => {
			await withBrowserPage(`${origin}/addresses?demo=1&chainId=1&view=cards&expandRich=1&richPaginationDemo=1&richCapped=1`, viewport, async session => {
				const position = 'document.querySelector(\'#richlist-rows details[open] a[href*="/capital/"]\')'
				await session.waitFor(`${position} !== null`)
				expect(await session.evaluate("document.querySelector('#richlist-rows article').textContent")).toContain('Showing 100 of 101 sampled REP tokens')
				await session.evaluate(`${position}.focus(); document.querySelector('#richlist-more').click()`)
				await session.waitFor("document.querySelectorAll('#richlist-table tbody tr').length === 100")
				expect(await session.evaluate(`document.activeElement === ${position}`)).toBeTrue()
				await session.evaluate(`${position}.scrollIntoView({block:'center'})`)
				expect(await session.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBeTrue()
				await writeScreenshot(session, `/tmp/augur10-rich-${size}.png`)
				expect(session.issues).toEqual([])
			})
		},
		30000,
	)
}
