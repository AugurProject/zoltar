import { expect, test } from 'bun:test'
import { createDevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

browserTest(
	'search, internal evidence links, canonical entity selection, and history work',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/?demo=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null) throw new Error('Missing browser response')
			if ('exceptionDetails' in response && response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
			if (!('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
			return response.result.value
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 100; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(100)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		try {
			await session.send('Runtime.enable')
			await session.send('Page.enable')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`document.querySelector('.log-row .cell-tx') !== null`)
			await Bun.sleep(300)
			expect(await evaluate(`document.querySelector('#connection-label')?.textContent`)).toContain('live · #23,184,712')
			expect(await evaluate(`document.querySelector('.log-row .activity-summary-text')?.textContent.length > 0`)).toBe(true)
			await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`)
			expect(await evaluate(`document.activeElement?.id`)).toBe('global-search-input')
			await evaluate(`document.querySelector('#global-search-input').value = '23184711'; document.querySelector('#global-search').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`)
			await waitFor(`document.querySelector('#global-search-results a') !== null`)
			expect(await evaluate(`document.querySelector('#global-search-results').textContent.includes('Block #23184711')`)).toBe(true)
			await evaluate(`document.querySelector('#global-network-filter').value = '11155111'; document.querySelector('#global-network-filter').dispatchEvent(new Event('change', { bubbles: true }))`)
			await waitFor(`new URL(location.href).searchParams.get('chainId') === '11155111'`)
			await evaluate(`document.querySelector('#global-search-results a').click()`)
			await waitFor(`location.pathname.startsWith('/block/') && document.querySelector('#explorer-content .static-grid') !== null`)
			expect(await evaluate(`new URL(location.href).searchParams.get('chainId')`)).toBe('1')
			expect(await evaluate(`document.querySelector('#global-network-filter').value`)).toBe('1')
			expect(await evaluate(`document.querySelector('#explorer-content h2')?.textContent`)).not.toBe('Evidence unavailable')
			await waitFor(`document.querySelector('#global-search-results').hidden`)
			await evaluate(`history.back()`)
			await waitFor(`location.pathname === '/' && document.querySelector('.log-row .cell-tx') !== null`)
			await evaluate(`document.querySelector('#global-network-filter').value = '1'; document.querySelector('#global-network-filter').dispatchEvent(new Event('change', { bubbles: true }))`)
			await waitFor(`new URL(location.href).searchParams.get('chainId') === '1' && document.querySelector('.log-row .cell-tx') !== null`)
			await evaluate(`document.querySelector('.log-row .cell-tx').click()`)
			await waitFor(`location.pathname.startsWith('/tx/') && document.querySelector('#explorer-content .static-grid') !== null`)
			expect(await evaluate(`document.querySelectorAll('#explorer-content a[href^="https://"]').length`)).toBe(1)
			await evaluate(`document.querySelector('#explorer-content a[href*="/block/"]').click()`)
			await waitFor(`location.pathname.startsWith('/block/') && document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`history.back()`)
			await waitFor(`location.pathname.startsWith('/tx/') && document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`document.querySelector('#global-network-filter').value = '11155111'; document.querySelector('#global-network-filter').dispatchEvent(new Event('change', { bubbles: true }))`)
			await waitFor(`location.search.includes('chainId=11155111') && document.querySelector('#explorer-content h2')?.textContent === 'Evidence unavailable'`)
			await session.send('Page.navigate', { url: `${origin}/block/23184711?demo=1&chainId=1&block251=1` })
			await waitFor(`document.querySelector('#explorer-content h3')?.textContent === 'First 250 transactions'`)
			expect(await evaluate(`document.querySelector('#explorer-content .data-note')?.textContent`)).toContain('More indexed transactions')
			await session.send('Page.navigate', { url: `${origin}/richlist?demo=1` })
			await waitFor(`document.querySelector('.data-table tbody tr') !== null`)
			expect(await evaluate(`document.querySelector('.data-table tbody tr td:nth-child(2)')?.textContent`)).toBe('912.000000000000000001 REP')
			await evaluate(`const createObjectURL = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.exportedCsv = blob.text(); return createObjectURL(blob) }; document.querySelector('.data-table-toolbar button').click()`)
			expect(await evaluate(`window.exportedCsv`)).toContain('912.000000000000000001 REP')
			expect(await evaluate(`document.querySelector('#richlist-table').hidden === false && document.querySelector('#richlist-shell').hidden === true`)).toBe(true)
			await evaluate(`document.querySelector('#rich-view-toggle').click()`)
			expect(await evaluate(`location.search.includes('view=cards') && document.querySelector('#richlist-table').hidden && !document.querySelector('#richlist-shell').hidden`)).toBe(true)
			await session.send('Page.navigate', { url: `${origin}/question/501?demo=1&chainId=1&entity501=1` })
			await waitFor(`document.querySelector('#state-detail')?.textContent.includes('Question 501')`)
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).toBe('Question 501')
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toContain('of 501')
			await session.send('Page.navigate', { url: `${origin}/missing?demo=1` })
			await waitFor(`document.title === 'Page not found · augurScan'`)
			expect(await evaluate(`document.querySelector('#not-found').hidden`)).toBe(false)
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'canonical question identity survives network selection, section reloads, and entity selection',
	async () => {
		const firstQuestion = '7346511098237401928374'
		const secondQuestion = '8721049384720193847201'
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/question/${firstQuestion}?demo=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null) throw new Error('Missing browser response')
			if ('exceptionDetails' in response && response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
			if (!('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
			return response.result.value
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 100; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(100)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		try {
			await session.send('Runtime.enable')
			await session.send('Page.enable')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`new URL(location.href).searchParams.get('chainId') === '1' && document.querySelector('#state-detail')?.getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).toContain('ETH/USD reference price')
			const overviewForkCount = await evaluate(`[...document.querySelectorAll('#state-detail .metric-card')].find(card => card.querySelector('span')?.textContent === 'Universe forks')?.querySelector('strong')?.textContent`)
			expect(overviewForkCount).toBe('1')
			await evaluate(`document.querySelector('.entity-detail-tabs a[href*="tab=usage"]').click()`)
			await waitFor(`new URL(location.href).searchParams.get('tab') === 'usage' && document.querySelector('#state-detail h4')?.textContent === 'Protocol usage'`)
			expect(await evaluate(`[...document.querySelectorAll('#state-detail .static-field')].find(field => field.querySelector('span')?.textContent === 'Universe forks using this question')?.querySelector('code')?.textContent`)).toBe(overviewForkCount)
			const usageUrl = await evaluate(`location.href`)
			await session.send('Page.navigate', { url: String(usageUrl) })
			await waitFor(`document.querySelector('#state-detail')?.getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.querySelector('.entity-detail-tabs a[aria-current="page"]')?.textContent`)).toBe('Usage')
			expect(await evaluate(`document.querySelector('#state-detail h4')?.textContent`)).toBe('Protocol usage')
			await evaluate(`document.querySelector('.entity-row[data-key="1:${secondQuestion}"]')?.click()`)
			await waitFor(`location.pathname === '/question/${secondQuestion}'`)
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).toContain('2030 global mean temperature')
			await evaluate(`document.querySelector('#global-network-filter').value = '11155111'; document.querySelector('#global-network-filter').dispatchEvent(new Event('change', { bubbles: true }))`)
			await waitFor(`new URL(location.href).searchParams.get('chainId') === '11155111' && document.querySelector('#state-detail')?.getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.querySelector('#state-detail')?.textContent`)).toContain('Entity not found in this network.')
			await session.send('Page.navigate', { url: `${origin}/universe/4102938471029384710293847?demo=1` })
			await waitFor(`new URL(location.href).searchParams.get('chainId') === '1' && document.querySelector('#state-detail')?.getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.querySelector('#state-detail')?.textContent`)).toContain('4102938471029384710293847')
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).not.toBe('Genesis universe')
		} finally {
			await session.close()
		}
	},
	30_000,
)
