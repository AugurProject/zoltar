import { expect } from 'bun:test'
import { CONFIGURATION_REVISION_CONFLICT } from '@zoltar/bot-shared/config/durable-file'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../../src/runtime/configuration-commit.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { connectToChromium, state, walletAddress } from '../support/dashboard-harness.ts'

type Controller = Parameters<typeof startDashboardServer>[1]
type Browser = Awaited<ReturnType<typeof connectToChromium>>

const pendingHash = `0x${'cd'.repeat(32)}`
const strategy = {
	allowHighRiskOperations: false,
	allowIrreversibleOperations: false,
	enabledEcosystems: ['open-oracle'],
	initializeGenesisUniverse: false,
	maximumEthPerOperation: '0.05',
	maximumGasCostEth: '0.02',
	maximumRepPerOperation: '10',
	minimumEthReserve: '0.05',
	minimumRepReserve: '10',
	selectableOperationAllowlist: null,
	workflowValidForBlocks: 288,
}

function configuration(revision: string) {
	return {
		hasSigner: true,
		revision,
		settings: {
			connectivity: { publicRpcUrls: ['https://submit.example/'], quorumRpcUrls: [], readRpcUrl: 'https://read.example/', rpcQuorum: 1 },
			network: { chainId: 11_155_111, name: 'sepolia' },
			networkConfigured: true,
			paused: true,
			runtime: { execute: false },
			scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
			strategy,
		},
		signerAddress: walletAddress,
	}
}

/** Runs one scenario against a dashboard whose controller methods the scenario overrides, then closes both. */
async function withDashboard(overrides: Partial<Controller>, path: string, scenario: (cdp: Browser, refresh: () => Promise<void>) => Promise<void>) {
	const dashboard = startDashboardServer(0, {
		getConfiguration: () => configuration('revision-1'),
		getState: () => state({ wallet: walletAddress }),
		hostname: '127.0.0.1',
		setCancellation: () => {},
		setCandidate: () => {},
		setObligation: () => {},
		setPaused: () => {},
		setReplacement: () => {},
		setSettings: () => {},
		setSigner: () => {},
		setWorkflow: () => {},
		...overrides,
	})
	let browser: Browser | undefined
	try {
		const cdp = await connectToChromium()
		browser = cdp
		await cdp.command('Page.navigate', { url: new URL(path, dashboard.url).href })
		await cdp.waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", { message: 'dashboard did not load' })
		const refresh = async () => {
			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await Bun.sleep(150)
			await cdp.waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", { message: 'dashboard refresh did not settle' })
		}
		await scenario(cdp, refresh)
		expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
	} finally {
		await browser?.close()
		dashboard.stop(true)
	}
}

function gate() {
	let release = () => {}
	const opened = new Promise<void>(resolve => {
		release = resolve
	})
	return { opened, release: () => release() }
}

