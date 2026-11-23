import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, origin, writeScreenshot } from './browser-test.ts'

browserTest(
	'refreshes 1,150 retained rich-list rows within the server request limit',
	async () => {
		const url = `${origin}/richlist?demo=1&chainId=1&richPaginationDemo=large&streamDemo=1`
		await withBrowserPage(url, desktopViewport, async session => {
			await session.send('Page.addScriptToEvaluateOnNewDocument', {
				source: `window.EventSource = class extends EventTarget {
					constructor() { super(); this.readyState = 1; window.richRefreshStream = this }
					close() { this.readyState = 2 }
				}`,
			})
			await session.send('Page.navigate', { url })
			const tableRowCount = `document.querySelectorAll('#richlist-table tbody tr').length`
			await session.waitFor(`${tableRowCount} === 50 && window.richRefreshStream !== undefined`)
			for (let expected = 100; expected <= 1150; expected += 50) {
				await session.evaluate(`document.querySelector('#richlist-more').click()`)
				await session.waitFor(`${tableRowCount} === ${expected}`)
			}
			await session.evaluate(`window.richRefreshStream.dispatchEvent(new Event('open')); window.richRefreshStream.dispatchEvent(new Event('open'))`)
			await session.waitFor(`window.__demoMaxRouteRequestsInFlight > 1 && document.querySelector('#richlist-rows').getAttribute('aria-busy') === 'false'`)
			expect(await session.evaluate('window.__demoMaxRouteRequestsInFlight <= 10')).toBeTrue()
			expect(await session.evaluate(tableRowCount)).toBe(1150)
			expect(await session.evaluate(`document.querySelector('#richlist-status').hidden`)).toBeTrue()
			expect(session.issues).toEqual([])
			await writeScreenshot(session, '/tmp/augurscan-rich-list-refresh-1440.png')
		})
	},
	30_000,
)
