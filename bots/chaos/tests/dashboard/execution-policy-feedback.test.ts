import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { startChromiumSession } from './chromium-session.ts'

const chromium = process.env['CHROMIUM_PATH'] ?? Bun.which('chromium') ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip

browserTest(
	'execution policy distinguishes drafts from active mode and saves explicitly at both widths',
	async () => {
		let execute = false
		let revision = 1
		let rejectSave = false
		let releaseSave = () => {}
		let saveGate: Promise<void> | undefined
		let mutations = 0
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getConfiguration: () => ({ revision: String(revision), settings: { paused: true, runtime: { execute }, strategy: { enabledEcosystems: ['open-oracle'], selectableOperationAllowlist: null } } }),
			getState: () => ({ execute, paused: true, activities: [], evaluations: [], inventory: { rep: [] }, obligations: [], pendingTransactions: [], scheduler: { status: 'paused' }, workflows: [] }),
			setSettings: async value => {
				mutations += 1
				await saveGate
				if (rejectSave) throw new Error('Policy save rejected')
				const nextExecute = Reflect.get(Object(Reflect.get(Object(Reflect.get(Object(value), 'patch')), 'runtime')), 'execute')
				if (typeof nextExecute !== 'boolean') throw new Error('Missing execution setting')
				execute = nextExecute
				revision += 1
			},
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const session = await startChromiumSession(chromium)
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		const cdp = {
			command: session.send,
			close: session.close,
			issues: session.issues,
			evaluate: async (expression: string) => {
				const response = await session.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
				return Reflect.get(Object(Reflect.get(Object(response), 'result')), 'value')
			},
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 200; attempt += 1) {
				if ((await cdp.evaluate(expression)) === true) return
				await Bun.sleep(25)
			}
			throw new Error(`Timed out: ${expression}`)
		}
		const capture = async (name: string) => {
			const result = await cdp.command('Page.captureScreenshot', { format: 'png' })
			const data = Reflect.get(Object(result), 'data')
			if (typeof data !== 'string') throw new Error('Screenshot unavailable')
			await Bun.write(`/tmp/chaos-policy-qa/${name}.png`, Buffer.from(data, 'base64'))
		}
		try {
			for (const width of [1440, 390]) {
				execute = false
				revision += 1
				await cdp.command('Emulation.setDeviceMetricsOverride', { width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1, mobile: false })
				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#settings-fields')?.disabled === false")
				await cdp.evaluate("document.querySelector('#settings-form').scrollIntoView({ block: 'start' }); window.scrollBy(0, -document.querySelector('.operator-shell').getBoundingClientRect().height - 16)")
				expect(await cdp.evaluate("document.querySelector('#execution-current-mode')?.textContent")).toBe('Current mode: Dry run')
				await capture(`saved-${width}`)
				const before = mutations
				await cdp.evaluate("document.querySelector('#execute').click()")
				expect(mutations).toBe(before)
				expect(await cdp.evaluate("document.querySelector('#execution-draft-mode')?.textContent")).toBe('Live execution selected · not applied')
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status')?.textContent")).toBe('Unsaved changes')
				expect(await cdp.evaluate("document.querySelector('#execution-current-mode')?.textContent")).toBe('Current mode: Dry run')
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await capture(`draft-${width}`)
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
				await cdp.evaluate("document.querySelector('#discard-settings').click()")
				expect(await cdp.evaluate("document.querySelector('#execute').checked")).toBe(false)
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status').hidden")).toBe(true)
				await cdp.evaluate("document.querySelector('#execute').click()")
				rejectSave = true
				await cdp.evaluate("document.querySelector('#save-settings').click()")
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Policy save rejected'")
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status').hidden")).toBe(false)
				await capture(`failed-${width}`)
				rejectSave = false
				saveGate = new Promise(resolve => {
					releaseSave = resolve
				})
				await cdp.evaluate("document.querySelector('#save-settings').click()")
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Saving…'")
				expect(await cdp.evaluate("document.querySelector('#save-settings').matches(':disabled')")).toBe(true)
				await capture(`saving-${width}`)
				releaseSave()
				saveGate = undefined
				await waitFor("document.querySelector('#execution-current-mode')?.textContent === 'Current mode: Live execution'")
				expect(await cdp.evaluate("document.querySelector('#settings-draft-status').hidden")).toBe(true)
				await capture(`live-${width}`)
				await cdp.evaluate("document.querySelector('#execute').click()")
				expect(await cdp.evaluate("document.querySelector('#execution-draft-mode')?.textContent")).toBe('Dry run selected · not applied')
				await cdp.evaluate("document.querySelector('#execute').click()")
				expect(await cdp.evaluate("document.querySelector('#execution-draft-mode').hidden")).toBe(true)
			}
			expect(cdp.issues).toEqual([])
		} finally {
			releaseSave()
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	60_000,
)
