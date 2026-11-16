import { expect } from 'bun:test'
import { evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { uniswapActionsFixture } from '../operations/uniswap-fixture.ts'
import { manualOperationFixture } from '../runtime/manual-operation-fixture.ts'
import { browserTest } from '../support/chromium.ts'
import { startManualOperationDashboardSession } from '../support/manual-operation-dashboard.ts'

browserTest(
	'Uniswap swaps, recovery and ranged positions at desktop and mobile widths',
	async () => {
		const actions = ['trading.uniswap.swap-rep-for-weth', 'trading.uniswap.swap-weth-for-rep', 'trading.uniswap.remove-liquidity', 'trading.uniswap.collect-fees', 'trading.uniswap.mint-range']
		const fixture = manualOperationFixture(actions[0])
		fixture.configuration.settings.submission.mode = 'private'
		fixture.configuration.settings.strategy.minimumRepReserveAttoRep = 0n
		const uniswap = uniswapActionsFixture().universeUniswap
		if (uniswap === undefined) throw new Error('Uniswap fixture missing')
		fixture.scan.snapshot.universeUniswap = uniswap
		fixture.configuration.settings.strategy.selectableOperationAllowlist = actions
		fixture.state.evaluations = evaluateOperationCatalog(fixture.scan.snapshot, planningOptions(fixture.configuration.settings, 7))
		const { capture, dashboard, session, waitFor } = await startManualOperationDashboardSession(fixture)
		try {
			for (const viewport of [
				{ width: 1440, height: 900, label: 'desktop' },
				{ width: 390, height: 844, label: 'mobile' },
			]) {
				await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
				for (const id of actions) {
					await session.send('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
					await waitFor("document.querySelectorAll('#catalog-rows > details').length === 4")
					await session.evaluate("window.qaErrors = []; window.addEventListener('error', event => window.qaErrors.push(event.message)); window.addEventListener('unhandledrejection', event => window.qaErrors.push(String(event.reason)));")
					await session.evaluate('document.querySelector(\'#catalog-rows [data-ecosystem="trading"] summary\').click()')
					await session.evaluate(`document.querySelector('[data-operation-id="${id}"]').scrollIntoView({ block: 'center' })`)
					await capture(`${viewport.label}-${id}-catalog`)
					await session.evaluate(`[...document.querySelectorAll('.operation-open')].find(button => button.closest('tr')?.dataset.operationId === '${id}').click()`)
					await waitFor("document.querySelector('#operation-dialog fieldset')?.disabled === false")
					expect(await session.evaluate("document.querySelector('#operation-dialog').textContent")).toContain(fixture.state.evaluations.find(candidate => candidate.definition.id === id)?.definition.label ?? 'Missing action')
					await capture(`${viewport.label}-${id}-inputs`)
					await session.evaluate("document.querySelector('#operation-dialog .operation-actions button').click()")
					try {
						await waitFor("document.querySelector('#operation-dialog').textContent.includes('Transaction preview')")
					} catch (error) {
						throw new Error(`${String(error)}: ${await session.evaluate("document.querySelector('#operation-dialog').textContent")}`)
					}
					await waitFor("document.querySelector('#operation-dialog .operation-actions button:nth-child(2)').disabled === false")
					expect(await session.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth')).toBe(true)
					await capture(`${viewport.label}-${id}-preview`)
					expect(await session.evaluate('window.qaErrors')).toEqual([])
				}
			}
		} finally {
			await session.close()
			dashboard.stop(true)
		}
	},
	180_000,
)
