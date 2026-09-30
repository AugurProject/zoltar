import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { connectToChromium, state } from '../support/dashboard-harness.ts'

browserTest(
	'schedule shortcut and catalog selection save through the dashboard',
	async () => {
		let paused = false
		let revision = 'controls-1'
		let selection: string[] = []
		const initialSchedule = new Date(Date.now() + 60_000).toISOString()
		let scheduledAt = initialSchedule
		let scheduleStatus = 'scheduled'
		let rejectSelection = false
		let selectionGate: Promise<void> | undefined
		let scans = 0
		const mutations: unknown[] = []
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getConfiguration: () => ({ revision, settings: { paused, runtime: { execute: false }, scheduler: { minimumDelaySeconds: 60, maximumDelaySeconds: 3600 }, strategy: { selectableOperationAllowlist: selection } } }),
			getState: () =>
				state({
					paused,
					scheduler: { status: scheduleStatus, nextRunAt: scheduledAt, lastDelaySeconds: 60 },
					evaluations: [
						{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.wrap', label: 'Wrap ETH', risk: 'low' }, eligibility: { eligible: false, blockers: ['No ETH available'] } },
						{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.unwrap', label: 'Unwrap WETH', risk: 'low' }, eligibility: { eligible: false, blockers: ['No WETH available'] } },
						{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { eligible: false, blockers: [`No report due after scan ${((scans += 1)).toString()}`] } },
					],
				}),
			setSchedule: value => {
				mutations.push(value)
				scheduledAt = new Date().toISOString()
				scheduleStatus = 'due'
			},
			setSelection: async value => {
				await selectionGate
				if (rejectSelection) throw new Error('Selection save failed')
				mutations.push(value)
				selection = [...selection, String(Reflect.get(Object(value), 'operationId'))]
				revision = 'controls-2'
			},
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const port = dashboard.port
		if (port === undefined) throw new Error('Dashboard port is unavailable')
		const cdp = await connectToChromium()
		try {
			const waitFor = async (expression: string) => await cdp.waitFor(expression, { attempts: 400 })
			const capture = async (name: string) => {
				const result = await cdp.command('Page.captureScreenshot', { format: 'png' })
				const data = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : undefined
				if (typeof data !== 'string') throw new Error('Screenshot unavailable')
				await Bun.write(`/tmp/chaos-controls-qa/${name}.png`, Buffer.from(data, 'base64'))
			}
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/overview` })
			await waitFor("document.querySelector('#run-next-now')?.disabled === false")
			await capture('overview-desktop-1440x900')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
			await cdp.evaluate("document.querySelector('#run-next-now').scrollIntoView({ block: 'center' })")
			await capture('overview-scheduled-mobile-390x844')
			await cdp.evaluate("document.querySelector('#run-next-now').click()")
			await waitFor("document.querySelector('#schedule-action-status')?.textContent.startsWith('Next choice requested.')")
			expect(mutations[0]).toEqual({ revision: 'controls-1', nextRunAt: initialSchedule })
			expect(await cdp.evaluate("document.querySelector('#run-next-now').disabled")).toBe(true)
			await waitFor("document.querySelector('#schedule-action-status')?.textContent === ''")
			await capture('overview-due-mobile-390x844')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			paused = true
			await waitFor("document.querySelector('#countdown')?.textContent === 'Paused'")
			expect(await cdp.evaluate("document.querySelector('#schedule-action-status').textContent")).toBe('')
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/catalog` })
			await waitFor("document.querySelector('[data-selection-toggle]')?.disabled === false")
			expect(await cdp.evaluate("document.querySelectorAll('[data-selection-toggle]').length")).toBe(2)
			await cdp.evaluate("document.querySelector('#catalog-rows summary').click()")
			await capture('catalog-desktop-1440x900')
			rejectSelection = true
			// The refresh that follows a failed save renders a snapshot that throws once. A save that
			// rejects inside its own recovery path must not strand every later save.
			await cdp.evaluate(`(() => {
				const countdown = document.querySelector('#countdown')
				const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
				Object.defineProperty(countdown, 'textContent', {
					configurable: true,
					get: () => descriptor.get.call(countdown),
					set: value => {
						delete countdown.textContent
						throw new Error('Injected render failure')
					},
				})
			})()`)
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').click()")
			await waitFor("document.querySelector('#catalog-selection-status')?.textContent.includes('Selection save failed')")
			await waitFor("document.querySelector('[data-selection-toggle]')?.disabled === false")
			expect(await cdp.evaluate("document.querySelector('[data-selection-toggle]').checked")).toBe(false)
			rejectSelection = false
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').click()")
			await waitFor("document.querySelector('#selectable-operation-allowlist')?.value === 'open-oracle.weth.wrap'")
			expect(mutations[1]).toEqual({ revision: 'controls-1', operationId: 'open-oracle.weth.wrap', enabled: true })
			// A save must not blink the rest of the catalog: only the saving toggle changes state.
			let releaseSelection = () => {}
			selectionGate = new Promise(resolve => {
				releaseSelection = resolve
			})
			await cdp.evaluate(`(() => {
				const rows = [...document.querySelectorAll('#catalog-rows tbody tr')]
				rows.forEach((row, index) => { row.dataset.stableRow = String(index) })
				document.querySelector('[data-selection-toggle="open-oracle.weth.unwrap"]').click()
			})()`)
			await waitFor('document.querySelector(\'[data-selection-toggle="open-oracle.weth.unwrap"]\')?.disabled === true')
			expect(
				await cdp.evaluate(`({
					otherChecked: document.querySelector('[data-selection-toggle="open-oracle.weth.wrap"]').checked,
					otherDisabled: document.querySelector('[data-selection-toggle="open-oracle.weth.wrap"]').disabled,
					savingChecked: document.querySelector('[data-selection-toggle="open-oracle.weth.unwrap"]').checked,
				})`),
			).toEqual({ otherChecked: true, otherDisabled: false, savingChecked: true })
			releaseSelection()
			await waitFor("document.querySelector('#selectable-operation-allowlist')?.value === 'open-oracle.weth.wrap\\nopen-oracle.weth.unwrap'")
			selectionGate = undefined
			// Only the row whose data changed is rebuilt; the rest keep their DOM nodes so the catalog never reflows.
			const scansBeforeRefresh = scans
			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor(`document.querySelector('#catalog-rows')?.textContent?.includes('No report due after scan ${(scansBeforeRefresh + 1).toString()}') === true`)
			expect(await cdp.evaluate("[...document.querySelectorAll('#catalog-rows tbody tr')].map(row => row.dataset.stableRow ?? 'rebuilt')")).toEqual(['0', '1', 'rebuilt'])
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').scrollIntoView({ block: 'center' })")
			await capture('catalog-mobile-390x844')
			expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/overview` })
			await waitFor("document.querySelector('#countdown')?.textContent === 'Paused'")
			await cdp.evaluate("document.querySelector('#run-next-now').scrollIntoView({ block: 'center' })")
			await capture('overview-paused-mobile-390x844')
			expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
		} finally {
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
