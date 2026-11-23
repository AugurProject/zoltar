import { expect } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'
import { browserTest, desktopViewport, origin, qaViewports } from './browser-test.ts'

for (const viewport of qaViewports)
	browserTest(
		`fork detail shows the reporter escrow frozen by the fork at ${viewport.width}x${viewport.height}`,
		async () => {
			await withBrowserPage(`${origin}/operations/fork/0?demo=1&chainId=1`, viewport, async ({ evaluate, waitFor }) => {
				await waitFor(`document.querySelector('#operations-content')?.textContent.includes('Fork migration totals')`)
				const rowText = (title: string) => evaluate(`[...document.querySelectorAll('#operations-content .operations-row')].find(row => row.querySelector('strong')?.textContent === ${JSON.stringify(title)})?.textContent`)
				expect(await rowText('Security pool fork')).toContain('5 security pool fork events · 2 owners chose a branch')
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

const interruptedPoolHistoryUrl = `${origin}/pool/0x9999999999999999999999999999999999999999?demo=1&chainId=1&tab=history&riskHistoryMore=1&riskHistoryAppendError=1&riskHistoryAppendDelay=1`

for (const viewport of qaViewports)
	browserTest(
		`pool history restores focus after a failed page and can retry at ${viewport.width}x${viewport.height}`,
		async () => {
			await withBrowserPage(interruptedPoolHistoryUrl, viewport, async ({ evaluate, waitFor }) => {
				const pager = 'document.querySelector(".operations-history-more")'
				const panel = 'document.querySelector("#operations-risk-history-coverage")'
				await waitFor(pager)
				await evaluate(`${pager}.focus(); ${pager}.click()`)
				await waitFor(`${pager}?.disabled && ${pager}?.getAttribute('aria-busy') === 'true'`)
				await waitFor(`${panel}?.textContent.includes('Older pool evidence could not be loaded.')`)
				expect(await evaluate(`document.activeElement === ${pager} && !${pager}.disabled && !${pager}.hasAttribute('aria-busy')`)).toBe(true)
				expect(await evaluate(`${pager}.getAttribute('aria-label')`)).toBe('Retry older pool risk history')
				const status = `${panel}.querySelector('.operations-history-status')`
				expect(await evaluate(`${pager}.getBoundingClientRect().bottom <= ${status}.getBoundingClientRect().top`)).toBe(true)
				await evaluate(`${pager}.click()`)
				await waitFor(`document.querySelector('#operations-content')?.textContent.includes('EscalationGameSet') && !${pager}`)
				expect(await evaluate("document.activeElement?.classList.contains('operations-history-complete')")).toBe(true)
				expect(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true)
			})
		},
		30_000,
	)

browserTest(
	'a failed history page leaves focus on the tab the user moved to while loading',
	async () => {
		await withBrowserPage(interruptedPoolHistoryUrl, desktopViewport, async ({ evaluate, waitFor }) => {
			const pager = 'document.querySelector(".operations-history-more")'
			const tab = 'document.querySelector(".entity-detail-tabs a[data-detail-tab=history]")'
			await waitFor(pager)
			await evaluate(`${pager}.focus(); ${pager}.click(); ${tab}.focus()`)
			await waitFor(`${pager}?.textContent === 'Retry older pool risk history'`)
			expect(await evaluate(`document.activeElement === ${tab}`)).toBe(true)
		})
	},
	30_000,
)
