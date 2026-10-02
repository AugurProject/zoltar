import { expect } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { optionalRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import example from '../../config/operator.example.json'
import { executionProfileId } from '../../src/config/execution-profile.ts'
import { loadSettings, parseSettings, saveSettings } from '../../src/config/settings.ts'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { createChaosDashboardController } from '../../src/runtime/dashboard-controller.ts'
import { initialDurableState, initialRuntimeState } from '../../src/state/initial-state.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { connectToChromium } from '../support/dashboard-harness.ts'

browserTest(
	'complete configuration loads automatically, validates drafts, and saves through the UI at desktop and mobile widths',
	async () => {
		const directory = await mkdtemp(join(tmpdir(), 'chaos-config-browser-'))
		let browser: Awaited<ReturnType<typeof connectToChromium>> | undefined
		let dashboard: ReturnType<typeof startDashboardServer> | undefined
		let finishRead: (() => void) | undefined
		const readBarrier = new Promise<void>(resolve => {
			finishRead = resolve
		})
		let finishSave: (() => void) | undefined
		const saveBarrier = new Promise<void>(resolve => {
			finishSave = resolve
		})
		try {
			const settings = parseSettings({ ...example, runtime: { ...example.runtime, stateFile: join(directory, 'runtime.json') } })
			const state = initialRuntimeState(true, undefined, settings.network.chainId, initialDurableState(settings.network.chainId, true, executionProfileId(settings)))
			state.uniswapV3Factory = settings.deployment.uniswapV3Factory
			const path = join(directory, 'operator.json')
			const revision = await saveSettings(path, settings)
			const configuration = { path, revision, settings, rememberSigner: false }
			let restarted = false
			const controller = createChaosDashboardController({
				configuration,
				state,
				gate: createSignerOperationGate(),
				hostname: '127.0.0.1',
				locks: { acquireSigner: async () => undefined, commitSigner: async () => undefined, discardSigner: async () => undefined, release: async () => undefined },
				onRestartRequested: () => {
					restarted = true
				},
				saveConfiguration: async (...args) => {
					await saveBarrier
					return await saveSettings(...args)
				},
			})
			if (controller.getConfigurationDocument === undefined) throw new Error('Complete configuration is unavailable')
			const getDocument = controller.getConfigurationDocument
			let failRead = false
			dashboard = startDashboardServer(0, {
				...controller,
				getConfigurationDocument: async () => {
					await readBarrier
					if (failRead) throw new Error('injected read failure')
					return getDocument()
				},
			})
			browser = await connectToChromium()
			const cdp = browser
			const screenshots = join(tmpdir(), 'chaos-config-qa')
			await mkdir(screenshots, { recursive: true })
			async function capture(name: string) {
				const shot = optionalRecord(await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }))
				const data = shot?.['data']
				if (typeof data !== 'string') throw new Error('Missing screenshot data')
				await writeFile(join(screenshots, `${name}.png`), Buffer.from(data, 'base64'))
			}
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await cdp.waitFor("document.querySelector('#complete-configuration-status')?.textContent === 'Loading configuration…'", { message: 'complete configuration should load automatically' })
			await cdp.evaluate("document.querySelector('#settings-complete').scrollIntoView()")
			await capture('desktop-loading')
			finishRead?.()
			await cdp.waitFor("document.querySelector('#complete-configuration-content input') !== null", { message: 'complete fields should appear' })
			expect(await cdp.evaluate("document.querySelector('#save-complete-configuration').disabled")).toBe(false)
			expect(await cdp.evaluate("document.querySelector('#complete-configuration-content').textContent.includes('privateKey')")).toBe(false)
			await capture('desktop-fields')
			await cdp.evaluate("document.querySelector('[data-configuration-path=\"runtime.pollMilliseconds\"]').scrollIntoView({block: 'center'})")
			await capture('desktop-runtime')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
			await cdp.evaluate("document.querySelector('#settings-complete').scrollIntoView()")
			await capture('mobile-fields')
			await cdp.evaluate("document.querySelector('[data-configuration-path=\"runtime.pollMilliseconds\"]').scrollIntoView({block: 'center'})")
			await capture('mobile-runtime')
			expect(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
			await cdp.evaluate("document.querySelector('#complete-configuration-json-mode').click()")
			await capture('mobile-json')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			await cdp.evaluate("document.querySelector('#complete-configuration-json-mode').click()")
			failRead = true
			await cdp.evaluate("document.querySelector('#load-complete-configuration').click()")
			await cdp.waitFor("document.querySelector('#load-complete-configuration').textContent === 'Retry'", { message: 'read failures should offer retry' })
			await cdp.evaluate("document.querySelector('#complete-configuration-status').scrollIntoView()")
			await capture('desktop-read-error')
			failRead = false
			await cdp.evaluate("document.querySelector('#load-complete-configuration').click()")
			await cdp.waitFor("document.querySelector('#load-complete-configuration').textContent === 'Discard changes'", { message: 'retry should recover' })
			await cdp.evaluate("document.querySelector('#complete-configuration-json-mode').click(); document.querySelector('#complete-configuration-json').value = '{invalid'; document.querySelector('#complete-configuration-form').requestSubmit()")
			await cdp.waitFor("document.querySelector('#complete-configuration-status').textContent.includes('JSON')", { message: 'invalid JSON should not save' })
			expect(restarted).toBe(false)
			await cdp.evaluate("document.querySelector('#load-complete-configuration').click()")
			await cdp.waitFor("document.querySelector('#complete-configuration-json').value.startsWith('{\\n') && document.querySelector('#complete-configuration-fields').disabled === false", { message: 'discard should restore JSON' })
			await cdp.evaluate("document.querySelector('#complete-configuration-json-mode').click()")
			await cdp.waitFor("document.querySelector('#complete-configuration-json-mode').checked === false && document.querySelector('#complete-configuration-fields').disabled === false", { message: 'field editor should be ready' })
			await cdp.evaluate(
				"document.querySelector('[data-configuration-path=\"runtime.pollMilliseconds\"]').value = '13000'; document.querySelector('[data-configuration-path=\"strategy.initializeGenesisUniverse\"]').click(); document.querySelector('[data-configuration-path=\"strategy.enabledEcosystems\"]').value = '[\"open-oracle\"]'; document.querySelector('#complete-configuration-json-mode').click()",
			)
			expect(await cdp.evaluate("JSON.parse(document.querySelector('#complete-configuration-json').value).runtime.pollMilliseconds")).toBe(13000)
			expect(await cdp.evaluate("JSON.parse(document.querySelector('#complete-configuration-json').value).strategy.initializeGenesisUniverse")).toBe(true)
			expect(await cdp.evaluate("JSON.parse(document.querySelector('#complete-configuration-json').value).strategy.enabledEcosystems")).toEqual(['open-oracle'])
			await cdp.evaluate("document.querySelector('#complete-configuration-form').requestSubmit()")
			await cdp.waitFor("document.querySelector('dialog[open]') !== null", { message: 'configuration review should appear' })
			await capture('desktop-review')
			await cdp.evaluate("(() => { const dialog = document.querySelector('dialog[open]'); const input = dialog.querySelector('input'); input.value = 'SAVE CONFIGURATION'; input.dispatchEvent(new Event('input', {bubbles: true})) })()")
			await cdp.waitFor("document.querySelector('dialog[open] button[type=submit]')?.disabled === false", { message: 'confirmation should enable saving' })
			await cdp.evaluate("document.querySelector('dialog[open] form').requestSubmit()")
			await cdp.waitFor("document.querySelector('#complete-configuration-status').textContent === 'Checking and saving configuration…'", { message: 'save should remain pending until committed' })
			await capture('desktop-pending')
			finishSave?.()
			await cdp.waitFor("document.querySelector('#complete-configuration-status').textContent.startsWith('Saved.')", { message: 'committed configuration should report restart' })
			await capture('desktop-saved')
			expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
			await writeFile(join(screenshots, 'browser-issues.json'), JSON.stringify(cdp.issues, undefined, 2))
			expect(restarted).toBe(true)
			expect((await loadSettings(path)).settings.runtime.pollMilliseconds).toBe(13000)
			expect(await cdp.evaluate("document.querySelector('#save-complete-configuration').disabled")).toBe(true)
		} finally {
			finishRead?.()
			finishSave?.()
			await browser?.close()
			await dashboard?.stop(true)
			await rm(directory, { recursive: true, force: true })
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS,
)
