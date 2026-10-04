import { expect } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { serializedSettings } from '../../src/config/settings.ts'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { address } from '../operations/fixture.ts'
import { manualOperationFixture } from '../runtime/manual-operation-fixture.ts'
import { browserTest, chromiumExecutable, startChromiumSession } from '../support/chromium.ts'

browserTest(
	'REP/WETH top-up catalog and bounded preview at desktop and mobile widths',
	async () => {
		const id = 'trading.genesis-uniswap.add-liquidity'
		const fixture = manualOperationFixture(id)
		fixture.configuration.settings.strategy.minimumRepReserveAttoRep = 0n
		fixture.scan.snapshot.genesisUniswap = { factory: true, initialized: true, liquidity: '1', pool: address(41), proxy: true, seeder: true }
		fixture.state.evaluations = evaluateOperationCatalog(fixture.scan.snapshot, planningOptions(fixture.configuration.settings, 7))
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getState: () => fixture.state,
			getConfiguration: () => ({ hasSigner: true, revision: fixture.configuration.revision, settings: serializedSettings(fixture.configuration.settings, true), wallet: fixture.state.wallet }),
			setOperation: value => fixture.controller.handle(value),
			setCancellation: () => undefined,
			setCandidate: () => undefined,
			setObligation: () => undefined,
			setReplacement: () => undefined,
			setPaused: () => undefined,
			setSettings: () => undefined,
			setSigner: () => undefined,
			setWorkflow: () => undefined,
		})
		const session = await startChromiumSession(chromiumExecutable)
		const waitFor = (expression: string) => session.waitFor(expression, { attempts: 150, retryFailures: true })
		async function capture(name: string) {
			const directory = process.env['CHAOS_QA_SCREENSHOTS']
			if (directory === undefined) return
			await mkdir(directory, { recursive: true })
			const response = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
			if (typeof response !== 'object' || response === null) throw new Error('Invalid screenshot response')
			const data = Reflect.get(response, 'data')
			if (typeof data !== 'string') throw new Error('Missing screenshot')
			await Bun.write(`${directory}/${name}.png`, Buffer.from(data, 'base64'))
		}
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
