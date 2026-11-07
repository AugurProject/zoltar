import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

for (const viewport of qaViewports) {
	browserTest(
		`failed question reads suppress stale metrics in summary and risk details at ${viewport.width}px`,
		async () => {
			await withBrowserPage(`${origin}/pool/0x9999999999999999999999999999999999999999?demo=1&chainId=1&poolMetrics=stale-unavailable`, viewport, async session => {
				await session.waitFor(`document.querySelector('.operations-metrics')?.textContent.includes('Question settlement value')`)
				const summary = String(await session.evaluate(`document.querySelector('.operations-metrics')?.textContent`))
				expect(summary).toContain('Question settlement valueUnavailable')
				expect(summary).not.toContain('42 ETH')
				const details = String(await session.evaluate(`[...document.querySelectorAll('.operations-panel')].find(panel => panel.textContent?.includes('Current risk state'))?.textContent`))
				expect(details).toContain('Tagged pool read unavailable')
				expect(details).not.toContain('42 ETH')
				expect(details).not.toContain('0.7 ETH')
				expect(details).not.toContain('60 shares')
				expect(details).not.toContain('250%')
			})
		},
		20_000,
	)
}
