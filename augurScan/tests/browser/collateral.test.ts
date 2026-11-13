import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

for (const symbol of ['USDC', 'USDT'])
	for (const viewport of qaViewports)
		browserTest(`${symbol} pool accounting keeps token units at ${viewport.width}px`, async () => {
			await withBrowserPage(`${origin}/system?demo=1&chainId=1&tab=pools&collateral=${symbol}`, viewport, async page => {
				await page.waitFor(`document.querySelector('#entity-list .entity-row') !== null`)
				await page.evaluate(`document.querySelector('#entity-list .entity-row').click()`)
				await page.waitFor(`document.querySelector('#state-detail')?.textContent.includes('Pool accounting history')`)
				const detail = String(await page.evaluate(`document.querySelector('#state-detail')?.textContent`))
				expect(detail).toContain(`241.82 ${symbol}`)
				expect(detail).toContain(`19.64 REP/${symbol}`)
				expect(detail).toContain(`Collateral, commitments, and fees are shown in ${symbol}.`)
				expect(await page.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true)
				expect(page.issues).toEqual([])
			})
		})
