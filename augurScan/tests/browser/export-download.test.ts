import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports, writeScreenshot } from './browser-test.ts'

browserTest('historical log export downloads one page at a time with a visible continuation', async () => {
	for (const viewport of qaViewports) {
		await withBrowserPage(`${origin}/operations/integrity?demo=1&chainId=1`, viewport, async session => {
			await session.waitFor(`document.querySelector('#operations-content')?.textContent.includes('Selected-chain historical exports') === true`)
			await session.evaluate(`(() => {
				window.exportRequests = []
				window.exportFiles = []
				const realFetch = window.fetch.bind(window)
				window.fetch = (input, options) => {
					const url = new URL(input, location.origin)
					if (url.pathname !== '/api/v1/export') return realFetch(input, options)
					window.exportRequests.push(url.searchParams.toString())
					const page = url.searchParams.has('cursor') ? 2 : 1
					if (page === 2 && window.expireExport) {
						window.expireExport = false
						return Promise.resolve(new Response('', { status: 409 }))
					}
					const headers = page === 1 ? { 'x-augurscan-next-cursor': 'page-2', 'x-augurscan-truncated': 'true' } : { 'x-augurscan-truncated': 'false' }
					return Promise.resolve(new Response(JSON.stringify({ page }) + '\\n', { headers }))
				}
				URL.createObjectURL = blob => {
					window.exportFiles.push(blob.text())
					return 'blob:' + location.origin + '/test'
				}
				const click = HTMLAnchorElement.prototype.click
				HTMLAnchorElement.prototype.click = function () {
					if (!this.download) click.call(this)
				}
			})()`)
			const panel = `[...document.querySelectorAll('.operations-panel')].find(panel => panel.textContent.includes('Selected-chain historical exports'))`
			const button = `${panel}.querySelectorAll('button')[1]`
			await session.evaluate(`${button}.click()`)
			await session.waitFor(`${button}.textContent === 'Download page 2'`)
			await session.evaluate(`${panel}.scrollIntoView({ block: 'center' })`)
			await writeScreenshot(session, `/tmp/augurscan-export-continuation-${viewport.width}.png`)
			await session.evaluate(`window.expireExport = true; ${button}.click()`)
			await session.waitFor(`${panel}.textContent.includes('The export snapshot changed') && ${button}.textContent === 'Download page 1'`)
			await session.evaluate(`${button}.click()`)
			await session.waitFor(`${button}.textContent === 'Download page 2'`)
			await session.evaluate(`${button}.click()`)
			await session.waitFor(`${panel}.textContent.includes('Export complete')`)
			expect(await session.evaluate('Promise.all(window.exportFiles)')).toEqual(['{"page":1}\n', '{"page":1}\n', '{"page":2}\n'])
			const firstPage = 'dataset=logs&canonical=all&limit=50000&chainId=1&demo=1'
			const secondPage = `${firstPage}&cursor=page-2`
			expect(await session.evaluate('window.exportRequests')).toEqual([firstPage, secondPage, firstPage, secondPage])
			expect(await session.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBeTrue()
			expect(session.issues).toEqual([])
		})
	}
})
