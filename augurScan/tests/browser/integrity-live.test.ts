import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, mobileViewport, origin, qaViewports, writeScreenshot } from './browser-test.ts'

browserTest(
	'integrity history ignores block bursts, refreshes periodically, and refreshes after reorgs',
	async () => {
		await withBrowserPage(`${origin}/operations/integrity?demo=1&chainId=1&streamDemo=1&burstDemo=1&integrityCombinedCauses=1`, desktopViewport, async session => {
			await session.waitFor(`document.querySelector('#operations-content .operations-row') !== null`)
			await session.evaluate(`window.qaIntegrityRefreshes = 0; new MutationObserver(records => {
			window.qaIntegrityRefreshes += records.filter(record => record.attributeName === 'aria-busy').length
		}).observe(document.querySelector('#operations-content'), { attributes: true })`)
			await session.evaluate(`new Promise(resolve => setTimeout(resolve, 5000))`)
			expect(await session.evaluate('window.qaIntegrityRefreshes')).toBe(0)
			await session.waitFor('window.qaIntegrityRefreshes > 0', { attempts: 100 })
			await session.waitFor(`document.querySelector('#operations-content').getAttribute('aria-busy') === 'false'`)
			await writeScreenshot(session, '/tmp/augurscan-integrity-desktop.png')
			await session.evaluate(`[...document.querySelectorAll('.operations-panel')].find(panel => panel.textContent.includes('Selected-chain replacements')).scrollIntoView({ block: 'start' })`)
			await writeScreenshot(session, '/tmp/augurscan-integrity-desktop-evidence.png')
			expect(session.issues).toEqual([])
		})
		await withBrowserPage(`${origin}/operations/integrity?demo=1&chainId=1&streamDemo=1&reorgDemo=1&integrityCombinedCauses=1`, mobileViewport, async session => {
			await session.waitFor(`document.querySelector('#operations-content .operations-row') !== null`)
			await session.evaluate(`window.qaIntegrityRefreshes = 0; new MutationObserver(records => {
			window.qaIntegrityRefreshes += records.filter(record => record.attributeName === 'aria-busy').length
		}).observe(document.querySelector('#operations-content'), { attributes: true })`)
			await session.waitFor('window.qaIntegrityRefreshes > 0')
			await session.waitFor(`document.querySelector('#freshness-banner').hidden && document.querySelector('#operations-content').getAttribute('aria-busy') === 'false'`)
			await writeScreenshot(session, '/tmp/augurscan-integrity-mobile.png')
			await session.evaluate(`[...document.querySelectorAll('.operations-panel')].find(panel => panel.textContent.includes('Selected-chain replacements')).scrollIntoView({ block: 'start' })`)
			await writeScreenshot(session, '/tmp/augurscan-integrity-mobile-evidence.png')
			expect(session.issues).toEqual([])
		})
	},
	30_000,
)

browserTest(
	'integrity loading, empty and failure states remain usable at both viewports',
	async () => {
		for (const viewport of qaViewports) {
			for (const state of ['loading', 'empty', 'error']) {
				const scenario = state === 'empty' ? 'catalogEmpty=1' : `state=${state}`
				await withBrowserPage(`${origin}/operations/integrity?demo=1&chainId=1&${scenario}`, viewport, async session => {
					await session.waitFor(state === 'loading' ? `document.querySelector('#operations-content').getAttribute('aria-busy') === 'true' && document.querySelector('#operations-status').textContent.includes('Loading')` : `document.querySelector('#operations-content').getAttribute('aria-busy') === 'false'`)
					if (state === 'error') expect(await session.evaluate(`document.querySelector('#operations-status button') !== null`)).toBe(true)
					if (state === 'empty') expect(await session.evaluate(`document.querySelector('#operations-content').textContent.includes('No')`)).toBe(true)
					expect(await session.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
					await writeScreenshot(session, `/tmp/augurscan-integrity-${state}-${viewport.width}.png`)
					expect(session.issues).toEqual([])
				})
			}
		}
	},
	30_000,
)
