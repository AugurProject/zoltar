import { expect, test } from 'bun:test'
import { createDevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]) {
	browserTest(
		`returning to the page refreshes status and retries automatically at ${viewport.width}px`,
		async () => {
			const session = await createDevToolsSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium', `${origin}/?demo=1`, viewport)
			const evaluate = async (expression: string): Promise<unknown> => {
				const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
				if (typeof response !== 'object' || response === null) throw new Error('Missing browser response')
				if ('exceptionDetails' in response) throw new Error(JSON.stringify(response.exceptionDetails))
				if (!('result' in response) || typeof response.result !== 'object' || response.result === null || !('value' in response.result)) return undefined
				return response.result.value
			}
			const waitFor = async (expression: string) => {
				for (let attempt = 0; attempt < 100; attempt++) {
					if (await evaluate(expression)) return
					await Bun.sleep(50)
				}
				throw new Error(`Timed out: ${expression}`)
			}
			const capture = async (state: string) => {
				const directory = process.env['AUGURSCAN_QA_SCREENSHOTS']
				if (directory === undefined) return
				const result = await session.send('Page.captureScreenshot', { format: 'png' })
				if (typeof result !== 'object' || result === null || !('data' in result) || typeof result.data !== 'string') throw new Error('Missing screenshot')
				await Bun.write(`${directory}/status-${viewport.width}-${state}.png`, Buffer.from(result.data, 'base64'))
			}
			try {
				await session.send('Page.enable')
				await session.send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
				await session.send('Page.navigate', { url: session.pageUrl })
				await waitFor(`sessionStorage.getItem('augurscan:network-status:v1') !== null`)
				// Use the maintained demo network fixture with real browser request orchestration.
				await session.send('Page.addScriptToEvaluateOnNewDocument', {
					source: `
				const fixture = JSON.parse(sessionStorage.getItem('augurscan:network-status:v1'));
				window.networkMode = 'current';
				window.runtimeErrors = [];
				addEventListener('error', event => window.runtimeErrors.push(event.message));
				addEventListener('unhandledrejection', event => window.runtimeErrors.push(String(event.reason)));
				window.EventSource = new Proxy(EventSource, { construct() {
					const source = Object.assign(new EventTarget(), { readyState: 1, close() {} });
					window.testStream = source;
					return source;
				} });
				window.networkRequests = 0;
				window.pendingNetworks = [];
				window.testHidden = false;
				Object.defineProperty(document, 'hidden', { get: () => window.testHidden });
				window.changeVisibility = (hidden) => { window.testHidden = hidden; document.dispatchEvent(new Event('visibilitychange')); };
				const interval = window.setInterval;
				window.setInterval = (callback, delay, ...args) => {
					if (delay === 12000) { window.pollStatus = callback; return 0; }
					return interval(callback, delay, ...args);
				};
				window.fetch = async (path) => {
					if (!String(path).startsWith('/api/v1/networks')) return Response.json({ items: [] }, { status: window.routeFails ? 503 : 200 });
					window.networkRequests++;
					if (window.networkMode === 'pending') await new Promise(resolve => window.pendingNetworks.push(resolve));
					if (window.networkMode === 'failure') return Response.json({}, { status: 503 });
					const timestamp = new Date(Date.now() - (window.networkMode === 'stale' ? 7200000 : 1000)).toISOString();
					return Response.json({ items: fixture.items.map(item => ({ ...item, indexed_timestamp: timestamp, last_success_at: new Date().toISOString() })) });
				};
			`,
				})
				await session.send('Page.navigate', { url: `${origin}/?chainId=1` })
				await waitFor(`!!window.pollStatus && !!document.querySelector('.network-card')`)
				await evaluate(`window.networkMode = 'pending'; window.changeVisibility(true); window.changeVisibility(false)`)
				await waitFor(`window.pendingNetworks.length > 0`)
				expect(await evaluate(`document.querySelector('#freshness-title').textContent`)).toBe('Refreshing status…')
				expect(await evaluate(`document.querySelectorAll('#refresh-stale, #detail-canonical-retry').length`)).toBe(0)
				expect(await evaluate(`document.querySelector('.network-card .badge').textContent`)).toBe('refreshing')
				await capture('refreshing')
				await evaluate(`window.networkMode = 'failure'; window.pendingNetworks.splice(0).forEach(resolve => resolve())`)
				await waitFor(`document.querySelector('#freshness-title').textContent === 'Unable to refresh status'`)
				expect(await evaluate(`document.querySelectorAll('#refresh-stale, #detail-canonical-retry').length`)).toBe(0)
				await capture('failed')
				await evaluate(`window.networkMode = 'current'; window.pollStatus()`)
				await waitFor(`document.querySelector('#freshness-banner').hidden && document.querySelector('.network-card .badge').textContent !== 'refreshing'`)
				await capture('current')
				// A response started before resuming must not clear the pending status.
				await evaluate(`window.networkMode = 'pending'; window.pollStatus()`)
				await waitFor(`window.pendingNetworks.length === 1`)
				await evaluate(`window.changeVisibility(true); window.changeVisibility(false); window.pendingNetworks.shift()()`)
				await waitFor(`window.pendingNetworks.length === 1`)
				expect(await evaluate(`document.querySelector('#freshness-title').textContent`)).toBe('Refreshing status…')
				await evaluate(`window.networkMode = 'current'; window.pendingNetworks.shift()()`)
				await waitFor(`document.querySelector('#freshness-banner').hidden`)
				const requests = await evaluate(`window.networkRequests`)
				await evaluate(`window.changeVisibility(true); window.pollStatus()`)
				expect(await evaluate(`window.networkRequests`)).toBe(requests)
				await evaluate(`window.networkMode = 'stale'; window.changeVisibility(true); window.changeVisibility(false)`)
				await waitFor(
					`document.querySelector('#freshness-title').textContent === 'RPC chain head is stale' && !document.querySelector('#freshness-banner').hidden`,
				)
				await capture('stale')
				expect(await evaluate(`document.documentElement.scrollWidth <= innerWidth`)).toBe(true)
				await evaluate(`window.networkMode = 'current'; dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))`)
				await waitFor(`document.querySelector('#freshness-banner').hidden`)
				await evaluate(
					`window.routeFails = true; window.testStream.dispatchEvent(new MessageEvent('reorg', { data: JSON.stringify({ chainId: 1, depth: 1, reason: 'chain-reorg' }) }))`,
				)
				await waitFor(`document.querySelector('#freshness-title').textContent === 'Chain update refresh incomplete'`)
				expect(await evaluate(`document.querySelector('#freshness-detail').textContent`)).toContain('Retrying automatically.')
				expect(await evaluate(`[...document.querySelectorAll('button')].some(button => button.textContent === 'Retry now')`)).toBe(false)
				await capture('canonical-failed')
				await evaluate(`window.routeFails = false; window.pollStatus()`)
				await waitFor(`document.querySelector('#freshness-banner').hidden`)
				expect(await evaluate(`window.runtimeErrors`)).toEqual([])
			} finally {
				await session.close()
			}
		},
		30_000,
	)
}
