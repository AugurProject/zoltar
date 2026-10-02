import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, origin } from './browser-test.ts'

browserTest(
	'navigation closes the account dialog, focuses a rendered heading, and keeps route filters on their own route',
	async () => {
		await withBrowserPage(`${origin}/richlist?demo=1&chainId=1&view=cards`, desktopViewport, async session => {
			const { evaluate, waitFor } = session
			await waitFor(`document.querySelector('.rich-transactions') !== null`)
			await evaluate(`document.querySelector('.rich-transactions').focus(); document.querySelector('.rich-transactions').click()`)
			await waitFor(`document.querySelector('#detail-dialog').open && document.querySelector('#detail-content .account-transaction a.explorer-link') !== null`)
			await evaluate(`document.querySelector('#close-detail').click()`)
			await waitFor(`!document.querySelector('#detail-dialog').open`)
			expect(await evaluate(`document.activeElement?.classList.contains('rich-transactions')`)).toBe(true)
			await evaluate(`document.querySelector('.rich-transactions').click()`)
			await waitFor(`document.querySelector('#detail-dialog').open && document.querySelector('#detail-content .account-transaction a.explorer-link') !== null`)
			await evaluate(`document.querySelector('#detail-content .account-transaction a.explorer-link').click()`)
			await waitFor(`location.pathname.startsWith('/tx/') && document.querySelector('#explorer-content h2') !== null`)
			expect(await evaluate(`document.querySelector('#detail-dialog').open`)).toBe(false)
			await waitFor(`document.activeElement === document.querySelector('#explorer-content h2')`)

			await session.send('Page.navigate', { url: `${origin}/operations/risk?demo=1&chainId=1` })
			await waitFor(`document.querySelector('#operations-content a.operations-row[href^="/pool/"]') !== null`)
			await evaluate(`document.querySelector('#operations-content a.operations-row[href^="/pool/"]').click()`)
			await waitFor(`location.pathname.startsWith('/pool/') && document.querySelector('#operations-content .operations-detail-header h2') !== null`)
			await waitFor(`document.activeElement === document.querySelector('#operations-content .operations-detail-header h2')`)
			expect(await evaluate(`document.activeElement.getClientRects().length > 0`)).toBe(true)
			await evaluate(`[...document.querySelectorAll('.product-nav a')].find(link => new URL(link.href).pathname === '/operations').click()`)
			await waitFor(`location.pathname === '/operations'`)

			await session.send('Page.navigate', { url: `${origin}/?demo=1&chainId=1&event=Transfer` })
			await waitFor(`document.querySelector('#feed').getAttribute('aria-busy') === 'false'`)
			await evaluate(`[...document.querySelectorAll('.product-nav a')].find(link => new URL(link.href).pathname === '/operations').click()`)
			await waitFor(`location.pathname === '/operations'`)
			expect(await evaluate(`new URL(location.href).searchParams.has('event')`)).toBe(false)
			expect(await evaluate(`new URL(location.href).searchParams.get('chainId')`)).toBe('1')
		})
	},
	60_000,
)

browserTest(
	'search, the skip link, live time labels, and the registry search keep working while the page updates',
	async () => {
		await withBrowserPage(`${origin}/?demo=1&chainId=1`, desktopViewport, async session => {
			const { evaluate, waitFor } = session
			await waitFor(`document.querySelector('.log-row .cell-time .activity-age') !== null`)
			await Bun.sleep(2_200)
			expect(await evaluate(`[...document.querySelectorAll('.log-row .cell-time')].every(cell => cell.children.length === 2 && cell.querySelector('.activity-age') !== null)`)).toBe(true)
			await evaluate(`document.querySelector('.skip-link').click()`)
			expect(await evaluate(`location.hash`)).toBe('')
			expect(await evaluate(`document.querySelector('#activity').contains(document.activeElement)`)).toBe(true)
			await evaluate(`document.querySelector('#global-search-input').value = '23184711'; document.querySelector('#global-search-input').dispatchEvent(new Event('input', { bubbles: true }))`)
			await waitFor(`document.querySelector('#global-search-results a') !== null`)
			expect(await evaluate(`document.querySelector('#global-search-results [role="status"]')?.textContent`)).toContain('result')
			await evaluate(`document.querySelector('#activity-heading').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`)
			expect(await evaluate(`document.querySelector('#global-search-results').hidden`)).toBe(true)
			await evaluate(`document.querySelector('#global-search').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`)
			await waitFor(`location.pathname === '/block/23184711' && document.querySelector('#explorer-content .static-grid') !== null`)

			await session.send('Page.navigate', { url: `${origin}/system?demo=1&chainId=1` })
			await waitFor(`document.querySelector('.entity-row') !== null && !document.querySelector('#entity-search').disabled`)
			await evaluate(`document.querySelector('#entity-search').focus(); document.querySelector('#entity-search').value = 'pool'; document.querySelector('#entity-search').dispatchEvent(new Event('input', { bubbles: true }))`)
			await Bun.sleep(350)
			expect(await evaluate(`document.activeElement?.id`)).toBe('entity-search')
			expect(await evaluate(`document.querySelector('#entity-search').disabled`)).toBe(false)
			await waitFor(`document.querySelector('#entity-list').getAttribute('aria-busy') === 'false'`)
			expect(await evaluate(`document.activeElement?.id`)).toBe('entity-search')
			expect(await evaluate(`document.querySelector('.entity-row[aria-selected]')`)).toBe(null)

			await session.send('Page.navigate', { url: `${origin}/operations/timeline?demo=1&chainId=1` })
			await waitFor(`document.querySelector('#operations-content form.operations-filters') !== null`)
			await evaluate(`window.qaSameDocument = true; document.querySelector('#operations-content input[name="fromBlock"]').value = 'abc'; document.querySelector('#operations-content form.operations-filters').requestSubmit()`)
			expect(await evaluate(`document.querySelector('#operations-content input[name="fromBlock"]').validationMessage`)).toBe('Enter a whole non-negative block number')
			expect(await evaluate(`new URL(location.href).searchParams.has('fromBlock')`)).toBe(false)
			await evaluate(`document.querySelector('#operations-content input[name="fromBlock"]').value = '1'; document.querySelector('#operations-content input[name="fromBlock"]').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#operations-content form.operations-filters').requestSubmit()`)
			await waitFor(`new URL(location.href).searchParams.get('fromBlock') === '1'`)
			expect(await evaluate(`window.qaSameDocument === true`)).toBe(true)
			expect(await evaluate(`[...new URL(location.href).searchParams.values()].every(value => value !== '')`)).toBe(true)

			await session.send('Page.navigate', { url: `${origin}/?demo=1&chainId=999` })
			await waitFor(`document.querySelector('#network-notice') !== null`)
			expect(await evaluate(`document.querySelector('#network-notice span').textContent`)).toContain('Chain 999 is not indexed by this scanner')
			await evaluate(`document.querySelector('#network-notice button').click()`)
			expect(await evaluate(`document.querySelector('#network-notice')`)).toBe(null)
		})
	},
	60_000,
)
