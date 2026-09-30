import { expect } from 'bun:test'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { connectToChromium, state, walletAddress } from '../support/dashboard-harness.ts'

browserTest(
	'reviews every drain policy choice before submitting the captured request',
	async () => {
		const requests: unknown[] = []
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({ revision: 'retirement-review', settings: { network: { chainId: 1, name: 'mainnet' }, paused: true, runtime: { execute: false }, scheduler: { maximumDelaySeconds: 3600, minimumDelaySeconds: 60 }, strategy: { enabledEcosystems: [] } } }),
			getState: () => state({ profileId: 'profile:review', retirement: { blockers: [], positions: [], status: 'inactive' }, wallet: walletAddress }),
			hostname: '127.0.0.1',
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setRetirement: value => requests.push(value),
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		let browserSession: Awaited<ReturnType<typeof connectToChromium>> | undefined
		try {
			const cdp = await connectToChromium()
			browserSession = cdp
			await cdp.command('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
			// Every state refresh briefly disables the RPC-health retry button, so assert the value each wait observed instead of reading it again.
			const waitForValue = async (expression: string, expected: boolean) => {
				let value: unknown
				for (let attempt = 0; attempt < 100; attempt++) {
					value = await cdp.evaluate(expression)
					if (value === expected) break
					await Bun.sleep(25)
				}
				expect(value).toBe(expected)
			}
			await waitForValue("document.querySelector('#rpc-health-retry-button')?.disabled", false)
			await waitForValue("document.querySelector('#retirement-start')?.disabled", false)
			await waitForValue("document.querySelector('#retirement-request')?.disabled", false)
			await cdp.evaluate("document.querySelector('#retirement-start')?.click()")
			await waitForValue("document.querySelector('#retirement-form')?.hidden", false)
			await cdp.evaluate("(() => { document.querySelector('#retirement-max-loss').value = '10001'; document.querySelector('#retirement-form').dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true })) })()")
			for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#retirement-action-status')?.textContent?.includes('0 to 10000 bps')")) !== true; attempt++) await Bun.sleep(25)
			expect(await cdp.evaluate("document.querySelector('#retirement-action-status')?.textContent")).toContain('0 to 10000 bps')
			expect(await cdp.evaluate("document.querySelector('.operator-confirm-dialog') === null")).toBe(true)
			for (const [index, policy] of [
				{ exitUnmatchedShares: true, migrateExistingClaims: false, exitAfterCompletion: false },
				{ exitUnmatchedShares: false, migrateExistingClaims: true, exitAfterCompletion: false },
				{ exitUnmatchedShares: false, migrateExistingClaims: false, exitAfterCompletion: true },
			].entries()) {
				const width = index === 0 ? 1440 : 390
				const height = index === 0 ? 900 : 844
				await cdp.command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
				await cdp.evaluate(`(() => {
					document.querySelector('#retirement-max-loss').value = '250'
					document.querySelector('#retirement-exit-unmatched').checked = ${policy.exitUnmatchedShares}
					document.querySelector('#retirement-migrate-claims').checked = ${policy.migrateExistingClaims}
					document.querySelector('#retirement-exit-after').checked = ${policy.exitAfterCompletion}
					document.querySelector('#retirement-form').requestSubmit()
				})()`)
				for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('.operator-confirm-dialog')?.open")) !== true; attempt++) await Bun.sleep(25)
				const review = await cdp.evaluate("[...document.querySelectorAll('.operator-review-row')].map(row => ({ label: row.querySelector('strong')?.textContent, before: row.querySelectorAll('span')[0]?.textContent, after: row.querySelectorAll('span')[2]?.textContent }))")
				expect(review).toMatchObject([
					{ label: 'Signer destination', before: 'Current signer' },
					{ label: 'Maximum unmatched-share loss', after: '250 bps' },
					{ label: 'Exit unmatched shares', after: policy.exitUnmatchedShares ? 'Enabled' : 'Disabled' },
					{ label: 'Migrate existing claims', after: policy.migrateExistingClaims ? 'Enabled' : 'Disabled' },
					{ label: 'Exit after completion', after: policy.exitAfterCompletion ? 'Enabled' : 'Disabled' },
				])
				expect(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
				expect(await cdp.evaluate("(() => { const dialog = document.querySelector('.operator-confirm-dialog'); return dialog instanceof HTMLDialogElement && dialog.clientWidth > 0 && dialog.scrollWidth <= dialog.clientWidth })() ")).toBe(true)
				if (process.env['BOT_DASHBOARD_QA_CAPTURE'] === '1' && index < 2) {
					const capture = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
					const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
					if (typeof data !== 'string') throw new Error('Drain review screenshot is missing')
					await Bun.write(`/tmp/bot-dashboard-qa/chaos-drain-review-${width.toString()}.png`, Buffer.from(data, 'base64'))
				}
				if (index === 0)
					await cdp.evaluate("(() => { document.querySelector('#retirement-exit-unmatched').checked = false; document.querySelector('#retirement-migrate-claims').checked = true; document.querySelector('#retirement-exit-after').checked = true; document.querySelector('#retirement-max-loss').value = '9000' })()")
				await cdp.evaluate(
					`(() => { const dialog = document.querySelector('.operator-confirm-dialog'); const input = dialog?.querySelector('input'); if (!(input instanceof HTMLInputElement)) return; input.value = dialog.querySelector('label strong')?.textContent ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => dialog.querySelector('button[type="submit"]')?.click(), 0) })()`,
				)
				for (let attempt = 0; attempt < 100 && requests.length <= index; attempt++) await Bun.sleep(25)
				const request = requests[index]
				if (typeof request !== 'object' || request === null) throw new Error('Expected retirement request')
				expect(Reflect.get(request, 'policies')).toMatchObject({ ...policy, maximumExitLossBps: 250 })
				if (!Array.isArray(review)) throw new Error('Expected retirement review rows')
				expect(Reflect.get(review[0], 'after')).toBe(getAddress(walletAddress))
				expect(Reflect.get(request, 'recipient')).toBeUndefined()
				if (index < 2) {
					await cdp.command('Page.navigate', { url: new URL(`/recovery?review=${(index + 1).toString()}`, dashboard.url).href })
					for (let attempt = 0; attempt < 100 && (await cdp.evaluate(`location.search === '?review=${(index + 1).toString()}' && document.readyState === 'complete'`)) !== true; attempt++) await Bun.sleep(25)
					await waitForValue("document.querySelector('#rpc-health-retry-button')?.disabled", false)
					await waitForValue("document.querySelector('#retirement-start')?.disabled", false)
					await waitForValue("document.querySelector('#retirement-request')?.disabled", false)
					await cdp.evaluate("document.querySelector('#retirement-start')?.click()")
					await waitForValue("document.querySelector('#retirement-form')?.hidden", false)
				}
			}
			expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
		} finally {
			try {
				await browserSession?.close()
			} finally {
				dashboard.stop(true)
			}
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 30_000,
)
