import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, origin, writeScreenshot } from './browser-test.ts'

browserTest(
	'refreshes 1,150 retained rich-list rows within the server request limit',
	async () => {
		const url = `${origin}/addresses?demo=1&chainId=1&richPaginationDemo=large&streamDemo=1`
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

browserTest('switching networks clears the previous table and export during loading and failure', async () => {
	await withBrowserPage(`${origin}/addresses?demo=1&chainId=1&view=table&richRouteRefreshDelayAfterLoad=1&routeRefreshErrorAfterLoad=1`, desktopViewport, async ({ evaluate, waitFor }) => {
		await waitFor("document.querySelector('#richlist-table tbody tr') !== null")
		await evaluate("document.querySelector('#global-network-filter').value = '11155111'; document.querySelector('#global-network-form').requestSubmit()")
		expect(await evaluate("document.querySelector('#richlist-table').childElementCount")).toBe(0)
		await waitFor("document.querySelector('#richlist-status button') !== null")
		expect(await evaluate("document.querySelector('#richlist-table').childElementCount")).toBe(0)
	})
})

browserTest('retry after a snapshot conflict gets a fresh ranking before appending', async () => {
	await withBrowserPage(`${origin}/addresses?demo=1&chainId=1&richPaginationDemo=1&richSnapshotConflict=1`, desktopViewport, async ({ evaluate, waitFor }) => {
		await waitFor("document.querySelectorAll('#richlist-table tbody tr').length === 50")
		await evaluate("document.querySelector('#richlist-more').click()")
		await waitFor("document.querySelector('#richlist-more-status button') !== null")
		await evaluate("document.querySelector('#richlist-more-status button').click()")
		await waitFor("!document.querySelector('#richlist-more').hidden && !document.querySelector('#richlist-more').disabled")
		await evaluate("document.querySelector('#richlist-more').click()")
		await waitFor("document.querySelectorAll('#richlist-table tbody tr').length === 100")
	})
})
