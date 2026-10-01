import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '@zoltar/bot-shared/execution/process-lock'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { recordPreflightFailure } from '../../src/execution/preflight-failure.ts'
import type { RuntimeState } from '../../src/state/operator-state.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { activityHash, connectToChromium, explorerTransaction, explorerUrl, state, walletAddress } from '../support/dashboard-harness.ts'

browserTest(
	'shows unavailable, read-only, and signer-backed execution account inventory',
	async () => {
		let current = state({ inventoryAvailable: false, signerReady: false })
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({}),
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setReplacement: () => {},
			setWorkflow: () => {},
			getState: () => current,
			hostname: '127.0.0.1',
			setPaused: () => {},
			setSettings: () => {},
			setSigner: () => {},
		})
		const cdp = await connectToChromium()
		try {
			for (const viewport of [
				{ width: 1440, height: 900 },
				{ width: 390, height: 844 },
			]) {
				await cdp.command('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
				for (const mode of ['keyless', 'read-only', 'conflict', 'signer'] as const) {
					current = state({
						inventory: { eth: '1000000000000000000', rep: [], weth: '2000000000000000000' },
						inventoryAvailable: mode !== 'keyless',
						signerReady: mode === 'signer' || mode === 'conflict',
						...(mode === 'conflict' ? { alerts: [{ severity: 'error', message: signerLockConflictMessage(new ExecutionSignerLockHeldError('Signer', '{"bot":"liquidator"}', '/protected/lock')) }] } : {}),
						...(mode === 'keyless' ? {} : { wallet: walletAddress }),
					})
					await cdp.command('Page.navigate', { url: `http://127.0.0.1:${dashboard.port}/overview` })
					const expectedEthText = mode === 'keyless' ? '—' : '1 ETH'
					const expectedBadge = { keyless: 'Signer missing', 'read-only': 'Read-only — signer not loaded', conflict: 'Signer unavailable', signer: 'Signer ready' }[mode]
					const ready = `document.getElementById('balance-eth')?.textContent === ${JSON.stringify(expectedEthText)} && document.getElementById('signer-badge')?.textContent === ${JSON.stringify(expectedBadge)}`
					for (let attempt = 0; attempt < 200; attempt += 1) {
						if (await cdp.evaluate(ready)) break
						await Bun.sleep(25)
					}
					expect(await cdp.evaluate(ready)).toBe(true)
					if (mode === 'keyless') expect(await cdp.evaluate("document.getElementById('wallet-short')?.textContent")).toBe('No execution account configured')
					else expect(await cdp.evaluate(`document.getElementById('wallet-short')?.innerHTML.includes(${JSON.stringify(walletAddress)})`)).toBe(true)
					expect(await cdp.evaluate('document.documentElement.scrollWidth <= window.innerWidth')).toBe(true)
					expect(cdp.issues).toEqual([])
					const outputDirectory = process.env['CHAOS_INVENTORY_QA_DIRECTORY']
					if (outputDirectory !== undefined) {
						const capture = await cdp.command('Page.captureScreenshot', { format: 'png' })
						const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
						if (typeof data !== 'string') throw new Error('Inventory QA screenshot is missing')
						await Bun.write(join(outputDirectory, `${mode}-${viewport.width.toString()}.png`), Buffer.from(data, 'base64'))
						if (viewport.width === 390) {
							await cdp.evaluate("document.getElementById('wallet-short')?.scrollIntoView({ block: 'center' })")
							const inventoryCapture = await cdp.command('Page.captureScreenshot', { format: 'png' })
							const inventoryData = typeof inventoryCapture === 'object' && inventoryCapture !== null ? Reflect.get(inventoryCapture, 'data') : undefined
							if (typeof inventoryData !== 'string') throw new Error('Inventory panel QA screenshot is missing')
							await Bun.write(join(outputDirectory, `${mode}-390-inventory.png`), Buffer.from(inventoryData, 'base64'))
						}
					}
				}
			}
		} finally {
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)

browserTest(
	'collapses overview activity to the ten newest actions and discloses planned dry-run work',
	async () => {
		const activities: Record<string, unknown>[] = Array.from({ length: 14 }, (_, index) => ({
			at: `2026-08-24T00:${index.toString().padStart(2, '0')}:00.000Z`,
			details: index === 0 ? 'Execution is disabled, so the bot planned this operation and stopped before signing any transaction.' : undefined,
			label: `Action ${index.toString()}`,
			status: 'dry-run',
			summary: '2 steps across 2 contracts; low risk; random priority; no transaction signed',
		}))
		const failureState: Pick<RuntimeState, 'activities'> = { activities: [] }
		recordPreflightFailure(
			failureState,
			{ definitionId: 'trading.genesis-uniswap.create-pool', ecosystem: 'trading' },
			new Error('Create pool no longer succeeds at the canonical pre-signing block', { cause: new Error('execution reverted: pool already exists') }),
			'Operation preflight stopped: Create genesis REP/WETH pool',
		)
		const failureActivity = failureState.activities[0]
		if (failureActivity === undefined) throw new Error('Expected the failure to be recorded')
		activities[1] = failureActivity
		for (const [offset, label] of ['Waiting for RPC visibility: Initialize REP/WETH pool', 'Submitted: Initialize REP/WETH pool', 'Signed intent persisted: Initialize REP/WETH pool'].entries()) {
			activities[offset + 2] = { at: '2026-09-17T13:34:44.000Z', label, status: 'pending', txHash: activityHash }
		}
		activities[5] = { at: '2026-09-17T13:35:00.000Z', label: 'Confirmed: Initialize REP/WETH pool', status: 'confirmed', txHash: activityHash }
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({ network: { explorerUrl } }),
			getState: () => state({ activities }),
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
		const cdp = await connectToChromium()
		try {
			const waitFor = async (expression: string) => await cdp.waitFor(expression, { attempts: 400 })
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${dashboard.port}/overview` })
			await waitFor("document.querySelectorAll('#activity-list .timeline-item').length === 10")
			expect(
				await cdp.evaluate(`({
					disclosure: document.querySelector('#activity-list .activity-details summary')?.textContent,
					expandExpanded: document.querySelector('#activity-expand')?.getAttribute('aria-expanded'),
					expandHidden: document.querySelector('#activity-expand')?.classList.contains('hidden'),
					expandText: document.querySelector('#activity-expand')?.textContent,
					newest: document.querySelector('#activity-list .timeline-item strong')?.textContent,
				})`),
			).toEqual({ disclosure: 'What was planned', expandExpanded: 'false', expandHidden: false, expandText: 'Show all 14 actions', newest: 'Action 0' })
			expect(
				await cdp.evaluate(`(() => {
					const item = document.querySelectorAll('#activity-list .timeline-item')[1]
					const details = item.querySelector('details')
					details.querySelector('summary').click()
					return { reason: item.querySelector('.timeline-detail').textContent, disclosure: details.querySelector('summary').textContent, cause: details.querySelector('p').textContent, open: details.open }
				})()`),
			).toEqual({ reason: 'Create pool no longer succeeds at the canonical pre-signing block', disclosure: 'Details', cause: 'execution reverted: pool already exists', open: true })
			await cdp.evaluate("document.querySelector('#activity-expand').click()")
			await waitFor("document.querySelectorAll('#activity-list .timeline-item').length === 14")
			expect(
				await cdp.evaluate(`({
					expandExpanded: document.querySelector('#activity-expand')?.getAttribute('aria-expanded'),
					expandText: document.querySelector('#activity-expand')?.textContent,
				})`),
			).toEqual({ expandExpanded: 'true', expandText: 'Show fewer' })
			await cdp.evaluate("document.querySelector('#activity-expand').click()")
			await waitFor("document.querySelectorAll('#activity-list .timeline-item').length === 10")
			expect(await cdp.evaluate('document.querySelector(\'[data-page-content="recovery"] #activity-list\')')).toBeNull()
			for (const viewport of [
				{ width: 1440, height: 900 },
				{ width: 390, height: 844 },
			]) {
				await cdp.command('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: viewport.width === 390 })
				await cdp.evaluate("document.querySelectorAll('#activity-list .timeline-item')[2].scrollIntoView({ block: 'start' }); window.scrollBy(0, -240)")
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
				const screenshots = process.env['CHAOS_QA_SCREENSHOTS']
				if (screenshots !== undefined) {
					await mkdir(screenshots, { recursive: true })
					const capture = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
					const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
					if (typeof data !== 'string') throw new Error('Activity screenshot unavailable')
					await Bun.write(`${screenshots}/activity-${viewport.width.toString()}.png`, Buffer.from(data, 'base64'))
				}
			}
			expect(
				await cdp.evaluate(`Array.from(document.querySelectorAll('#activity-list .timeline-item')).slice(2, 5).map(item => ({
				badge: item.querySelector('.badge')?.textContent ?? null,
				hash: item.querySelector('.identifier-value')?.textContent,
				explorer: item.querySelector('.activity-identifier a')?.href,
			}))`),
			).toEqual(Array.from({ length: 3 }, () => ({ badge: null, hash: activityHash, explorer: explorerTransaction(activityHash) })))
			expect(await cdp.evaluate("document.querySelectorAll('#activity-list .timeline-item')[5].querySelector('.badge')?.textContent")).toBe('Confirmed')
			// A poll must not close an opened disclosure or rebuild unchanged items.
			await cdp.evaluate(`(() => {
				document.querySelector('#activity-list .activity-details').open = true
				;[...document.querySelectorAll('#activity-list .timeline-item')].forEach((item, index) => { item.dataset.stableItem = String(index) })
			})()`)
			activities[3] = { ...activities[3], summary: 'Rewritten summary' }
			await waitFor("document.querySelector('#activity-list')?.textContent?.includes('Rewritten summary') === true")
			expect(
				await cdp.evaluate(`({
					disclosureOpen: document.querySelector('#activity-list .activity-details').open,
					items: [...document.querySelectorAll('#activity-list .timeline-item')].map(item => item.dataset.stableItem ?? 'rebuilt'),
				})`),
			).toEqual({ disclosureOpen: true, items: ['0', '1', '2', 'rebuilt', '4', '5', '6', '7', '8', '9'] })
			activities.length = 0
			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor("document.querySelector('#activity-list .empty-state') !== null")
			expect(
				await cdp.evaluate(`({
					expandHidden: document.querySelector('#activity-expand')?.classList.contains('hidden'),
					occurrences: [...document.querySelectorAll('.activity-panel *')].filter(element => element.children.length === 0 && element.textContent?.trim() === 'No activity recorded.').length,
				})`),
			).toEqual({ expandHidden: true, occurrences: 1 })
			expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
		} finally {
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
