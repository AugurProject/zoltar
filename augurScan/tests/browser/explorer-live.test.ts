import { expect, test } from 'bun:test'
import { createDevToolsSession } from '../../../tooling/ui/browserSmoke.mts'

const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

browserTest(
	'a reorg refreshes visible transaction evidence',
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
			for (let attempt = 0; attempt < 90; attempt++) {
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
			const transactionPath = await evaluate(`document.querySelector('.log-row .cell-tx').getAttribute('href')`)
			if (typeof transactionPath !== 'string') throw new Error('Missing demo transaction')
			const transactionUrl = new URL(transactionPath, origin)
			transactionUrl.searchParams.set('streamDemo', '1')
			transactionUrl.searchParams.set('reorgDemo', '1')
			await session.send('Page.navigate', { url: transactionUrl.href })
			await waitFor(`document.querySelector('#explorer-content .static-grid') !== null`)
			await evaluate(`window.qaExplorerRefreshes = 0; new MutationObserver(() => window.qaExplorerRefreshes++).observe(document.querySelector('#explorer-content'), { childList: true })`)
			await waitFor(`window.qaExplorerRefreshes > 0`)
			expect(await evaluate(`document.querySelector('#explorer-content .static-grid') !== null`)).toBe(true)
			await waitFor(`document.querySelector('#freshness-banner').hidden`)
		} finally {
			await session.close()
		}
	},
	20_000,
)
