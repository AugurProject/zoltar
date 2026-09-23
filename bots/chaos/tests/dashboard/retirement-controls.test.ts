import { existsSync } from 'node:fs'
import { expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CHROMIUM_STARTUP_BUDGET_MILLISECONDS, startChromiumSession } from './chromium-session.ts'

const chromium = process.env['CHROMIUM_PATH'] ?? Bun.which('google-chrome') ?? Bun.which('chromium') ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip
const wallet = `0x${'ab'.repeat(20)}`
const profileId = `profile:v1:${'12'.repeat(32)}`

browserTest(
	'shows signer destination and residual evidence across states and widths',
	async () => {
		let status = 'inactive'
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({ hasSigner: true, revision: 'retirement-controls', settings: { network: { chainId: 11_155_111, name: 'sepolia' }, paused: true, runtime: { execute: false }, strategy: {} }, signerAddress: wallet }),
			getState: () => ({
				activities: [],
				evaluations: [],
				inventory: { rep: [] },
				obligations: [],
				paused: true,
				pendingTransactions: [],
				profileId,
				retirement: {
					blockers: [],
					positions: [],
					recipient: wallet,
					status,
					...(status === 'drained-with-residuals'
						? {
								completionEvidence: {
									blockHash: `0x${'34'.repeat(32)}`,
									blockNumber: '123456',
									completedAt: '2026-09-23T00:00:00.000Z',
									proof: { actionableObligations: 0, claimableAssets: 0, collectableV3Positions: 0, knownApprovals: 0, ownedLiquidityPositions: 0, partialWorkflows: 0, pendingTransactions: 0 },
									residuals: [{ amount: '20000000000000000', asset: 'REP', category: 'operator-accepted', reason: 'Old claim is no longer redeemable' }],
								},
							}
						: {}),
				},
				wallet,
				workflows: [],
			}),
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
			for (const [width, height] of [
				[1440, 900],
				[390, 844],
			] as const) {
				await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
				for (const [nextStatus, marker, requestDisabled, cancelDisabled] of [
					['inactive', wallet, false, true],
					['requested', 'Cancel the drain', true, false],
					['known-claims-recovered', wallet, true, true],
					['drained-with-residuals', '', true, true],
				] as const) {
					status = nextStatus
					await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
					let rendered = false
					for (let attempt = 0; attempt < 200; attempt += 1) {
						if (
							await evaluate(
								`document.querySelector('#retirement-destination')?.textContent?.includes(${JSON.stringify(marker)}) === true && document.querySelector('#retirement-status')?.textContent?.toLowerCase() === ${JSON.stringify(nextStatus === 'known-claims-recovered' ? 'all known claims recovered' : nextStatus.replaceAll('-', ' '))}`,
							)
						) {
							rendered = true
							break
						}
						await Bun.sleep(25)
					}
					expect(rendered).toBeTrue()
					expect(await evaluate("document.querySelector('#retirement-destination')?.hidden")).toBe(nextStatus === 'drained-with-residuals')
					expect(await evaluate("document.querySelector('#retirement-request')?.disabled")).toBe(requestDisabled)
					expect(await evaluate("document.querySelector('#retirement-request-options')?.disabled")).toBe(requestDisabled)
					expect(await evaluate("document.querySelector('#retirement-request-options')?.hidden")).toBe(nextStatus !== 'inactive')
					expect(await evaluate("document.querySelector('#retirement-cancel')?.disabled")).toBe(cancelDisabled)
					expect(await evaluate("document.querySelector('#retirement-confirmation')?.type")).toBe('hidden')
					expect(await evaluate("document.querySelector('#retirement-request')?.hidden")).toBe(nextStatus !== 'inactive')
					expect(await evaluate("document.querySelector('#retirement-cancel')?.hidden")).toBe(nextStatus !== 'requested')
					expect(await evaluate("document.querySelector('#retirement-actions')?.hidden")).toBe(nextStatus === 'known-claims-recovered' || nextStatus === 'drained-with-residuals')
					expect(await evaluate("document.querySelector('#retirement-recipient') === null")).toBeTrue()
					if (nextStatus === 'inactive') {
						expect(await evaluate("document.querySelector('#retirement-form')?.hidden")).toBeTrue()
						expect(await evaluate("getComputedStyle(document.querySelector('#retirement-form')).display")).toBe('none')
						await evaluate("document.querySelector('#retirement-start')?.click()")
						expect(await evaluate("document.querySelector('#retirement-form')?.hidden")).toBeFalse()
						expect(await evaluate("getComputedStyle(document.querySelector('#retirement-form')).display")).toBe('grid')
					}
					if (nextStatus === 'drained-with-residuals') {
						expect(await evaluate("document.querySelector('#retirement-residual-evidence')?.textContent?.includes('123456')")).toBeTrue()
						expect(await evaluate(`document.querySelector('#retirement-residual-evidence')?.textContent?.includes(${JSON.stringify(`0x${'34'.repeat(32)}`)})`)).toBeTrue()
						expect(await evaluate("document.querySelector('#retirement-residual-evidence')?.textContent?.includes('20000000000000000 REP')")).toBeTrue()
						expect(await evaluate("document.querySelector('#retirement-residual-evidence')?.textContent?.includes('operator-accepted')")).toBeTrue()
						expect(await evaluate("document.querySelector('#retirement-residual-evidence')?.textContent?.includes('Old claim is no longer redeemable')")).toBeTrue()
						expect(await evaluate("document.querySelector('#retirement-residual-submit')?.disabled")).toBeFalse()
						expect(await evaluate('document.body.scrollWidth > innerWidth')).toBeFalse()
						if (process.env['BOT_DASHBOARD_QA_CAPTURE'] === '1') {
							await evaluate("(() => { const evidence = document.querySelector('#retirement-residual-evidence'); const details = evidence?.closest('details'); if (details) details.open = true; evidence?.scrollIntoView({ block: 'center' }) })()")
							const capture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
							const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
							if (typeof data !== 'string') throw new Error('Residual screenshot is missing')
							await Bun.write(`/tmp/bot-dashboard-qa/chaos-residual-${width.toString()}.png`, Buffer.from(data, 'base64'))
						}
					}
				}
			}
			expect(browser.issues).toEqual([])
		} finally {
			await browser.close()
			dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'reviews captured V3 registration and residual acceptance details before submitting',
	async () => {
		let status = 'blocked'
		const requests: unknown[] = []
		const owner = `0x${'11'.repeat(20)}`
		const pool = `0x${'22'.repeat(20)}`
		const token0 = `0x${'33'.repeat(20)}`
		const token1 = `0x${'44'.repeat(20)}`
		const blockHash = `0x${'55'.repeat(32)}`
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({ hasSigner: true, revision: 'retirement-review', settings: { network: { chainId: 11_155_111, name: 'sepolia' }, paused: true, runtime: { execute: false }, strategy: {} }, signerAddress: wallet }),
			getState: () => ({
				activities: [],
				evaluations: [],
				inventory: { rep: [] },
				obligations: [],
				paused: true,
				pendingTransactions: [],
				profileId,
				wallet,
				workflows: [],
				retirement: {
					blockers: status === 'blocked' ? [{ category: 'ambiguous-position', details: 'Review the legacy position' }] : [],
					positions: [],
					recipient: wallet,
					status,
					completionEvidence: status === 'drained-with-residuals' ? { blockHash, blockNumber: '123456', residuals: [{ amount: '20000000000000000', asset: 'REP', category: 'operator-accepted', reason: 'Old claim is no longer redeemable' }] } : undefined,
				},
			}),
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
		const browser = await startChromiumSession(chromium)
		const evaluate = async (expression: string) => {
			const response = await browser.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
			const result = typeof response === 'object' && response !== null ? Reflect.get(response, 'result') : undefined
			return typeof result === 'object' && result !== null ? Reflect.get(result, 'value') : undefined
		}
		const waitFor = async (expression: string) => {
			for (let attempt = 0; attempt < 120; attempt++) {
				if (await evaluate(expression)) return
				await Bun.sleep(25)
			}
			throw new Error(`Timed out waiting for ${expression}`)
		}
		const review = () => evaluate("[...document.querySelectorAll('.operator-review-row')].map(row => [row.querySelector('strong')?.textContent, row.querySelectorAll('span')[2]?.textContent])")
		const confirm = async () => {
			await evaluate(
				"(() => { const dialog = document.querySelector('.operator-confirm-dialog'); const input = dialog?.querySelector('input'); if (!(input instanceof HTMLInputElement)) return; input.value = dialog.querySelector('label strong')?.textContent ?? ''; input.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => dialog.querySelector('button[type=submit]')?.click(), 0) })()",
			)
		}
		const reviewViewport = async (action: string, width: number, height: number) => {
			await browser.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
			expect(await evaluate("document.documentElement.scrollWidth <= innerWidth && (() => { const dialog = document.querySelector('.operator-confirm-dialog'); return dialog instanceof HTMLDialogElement && dialog.clientWidth > 0 && dialog.scrollWidth <= dialog.clientWidth })()")).toBe(true)
			if (process.env['BOT_DASHBOARD_QA_CAPTURE'] === '1') {
				const capture = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
				const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
				if (typeof data !== 'string') throw new Error('Retirement review screenshot is missing')
				await Bun.write(`/tmp/bot-dashboard-qa/chaos-${action}-review-${width.toString()}.png`, Buffer.from(data, 'base64'))
			}
		}
		try {
			await browser.send('Runtime.enable')
			await browser.send('Page.enable')
			await browser.send('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
			await waitFor("document.querySelector('#retirement-status')?.textContent === 'blocked' && document.querySelector('#retirement-v3-form')?.closest('details')?.hidden === false")
			await evaluate(`(() => {
				const values = ${JSON.stringify({ owner, pool, token0, token1, fee: '3000', lower: '-120', upper: '120', workflow: 'receipt:original' })}
				for (const [name, value] of Object.entries(values)) document.querySelector('#retirement-v3-' + name).value = value
				document.querySelector('#retirement-v3-form').closest('details').open = true
				document.querySelector('#retirement-v3-form').requestSubmit()
			})()`)
			await waitFor("document.querySelector('.operator-confirm-dialog')?.open === true")
			expect(await review()).toEqual([
				['Profile ID', profileId],
				['Owner', owner],
				['Pool', pool],
				['Token 0', token0],
				['Token 1', token1],
				['Fee tier', '3000'],
				['Lower tick', '-120'],
				['Upper tick', '120'],
				['Receipt/workflow reference', 'receipt:original'],
			])
			await reviewViewport('v3', 1440, 900)
			await reviewViewport('v3', 390, 844)
			await evaluate("document.querySelector('#retirement-v3-workflow').value = 'receipt:changed-after-review'")
			await confirm()
			for (let attempt = 0; attempt < 120 && requests.length < 1; attempt++) await Bun.sleep(25)
			expect(requests[0]).toMatchObject({ action: 'register-v3-position', profileId, owner, pool, token0, token1, fee: 3000, tickLower: -120, tickUpper: 120, workflowId: 'receipt:original' })
			status = 'drained-with-residuals'
			await browser.send('Page.navigate', { url: new URL('/recovery?residual-review=1', dashboard.url).href })
			await waitFor("document.querySelector('#retirement-residual-submit')?.disabled === false")
			await evaluate("(() => { document.querySelector('#retirement-residual-target-profile').value = 'profile:replacement'; document.querySelector('#retirement-residual-reason').value = 'Reviewed retained REP and accepted replacement.'; document.querySelector('#retirement-residual-form').requestSubmit() })()")
			await waitFor("document.querySelector('.operator-confirm-dialog')?.open === true")
			expect(await review()).toEqual([
				['Target deployment ID', 'profile:replacement'],
				['Review rationale', 'Reviewed retained REP and accepted replacement.'],
				['Completion block', '123456'],
				['Completion block hash', blockHash],
				['Residual 1', '20000000000000000 REP base units · operator-accepted: Old claim is no longer redeemable'],
			])
			await reviewViewport('residual', 1440, 900)
			await reviewViewport('residual', 390, 844)
			await evaluate("document.querySelector('#retirement-residual-reason').value = 'Changed after review'")
			await confirm()
			for (let attempt = 0; attempt < 120 && requests.length < 2; attempt++) await Bun.sleep(25)
			expect(requests[1]).toMatchObject({ action: 'accept-residuals', targetProfileId: 'profile:replacement', reason: 'Reviewed retained REP and accepted replacement.' })
			expect(browser.issues).toEqual([])
		} finally {
			await browser.close()
			dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)
