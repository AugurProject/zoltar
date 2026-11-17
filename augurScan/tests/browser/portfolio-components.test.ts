import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, origin, qaViewports } from './browser-test.ts'

for (const viewport of qaViewports)
	browserTest(
		`fork detail shows the reporter escrow frozen by the fork at ${viewport.width}x${viewport.height}`,
		async () => {
			await withBrowserPage(`${origin}/operations/fork/0?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('#operations-content')?.textContent.includes('Fork migration totals')`)
				const rowText = (title: string) => evaluate(`[...document.querySelectorAll('#operations-content .operations-row')].find(row => row.querySelector('strong')?.textContent === ${JSON.stringify(title)})?.textContent`)
				expect(await rowText('Portfolio fork')).toContain('5 portfolio fork events · 2 owners chose a branch')
				const reporter = await rowText('Reporter escrow')
				expect(reporter).toContain('1,200 REP live escrow migrates')
				expect(reporter).toContain('300 REP of finalized games stays with the parent')
				expect(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true)
			})
		},
		30_000,
	)
for (const viewport of qaViewports)
	browserTest(
		`report detail lists the escrow's completion among the coordinator decisions at ${viewport.width}x${viewport.height}`,
		async () => {
			await withBrowserPage(`${origin}/operations/report/0x1111111111111111111111111111111111111111/3912?demo=1&chainId=1&tab=evidence`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('#operations-content')?.textContent.includes('Coordinator decisions')`)
				const decisions = await evaluate(`[...document.querySelectorAll('#operations-content .operations-panel')].find(panel => panel.querySelector('h3')?.textContent === 'Coordinator decisions')?.textContent`)
				expect(decisions).toContain('ReportCompleted')
				expect(decisions).toContain('Escrow settled the report; the feed rejected its price')
				expect(decisions).toContain('PriceReportRejected')
				expect(await evaluate(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true)
			})
		},
		30_000,
	)