browserTest(
	'a slow mutation from this page does not report the dashboard as unavailable',
	async () => {
		const save = gate()
		let saves = 0
		await withDashboard(
			{
				setConnectivity: async () => {
					saves += 1
					await save.opened
				},
			},
			'/settings',
			async cdp => {
				await cdp.waitFor("document.querySelector('#connectivity-fields')?.disabled === false && document.querySelector('#read-rpc-url')?.value !== ''", { message: 'connectivity form did not load' })
				await cdp.evaluate("document.querySelector('#connectivity-form').requestSubmit()")
				for (let attempt = 0; attempt < 100 && saves === 0; attempt++) await Bun.sleep(25)
				expect(saves).toBe(1)
				// The server answers reads only after the mutation; the 1 s state timeout would otherwise fire here.
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await Bun.sleep(2_300)
				expect(await cdp.evaluate("({ error: document.querySelector('#global-error')?.classList.contains('hidden'), configuration: document.querySelector('#configuration-status')?.classList.contains('error') })")).toEqual({ error: true, configuration: false })
				save.release()
				await cdp.waitFor("document.querySelector('#connectivity-status')?.textContent === 'Chain and RPCs passed server-side validation and were saved.' && document.querySelector('#connectivity-fields')?.disabled === false", { message: 'connectivity save did not settle' })
				expect(await cdp.evaluate("document.querySelector('#global-error')?.classList.contains('hidden')")).toBe(true)
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'unchanged alerts, recovery rows, and submitting recovery forms survive a state refresh',
	async () => {
		const reconcile = gate()
		let reconciliations = 0
		await withDashboard(
			{
				getState: () =>
					state({
						alerts: [{ message: 'Safety pause is latched', severity: 'error', actionHref: '/recovery', actionLabel: 'Review recovery' }],
						obligations: [{ blockers: [], id: 'obligation-1', label: 'Finalize report', status: 'failed', updatedAt: '2026-10-01T00:00:00.000Z' }],
						pendingTransactions: [{ hash: pendingHash, label: 'Wrap WETH', nonce: 7, status: 'submitted', submittedAt: new Date().toISOString() }],
						wallet: walletAddress,
					}),
				setObligation: async () => {
					reconciliations += 1
					await reconcile.opened
				},
			},
			'/recovery',
			async (cdp, refresh) => {
				await cdp.waitFor("document.querySelector('#pending-transactions .stack-row') !== null && document.querySelector('#obligations .stack-row') !== null && document.querySelector('#operator-alerts li') !== null", { message: 'recovery items did not render' })
				await cdp.evaluate("for (const selector of ['#operator-alerts li', '#pending-transactions .stack-row', '#obligations .stack-row', '#obligation-id option', '#coverage-summary .coverage-card']) document.querySelector(selector).dataset.kept = 'true'")
				await refresh()
				expect(await cdp.evaluate("['#operator-alerts li', '#pending-transactions .stack-row', '#obligations .stack-row', '#obligation-id option', '#coverage-summary .coverage-card'].map(selector => document.querySelector(selector)?.dataset.kept)")).toEqual(['true', 'true', 'true', 'true', 'true'])

				await cdp.evaluate("(() => { document.querySelector('#obligation-reason').value = 'Verified the revert was canonical.'; document.querySelector('#obligation-confirmation').value = 'RETRY VERIFIED SAFE FAILURE'; document.querySelector('#obligation-form').requestSubmit() })()")
				for (let attempt = 0; attempt < 100 && reconciliations === 0; attempt++) await Bun.sleep(25)
				expect(reconciliations).toBe(1)
				// A refresh requested while the request is in flight must not re-enable the form for a second submission.
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await Bun.sleep(300)
				expect(await cdp.evaluate("document.querySelector('#obligation-fields')?.disabled")).toBe(true)
				reconcile.release()
				await cdp.waitFor("document.querySelector('#obligation-status')?.textContent === 'Lifecycle reconciliation saved.' && document.querySelector('#obligation-fields')?.disabled === false", { message: 'lifecycle reconciliation did not settle' })
				expect(reconciliations).toBe(1)
				expect(await cdp.evaluate("[document.querySelector('#obligation-confirmation')?.getAttribute('aria-describedby'), document.querySelector('#cancellation-confirmation')?.closest('label')?.textContent?.trim(), document.querySelector('#candidate-confirmation')?.closest('label')?.textContent?.trim()]")).toEqual([
					'obligation-confirmation-help',
					'Type VERIFY NONCE CANCELLATION to confirm',
					'Type CLEAR RECOVERY CANDIDATE to confirm',
				])
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'page links navigate in place, name the page, and move focus to its heading',
	async () => {
		await withDashboard({}, '/settings', async cdp => {
			await cdp.waitFor("document.querySelector('#settings-fields')?.disabled === false", { message: 'policy form did not load' })
			expect(await cdp.evaluate('document.title')).toBe('Settings · Zoltar chaos bot')
			// An unsaved policy edit must survive following the help text's catalog link and coming back.
			await cdp.evaluate("(() => { window.pageInstance = 'original'; const input = document.querySelector('#min-delay'); input.value = '120'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); document.querySelector('#selectable-operation-catalog-link').click() })()")
			await cdp.waitFor("location.pathname === '/catalog' && document.body.dataset.page === 'catalog'", { message: 'catalog link did not navigate' })
			expect(await cdp.evaluate("({ instance: window.pageInstance, title: document.title, focused: document.activeElement?.id, current: document.querySelector('.section-nav a[aria-current=\"page\"]')?.getAttribute('href') })")).toEqual({
				instance: 'original',
				title: 'Operation catalog · Zoltar chaos bot',
				focused: 'catalog-title',
				current: '/catalog',
			})
			await cdp.evaluate('history.back()')
			await cdp.waitFor("location.pathname === '/settings' && document.body.dataset.page === 'settings'", { message: 'history did not return to settings' })
			expect(await cdp.evaluate("({ instance: window.pageInstance, draft: document.querySelector('#min-delay')?.value, title: document.title })")).toEqual({ instance: 'original', draft: '120', title: 'Settings · Zoltar chaos bot' })

			// Cancelling the policy review must not leave the form reporting a save in progress.
			await cdp.evaluate("document.querySelector('#settings-form').requestSubmit()")
			await cdp.waitFor("document.querySelector('.operator-confirm-dialog')?.open === true", { message: 'policy review did not open' })
			expect(await cdp.evaluate("[...document.querySelectorAll('.operator-review-row strong')].map(label => label.textContent)")).toEqual(['Minimum random delay'])
			await cdp.evaluate("document.querySelector('.operator-confirm-dialog .dialog-actions button.secondary')?.click()")
			await cdp.waitFor("document.querySelector('.operator-confirm-dialog') === null && document.querySelector('#settings-fields')?.disabled === false", { message: 'policy review did not close' })
			expect(await cdp.evaluate("document.querySelector('#settings-save-status')?.textContent")).toBe('Save cancelled. Your edits are still unsaved.')
		})
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'retirement lists its blockers and positions and reconciles an unknown request outcome',
	async () => {
		let cancellations = 0
		await withDashboard(
			{
				getState: () =>
					state({
						profileId: 'profile:blocked',
						retirement: {
							blockers: [{ category: 'pending-transaction', details: 'Wrap WETH is still pending', nextEligibleAt: '2026-10-02T12:00:00.000Z' }],
							positions: [{ fee: 3000, owner: walletAddress, pool: `0x${'22'.repeat(20)}`, status: 'needs-collection', tickLower: -120, tickUpper: 120 }],
							recipient: walletAddress,
							status: 'blocked',
						},
						wallet: walletAddress,
					}),
				setRetirement: () => {
					cancellations += 1
					const error = new Error('activation did not complete')
					error.name = CONFIGURATION_COMMITTED_SAFELY_PAUSED
					throw error
				},
			},
			'/recovery',
			async (cdp, refresh) => {
				await cdp.waitFor("document.querySelector('#retirement-status')?.textContent === 'blocked'", { message: 'retirement did not render' })
				expect(await cdp.evaluate("({ hidden: document.querySelector('#retirement-details')?.hidden, blockers: [...document.querySelectorAll('#retirement-blockers li')].map(item => item.textContent), positions: [...document.querySelectorAll('#retirement-positions li')].map(item => item.textContent) })")).toEqual({
					hidden: false,
					blockers: [expect.stringMatching(/^pending transaction: Wrap WETH is still pending · next attempt .*2026/)],
					positions: [`needs collection · pool 0x${'22'.repeat(20)} · owner ${walletAddress} · ticks -120 to 120 · fee 3000`],
				})
				await cdp.evaluate("document.querySelector('#retirement-blockers li').dataset.kept = 'true'")
				await refresh()
				expect(await cdp.evaluate("document.querySelector('#retirement-blockers li')?.dataset.kept")).toBe('true')
				expect(await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth')).toBe(true)

				await cdp.evaluate("document.querySelector('#retirement-cancel').click()")
				await cdp.waitFor("document.querySelector('.operator-confirm-dialog')?.open === true", { message: 'cancel confirmation did not open' })
				await cdp.evaluate("(() => { const input = document.querySelector('.operator-confirm-dialog input'); input.value = 'CANCEL DRAIN'; input.dispatchEvent(new Event('input', { bubbles: true })); setTimeout(() => document.querySelector('#operator-confirm-submit')?.click(), 0) })()")
				await cdp.waitFor("document.querySelector('#retirement-action-status')?.textContent === 'The request outcome was unknown. Current state was reloaded; review it before another mutation.'", { message: 'unknown retirement outcome was not reconciled' })
				expect(cancellations).toBe(1)
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'resume preflight reloads state first and refuses a stale checklist while the scan age keeps counting',
	async () => {
		let failState = false
		let stateReads = 0
		const lastScanAt = new Date(Date.now() - 5_000).toISOString()
		await withDashboard(
			{
				getState: () => {
					stateReads += 1
					if (failState) throw new Error('intentional state-read failure')
					return state({ lastScanAt, wallet: walletAddress })
				},
			},
			'/overview',
			async cdp => {
				await cdp.waitFor("document.querySelector('#pause-button')?.textContent === 'Resume'", { message: 'paused dashboard did not load' })
				const readsBeforeOpen = stateReads
				await cdp.evaluate("document.querySelector('#pause-button').click()")
				await cdp.waitFor("document.querySelector('#resume-dialog')?.open === true", { message: 'resume dialog did not open' })
				expect(stateReads).toBeGreaterThan(readsBeforeOpen)
				expect(await cdp.evaluate("({ stale: document.querySelector('#resume-stale-warning')?.classList.contains('hidden'), disabled: document.querySelector('#confirm-resume')?.disabled })")).toEqual({ stale: true, disabled: false })
				await cdp.evaluate("document.querySelector('#cancel-resume').click()")

				failState = true
				const scanAge = await cdp.evaluate("document.querySelector('#last-scan')?.textContent")
				await cdp.evaluate("document.querySelector('#pause-button').click()")
				await cdp.waitFor("document.querySelector('#resume-dialog')?.open === true", { message: 'resume dialog did not open on stale state' })
				expect(await cdp.evaluate("({ stale: document.querySelector('#resume-stale-warning')?.classList.contains('hidden'), disabled: document.querySelector('#confirm-resume')?.disabled })")).toEqual({ stale: false, disabled: true })
				// No state arrives any more, yet the header age must keep advancing.
				await cdp.waitFor(`document.querySelector('#last-scan')?.textContent !== ${JSON.stringify(scanAge)} && document.querySelector('#last-scan')?.textContent?.startsWith('Scanned ')`, { message: 'scan age froze while state reads failed' })
				expect(await cdp.evaluate("document.querySelector('#operator-health')?.textContent?.includes('Not tracked · limit 0.05 ETH per operation')")).toBe(true)
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'an execution that never started is not re-attached when its operation reopens',
	async () => {
		const execution = gate()
		const actions: unknown[] = []
		await withDashboard(
			{
				getState: () => state({ evaluations: [{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.wrap', independentlyExecutable: true, label: 'Wrap WETH' }, eligibility: { blockers: [], eligible: true } }], wallet: walletAddress }),
				setOperation: async value => {
					const action = typeof value === 'object' && value !== null ? Reflect.get(value, 'action') : undefined
					actions.push(action)
					if (action === 'status') return { execution: null }
					if (action === 'execute') {
						await execution.opened
						throw new Error('The bot is completing another operation. Retry shortly')
					}
					return {
						blockers: [],
						candidates: [],
						coverage: [],
						fields: [{ advanced: false, key: 'amount', kind: 'amount', label: 'Amount', value: '73' }],
						mode: 'dry-run',
						steps: [{ arguments: '[]', label: 'Wrap WETH', method: 'deposit', to: `0x${'11'.repeat(20)}`, value: '73' }],
						...(action === 'preview' ? { expiresAt: Date.now() + 60_000, previewId: 'preview-1' } : {}),
					}
				},
			},
			'/catalog',
			async cdp => {
				const executeButton = "document.querySelector('#operation-dialog .operation-actions button:nth-child(2)')"
				await cdp.waitFor("document.querySelector('.operation-open') !== null", { message: 'catalog did not render' })
				await cdp.evaluate("(() => { for (const group of document.querySelectorAll('.catalog-group')) group.open = true; document.querySelector('.operation-open').click() })()")
				await cdp.waitFor("document.querySelector('#operation-input-amount') !== null && document.querySelector('#operation-dialog fieldset')?.disabled === false", { message: 'operation did not load' })
				await cdp.evaluate("document.querySelector('#operation-dialog form').requestSubmit()")
				await cdp.waitFor(`${executeButton}.disabled === false`, { message: 'preview did not complete' })
				await cdp.evaluate(`${executeButton}.click()`)
				for (let attempt = 0; attempt < 100 && !actions.includes('execute'); attempt++) await Bun.sleep(25)
				await cdp.evaluate("document.querySelector('#operation-dialog').close()")
				// Let the dialog's close event land before the request fails, as it does when an operator closes it mid-request.
				await Bun.sleep(200)
				execution.release()
				await Bun.sleep(300)
				await cdp.evaluate("document.querySelector('.operation-open').click()")
				await cdp.waitFor("document.querySelector('#operation-input-amount') !== null && document.querySelector('#operation-dialog fieldset')?.disabled === false", { message: 'operation did not reload' })
				expect(actions).not.toContain('status')
				expect(await cdp.evaluate("document.querySelector('#operation-dialog [role=status]')?.textContent")).not.toContain('Execution status unavailable')
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'an unanswered operation status poll does not stop state polling',
	async () => {
		const status = gate()
		const actions: unknown[] = []
		let stateReads = 0
		try {
			await withDashboard(
				{
					getState: () => {
						stateReads += 1
						return state({ evaluations: [{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.wrap', independentlyExecutable: true, label: 'Wrap WETH' }, eligibility: { blockers: [], eligible: true } }], wallet: walletAddress })
					},
					setOperation: async value => {
						const action = typeof value === 'object' && value !== null ? Reflect.get(value, 'action') : undefined
						actions.push(action)
						if (action === 'status') {
							await status.opened
							return { execution: null }
						}
						if (action === 'execute') return { execution: { message: 'Checking current state…', status: 'pending' } }
						return {
							blockers: [],
							candidates: [],
							coverage: [],
							fields: [{ advanced: false, key: 'amount', kind: 'amount', label: 'Amount', value: '73' }],
							mode: 'dry-run',
							steps: [],
							...(action === 'preview' ? { expiresAt: Date.now() + 60_000, previewId: 'preview-1' } : {}),
						}
					},
				},
				'/catalog',
				async cdp => {
					const executeButton = "document.querySelector('#operation-dialog .operation-actions button:nth-child(2)')"
					await cdp.waitFor("document.querySelector('.operation-open') !== null", { message: 'catalog did not render' })
					await cdp.evaluate("(() => { for (const group of document.querySelectorAll('.catalog-group')) group.open = true; document.querySelector('.operation-open').click() })()")
					await cdp.waitFor("document.querySelector('#operation-input-amount') !== null && document.querySelector('#operation-dialog fieldset')?.disabled === false", { message: 'operation did not load' })
					await cdp.evaluate("document.querySelector('#operation-dialog form').requestSubmit()")
					await cdp.waitFor(`${executeButton}.disabled === false`, { message: 'preview did not complete' })
					await cdp.evaluate(`${executeButton}.click()`)
					for (let attempt = 0; attempt < 100 && !actions.includes('status'); attempt++) await Bun.sleep(25)
					expect(actions).toContain('status')
					// The status request now hangs inside the server's mutation queue. State polling must still run and,
					// because the server cannot answer the read, mark the retained snapshot stale instead of waiting.
					await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
					await cdp.waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === false && document.querySelector('#operator-health')?.textContent?.includes('Dashboard state is stale') === true", {
						attempts: 320,
						message: 'state polling stopped behind an unanswered status poll',
					})
					status.release()
					const readsAfterRelease = stateReads
					await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
					await cdp.waitFor("document.querySelector('#global-error')?.classList.contains('hidden') === true", { message: 'state polling did not recover after the status poll answered' })
					expect(stateReads).toBeGreaterThan(readsAfterRelease)
				},
			)
		} finally {
			status.release()
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'a policy save reviewed before a concurrent execution-mode change cannot overwrite it',
	async () => {
		let revision = 'revision-1'
		let execute = false
		const saves: unknown[] = []
		await withDashboard(
			{
				getConfiguration: () => {
					const current = configuration(revision)
					return { ...current, settings: { ...current.settings, runtime: { execute } } }
				},
				setSettings: value => {
					saves.push(value)
					if (typeof value !== 'object' || value === null || Reflect.get(value, 'revision') === revision) return
					const conflict = new Error('revision conflict')
					conflict.name = CONFIGURATION_REVISION_CONFLICT
					throw conflict
				},
			},
			'/settings',
			async (cdp, refresh) => {
				await cdp.waitFor("document.querySelector('#settings-fields')?.disabled === false", { message: 'policy form did not load' })
				await cdp.evaluate("(() => { const input = document.querySelector('#min-delay'); input.value = '120'; input.dispatchEvent(new InputEvent('input', { bubbles: true })); document.querySelector('#settings-form').requestSubmit() })()")
				await cdp.waitFor("document.querySelector('.operator-confirm-dialog')?.open === true", { message: 'policy review did not open' })
				// Another client arms live execution while the review is open, and a poll observes it.
				revision = 'revision-2'
				execute = true
				await refresh()
				await cdp.evaluate("document.querySelector('#operator-confirm-submit')?.click()")
				await cdp.waitFor("document.querySelector('.operator-confirm-dialog') === null", { message: 'policy review did not close' })
				await Bun.sleep(300)
				// The reviewed patch carries the old mode, so it may only travel under the revision it was built from.
				expect(saves.map(save => (typeof save === 'object' && save !== null ? Reflect.get(save, 'revision') : undefined)).filter(sent => sent !== 'revision-1')).toEqual([])
				await refresh()
				expect(await cdp.evaluate("({ save: document.querySelector('#save-settings')?.disabled, status: document.querySelector('#settings-save-status')?.textContent })")).toEqual({
					save: true,
					status: 'Configuration changed elsewhere. Discard these edits and reload before saving.',
				})
			},
		)
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)

browserTest(
	'clicking the section link of the page already shown adds no history entry',
	async () => {
		await withDashboard({}, '/recovery', async cdp => {
			const before = await cdp.evaluate('history.length')
			await cdp.evaluate('(() => { const link = document.querySelector(\'.section-nav a[href="/recovery"]\'); link.click(); link.click() })()')
			expect(await cdp.evaluate('({ length: history.length, path: location.pathname, page: document.body.dataset.page })')).toEqual({ length: before, path: '/recovery', page: 'recovery' })
			await cdp.evaluate('document.querySelector(\'.section-nav a[href="/catalog"]\').click()')
			expect(await cdp.evaluate('history.length')).toBe(Number(before) + 1)
		})
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 20_000,
)
