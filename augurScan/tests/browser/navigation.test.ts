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
			expect(await evaluate(`document.querySelector('.log-row .cell-time').scrollWidth <= document.querySelector('.log-row .cell-time').clientWidth`)).toBe(true)
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
			await evaluate(`document.querySelector('#explorer-content .explorer-evidence-row a[href*="log="]').click()`)
			await waitFor(`location.pathname === '/' && location.search.includes('log=') && document.querySelector('.log-row') !== null`)
			await waitFor(`document.querySelector('.event-detail-drawer')?.dataset.triggerKey === new URL(location.href).searchParams.get('log') && document.querySelector('.event-detail-content')?.getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.querySelectorAll('.event-detail-drawer').length`)).toBe(1)
			await evaluate(`history.back()`)
			await waitFor(`location.pathname.startsWith('/tx/') && document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`document.querySelector('#explorer-content a[href*="/block/"]').click()`)
			await waitFor(`location.pathname.startsWith('/block/') && document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`history.back()`)
			await waitFor(`location.pathname.startsWith('/tx/') && document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`document.querySelector('#global-network-filter').value = '11155111'; document.querySelector('#global-network-filter').dispatchEvent(new Event('change', { bubbles: true }))`)
			await waitFor(`location.search.includes('chainId=11155111') && document.querySelector('#explorer-content h2')?.textContent === 'Evidence unavailable'`)
			await session.send('Page.navigate', { url: `${origin}/block/23184711?demo=1&chainId=1&block251=1` })
			await waitFor(`document.querySelector('#explorer-content h3')?.textContent === 'First 250 transactions'`)
			expect(await evaluate(`document.querySelector('#explorer-content .data-note')?.textContent`)).toContain('More indexed transactions')
			await session.send('Page.navigate', { url: `${origin}/operations?demo=1&chainId=1` })
			await waitFor(`document.querySelector('#operations-content')?.textContent.includes('Vault position')`)
			expect(await evaluate(`document.querySelector('#operations-content')?.textContent.includes('health 113.5%')`)).toBe(true)
			await session.send('Page.navigate', { url: `${origin}/richlist?demo=1` })
			await waitFor(`document.querySelector('.data-table tbody tr') !== null`)
			expect(await evaluate(`document.querySelector('.data-table tbody tr td:nth-child(2)')?.textContent`)).toBe('912.000000000000000001 REP · 0x2216…c9bb')
			await evaluate(`const createObjectURL = URL.createObjectURL.bind(URL); URL.createObjectURL = blob => { window.exportedCsv = blob.text(); return createObjectURL(blob) }; document.querySelector('.data-table-toolbar button').click()`)
			expect(await evaluate(`window.exportedCsv`)).toContain('912.000000000000000001 REP')
			expect(await evaluate(`document.querySelector('#richlist-table').hidden === false && document.querySelector('#richlist-shell').hidden === true`)).toBe(true)
			await evaluate(`document.querySelector('#rich-view-toggle').click()`)
			expect(await evaluate(`location.search.includes('view=cards') && document.querySelector('#richlist-table').hidden && !document.querySelector('#richlist-shell').hidden`)).toBe(true)
			await session.send('Page.navigate', { url: `${origin}/question/501?demo=1&chainId=1&entity501=1` })
			await waitFor(`document.querySelector('#state-detail')?.textContent.includes('Question 501')`)
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).toBe('Question 501')
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toBe('501')
			expect(await evaluate(`document.querySelectorAll('#entity-list .entity-row[data-key="1:501"]').length`)).toBe(1)
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

browserTest(
	'the system catalog can load and find questions beyond its initial page',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&entity1201=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 1,201'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '1,000 of 1,201'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-list')?.textContent.includes('Question 1201')`)
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toContain('1,201')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 1,201'`)
			await evaluate(`document.querySelector('#entity-search').value = 'Question 1201'; document.querySelector('#entity-search').dispatchEvent(new Event('input', { bubbles: true }))`)
			await waitFor(`document.querySelectorAll('#entity-list .entity-row').length === 1 && document.querySelector('#entity-list')?.textContent.includes('Question 1201')`)
			expect(await evaluate(`document.querySelector('#entity-list .entity-row')?.textContent`)).toContain('Question 1201')
			await session.send('Page.navigate', { url: `${origin}/question/1201?demo=1&chainId=1&entity1201=1` })
			await waitFor(`document.querySelector('#state-detail .state-detail-title')?.textContent === 'Question 1201'`)
			expect(await evaluate(`document.querySelector('#state-detail .state-detail-title')?.textContent`)).toBe('Question 1201')
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'large catalogs use one catalog request per additional page',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&entity5001=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 5,001'`)
			const startedAt = Date.now()
			for (let page = 2; page <= 6; page++) {
				const previousRequests = Number(await evaluate(`window.__augurScanCatalogRequests`))
				await evaluate(`document.querySelector('#entity-load-more').click()`)
				await waitFor(`document.querySelectorAll('#entity-list .entity-row').length === ${page * 500}`)
				expect(Number(await evaluate(`window.__augurScanCatalogRequests`)) - previousRequests).toBe(1)
			}
			expect(Date.now() - startedAt).toBeLessThan(10_000)
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'the system catalog restarts pagination when an earlier entity disappears',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&entity1201=1&catalogShiftOnMore=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 1,201'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 1,200'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '1,000 of 1,200'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '1,200'`)
			const identities = await evaluate(`Array.from(document.querySelectorAll('#entity-list .entity-row'), row => row.getAttribute('data-key'))`)
			expect(identities).toEqual(Array.from({ length: 1_200 }, (_, index) => `1:${index + 2}`))
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'the system catalog restarts pagination after a same-size reorder',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&entity1201=1&catalogShiftOnMore=replace`, { width: 390, height: 844 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 1,201'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-list .entity-row')?.getAttribute('data-key') === '1:2'`)
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toBe('500 of 1,201')
			expect(await evaluate(`document.querySelectorAll('#entity-list .entity-row').length`)).toBe(500)
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'loading more restarts when an inactive catalog shifts',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&catalogDual501=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-load-more')?.disabled === false`)
			await evaluate(`document.querySelector('#tab-pools').click()`)
			await waitFor(`document.querySelector('#entity-list .entity-row')?.getAttribute('data-key') === '1:0x0000000000000000000000000000000000000002'`)
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toBe('500 of 501')
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'loading more detects an interior replacement in an inactive catalog',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=questions&catalogDual501=1&catalogInteriorReplace=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-load-more')?.disabled === false`)
			await evaluate(`document.querySelector('#tab-pools').click()`)
			await waitFor(`document.querySelector('#entity-list .entity-row:nth-child(100)')?.getAttribute('data-key') === '1:0x00000000000000000000000000000000000000c9'`)
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toBe('500 of 501')
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'pool lifecycle and checkpoints remain available after loading a later catalog page',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=pools&pool501=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
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
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			expect(await evaluate(`document.querySelector('#entity-list .entity-row:first-child .entity-row-meta')?.textContent`)).toContain('…000001')
			expect(await evaluate(`document.querySelector('#entity-list .entity-row:nth-child(2) .entity-row-meta')?.textContent`)).toContain('…000002')
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '501'`)
			await evaluate(`document.querySelector('#entity-list .entity-row:last-child')?.click()`)
			await waitFor(`document.querySelector('#state-detail')?.getAttribute('aria-busy') === 'false'`)
			const detail = String(await evaluate(`document.querySelector('#state-detail')?.textContent`))
			expect(detail).toContain('Fork migration')
			expect(detail).toContain('42')
			expect(detail).not.toContain('No lifecycle event yet')
			expect(detail).not.toContain('No checkpoint')
		} finally {
			await session.close()
		}
	},
	30_000,
)

browserTest(
	'live refresh reconciles the loaded pool page and its accounting',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=pools&pool501=1&pool501Live=1&streamDemo=1`, { width: 1440, height: 900 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
			return response.result.value
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 150; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(100)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		try {
			await session.send('Runtime.enable')
			await session.send('Page.enable')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '501'`)
			const requestsBeforeLive = Number(await evaluate(`window.__augurScanCatalogRequests`))
			const sequenceBeforeLive = Number(await evaluate(`window.__augurScanLiveSequence`))
			await evaluate(`document.querySelector('#entity-list .entity-row:last-child')?.click()`)
			await waitFor(`document.querySelector('#state-detail')?.textContent.includes('Fork migration')`)
			await waitFor(`document.querySelector('#state-detail')?.textContent.includes('Fork truth auction')`)
			const detail = String(await evaluate(`document.querySelector('#state-detail')?.textContent`))
			expect(detail).toContain('84')
			expect(detail).not.toContain('No checkpoint')
			const requestsAfterLive = Number(await evaluate(`window.__augurScanCatalogRequests`))
			const sequenceAfterLive = Number(await evaluate(`window.__augurScanLiveSequence`))
			expect(requestsAfterLive - requestsBeforeLive).toBeLessThanOrEqual(2 * (sequenceAfterLive - sequenceBeforeLive))
		} finally {
			await session.close()
		}
	},
	25_000,
)

browserTest(
	'live refresh restarts loaded catalog pages after a page-boundary shift',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=pools&pool501=1&pool501LiveShift=1&streamDemo=1`, { width: 390, height: 844 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
			return response.result.value
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 150; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(100)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		try {
			await session.send('Runtime.enable')
			await session.send('Page.enable')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '501'`)
			await waitFor(`document.querySelector('#entity-list .entity-row')?.getAttribute('data-key') === '1:0x0000000000000000000000000000000000000002'`)
			expect(await evaluate(`document.querySelector('#entity-count')?.textContent`)).toBe('500 of 501')
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '501'`)
			expect(await evaluate(`document.querySelector('#entity-list .entity-row:last-child')?.getAttribute('data-key')`)).toBe('1:0x00000000000000000000000000000000000001f6')
		} finally {
			await session.close()
		}
	},
	25_000,
)

browserTest(
	'live refresh restarts when an interior identity changes between pages',
	async () => {
		const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/system?demo=1&chainId=1&tab=pools&pool501=1&pool501LiveInterior=1&streamDemo=1`, { width: 390, height: 844 })
		const evaluate = async (expression: string): Promise<unknown> => {
			const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
			if (typeof response !== 'object' || response === null || !('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
			return response.result.value
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 150; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(100)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		try {
			await session.send('Runtime.enable')
			await session.send('Page.enable')
			await session.send('Page.navigate', { url: session.pageUrl })
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501'`)
			await evaluate(`document.querySelector('#entity-load-more').click()`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '501'`)
			await waitFor(`document.querySelector('#entity-count')?.textContent === '500 of 501' && document.querySelector('#entity-list .entity-row:nth-child(100)')?.getAttribute('data-key') === '1:0x00000000000000000000000000000000000000c9'`)
			expect(await evaluate(`document.querySelectorAll('#entity-list .entity-row').length`)).toBe(500)
		} finally {
			await session.close()
		}
	},
	25_000,
)
