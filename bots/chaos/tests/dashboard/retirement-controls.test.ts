import { existsSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CHROMIUM_STARTUP_BUDGET_MILLISECONDS, startChromiumSession } from './chromium-session.ts'

const chromium = process.env['CHROMIUM_PATH'] ?? Bun.which('google-chrome') ?? Bun.which('chromium') ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip
const wallet = `0x${'ab'.repeat(20)}`
const profileId = `profile:v1:${'12'.repeat(32)}`

browserTest(
	'keeps signer destination and retirement actions clear across states',
	async () => {
		let status = 'inactive'
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({ hasSigner: true, revision: 'retirement-controls', settings: { network: { chainId: 11_155_111, name: 'sepolia' }, paused: true, runtime: { execute: false }, strategy: {} }, signerAddress: wallet }),
			getState: () => ({ activities: [], evaluations: [], inventory: { rep: [] }, obligations: [], paused: true, pendingTransactions: [], profileId, retirement: { blockers: [], positions: [], recipient: wallet, status }, wallet, workflows: [] }),
			hostname: '127.0.0.1',
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const browser = await startChromiumSession(chromium)
		const evaluate = async (expression: string) => {
			const response = await browser.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
			const result = typeof response === 'object' && response !== null ? Reflect.get(response, 'result') : undefined
			return typeof result === 'object' && result !== null ? Reflect.get(result, 'value') : undefined
		}
		try {
			await browser.send('Runtime.enable')
			await browser.send('Page.enable')
			await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
			for (const [nextStatus, marker, requestDisabled, cancelDisabled] of [
				['inactive', 'to confirm.', false, true],
				['requested', 'to cancel', true, false],
				['known-claims-recovered', wallet, true, true],
			] as const) {
				status = nextStatus
				await browser.send('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				let rendered = false
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if (await evaluate(`document.querySelector('#retirement-destination')?.textContent?.includes(${JSON.stringify(marker)}) === true`)) {
						rendered = true
						break
					}
					await Bun.sleep(25)
				}
				expect(rendered).toBeTrue()
				expect(await evaluate("document.querySelector('#retirement-destination')?.hidden")).toBeFalse()
				expect(await evaluate("document.querySelector('#retirement-request')?.disabled")).toBe(requestDisabled)
				expect(await evaluate("document.querySelector('#retirement-request-options')?.disabled")).toBe(requestDisabled)
				expect(await evaluate("document.querySelector('#retirement-request-options')?.hidden")).toBe(nextStatus !== 'inactive')
				expect(await evaluate("document.querySelector('#retirement-cancel')?.disabled")).toBe(cancelDisabled)
				expect(await evaluate("document.querySelector('#retirement-confirmation')?.disabled")).toBe(nextStatus === 'known-claims-recovered')
				expect(await evaluate("document.querySelector('#retirement-confirmation-label')?.hidden")).toBe(nextStatus === 'known-claims-recovered')
				expect(await evaluate("document.querySelector('#retirement-request')?.hidden")).toBe(nextStatus !== 'inactive')
				expect(await evaluate("document.querySelector('#retirement-cancel')?.hidden")).toBe(nextStatus !== 'requested')
				expect(await evaluate("document.querySelector('#retirement-actions')?.hidden")).toBe(nextStatus === 'known-claims-recovered')
				expect(await evaluate("document.querySelector('#retirement-recipient') === null")).toBeTrue()
				if (nextStatus === 'inactive') expect(await evaluate("document.querySelector('#retirement-exit-after')?.closest('label')?.getBoundingClientRect().bottom <= document.querySelector('#retirement-confirmation')?.closest('label')?.getBoundingClientRect().top")).toBeTrue()
			}
			expect(browser.issues).toEqual([])
		} finally {
			await browser.close()
			dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)
