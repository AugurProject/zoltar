import { expect } from 'bun:test'
import { evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { address } from '../operations/fixture.ts'
import { manualOperationFixture } from '../runtime/manual-operation-fixture.ts'
import { browserTest } from '../support/chromium.ts'
import { startManualOperationDashboardSession } from '../support/manual-operation-dashboard.ts'

browserTest(
	'REP/WETH top-up catalog and bounded preview at desktop and mobile widths',
	async () => {
		const id = 'trading.genesis-uniswap.add-liquidity'
		const fixture = manualOperationFixture(id)
		fixture.configuration.settings.strategy.minimumRepReserveAttoRep = 0n
		fixture.scan.snapshot.genesisUniswap = { factory: true, initialized: true, liquidity: '1', pool: address(41), proxy: true, seeder: true }
		fixture.state.evaluations = evaluateOperationCatalog(fixture.scan.snapshot, planningOptions(fixture.configuration.settings, 7))
		const { capture, dashboard, session, waitFor } = await startManualOperationDashboardSession(fixture)
		try {
			for (const viewport of [
				{ width: 1440, height: 900, label: 'desktop' },
				{ width: 390, height: 844, label: 'mobile' },
			]) {
				await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
				await session.send('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
				await waitFor("document.querySelectorAll('#catalog-rows > details').length === 4")
				await session.evaluate("window.qaErrors = []; window.addEventListener('error', event => window.qaErrors.push(event.message)); window.addEventListener('unhandledrejection', event => window.qaErrors.push(String(event.reason)));")
				await session.evaluate('document.querySelector(\'#catalog-rows [data-ecosystem="trading"] summary\').click()')
				await session.evaluate(`document.querySelector('[data-operation-id="${id}"]').scrollIntoView({ block: 'center' })`)
				await capture(`${viewport.label}-top-up-catalog`)
				await session.evaluate(`[...document.querySelectorAll('.operation-open')].find(button => button.closest('tr')?.dataset.operationId === '${id}').click()`)
				await waitFor("document.querySelector('#operation-dialog fieldset')?.disabled === false")
				expect(await session.evaluate("document.querySelector('#operation-dialog').textContent")).toContain('Add genesis REP/WETH liquidity')
				await capture(`${viewport.label}-top-up-inputs`)
				await session.evaluate("document.querySelector('#operation-dialog .operation-actions button').click()")
				await waitFor("document.querySelector('#operation-dialog').textContent.includes('Add REP/WETH liquidity')")
				expect(await session.evaluate("document.querySelector('#operation-dialog').textContent")).toContain('Approve genesis token')
				expect(await session.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true)
				await capture(`${viewport.label}-top-up-preview`)
				expect(await session.evaluate('window.qaErrors')).toEqual([])
			}
		} finally {
			await session.close()
			dashboard.stop(true)
		}
	},
	180_000,
)
