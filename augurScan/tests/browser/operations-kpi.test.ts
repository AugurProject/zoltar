import { expect, test } from 'bun:test'
import { withBrowserPage } from '../../../tooling/ui/browserSmoke.mts'

const origin = process.env['AUGURSCAN_BROWSER_URL']
const browserTest = origin === undefined ? test.skip : test

for (const viewport of [
	{ width: 1440, height: 900 },
	{ width: 390, height: 844 },
]) {
	browserTest(
		`Operations KPI subtitles and empty states identify the bounded catalog sample at ${viewport.width}px`,
		async () => {
			await withBrowserPage(
				`${origin}/operations?demo=1&chainId=1&operationsKpiCapped=1`,
				viewport,
				async session => {
					const { evaluate } = session
					for (let attempt = 0; attempt < 100; attempt++) {
						if (await evaluate(`document.querySelector('.operations-metrics .operations-card')?.textContent.includes('OpenOracle reports')`)) break
						await Bun.sleep(100)
					}
					const reports = String(await evaluate(`[...document.querySelectorAll('.operations-metrics .operations-card')].find(card => card.querySelector('span')?.textContent === 'OpenOracle reports')?.textContent`))
					const escalations = String(await evaluate(`[...document.querySelectorAll('.operations-metrics .operations-card')].find(card => card.querySelector('span')?.textContent === 'Escalation games')?.textContent`))
					const auctions = String(await evaluate(`[...document.querySelectorAll('.operations-metrics .operations-card')].find(card => card.querySelector('span')?.textContent === 'Truth auctions')?.textContent`))
					expect(reports).toContain('251')
					expect(reports).toContain('0 settleable among 250 shown')
					expect(escalations).toContain('251')
					expect(auctions).toContain('251')
					expect(auctions).toContain('0 open among 250 shown')
					const panels = String(await evaluate(`document.querySelector('.operations-grid')?.textContent`))
					expect(panels).toContain('No reports need attention among 250 shown.')
					expect(panels).toContain('No active escalation games among 250 shown.')
					expect(panels).toContain('No active auctions among 250 shown.')
				},
				{ exceptions: 'ignore' },
			)
		},
		20_000,
	)
}
