import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, origin } from './browser-test.ts'

browserTest(
	'a reorg refreshes visible transaction evidence',
	async () => {
		await withBrowserPage(
			`${origin}/?demo=1`,
			desktopViewport,
			async session => {
				const { evaluate, waitFor } = session
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
			},
			{ attempts: 90 },
		)
	},
	20_000,
)
