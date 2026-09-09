import { expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { evaluateOperationCatalog } from '../../src/operations/catalog.ts'
import { planningOptions } from '../../src/runtime/canonical-scan.ts'
import { serializedSettings } from '../../src/config/settings.ts'
import { manualOperationFixture } from '../runtime/manual-operation-fixture.ts'
import { startChromiumSession } from './chromium-session.ts'

test('catalog groups and manual operation dialog at desktop and mobile widths', async () => {
	const fixture = manualOperationFixture()
	fixture.state.evaluations = evaluateOperationCatalog(fixture.scan.snapshot, planningOptions(fixture.configuration.settings, 7))
	let holdExecution = false
	let executionStatus = 'pending'
	let executeCalls = 0
	let failInspect = false
	let stateReads = 0
	let failNextStateRead = false
	const dashboard = startDashboardServer(0, {
		hostname: '127.0.0.1',
		getState: () => {
			stateReads += 1
			if (failNextStateRead) {
				failNextStateRead = false
				throw new Error('Intentional automatic-refresh recovery fixture')
			}
			return fixture.state
		},
		getConfiguration: () => ({ hasSigner: true, revision: fixture.configuration.revision, settings: serializedSettings(fixture.configuration.settings, true), wallet: fixture.state.wallet }),
		setOperation: async value => {
			if (typeof value !== 'object' || value === null) throw new Error('Invalid fixture request')
			const action = Reflect.get(value, 'action')
			if (action === 'inspect' && failInspect) {
				failInspect = false
				const error = new Error('Fixture discovery failed. Retry shortly.')
				error.name = 'ManualOperationInputError'
				throw error
			}
			if (action === 'execute') executeCalls += 1
			if (holdExecution && (action === 'execute' || action === 'status')) return { execution: { status: executionStatus, message: executionStatus === 'pending' ? 'Executing operation…' : 'Dry run completed. No transaction signed.' } }
			return fixture.controller.handle(value)
		},
		setCancellation: () => undefined,
		setCandidate: () => undefined,
		setObligation: () => undefined,
		setReplacement: () => undefined,
		setPaused: () => undefined,
		setSettings: () => undefined,
		setSigner: () => undefined,
		setWorkflow: () => undefined,
	})
	const session = await startChromiumSession(process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium')
	async function evaluate(expression: string) {
		const response = await session.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
		const details = Reflect.get(response, 'exceptionDetails')
		if (details !== undefined) throw new Error(JSON.stringify(details))
		return Reflect.get(Reflect.get(response, 'result'), 'value')
	}
	async function waitFor(expression: string) {
		for (let attempt = 0; attempt < 150; attempt += 1) {
			if ((await evaluate(expression)) === true) return
			await Bun.sleep(100)
		}
		throw new Error(`Browser condition timed out: ${expression}`)
	}
	const screenshotDirectory = process.env['CHAOS_QA_SCREENSHOTS']
	async function capture(name: string) {
		if (screenshotDirectory === undefined) return
		await mkdir(screenshotDirectory, { recursive: true })
		const response = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
		const data = Reflect.get(response, 'data')
		if (typeof data !== 'string') throw new Error('Missing screenshot')
		await Bun.write(`${screenshotDirectory}/${name}.png`, Buffer.from(data, 'base64'))
	}
	try {
		await session.send('Page.enable')
		await session.send('Runtime.enable')
		for (const viewport of [
			{ width: 1440, height: 900, label: 'desktop' },
			{ width: 390, height: 844, label: 'mobile' },
		]) {
			await session.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
			await session.send('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
			await waitFor("document.querySelectorAll('#catalog-rows > details').length === 4")
			expect(await evaluate("document.querySelectorAll('#catalog-rows details[open]').length")).toBe(0)
			expect(await evaluate("document.querySelectorAll('#catalog-rows .operation-name small.mono, #catalog-rows .operation-id-copy').length")).toBe(0)
			expect(await evaluate("document.querySelector('#refresh-button') === null")).toBe(true)
			failNextStateRead = true
			await evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === false")
			fixture.state.lastScannedBlock = viewport.label === 'desktop' ? 201n : 202n
			const initialReads = stateReads
			for (let attempt = 0; attempt < 150 && stateReads === initialReads; attempt += 1) await Bun.sleep(100)
			expect(stateReads).toBeGreaterThan(initialReads)
			await waitFor(`document.querySelector('#last-block')?.textContent === 'Block ${fixture.state.lastScannedBlock}' && document.querySelector('#global-error')?.classList.contains('hidden') === true`)
			await capture(`${viewport.label}-collapsed`)
			await evaluate('document.querySelector(\'#catalog-rows [data-ecosystem="open-oracle"] summary\').click()')
			await capture(`${viewport.label}-expanded`)
			await evaluate("[...document.querySelectorAll('.operation-open')].find(button => button.getAttribute('aria-label') === 'Open wrap WETH').focus()")
			const changed = fixture.state.evaluations[0]
			if (changed !== undefined) changed.definition.description += ' Refreshed.'
			await evaluate("document.dispatchEvent(new Event('visibilitychange'))")
			await waitFor("document.activeElement?.getAttribute('aria-label') === 'Open wrap WETH'")
			await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false")
			expect(await evaluate('document.querySelector(\'#catalog-rows [data-ecosystem="open-oracle"]\').open')).toBe(true)
			await evaluate("[...document.querySelectorAll('.operation-open')].find(button => button.getAttribute('aria-label') === 'Open wrap WETH').click()")
			await waitFor("document.querySelector('#operation-input-seed') !== null && document.querySelector('#operation-dialog fieldset').disabled === false")
			expect(await evaluate("document.querySelector('#operation-input-seed').disabled")).toBe(true)
			await capture(`${viewport.label}-inputs`)
			await evaluate(`(() => {
				const source = document.querySelector('[aria-label="Maximum ETH spend (wei) source"]')
				source.value = 'custom'; source.dispatchEvent(new Event('change'))
				const input = document.querySelector('#operation-input-maxEthSpendAttoEth')
				input.value = '100'; input.dispatchEvent(new Event('input'))
				document.querySelector('#operation-dialog form').requestSubmit()
			})()`)
			await waitFor("document.querySelector('#operation-dialog .operation-actions button:nth-child(2)').disabled === false")
			expect(await evaluate("document.querySelector('#operation-input-maxEthSpendAttoEth').value")).toBe('100')
			await evaluate("document.querySelector('.operation-transactions details').open = true")
			await evaluate("document.querySelector('#operation-dialog').scrollTop = document.querySelector('#operation-dialog').scrollHeight")
			await capture(`${viewport.label}-preview`)
			expect(await evaluate("document.body.scrollWidth <= document.documentElement.clientWidth && document.querySelector('#operation-dialog').scrollWidth <= document.querySelector('#operation-dialog').clientWidth")).toBe(true)
			holdExecution = true
			executionStatus = 'pending'
			const before = executeCalls
			await evaluate("document.querySelector('#operation-dialog .operation-actions button:nth-child(2)').click(); document.querySelector('#operation-dialog .operation-actions button:nth-child(2)').click()")
			await waitFor("document.querySelector('#operation-dialog [role=status]').textContent === 'Executing operation…'")
			expect(executeCalls).toBe(before + 1)
			await capture(`${viewport.label}-pending`)
			await evaluate("document.querySelector('#operation-dialog').close()")
			await evaluate("[...document.querySelectorAll('.operation-open')].find(button => button.getAttribute('aria-label') === 'Open wrap WETH').click()")
			await waitFor("document.querySelector('#operation-dialog [role=status]').textContent === 'Executing operation…'")
			executionStatus = 'completed'
			await waitFor("document.querySelector('#operation-dialog [role=status]').textContent.includes('Dry run completed')")
			await capture(`${viewport.label}-completed`)
			await evaluate("document.querySelector('#operation-dialog').close()")
			holdExecution = false
			failInspect = true
			await evaluate("[...document.querySelectorAll('.operation-open')].find(button => button.getAttribute('aria-label') === 'Open wrap WETH').click()")
			await waitFor("document.querySelector('#operation-dialog [role=status]').textContent.includes('Fixture discovery failed')")
			await capture(`${viewport.label}-failure`)
			await evaluate("document.querySelector('#operation-dialog .operation-actions button:last-child').click()")
			await waitFor("document.querySelector('#operation-input-seed') !== null && document.querySelector('#operation-dialog fieldset').disabled === false")
			await evaluate("document.querySelector('#operation-dialog').close()")
			fixture.configuration.settings.runtime.execute = true
			await evaluate("[...document.querySelectorAll('.operation-open')].find(button => button.getAttribute('aria-label') === 'Open wrap WETH').click()")
			await waitFor("document.querySelector('#operation-dialog [role=status]').textContent.includes('Resume the bot before live execution')")
			await capture(`${viewport.label}-blocked-live`)
			expect(await evaluate("document.querySelector('#operation-dialog .operation-actions button:nth-child(2)').disabled")).toBe(true)
			await evaluate("document.querySelector('#operation-dialog').close()")
			fixture.configuration.settings.runtime.execute = false
			for (const route of ['overview', 'ecosystem', 'activity', 'settings']) {
				await session.send('Page.navigate', { url: new URL(`/${route}`, dashboard.url).href })
				await waitFor(`document.querySelector('#last-block')?.textContent === 'Block ${fixture.state.lastScannedBlock}'`)
				expect(await evaluate("document.querySelector('#refresh-button') === null")).toBe(true)
				await capture(`${viewport.label}-${route}`)
			}
		}
		expect(session.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
	} finally {
		await session.close()
		dashboard.stop(true)
	}
}, 120_000)
