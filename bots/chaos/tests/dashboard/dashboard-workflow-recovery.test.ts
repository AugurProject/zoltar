import { expect } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { browserTest, CHROMIUM_STARTUP_BUDGET_MILLISECONDS } from '../support/chromium.ts'
import { activityHash, connectToChromium, expectVisibleIdentifiers as expectDashboardIdentifiers, explorerTransaction, explorerUrl, readAccessibilityIdentity, state, walletAddress } from '../support/dashboard-harness.ts'
import {
	cancellationHash,
	candidateHash,
	degradedWorkflowRenderingState,
	longCatalogBlocker,
	longCatalogLabel,
	partialRecoveryDashboardState,
	pausedWorkflowRenderingState,
	rpcSecret,
	scenarios,
	staleSubmissionWorkflowRenderingState,
	topologyIdentifiers,
	transactionHash,
	workflowRenderingState,
	workflowSteps,
} from '../support/dashboard-workflow-fixtures.ts'

browserTest(
	'validates stale recovery, workflow status semantics, and mobile interaction targets',
	async () => {
		const firstScenario = scenarios[0]
		if (firstScenario === undefined) throw new Error('Recovery scenarios are required')
		let initialDashboardState = firstScenario.staleState
		let recoveredDashboardState = firstScenario.recoveredState
		let failSecondStateRead = true
		let failNextStateRead = false
		let submissionConfigured = true
		let selectableOperationAllowlist: string[] | null = null
		const connectivityMutations: unknown[] = []
		let delayNextConnectivityMutation = true
		let configurationRevision = 'fixture-1'
		let executeMode = false
		const settingsMutations: unknown[] = []
		const executionMutations: unknown[] = []
		let stateRequests = 0
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({
				hasSigner: true,
				revision: configurationRevision,
				settings: {
					connectivity: {
						publicRpcUrls: [`https://submit.example/?token=${rpcSecret}`],
						quorumRpcUrls: ['https://read-two.example/?api_key=private', 'https://read-three.example/private'],
						readRpcUrl: `https://operator:${rpcSecret}@read-one.example/private`,
						rpcQuorum: 2,
					},
					network: { chainId: 11_155_111, explorerUrl, name: 'sepolia' },
					paused: Reflect.get(initialDashboardState, 'paused') === true,
					runtime: { execute: executeMode },
					submission: submissionConfigured
						? {
								minimumBundleRelaySuccesses: 2,
								mode: 'private',
								relayUrls: [`https://relay-one.example/private?token=${rpcSecret}`, 'https://relay-two.example/private', 'https://relay-three.example/private'],
							}
						: undefined,
					scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
					strategy: {
						allowHighRiskOperations: false,
						allowIrreversibleOperations: false,
						initializeGenesisUniverse: true,
						enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
						maximumEthPerOperation: '0.05',
						maximumGasCostEth: '0.02',
						maximumRepPerOperation: '10',
						minimumEthReserve: '0.05',
						minimumRepReserve: '10',
						selectableOperationAllowlist,
						workflowValidForBlocks: 288,
					},
				},
				signerAddress: walletAddress,
			}),
			getState: async () => {
				stateRequests += 1
				if (failNextStateRead) {
					failNextStateRead = false
					throw new Error('intentional one-shot state-read failure')
				}
				if (failSecondStateRead && stateRequests === 2) {
					await Bun.sleep(150)
					throw new Error('intentional state-read failure')
				}
				if (stateRequests === 3) await Bun.sleep(150)
				return stateRequests >= 3 ? recoveredDashboardState : initialDashboardState
			},
			hostname: '127.0.0.1',
			setCancellation: () => {},
			setCandidate: () => {},
			setConnectivity: async value => {
				connectivityMutations.push(value)
				if (delayNextConnectivityMutation) {
					delayNextConnectivityMutation = false
					await Bun.sleep(5_250)
				}
			},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setExecution: value => {
				executionMutations.push(value)
				executeMode = Reflect.get(Object(value), 'execute') === true
			},
			setSettings: value => settingsMutations.push(value),
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const dashboardPort = dashboard.port
		if (dashboardPort === undefined) throw new Error('Dashboard interaction fixture did not expose a port')
		let browserSession: Awaited<ReturnType<typeof connectToChromium>> | undefined
		try {
			const cdp = await connectToChromium()
			await cdp.command('Page.addScriptToEvaluateOnNewDocument', {
				source: `document.addEventListener('DOMContentLoaded', () => {
				const accept = () => {
					const dialog = document.querySelector('.operator-confirm-dialog')
					if (!(dialog instanceof HTMLDialogElement)) return
					window.operatorDialogReview = dialog.textContent ?? ''
					const input = dialog.querySelector('input')
					if (input instanceof HTMLInputElement) {
						input.value = dialog.querySelector('label strong')?.textContent ?? ''
						input.dispatchEvent(new Event('input', { bubbles: true }))
					}
					setTimeout(() => dialog.querySelector('button[type="submit"]')?.click(), 0)
				}
				new MutationObserver(accept).observe(document.body, { childList: true, subtree: true })
			})`,
			})
			browserSession = cdp
			await cdp.command('Network.enable')
			const waitFor = async (expression: string, message: string) => await cdp.waitFor(expression, { attempts: 400, message })
			const accessibilityIdentity = async (selector: string) => await readAccessibilityIdentity(cdp, selector)
			const waitForSettingsMutation = async (count: number, message: string) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if (settingsMutations.length === count) return
					await Bun.sleep(25)
				}
				throw new Error(message)
			}
			/** Flips the saved execution mode through the Execution mode panel so the policy form validates against it. */
			const setExecutionMode = async (execute: boolean, message: string) => {
				const count = executionMutations.length + 1
				await cdp.evaluate(`(() => {
					const toggle = document.querySelector('#execution-enabled')
					const form = document.querySelector('#execution-form')
					if (!(toggle instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					toggle.checked = ${execute ? 'true' : 'false'}
					toggle.dispatchEvent(new Event('change', { bubbles: true }))
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if (executionMutations.length === count) break
					await Bun.sleep(25)
				}
				if (executionMutations.length !== count) throw new Error(message)
				expect(executionMutations.at(-1)).toEqual({ execute, revision: configurationRevision })
				await waitFor(`document.querySelector('#execution-status')?.textContent === ${JSON.stringify(execute ? 'Live execution enabled. Resume through the readiness check to start signing.' : 'Dry-run mode saved.')} && document.querySelector('#execution-fieldset')?.disabled === false`, message)
			}
			const waitForConnectivityMutation = async (count: number, message: string) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if (connectivityMutations.length === count) return
					await Bun.sleep(25)
				}
				throw new Error(message)
			}
			const expectVisibleIdentifiers = async (expected: { explorerUrl?: string; type: string; value: string }[], minimumButtonHeight: number, selector?: string) => await expectDashboardIdentifiers(cdp, expected, minimumButtonHeight, selector)

			for (const scenario of scenarios) {
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", 'Chromium did not reset between scenarios')
				await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
				initialDashboardState = scenario.staleState
				recoveredDashboardState = scenario.recoveredState
				failSecondStateRead = true
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", `${scenario.label} fixture did not load`)
				const loading = await cdp.evaluate(`(() => {
					const form = document.querySelector('#${scenario.formId}')
					if (!(form instanceof HTMLFormElement)) return undefined
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					return {
						disabled: document.querySelector('#${scenario.fieldsId}')?.disabled,
						retryDisabled: document.querySelector('#${scenario.retryId}')?.disabled,
						retryHidden: document.querySelector('#${scenario.retryId}')?.classList.contains('hidden'),
						retryText: document.querySelector('#${scenario.retryId}')?.textContent,
						status: document.querySelector('#${scenario.statusId}')?.textContent,
					}
				})()`)
				expect(loading).toEqual({ disabled: true, retryDisabled: true, retryHidden: false, retryText: 'Refreshing…', status: expect.stringContaining('Loading the current') })
				await waitFor(
					`document.querySelector('#${scenario.statusId}')?.textContent?.includes('unavailable') === true && document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#${scenario.retryId}')?.textContent === 'Retry' && document.querySelector('#${scenario.retryId}')?.disabled === false`,
					`${scenario.label} did not expose its local Retry action after failure`,
				)
				expect(stateRequests).toBe(2)
				const failure = await cdp.evaluate(`new Promise(resolve => {
					const button = document.querySelector('#${scenario.retryId}')
					button?.scrollIntoView({ block: 'center' })
					requestAnimationFrame(() => requestAnimationFrame(() => {
						const bounds = button?.getBoundingClientRect()
						resolve({
							accessibleDescription: button?.getAttribute('aria-describedby'),
							bottom: bounds?.bottom,
							disabled: document.querySelector('#${scenario.fieldsId}')?.disabled,
							height: bounds?.height,
							retryDisabled: button?.disabled,
							retryHidden: button?.classList.contains('hidden'),
							status: document.querySelector('#${scenario.statusId}')?.textContent,
							top: bounds?.top,
						})
					}))
				})`)
				expect(failure).toEqual({
					accessibleDescription: scenario.statusId,
					bottom: expect.any(Number),
					disabled: true,
					height: expect.any(Number),
					retryDisabled: false,
					retryHidden: false,
					status: expect.not.stringContaining('header'),
					top: expect.any(Number),
				})
				expect(Reflect.get(Object(failure), 'top')).toBeGreaterThanOrEqual(0)
				expect(Reflect.get(Object(failure), 'bottom')).toBeLessThanOrEqual(844)
				expect(Reflect.get(Object(failure), 'height')).toBeGreaterThanOrEqual(44)
				await cdp.evaluate(`document.querySelector('#${scenario.retryId}')?.click()`)
				expect(
					await cdp.evaluate(`({
						disabled: document.querySelector('#${scenario.retryId}')?.disabled,
						hidden: document.querySelector('#${scenario.retryId}')?.classList.contains('hidden'),
						status: document.querySelector('#${scenario.statusId}')?.textContent,
						text: document.querySelector('#${scenario.retryId}')?.textContent,
					})`),
				).toEqual({ disabled: true, hidden: false, status: expect.stringContaining('Loading the current'), text: 'Refreshing…' })
				await waitFor(
					`document.querySelector('#${scenario.statusId}')?.textContent?.includes('loaded') === true && document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#${scenario.retryId}')?.classList.contains('hidden') === true`,
					`${scenario.label} did not recover through its local Retry`,
				)
				expect(stateRequests).toBe(3)
				expect(await cdp.evaluate(`document.querySelector('#${scenario.fieldsId}')?.disabled`)).toBe(false)
			}

			initialDashboardState = { ...partialRecoveryDashboardState, lastScannedBlock: undefined, lastScanAt: undefined, lastDeploymentCheckedBlock: '100', lastDeploymentCheckAt: new Date().toISOString(), pendingTransactions: [], obligations: [], workflows: [], currentWorkflow: undefined }
			recoveredDashboardState = initialDashboardState
			failSecondStateRead = false
			stateRequests = 0
			await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
			await waitFor("document.querySelector('#last-block')?.textContent === 'Block 100'", 'Deployment check block was not displayed before a complete scan')
			expect(await cdp.evaluate("document.querySelector('#last-scan')?.textContent")).toContain('Deployments checked')
			expect(await cdp.evaluate("document.querySelector('#recovery-badge')?.getClientRects().length")).toBe(0)
			expect(await cdp.evaluate("document.querySelector('#rep-balances')?.textContent")).toBe('—')
			initialDashboardState = partialRecoveryDashboardState
			recoveredDashboardState = partialRecoveryDashboardState
			failSecondStateRead = false
			stateRequests = 0
			await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
			await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run' && document.querySelector('#operator-health')?.textContent?.includes('Paused')", 'Safety-pause fixture did not render its durable latch')
			expect(
				await cdp.evaluate(`(async () => {
 const { renderOperatorAlerts } = await import('/operator-alerts.js')
 const container = document.createElement('ul')
 renderOperatorAlerts(container, [{ message: 'Waiting for deployments', severity: 'info' }])
 const waiting = { role: container.getAttribute('role'), live: container.getAttribute('aria-live'), style: container.firstElementChild.className, text: container.textContent }
 renderOperatorAlerts(container, [{ message: 'RPC failed', severity: 'error' }, { message: 'Waiting for deployments', severity: 'info' }])
 const mixed = { role: container.getAttribute('role'), live: container.getAttribute('aria-live'), styles: [...container.children].map(item => item.className) }
 renderOperatorAlerts(container, [{ message: 'Safety pause', severity: 'error', actionHref: '/recovery', actionLabel: 'Review recovery' }])
 const action = { href: container.querySelector('a')?.getAttribute('href'), label: container.querySelector('a')?.textContent }
 history.replaceState({}, '', '/recovery')
 renderOperatorAlerts(container, [{ message: 'Safety pause', severity: 'error', actionHref: '/recovery', actionLabel: 'Review recovery' }])
 const actionOnRecovery = container.querySelector('a') === null
 history.replaceState({}, '', '/overview')
 renderOperatorAlerts(container, [])
 return { waiting, mixed, action, actionOnRecovery, cleared: container.children.length === 0 && container.classList.contains('hidden') }
 })()`),
			).toEqual({ waiting: { role: 'status', live: 'polite', style: 'notice info', text: 'Waiting for deployments' }, mixed: { role: 'alert', live: 'assertive', styles: ['notice error', 'notice info'] }, action: { href: '/recovery', label: 'Review recovery' }, actionOnRecovery: true, cleared: true })

			expect(
				await cdp.evaluate(`({
					eth: document.querySelector('#balance-eth')?.textContent,
					recovery: document.querySelector('#recovery-badge')?.textContent,
					rep: document.querySelector('#rep-balances')?.textContent,
					weth: document.querySelector('#balance-weth')?.textContent,
				})`),
			).toEqual({ eth: '—', recovery: '1 recovery item', rep: '—', weth: '—' })
			expect(await cdp.evaluate("document.querySelector('#recovery-badge')?.getClientRects().length")).toBe(1)
			expect(
				await cdp.evaluate(`({
					panelVisible: document.querySelector('#workflow-recovery-panel')?.hidden === false,
					identity: document.querySelector('#workflow-recovery-summary')?.textContent?.includes('Partial dashboard workflow'),
					status: document.querySelector('#workflow-recovery-summary')?.textContent?.includes('Waiting continuation'),
					formInPanel: document.querySelector('#workflow-form')?.parentElement?.id === 'workflow-recovery-panel',
					pending: document.querySelector('#pending-transactions')?.textContent,
				})`),
			).toEqual({ panelVisible: true, identity: true, status: true, formInPanel: true, pending: 'No transaction requires confirmation.' })
			expect(await cdp.evaluate("document.querySelector('#workflow-reason')?.getAttribute('aria-describedby') === 'workflow-reason-help' && document.querySelector('#workflow-reason-help')?.textContent?.includes('12–2048 characters') === true")).toBe(true)
			expect(
				await cdp.evaluate(`(() => {
					const reason = document.querySelector('#workflow-reason')
					const confirmation = document.querySelector('#workflow-confirmation')
					const submit = document.querySelector('#workflow-form button[type="submit"]')
					if (!(reason instanceof HTMLTextAreaElement) || !(confirmation instanceof HTMLInputElement) || !(submit instanceof HTMLButtonElement)) return []
					const states = [submit.disabled]
					reason.value = 'Verified canonical continuation is unavailable.'
					reason.dispatchEvent(new Event('input', { bubbles: true }))
					states.push(submit.disabled)
					confirmation.value = 'ABANDON PARTIAL'
					confirmation.dispatchEvent(new Event('input', { bubbles: true }))
					states.push(submit.disabled)
					confirmation.value = 'ABANDON PARTIAL WORKFLOW'
					confirmation.dispatchEvent(new Event('input', { bubbles: true }))
					states.push(submit.disabled)
					reason.value = '12345678901'
					reason.dispatchEvent(new Event('input', { bubbles: true }))
					states.push(submit.disabled)
					return states
				})()`),
			).toEqual([true, true, true, false, true])
			await cdp.evaluate("document.querySelector('#pause-button')?.click()")
			await waitFor("document.querySelector('#resume-dialog')?.open === true", 'Safety-pause resume dialog did not open')
			expect(await cdp.evaluate(`Object.fromEntries([...document.querySelectorAll('#resume-preflight li')].map(row => [row.querySelector('span')?.textContent, row.querySelector('strong')?.textContent]))`)).toMatchObject({ 'Recovery items': '1', 'Safety latch': 'Active' })

			initialDashboardState = workflowRenderingState
			recoveredDashboardState = workflowRenderingState
			failSecondStateRead = false
			for (const viewport of [
				{ height: 900, label: 'desktop', width: 1_440 },
				{ height: 844, label: 'mobile', width: 390 },
			]) {
				const nextConfigurationRevision = viewport.label === 'desktop' ? 'fixture-2' : 'fixture-3'
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", `Chromium did not reset before the ${viewport.label} workflow check`)
				stateRequests = 0
				await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: viewport.height, mobile: false, width: viewport.width })
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor(`document.querySelectorAll('#current-workflow .step-list li').length === ${workflowSteps.length.toString()}`, `${viewport.label} workflow steps did not render`)
				expect(await cdp.evaluate("document.querySelector('#scheduler-state')?.textContent")).toBe('Transaction recovery pending')
				expect(await cdp.evaluate("document.querySelector('header #last-block')?.textContent")).toBe('Block 12345678')
				expect(await cdp.evaluate("document.querySelector('header #last-scan')?.textContent")).toMatch(/^Scanned \d+[smh] ago$/)
				const health = await cdp.evaluate(`({
					chain: document.querySelector('#rpc-chain-readiness')?.textContent,
					configured: document.querySelector('#rpc-configured-total')?.textContent,
					healthy: document.querySelector('#rpc-healthy-count')?.textContent,
					lastCheck: document.querySelector('#rpc-last-check')?.textContent,
					localRetryHidden: document.querySelector('#rpc-health-retry-button')?.classList.contains('hidden'),
					required: document.querySelector('#rpc-required-quorum')?.textContent,
					secretVisible: document.documentElement.textContent?.includes(${JSON.stringify(rpcSecret)}),
					status: document.querySelector('#rpc-health-status')?.textContent,
				})`)
				expect(health).toMatchObject({
					chain: 'Ready for chain 11155111',
					configured: '3 endpoints',
					healthy: '2 of 3',
					localRetryHidden: true,
					required: '2 endpoints',
					secretVisible: false,
					status: 'Quorum ready',
				})
				expect(Reflect.get(Object(health), 'lastCheck')).not.toBe('No completed check')
				expect(
					await cdp.evaluate(`({
						freshness: document.querySelector('#submission-freshness')?.textContent,
						healthy: document.querySelector('#submission-healthy-count')?.textContent,
						mode: document.querySelector('#submission-mode')?.textContent,
						proof: document.querySelector('#submission-signer-proof')?.textContent,
						required: document.querySelector('#submission-required-threshold')?.textContent,
						secretVisible: document.documentElement.textContent?.includes(${JSON.stringify(rpcSecret)}),
						status: document.querySelector('#submission-health-status')?.textContent,
					})`),
				).toEqual({ freshness: '3 fresh of 3 checked', healthy: '2 of 3 origins', mode: 'Private relay', proof: 'Matches current signer', required: '2 origins', secretVisible: false, status: 'Path ready' })
				expect(
					await cdp.evaluate(`({
						eth: document.querySelector('#balance-eth')?.textContent,
						rep: document.querySelector('#rep-balances .token-row > strong')?.textContent,
						weth: document.querySelector('#balance-weth')?.textContent,
					})`),
				).toEqual({ eth: '1.000000000000000001 ETH', rep: '123.456789012345678901 REP', weth: '0.000000000000000042 WETH' })
				failSecondStateRead = true
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor(
					"document.querySelector('#rpc-health-status')?.textContent === 'Health unavailable' && document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#rpc-health-retry-button')?.textContent === 'Retry' && document.querySelector('#rpc-health-retry-button')?.classList.contains('hidden') === false",
					`${viewport.label} failed refresh did not expose local RPC recovery`,
				)
				expect(
					await cdp.evaluate(`({
						chain: document.querySelector('#rpc-chain-readiness')?.textContent,
						configured: document.querySelector('#rpc-configured-total')?.textContent,
						healthy: document.querySelector('#rpc-healthy-count')?.textContent,
						lastCheck: document.querySelector('#rpc-last-check')?.textContent,
						localRetry: (() => {
							const button = document.querySelector('#rpc-health-retry-button')
							const bounds = button?.getBoundingClientRect()
							return {
								accessibleName: button?.getAttribute('aria-label'),
								bottom: bounds?.bottom,
								disabled: button?.disabled,
								height: bounds?.height,
								top: bounds?.top,
							}
						})(),
						required: document.querySelector('#rpc-required-quorum')?.textContent,
						status: document.querySelector('#rpc-health-status')?.textContent,
					})`),
				).toEqual({
					chain: 'Unavailable until state refresh succeeds',
					configured: '—',
					healthy: '—',
					lastCheck: 'Previous health result is stale',
					localRetry: {
						accessibleName: 'Retry dashboard state refresh',
						bottom: expect.any(Number),
						disabled: false,
						height: expect.any(Number),
						top: expect.any(Number),
					},
					required: '—',
					status: 'Health unavailable',
				})
				expect(
					await cdp.evaluate(`({
						freshness: document.querySelector('#submission-freshness')?.textContent,
						status: document.querySelector('#submission-health-status')?.textContent,
					})`),
				).toEqual({ freshness: 'Previous readiness is stale', status: 'Path unavailable' })
				if (viewport.label === 'mobile') {
					const bounds = await cdp.evaluate(`new Promise(resolve => {
						const panel = document.querySelector('.rpc-health-panel')
						panel?.scrollIntoView({ block: 'start' })
						requestAnimationFrame(() => requestAnimationFrame(() => {
							const buttonBounds = document.querySelector('#rpc-health-retry-button')?.getBoundingClientRect()
							resolve({ bottom: buttonBounds?.bottom, height: buttonBounds?.height, top: buttonBounds?.top })
						}))
					})`)
					expect(Reflect.get(Object(bounds), 'top')).toBeGreaterThanOrEqual(0)
					expect(Reflect.get(Object(bounds), 'bottom')).toBeLessThanOrEqual(viewport.height)
					expect(Reflect.get(Object(bounds), 'height')).toBeGreaterThanOrEqual(44)
				}
				failSecondStateRead = false
				await cdp.evaluate("document.querySelector('#rpc-health-retry-button')?.click()")
				await waitFor(
					"document.querySelector('#rpc-health-status')?.textContent === 'Quorum ready' && document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#rpc-health-retry-button')?.classList.contains('hidden') === true",
					`${viewport.label} RPC health did not recover through its local Retry`,
				)
				const renderedSteps = await cdp.evaluate(`[...document.querySelectorAll('#current-workflow .step-list li')].map(row => {
					const status = row.querySelector('[data-step-status]')
					const hash = row.querySelector('[data-step-hash]')
					const hashDisplay = hash?.querySelector('.identifier-value')
					const label = row.querySelector('.step-label')
					const statusBounds = status?.getBoundingClientRect()
					return {
						hash: hashDisplay?.textContent ?? null,
						label: label?.textContent,
						labelFits: label !== null && label.scrollWidth <= label.clientWidth,
						markerHidden: row.querySelector('.step-dot')?.getAttribute('aria-hidden'),
						status: status?.textContent,
						statusCode: status?.getAttribute('data-step-status'),
						statusVisible: (statusBounds?.width ?? 0) > 0 && (statusBounds?.height ?? 0) > 0,
					}
				})`)
				expect(renderedSteps).toHaveLength(workflowSteps.length)
				for (const [index, rendered] of (Array.isArray(renderedSteps) ? renderedSteps : []).entries()) {
					const expected = workflowSteps[index]
					if (expected === undefined) throw new Error('Rendered an unexpected workflow step')
					const expectedStatus = expected.status === undefined ? 'Waiting' : `${expected.status.slice(0, 1).toUpperCase()}${expected.status.slice(1)}`
					expect(Reflect.get(rendered, 'label')).toBe(expected.label)
					expect(Reflect.get(rendered, 'labelFits')).toBe(true)
					expect(Reflect.get(rendered, 'status')).toBe(expectedStatus)
					expect(Reflect.get(rendered, 'statusCode')).toBe(expected.status ?? 'waiting')
					expect(Reflect.get(rendered, 'statusVisible')).toBe(true)
					expect(Reflect.get(rendered, 'markerHidden')).toBe('true')
					if (expected.transactionHash === undefined) {
						expect(Reflect.get(rendered, 'hash')).toBeNull()
					} else {
						expect(Reflect.get(rendered, 'hash')).toBe(expected.transactionHash)
					}
				}
				expect(await cdp.evaluate(`({ scheduler: document.querySelector('#scheduler-state')?.textContent, workflow: document.querySelector('#current-workflow .workflow-heading .badge')?.textContent })`)).toEqual({ scheduler: 'Transaction recovery pending', workflow: 'Waiting transaction' })
				const waitNote = await cdp.evaluate(`(() => {
					const note = document.querySelector('#current-workflow .transaction-wait')
					const bounds = note?.getBoundingClientRect()
					return { className: note?.className, detail: note?.querySelector('small')?.textContent, headline: note?.querySelector('strong')?.textContent, visible: (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 }
				})()`)
				// The fixture queues a replacement, which recovery verifies before anything else, so that takes precedence over the observation.
				expect(waitNote).toEqual({ className: 'transaction-wait info', detail: 'Waiting for its canonically included receipt before the original intent is closed.', headline: 'Verifying the queued replacement', visible: true })
				await expectVisibleIdentifiers(
					[
						{ type: 'wallet address', value: walletAddress },
						{ explorerUrl: explorerTransaction(activityHash), type: 'activity transaction hash', value: activityHash },
						...workflowSteps.flatMap(step => (step.transactionHash === undefined ? [] : [{ explorerUrl: explorerTransaction(step.transactionHash), type: 'workflow transaction hash', value: step.transactionHash }])),
					],
					viewport.width === 390 ? 44 : 32,
				)
				if (viewport.width === 390) {
					const contextualActionHeights = await cdp.evaluate(`[...document.querySelectorAll('.text-link')].flatMap(link => {
						const bounds = link.getBoundingClientRect()
						return bounds.width === 0 || bounds.height === 0 ? [] : [bounds.height]
					})`)
					expect(contextualActionHeights).toHaveLength(2)
					for (const height of Array.isArray(contextualActionHeights) ? contextualActionHeights : []) {
						if (typeof height !== 'number') throw new Error('Missing contextual action bounds')
						expect(height).toBeGreaterThanOrEqual(44)
					}
				}

				expect(
					await cdp.evaluate(`(() => {
					const value = document.querySelector('[data-identifier-type="wallet address"] .identifier-value')
					const range = document.createRange()
					range.selectNodeContents(value)
					const selection = window.getSelection()
					selection.removeAllRanges()
					selection.addRange(range)
					return selection.toString()
				})()`),
				).toBe(walletAddress)

				await cdp.command('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
				await waitFor("document.querySelector('header #last-block')?.textContent === 'Block 12345678'", 'Shared block header did not render on the catalog route')
				await waitFor("document.querySelector('#catalog-caption')?.textContent?.includes('2 live candidates') === true", 'Grouped operation catalog did not render')
				expect(await cdp.evaluate("document.querySelectorAll('#catalog-rows .operation-id-copy, #catalog-rows .operation-name small.mono').length")).toBe(0)
				await cdp.evaluate("document.querySelectorAll('#catalog-rows details').forEach(group => { group.open = true })")
				expect(
					await cdp.evaluate(`(() => {
						const alias = [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.textContent?.includes('claimAuctionProceeds'))
						const selectableAlias = [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.querySelector('.operation-name strong')?.textContent === 'WETH9.receive')
						const statoblast = [...document.querySelectorAll('#coverage-summary .coverage-card')].find(card => card.textContent?.includes('Statoblast'))
						return {
							aliasClassification: selectableAlias?.querySelector('td:nth-child(2) .badge')?.textContent,
							aliasCopyable: selectableAlias?.querySelector('.operation-id-copy') instanceof HTMLButtonElement,
							aliasEligibility: selectableAlias?.querySelector('td:nth-child(5) .badge')?.textContent,
							coverage: statoblast?.querySelector('strong')?.textContent,
							eligibility: alias?.querySelector('td:nth-child(5) .badge')?.textContent,
						}
					})()`),
				).toEqual({
					aliasClassification: 'Coverage alias',
					aliasCopyable: false,
					aliasEligibility: 'Not independently selectable',
					coverage: '0/0',
					eligibility: 'Not independently selectable',
				})
				const redundantCatalogCopy = await cdp.evaluate(`(() => {
					const normalize = value => value?.trim().replaceAll(/\\s+/g, ' ').replace(/[.?!]+$/, '').toLowerCase()
					return [...document.querySelectorAll('#catalog-rows tbody tr')].flatMap(row => {
						const description = row.querySelector('.operation-name > small:not(.mono)')?.textContent
						const normalizedDescription = normalize(description)
						if (normalizedDescription === undefined || normalizedDescription === '') return []
						const duplicate = [...row.querySelectorAll('.blocker-list li')].some(blocker => normalize(blocker.textContent) === normalizedDescription)
						return duplicate ? [row.querySelector('.operation-name strong')?.textContent] : []
					})
				})()`)
				expect(redundantCatalogCopy).toEqual([])
				expect(
					await cdp.evaluate(`(() => {
						const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.textContent?.includes('Pool.initialize'))
						return {
							blockers: [...(row?.querySelectorAll('.blocker-list li') ?? [])].map(blocker => blocker.textContent),
							descriptions: row?.querySelectorAll('.operation-name > small:not(.mono)').length,
						}
					})()`),
				).toEqual({ blockers: ['factory only'], descriptions: 0 })
				expect(
					await cdp.evaluate(`(() => {
						const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.querySelector('.operation-name strong')?.textContent === 'Settle report')
						return {
							blockers: row?.querySelectorAll('.blocker-list li').length,
							description: row?.querySelector('.operation-description')?.textContent,
						}
					})()`),
				).toEqual({ blockers: 0, description: 'Settle the anchored report.' })
				if (viewport.label === 'desktop') {
					expect(
						await cdp.evaluate(`({
								candidate: [...document.querySelectorAll('#catalog-rows tbody tr')].find(row => row.querySelector('.operation-name strong')?.textContent === 'Settle report')?.querySelector('td:nth-child(4)')?.textContent,
								rows: document.querySelectorAll('#catalog-rows tbody tr').length,
							})`),
					).toEqual({ candidate: '2', rows: 6 })
					expect(
						await cdp.evaluate(`(() => {
							const shell = document.querySelector('#catalog-rows .table-shell')
							const headers = [...shell.querySelectorAll('thead th')]
							if (!(shell instanceof HTMLElement)) return undefined
							const eligibilityBounds = headers.at(-1)?.getBoundingClientRect()
							return {
								allColumnsVisible: eligibilityBounds !== undefined && eligibilityBounds.right <= shell.getBoundingClientRect().right + 1,
								headerLabels: headers.map(header => header.textContent?.trim()),
								horizontalOverflow: shell.scrollWidth > shell.clientWidth,
							}
						})()`),
					).toEqual({ allColumnsVisible: true, headerLabels: ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility'], horizontalOverflow: false })
					await cdp.evaluate(`(() => {
						const filter = document.querySelector('#catalog-classification-filter')
						if (!(filter instanceof HTMLSelectElement)) return
						filter.value = 'coverage-alias'
						filter.dispatchEvent(new Event('change', { bubbles: true }))
					})()`)
					expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('WETH9.receive') === true && document.querySelectorAll('#catalog-rows tbody tr').length === 1`)).toBe(true)
					await cdp.evaluate(`(() => {
							const filter = document.querySelector('#catalog-classification-filter')
							if (!(filter instanceof HTMLSelectElement)) return
							filter.value = 'role-restricted'
							filter.dispatchEvent(new Event('change', { bubbles: true }))
						})()`)
					expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('Pool.initialize') === true && document.querySelectorAll('#catalog-rows tbody tr').length === 1`)).toBe(true)
				} else {
					const mobileCatalog = await cdp.evaluate(`(() => {
						const shell = document.querySelector('#catalog-rows [data-ecosystem="open-oracle"] .table-shell')
						const row = [...document.querySelectorAll('#catalog-rows tbody tr')].find(candidate => candidate.querySelector('.operation-name strong')?.textContent === 'Blocked report sibling')
						if (!(shell instanceof HTMLElement) || !(row instanceof HTMLTableRowElement)) return undefined
						const operationLabel = row.querySelector('.operation-name strong')
						const blocker = row.querySelector('.blocker-list li')
						if (operationLabel !== null) operationLabel.textContent = ${JSON.stringify(longCatalogLabel)}
						if (blocker !== null) blocker.textContent = ${JSON.stringify(longCatalogBlocker)}
						shell.scrollLeft = shell.scrollWidth
						const cells = [...row.querySelectorAll(':scope > td')]
						const rowBounds = row.getBoundingClientRect()
						const shellBounds = shell.getBoundingClientRect()
						return {
							blocker: blocker?.textContent,
							candidateCount: cells[3]?.textContent?.trim(),
							cellLabels: cells.map(cell => getComputedStyle(cell, '::before').content.replaceAll('"', '')),
							cellsContained: cells.every(cell => {
								const bounds = cell.getBoundingClientRect()
								return bounds.left >= rowBounds.left - 1 && bounds.right <= rowBounds.right + 1 && cell.scrollWidth <= cell.clientWidth
							}),
							documentOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
							eligibility: cells[4]?.querySelector('.badge')?.textContent,
							identity: operationLabel?.textContent,
							maximumHorizontalScroll: shell.scrollWidth - shell.clientWidth,
							risk: cells[2]?.querySelector('.badge')?.textContent,
							rowContained: rowBounds.left >= shellBounds.left - 1 && rowBounds.right <= shellBounds.right + 1 && row.scrollWidth <= row.clientWidth,
							rowDisplay: getComputedStyle(row).display,
							shellOverflow: shell.scrollWidth > shell.clientWidth,
						}
					})()`)
					const copyTargetHeights = await cdp.evaluate(`[...document.querySelectorAll('#catalog-rows .operation-open')].map(button => button.getBoundingClientRect().height)`)
					expect(Array.isArray(copyTargetHeights)).toBe(true)
					if (!Array.isArray(copyTargetHeights)) throw new Error('Mobile catalog Open operation controls did not render')
					expect(copyTargetHeights.length).toBeGreaterThan(0)
					for (const height of copyTargetHeights) expect(height).toBeGreaterThanOrEqual(44)
					expect(mobileCatalog).toEqual({
						blocker: longCatalogBlocker,
						candidateCount: '0',
						cellLabels: ['Operation', 'Classification', 'Risk', 'Candidates', 'Eligibility'],
						cellsContained: true,
						documentOverflow: false,
						eligibility: 'Blocked',
						identity: longCatalogLabel,
						maximumHorizontalScroll: 0,
						risk: 'Low',
						rowContained: true,
						rowDisplay: 'grid',
						shellOverflow: false,
					})
				}

				await cdp.command('Page.navigate', { url: new URL('/ecosystem', dashboard.url).href })
				await waitFor("document.querySelector('#topology-anchor')?.textContent === 'Block 4242'", `${viewport.label} anchored topology did not render`)
				expect(await cdp.evaluate(`[...document.querySelectorAll('#ecosystem-grid .ecosystem-metrics')].map(metrics => [...metrics.querySelectorAll('span')].map(label => label.textContent))`)).toEqual(Array.from({ length: 4 }, () => ['Independent operations', 'Eligible', 'Candidates']))
				expect(await cdp.evaluate("document.querySelector('#topology-status')?.textContent")).toBe('5 protocol identities · discovery complete.')
				expect(
					await cdp.evaluate(`({
							auctions: document.querySelectorAll('#topology-auctions .topology-row').length,
							pairs: document.querySelectorAll('#topology-pairs .topology-row').length,
							pools: document.querySelectorAll('#topology-pools .topology-row').length,
							reports: document.querySelectorAll('#topology-reports .topology-row').length,
							universes: document.querySelectorAll('#topology-universes .topology-row').length,
						})`),
				).toEqual({ auctions: 1, pairs: 1, pools: 1, reports: 1, universes: 1 })
				const topologyPresentation = await cdp.evaluate(`({
					summaryHeights: [...document.querySelectorAll('.topology-grid summary')].map(summary => summary.getBoundingClientRect().height),
					topbarBackground: getComputedStyle(document.querySelector('.operator-shell')).backgroundColor,
				})`)
				expect(Reflect.get(Object(topologyPresentation), 'topbarBackground')).toBe('color(srgb 0.0627451 0.0823529 0.113725 / 0.82)')
				const summaryHeights = Reflect.get(Object(topologyPresentation), 'summaryHeights')
				expect(summaryHeights).toHaveLength(5)
				if (!Array.isArray(summaryHeights)) throw new Error('Missing topology summary bounds')
				for (const height of summaryHeights) {
					if (typeof height !== 'number') throw new Error('Missing topology summary bounds')
					expect(height).toBeGreaterThanOrEqual(44)
				}
				await expectVisibleIdentifiers(topologyIdentifiers, viewport.width === 390 ? 44 : 32, '.topology-panel .full-identifier')
				const ecosystemCards = await cdp.evaluate(`[...document.querySelectorAll('#ecosystem-grid .ecosystem-card')].map(card => ({
					blockers: [...card.querySelectorAll('.blocker-list li')].map(item => item.textContent),
					ecosystem: card.getAttribute('data-ecosystem'),
					readiness: card.querySelector('.panel-heading .badge')?.textContent,
					summary: card.querySelector(':scope > p, :scope > ul')?.textContent,
				}))`)
				const openOracleCard = Array.isArray(ecosystemCards) ? ecosystemCards.find(card => Reflect.get(card, 'ecosystem') === 'open-oracle') : undefined
				const tradingCard = Array.isArray(ecosystemCards) ? ecosystemCards.find(card => Reflect.get(card, 'ecosystem') === 'trading') : undefined
				expect(openOracleCard).toEqual({ blockers: [], ecosystem: 'open-oracle', readiness: 'Ready' })
				expect(tradingCard).toEqual({ blockers: ['Router enter: No safe route exists'], ecosystem: 'trading', readiness: 'Blocked', summary: 'Router enter: No safe route exists' })
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

				await cdp.command('Page.navigate', { url: new URL('/recovery', dashboard.url).href })
				await waitFor("document.querySelector('#pending-transactions .identifier-value') !== null", `${viewport.label} recovery identifiers did not render`)
				expect(
					await cdp.evaluate(`({
						replacement: document.querySelector('#replacement-form')?.hidden,
						cancellation: document.querySelector('#cancellation-form')?.hidden,
						candidate: document.querySelector('#candidate-form')?.hidden,
					})`),
				).toEqual({ replacement: true, cancellation: true, candidate: false })
				expect(await cdp.evaluate("document.querySelector('#pending-transactions .transaction-wait strong')?.textContent")).toBe('Verifying the queued replacement')
				expect(
					await cdp.evaluate(`(() => {
						const row = document.querySelector('#pending-transactions .stack-row')
						const note = row?.querySelector('.transaction-wait')
						const headline = note?.querySelector('strong')
						const detail = note?.querySelector('small')
						if (!(row instanceof HTMLElement) || !(note instanceof HTMLElement) || !(headline instanceof HTMLElement) || !(detail instanceof HTMLElement)) return undefined
						const rowStyle = getComputedStyle(row)
						const noteStyle = getComputedStyle(note)
						const contentHeight = headline.offsetHeight + detail.offsetHeight + parseFloat(noteStyle.rowGap) + parseFloat(noteStyle.paddingTop) + parseFloat(noteStyle.paddingBottom) + parseFloat(noteStyle.borderTopWidth) + parseFloat(noteStyle.borderBottomWidth)
						return {
							contained: note.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom && note.getBoundingClientRect().top >= row.getBoundingClientRect().top,
							contentSized: Math.abs(note.offsetHeight - contentHeight) <= 2,
							fullWidth: Math.round(note.getBoundingClientRect().width) === Math.round(row.clientWidth - parseFloat(rowStyle.paddingLeft) - parseFloat(rowStyle.paddingRight)),
						}
					})()`),
				).toEqual({ contained: true, contentSized: true, fullWidth: true })
				await expectVisibleIdentifiers(
					[
						{ explorerUrl: explorerTransaction(transactionHash), type: 'pending transaction hash', value: transactionHash },
						{ explorerUrl: explorerTransaction(candidateHash), type: 'replacement transaction hash', value: candidateHash },
						{ explorerUrl: explorerTransaction(cancellationHash), type: 'cancellation transaction hash', value: cancellationHash },
					],
					viewport.width === 390 ? 44 : 32,
				)
				expect(
					await cdp.evaluate(`({
						obligation: document.querySelector('#obligations .badge')?.textContent,
						option: document.querySelector('#obligation-id option')?.textContent,
						pending: document.querySelector('#pending-transactions .badge')?.textContent,
					})`),
				).toEqual({ obligation: 'Executing', option: 'Rendered obligation · Executing', pending: 'Waiting transaction' })
				expect(
					await cdp.evaluate(`(() => {
						const row = [...document.querySelectorAll('#obligations .stack-row')].find(candidate => candidate.textContent?.includes('Deferred obligation'))
						return { detail: row?.querySelector('small')?.textContent, status: row?.querySelector('.badge')?.textContent, tone: row?.querySelector('.badge')?.className }
					})()`),
				).toEqual({ detail: 'Open Oracle · 1 of 3 included attempts failed · next attempt Aug 24, 2026, 12:03:00 AM', status: 'Retry waiting', tone: 'badge warning' })
				const recoveryTextarea = await cdp.evaluate(`(() => {
					const fields = document.querySelector('#candidate-fields')
					const input = document.querySelector('#candidate-confirmation')
					const textarea = document.querySelector('#candidate-reason')
					if (!(fields instanceof HTMLFieldSetElement) || !(input instanceof HTMLInputElement) || !(textarea instanceof HTMLTextAreaElement)) return undefined
					const disabled = textarea.matches(':disabled')
					const disabledStyle = getComputedStyle(textarea)
					const inputStyle = getComputedStyle(input)
					const styledLikeInput =
						disabledStyle.backgroundColor === inputStyle.backgroundColor &&
						disabledStyle.borderColor === inputStyle.borderColor &&
						disabledStyle.borderRadius === inputStyle.borderRadius &&
						disabledStyle.color === inputStyle.color &&
						disabledStyle.fontFamily === inputStyle.fontFamily
					fields.disabled = false
					textarea.value = 'Operator confirmed the canonical recovery state.'
					textarea.focus()
					const enabledStyle = getComputedStyle(textarea)
					return {
						disabled,
						enabled: !textarea.matches(':disabled'),
						minimumHeight: Number.parseFloat(enabledStyle.minHeight),
						styledLikeInput,
						value: textarea.value,
					}
				})()`)
				expect(recoveryTextarea).toEqual({
					disabled: true,
					enabled: true,
					minimumHeight: 80,
					styledLikeInput: true,
					value: 'Operator confirmed the canonical recovery state.',
				})
				const previousInitialState = initialDashboardState
				const previousRecoveredState = recoveredDashboardState
				initialDashboardState = state({ pendingTransactions: [{ hash: transactionHash, replacementHash: candidateHash, status: 'submitted' }] })
				recoveredDashboardState = initialDashboardState
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#candidate-reason')?.matches(':disabled') === false", 'Recovery textarea did not become available from current state')
				await cdp.evaluate("document.querySelector('#candidate-reason')?.focus()")
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyDown', windowsVirtualKeyCode: 9 })
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', type: 'keyUp', windowsVirtualKeyCode: 9 })
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', modifiers: 8, type: 'keyDown', windowsVirtualKeyCode: 9 })
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', modifiers: 8, type: 'keyUp', windowsVirtualKeyCode: 9 })
				expect(
					await cdp.evaluate(`(() => {
						const textarea = document.querySelector('#candidate-reason')
						if (!(textarea instanceof HTMLTextAreaElement)) return undefined
						const style = getComputedStyle(textarea)
						return { focused: document.activeElement === textarea, outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
					})()`),
				).toEqual({ focused: true, outlineStyle: 'solid', outlineWidth: '2px' })
				initialDashboardState = previousInitialState
				recoveredDashboardState = previousRecoveredState

				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#activity-list .identifier-value') !== null", `${viewport.label} overview activity did not render`)
				expect(
					await cdp.evaluate(`({
						activity: document.querySelector('#activity-list .badge')?.textContent,
						expandHidden: document.querySelector('#activity-expand')?.classList.contains('hidden'),
					})`),
				).toEqual({ activity: 'Dry run', expandHidden: true })

				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#signer-summary .identifier-value') !== null", `${viewport.label} signer identifier did not render`)
				await expectVisibleIdentifiers([{ type: 'transaction signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32)
				expect(
					await cdp.evaluate(`({
						catalogLink: {
							href: document.querySelector('#selectable-operation-catalog-link')?.getAttribute('href'),
							text: document.querySelector('#selectable-operation-catalog-link')?.textContent,
						},
						executeDescription: document.querySelector('#execution-enabled')?.getAttribute('aria-describedby'),
						executeHelp: document.querySelector('#execution-form .section-note')?.textContent,
						connectivityDisabled: document.querySelector('#connectivity-fields')?.disabled,
						connectivityHelp: document.querySelector('#connectivity-fields .notice')?.textContent,
						initializerHelp: document.querySelector('label[for="initialize-genesis-universe"] + p')?.textContent,
						initializerHelpId: document.querySelector('#initialize-genesis-universe')?.getAttribute('aria-describedby'),
						initializeGenesisUniverse: document.querySelector('#initialize-genesis-universe')?.checked,
						selectableScopeHelp: document.querySelector('#all-selectable-operations-help')?.textContent,
						readRpcUrl: document.querySelector('#read-rpc-url')?.value,
						lede: document.querySelector('#settings-chain-scope')?.textContent,
						locked: document.querySelector('#settings-fields')?.disabled,
						pauseNote: document.querySelector('#settings-pause-note')?.textContent,
						pauseNoteVisible: document.querySelector('#settings-pause-note')?.classList.contains('hidden') === false,
					})`),
				).toEqual({
					catalogLink: { href: '/catalog', text: 'Operation catalog' },
					connectivityDisabled: false,
					connectivityHelp: "RPC checks run from the chaos-bot server. Docker service URLs such as http://reth:8545 work only when that process shares the service's container network. Saved endpoint URLs remain visible here so the active configuration can be reviewed and edited.",
					initializerHelp:
						'Continuously completes the exact genesis topology: binary question, origin security pool, wallet vault, external REP/WETH Uniswap pool creation, initialization, and seeding, Statoblast trading roots, canonical trading pair, and initial pair liquidity. Only these initializer operations bypass the selectable allowlist.',
					initializerHelpId: 'initialize-genesis-universe-help',
					initializeGenesisUniverse: true,
					readRpcUrl: `https://operator:${rpcSecret}@read-one.example/private`,
					selectableScopeHelp:
						'Turn this off for a staged rollout, then enable operations in the Operation catalog. An empty allowlist runs lifecycle obligations only unless genesis initialization is enabled; only its ordered initializer operations are exempt. Lifecycle discovery, recovery, and execution are never disabled by this control.',
					executeDescription: 'execution-checklist',
					executeHelp: 'Off is dry-run mode. Live mode can spend gas and protocol assets.',
					lede: 'Changes apply before the next selection cycle.',
					locked: true,
					pauseNote: 'Execution policy and execution mode are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, ecosystem scope, or the live switch.',
					pauseNoteVisible: true,
				})
				await cdp.evaluate(`(() => {
					const quorum = document.querySelector('#rpc-quorum')
					if (!(quorum instanceof HTMLSelectElement)) return false
					quorum.value = '1'
					quorum.dispatchEvent(new InputEvent('input', { bubbles: true }))
					return true
				})()`)
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false && document.querySelector('#rpc-quorum')?.value === '1'", `${viewport.label} RPC quorum draft was not preserved across a same-revision refresh`)
				await cdp.evaluate("document.querySelector('#discard-connectivity')?.click()")
				await waitFor("document.querySelector('#rpc-quorum')?.value === '2'", `${viewport.label} discarded RPC quorum draft did not restore the current configuration`)
				await cdp.evaluate(`(() => {
					const form = document.querySelector('#connectivity-form')
					const read = document.querySelector('#read-rpc-url')
					if (!(form instanceof HTMLFormElement) || !(read instanceof HTMLInputElement)) return false
					read.value = 'http://stale-draft.example'
					read.dispatchEvent(new InputEvent('input', { bubbles: true }))
					return true
				})()`)
				configurationRevision = nextConfigurationRevision
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor(
					"document.querySelector('#connectivity-status')?.textContent === 'Configuration changed elsewhere. Discard this RPC draft and re-enter the complete replacement set before saving.' && document.querySelector('#save-connectivity')?.matches(':disabled') === true",
					`${viewport.label} stale RPC draft was not blocked after a newer configuration loaded`,
				)
				const staleConnectivityMutationCount = connectivityMutations.length
				await cdp.evaluate("document.querySelector('#connectivity-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))")
				await Bun.sleep(50)
				expect(connectivityMutations.length).toBe(staleConnectivityMutationCount)
				await cdp.evaluate("document.querySelector('#discard-connectivity')?.click()")
				await waitFor(`document.querySelector('#read-rpc-url')?.value === 'https://operator:${rpcSecret}@read-one.example/private' && document.querySelector('#save-connectivity')?.matches(':disabled') === false`, `${viewport.label} stale RPC draft could not restore the saved endpoint`)
				const connectivityMutationCount = connectivityMutations.length + 1
				await cdp.evaluate(`(() => {
					const read = document.querySelector('#read-rpc-url')
					const publicRpcs = document.querySelector('#public-rpc-urls')
					const quorumRpcs = document.querySelector('#quorum-rpc-urls')
					const form = document.querySelector('#connectivity-form')
					if (!(read instanceof HTMLInputElement) || !(publicRpcs instanceof HTMLTextAreaElement) || !(quorumRpcs instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return false
					read.value = 'http://reth:8545'
					publicRpcs.value = 'http://reth:8545'
					quorumRpcs.value = 'http://anvil:8545'
					read.dispatchEvent(new InputEvent('input', { bubbles: true }))
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					return true
				})()`)
				await waitForConnectivityMutation(connectivityMutationCount, `${viewport.label} RPC connectivity form did not submit through the dashboard server`)
				expect(connectivityMutations.at(-1)).toEqual({
					connectivity: { publicRpcUrls: ['http://reth:8545'], quorumRpcUrls: ['http://anvil:8545'], readRpcUrl: 'http://reth:8545', rpcQuorum: 2 },
					revision: nextConfigurationRevision,
				})
				await waitFor(
					"document.querySelector('#connectivity-status')?.textContent === 'Chain and RPCs passed server-side validation and were saved.' && document.querySelector('#save-connectivity')?.matches(':disabled') === false",
					`${viewport.label} RPC connectivity form did not report success and return to a usable state`,
				)
				expect(
					await cdp.evaluate(`(() => {
						const input = document.querySelector('#workflow-valid-blocks')
						const unit = input?.nextElementSibling
						const bounds = unit?.getBoundingClientRect()
						return { disabled: input?.matches(':disabled'), unit: unit?.textContent?.trim(), unitVisible: (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 }
					})()`),
				).toEqual({ disabled: true, unit: 'blocks', unitVisible: true })
				const disabledButtonPresentation = await cdp.evaluate(`(() => {
					const button = document.querySelector('#save-settings')
					if (!(button instanceof HTMLButtonElement)) return undefined
					const style = getComputedStyle(button)
					const luminance = value => {
						const channels = value.match(/\\d+(?:\\.\\d+)?/g)?.slice(0, 3).map(Number)
						if (channels?.length !== 3) return undefined
						const linear = channels.map(channel => {
							const normalized = channel / 255
							return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
						})
						return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
					}
					const foreground = luminance(style.color)
					const background = luminance(style.backgroundColor)
					return {
						contrast: foreground === undefined || background === undefined ? undefined : (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
						opacity: style.opacity,
					}
				})()`)
				expect(Reflect.get(Object(disabledButtonPresentation), 'opacity')).toBe('1')
				expect(Reflect.get(Object(disabledButtonPresentation), 'contrast')).toBeGreaterThanOrEqual(4.5)
				failNextStateRead = true
				await cdp.command('Network.setBlockedURLs', { urls: [`*://127.0.0.1:${dashboardPort.toString()}/api/signer`] })
				await cdp.evaluate(`(() => {
						const input = document.querySelector('#private-key')
						const form = document.querySelector('#signer-form')
						if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
						input.value = ${JSON.stringify(`0x${'99'.repeat(32)}`)}
						form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					})()`)
				await waitFor("document.querySelector('#signer-status')?.textContent?.includes('configuration and state could not be reloaded') === true", `${viewport.label} partial signer reconciliation did not remain unresolved`)
				expect(await cdp.evaluate(`document.querySelector('#signer-fieldset')?.disabled`)).toBe(true)
				await cdp.command('Network.setBlockedURLs', { urls: [] })
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#signer-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#signer-fieldset')?.disabled === false", `${viewport.label} unresolved signer mutation did not recover after a complete refresh`)

				initialDashboardState = pausedWorkflowRenderingState
				recoveredDashboardState = pausedWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} paused execution policy did not become editable`)
				expect(
					await cdp.evaluate(`(() => {
						const input = document.querySelector('#workflow-valid-blocks')
						const unit = input?.nextElementSibling
						const bounds = unit?.getBoundingClientRect()
						return { disabled: input?.matches(':disabled'), unit: unit?.textContent?.trim(), unitVisible: (bounds?.width ?? 0) > 0 && (bounds?.height ?? 0) > 0 }
					})()`),
				).toEqual({ disabled: false, unit: 'blocks', unitVisible: true })
				failNextStateRead = true
				await cdp.command('Network.setBlockedURLs', { urls: [`*://127.0.0.1:${dashboardPort.toString()}/api/settings`] })
				await cdp.evaluate(`document.querySelector('#settings-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('configuration and state could not be reloaded') === true", `${viewport.label} partial settings reconciliation did not remain unresolved`)
				expect(await cdp.evaluate(`document.querySelector('#settings-fields')?.disabled`)).toBe(true)
				await cdp.command('Network.setBlockedURLs', { urls: [] })
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} unresolved settings mutation did not recover after a complete refresh`)
				expect(
					await cdp.evaluate(`({
						all: document.querySelector('#all-selectable-operations')?.checked,
						allowlistDisabled: document.querySelector('#selectable-operation-allowlist')?.disabled,
					})`),
				).toEqual({ all: true, allowlistDisabled: true })
				const rejectedAllowlistMutationCount = settingsMutations.length
				await cdp.evaluate(`(() => {
					const all = document.querySelector('#all-selectable-operations')
					const allowlist = document.querySelector('#selectable-operation-allowlist')
					const form = document.querySelector('#settings-form')
					if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
					all.checked = false
					all.dispatchEvent(new InputEvent('input', { bubbles: true }))
					allowlist.value = 'surface.weth9.receive'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Unknown independently selectable operation definition ID surface.weth9.receive') === true", `${viewport.label} coverage-only alias was not rejected from the selectable-operation allowlist`)
				expect(settingsMutations).toHaveLength(rejectedAllowlistMutationCount)
				await cdp.evaluate(`(() => {
					const all = document.querySelector('#all-selectable-operations')
					const allowlist = document.querySelector('#selectable-operation-allowlist')
					const form = document.querySelector('#settings-form')
					if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
					all.checked = false
					all.dispatchEvent(new InputEvent('input', { bubbles: true }))
					allowlist.value = 'open-oracle.weth.typo'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Unknown independently selectable operation definition ID open-oracle.weth.typo') === true", `${viewport.label} unknown selectable operation ID was not rejected locally`)
				expect(settingsMutations).toHaveLength(rejectedAllowlistMutationCount)
				const stagedAllowlistMutationCount = settingsMutations.length + 1
				await cdp.evaluate(`(() => {
					const all = document.querySelector('#all-selectable-operations')
					const allowlist = document.querySelector('#selectable-operation-allowlist')
					const form = document.querySelector('#settings-form')
					if (!(all instanceof HTMLInputElement) || !(allowlist instanceof HTMLTextAreaElement) || !(form instanceof HTMLFormElement)) return
					all.checked = false
					all.dispatchEvent(new InputEvent('input', { bubbles: true }))
					allowlist.value = 'open-oracle.blocked-sibling\\ntrading.position.enter'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitForSettingsMutation(stagedAllowlistMutationCount, `${viewport.label} selectable-operation canary policy was not submitted`)
				expect(settingsMutations.at(-1)).toMatchObject({
					patch: { strategy: { selectableOperationAllowlist: ['open-oracle.blocked-sibling', 'trading.position.enter'] } },
				})
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} selectable-operation canary policy did not reconcile`)
				const highRiskMutationCount = settingsMutations.length + 1
				await cdp.evaluate(`(() => {
					window.operatorDialogReview = ''
					const highRisk = document.querySelector('#allow-high-risk')
					const form = document.querySelector('#settings-form')
					if (!(highRisk instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					highRisk.checked = true
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitForSettingsMutation(highRiskMutationCount, `${viewport.label} high-risk policy was not submitted`)
				expect(await cdp.evaluate('window.operatorDialogReview')).toMatch(/High-risk operations\s*Blocked\s*→\s*Allowed/)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} high-risk policy did not reconcile`)
				await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
				await cdp.evaluate(`(() => {
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					ethReserve.value = '0'
					repReserve.value = '10'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must be greater than zero for live execution.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a zero ETH reserve locally`)
				await cdp.evaluate(`(() => {
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					ethReserve.value = '0.05'
					repReserve.value = '0.000000000000000000'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'REP reserve must be greater than zero for live execution.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a zero REP reserve locally`)
				await cdp.evaluate(`(() => {
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					ethReserve.value = '0.01'
					repReserve.value = '10'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must retain at least one maximum-gas-cost-sized safety floor.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not retain one full gas budget as a safety floor`)
				const mutationCountBeforePrecisionCheck = settingsMutations.length
				await setExecutionMode(false, `${viewport.label} execution mode did not switch to dry run`)
				await cdp.evaluate(`(() => {
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					ethReserve.value = '0.0000000000000000001'
					repReserve.value = '0'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor(
					"document.querySelector('#settings-save-status')?.textContent === 'ETH reserve must be a non-negative decimal amount with at most 18 places.' && document.querySelector('#settings-fields')?.disabled === false",
					`${viewport.label} policy did not reject reserve precision beyond 18 decimal places locally`,
				)
				expect(settingsMutations).toHaveLength(mutationCountBeforePrecisionCheck)

				const mutationCountBeforeEqualDelay = settingsMutations.length
				await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
				await cdp.evaluate(`(() => {
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					minDelay.value = '60'
					maxDelay.value = '60'
					ethReserve.value = '0.05'
					repReserve.value = '10'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Minimum delay must be at least one second less than maximum delay.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject equal delay bounds locally`)
				expect(settingsMutations).toHaveLength(mutationCountBeforeEqualDelay)

				const mutationCountBeforeMaximumMinimumDelay = settingsMutations.length
				expect(await cdp.evaluate("document.querySelector('#min-delay')?.getAttribute('max')")).toBe('3599')
				await cdp.evaluate(`(() => {
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const form = document.querySelector('#settings-form')
					if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					minDelay.value = '3600'
					maxDelay.value = '3600'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
				})()`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Minimum delay must be at least one second less than maximum delay.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} live policy did not reject a 3600-second minimum delay locally`)
				expect(settingsMutations).toHaveLength(mutationCountBeforeMaximumMinimumDelay)

				const dryRunMutationCount = settingsMutations.length + 1
				await setExecutionMode(false, `${viewport.label} execution mode did not switch to dry run`)
				await cdp.evaluate(`(() => {
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const maximumGasCost = document.querySelector('#maximum-gas-cost')
					const form = document.querySelector('#settings-form')
					if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					minDelay.value = '60'
					maxDelay.value = '3600'
					ethReserve.value = '0'
					repReserve.value = '0.000000000000000000'
					maximumGasCost.value = '0.02'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					})()`)
				await waitForSettingsMutation(dryRunMutationCount, `${viewport.label} dry-run zero-reserve policy was not submitted`)
				expect(settingsMutations.at(-1)).toEqual({
					patch: {
						runtime: { execute: false },
						scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
						strategy: {
							allowHighRiskOperations: false,
							allowIrreversibleOperations: false,
							initializeGenesisUniverse: true,
							enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
							maximumEthPerOperation: '0.05',
							maximumGasCostEth: '0.02',
							maximumRepPerOperation: '10',
							minimumEthReserve: '0',
							minimumRepReserve: '0.000000000000000000',
							selectableOperationAllowlist: null,
							workflowValidForBlocks: 288,
						},
					},
					revision: nextConfigurationRevision,
				})
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} dry-run zero-reserve policy did not reconcile`)

				const exactBoundaryMutationCount = settingsMutations.length + 1
				await setExecutionMode(true, `${viewport.label} execution mode did not switch to live`)
				await cdp.evaluate(`(() => {
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const maximumGasCost = document.querySelector('#maximum-gas-cost')
					const form = document.querySelector('#settings-form')
					if (!(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					minDelay.value = '60'
					maxDelay.value = '3600'
					maximumGasCost.value = '0.123456789012345678'
					ethReserve.value = '0.123456789012345678'
					repReserve.value = '0.000000000000000001'
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					})()`)
				await waitForSettingsMutation(exactBoundaryMutationCount, `${viewport.label} exact gas-cost safety-floor policy was not submitted`)
				expect(settingsMutations.at(-1)).toEqual({
					patch: {
						runtime: { execute: true },
						scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
						strategy: {
							allowHighRiskOperations: false,
							allowIrreversibleOperations: false,
							initializeGenesisUniverse: true,
							enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
							maximumEthPerOperation: '0.05',
							maximumGasCostEth: '0.123456789012345678',
							maximumRepPerOperation: '10',
							minimumEthReserve: '0.123456789012345678',
							minimumRepReserve: '0.000000000000000001',
							selectableOperationAllowlist: null,
							workflowValidForBlocks: 288,
						},
					},
					revision: nextConfigurationRevision,
				})
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} exact gas-cost safety-floor policy did not reconcile`)

				initialDashboardState = degradedWorkflowRenderingState
				recoveredDashboardState = degradedWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#rpc-health-status')?.textContent === 'Quorum blocked'", `${viewport.label} degraded RPC health did not render`)
				expect(
					await cdp.evaluate(`({
						chain: document.querySelector('#rpc-chain-readiness')?.textContent,
						healthy: document.querySelector('#rpc-healthy-count')?.textContent,
						secretVisible: document.documentElement.textContent?.includes(${JSON.stringify(rpcSecret)}),
						status: document.querySelector('#rpc-health-status')?.textContent,
					})`),
				).toEqual({ chain: 'Not ready for chain 11155111', healthy: '1 of 3', secretVisible: false, status: 'Quorum blocked' })
				expect(
					await cdp.evaluate(`({
						healthy: document.querySelector('#submission-healthy-count')?.textContent,
						proof: document.querySelector('#submission-signer-proof')?.textContent,
						status: document.querySelector('#submission-health-status')?.textContent,
					})`),
				).toEqual({ healthy: '1 of 3 origins', proof: 'Does not match current signer', status: 'Path blocked' })
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

				initialDashboardState = staleSubmissionWorkflowRenderingState
				recoveredDashboardState = staleSubmissionWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#submission-health-status')?.textContent === 'Evidence stale'", `${viewport.label} stale submission evidence did not render`)
				expect(
					await cdp.evaluate(`({
						freshness: document.querySelector('#submission-freshness')?.textContent,
						healthy: document.querySelector('#submission-healthy-count')?.textContent,
						proof: document.querySelector('#submission-signer-proof')?.textContent,
						status: document.querySelector('#submission-health-status')?.textContent,
					})`),
				).toEqual({ freshness: '0 fresh of 3 checked', healthy: '0 of 3 origins', proof: 'Not yet proven', status: 'Evidence stale' })

				submissionConfigured = false
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#submission-health-status')?.textContent === 'Path not configured'", `${viewport.label} unconfigured submission path did not render`)
				expect(
					await cdp.evaluate(`({
						freshness: document.querySelector('#submission-freshness')?.textContent,
						mode: document.querySelector('#submission-mode')?.textContent,
						status: document.querySelector('#submission-health-status')?.textContent,
					})`),
				).toEqual({ freshness: 'Not yet verified', mode: '—', status: 'Path not configured' })
				submissionConfigured = true

				initialDashboardState = pausedWorkflowRenderingState
				recoveredDashboardState = pausedWorkflowRenderingState
				stateRequests = 0
				selectableOperationAllowlist = ['open-oracle.blocked-sibling', 'trading.position.enter']
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", `${viewport.label} paused resume fixture did not render`)
				await cdp.evaluate("document.querySelector('#pause-button')?.click()")
				await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} resume dialog did not open`)
				expect(await accessibilityIdentity('#resume-dialog')).toEqual({ name: 'Resume chaos scheduling?', role: 'dialog' })
				expect(
					await cdp.evaluate(`(() => {
						const scope = [...document.querySelectorAll('#resume-preflight li')].find(row => row.querySelector('span')?.textContent === 'Random novelty scope')
						return {
							ids: scope?.querySelector('.resume-random-scope-ids')?.textContent,
							summary: scope?.querySelector('.resume-random-scope > span')?.textContent,
							warningHidden: document.querySelector('#resume-random-scope-warning')?.classList.contains('hidden'),
						}
					})()`),
				).toEqual({ ids: 'open-oracle.blocked-sibling\ntrading.position.enter', summary: '2-ID canary', warningHidden: true })
				await cdp.evaluate("document.querySelector('#cancel-resume')?.click()")
				selectableOperationAllowlist = null
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Dry run'", `${viewport.label} unrestricted resume fixture did not render`)
				await cdp.evaluate("document.querySelector('#pause-button')?.click()")
				await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} unrestricted resume dialog did not open`)
				expect(
					await cdp.evaluate(`(() => {
						const scope = [...document.querySelectorAll('#resume-preflight li')].find(row => row.querySelector('span')?.textContent === 'Random novelty scope')
						return {
							button: document.querySelector('#confirm-resume')?.textContent,
							disabled: document.querySelector('#confirm-resume')?.disabled,
							scope: scope?.querySelector('strong')?.textContent,
							warning: document.querySelector('#resume-random-scope-warning')?.textContent,
						}
					})()`),
				).toEqual({ button: 'Resume unrestricted bot', disabled: false, scope: 'ALL selectable operations', warning: 'Random novelty is unrestricted. Any due eligible selectable operation may run immediately after resume.' })
				expect(
					await cdp.evaluate(`(() => {
						const actions = [...document.querySelectorAll('#resume-dialog .dialog-actions button')]
						const visualOrder = [...actions].sort((left, right) => {
							const leftBounds = left.getBoundingClientRect()
							const rightBounds = right.getBoundingClientRect()
							return Math.abs(leftBounds.top - rightBounds.top) > 1 ? leftBounds.top - rightBounds.top : leftBounds.left - rightBounds.left
						})
						return {
							active: document.activeElement?.id,
							domOrder: actions.map(action => action.id),
							visualOrder: visualOrder.map(action => action.id),
						}
					})()`),
				).toEqual({ active: 'cancel-resume', domOrder: ['cancel-resume', 'confirm-resume'], visualOrder: ['cancel-resume', 'confirm-resume'] })
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'rawKeyDown', windowsVirtualKeyCode: 9 })
				await cdp.command('Input.dispatchKeyEvent', { code: 'Tab', key: 'Tab', nativeVirtualKeyCode: 9, type: 'keyUp', windowsVirtualKeyCode: 9 })
				expect(await cdp.evaluate('document.activeElement?.id')).toBe('confirm-resume')
				await expectVisibleIdentifiers([{ type: 'recovery signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32, '#resume-dialog .full-identifier')
				await cdp.evaluate("document.querySelector('#cancel-resume')?.click()")
				initialDashboardState = workflowRenderingState
				recoveredDashboardState = workflowRenderingState
			}

			await cdp.command('Page.navigate', { url: 'about:blank' })
			await waitFor("document.readyState === 'complete'", 'Chromium did not reset before the settings layout check')
			stateRequests = 3
			await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#settings-scope')?.textContent === 'sepolia · chain 11155111'", 'Mobile settings fixture did not load')
			const checkboxTargets = await cdp.evaluate(`[
				...document.querySelectorAll('#execution-enabled, #allow-high-risk, #allow-irreversible, [data-ecosystem-toggle], #remember-signer'),
			].map(input => {
				const label = input.closest('.switch-field') ?? input.labels?.[0]
				const bounds = label?.getBoundingClientRect()
				return { height: bounds?.height, name: input.id || input.dataset.ecosystemToggle, width: bounds?.width }
			})`)
			expect(checkboxTargets).toHaveLength(8)
			for (const target of Array.isArray(checkboxTargets) ? checkboxTargets : []) {
				expect(Reflect.get(target, 'width'), `${String(Reflect.get(target, 'name'))} label width`).toBeGreaterThanOrEqual(44)
				expect(Reflect.get(target, 'height'), `${String(Reflect.get(target, 'name'))} label height`).toBeGreaterThanOrEqual(44)
			}
			const connectivityLayout = await cdp.evaluate(`(() => {
				const form = document.querySelector('#connectivity-form')
				const button = document.querySelector('#save-connectivity')
				if (!(form instanceof HTMLFormElement) || !(button instanceof HTMLButtonElement)) return undefined
				const formBounds = form.getBoundingClientRect()
				const buttonBounds = button.getBoundingClientRect()
				return { buttonHeight: buttonBounds.height, formLeft: formBounds.left, formRight: formBounds.right, viewportWidth: document.documentElement.clientWidth }
			})()`)
			const formLeft = Reflect.get(Object(connectivityLayout), 'formLeft')
			const formRight = Reflect.get(Object(connectivityLayout), 'formRight')
			const viewportWidth = Reflect.get(Object(connectivityLayout), 'viewportWidth')
			const buttonHeight = Reflect.get(Object(connectivityLayout), 'buttonHeight')
			if (typeof formLeft !== 'number' || typeof formRight !== 'number' || typeof viewportWidth !== 'number' || typeof buttonHeight !== 'number') throw new Error('Mobile connectivity form bounds are unavailable')
			expect(formLeft).toBeGreaterThanOrEqual(0)
			expect(formRight).toBeLessThanOrEqual(viewportWidth)
			expect(buttonHeight).toBeGreaterThanOrEqual(44)

			for (const route of ['ecosystem', 'settings']) {
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", `Chromium did not reset before the /${route} navigation check`)
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL(`/${route}`, dashboard.url).href })
				await waitFor(
					`(() => {
					const navigation = document.querySelector('.section-nav')
					const current = navigation?.querySelector('[aria-current="page"]')
					if (!(navigation instanceof HTMLElement) || !(current instanceof HTMLElement)) return false
					const navigationBounds = navigation.getBoundingClientRect()
					const currentBounds = current.getBoundingClientRect()
					return currentBounds.left >= navigationBounds.left - 1 && currentBounds.right <= navigationBounds.right + 1
				})()`,
					`/${route} did not reveal its current navigation chip`,
				)
				await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", `/${route} initial refresh did not settle`)
				const navigationBeforeRefresh = await cdp.evaluate(`(() => {
					const navigation = document.querySelector('.section-nav')
					const current = navigation?.querySelector('[aria-current="page"]')
					if (!(navigation instanceof HTMLElement) || !(current instanceof HTMLElement)) return undefined
					const navigationBounds = navigation.getBoundingClientRect()
					const currentBounds = current.getBoundingClientRect()
					return {
						bodyWidth: document.body.scrollWidth,
						centerDelta: Math.abs((currentBounds.left + currentBounds.right) / 2 - (navigationBounds.left + navigationBounds.right) / 2),
						clientWidth: document.documentElement.clientWidth,
						currentPath: new URL(current.getAttribute('href') ?? '', window.location.href).pathname,
						currentVisible: currentBounds.left >= navigationBounds.left - 1 && currentBounds.right <= navigationBounds.right + 1,
						linkHeights: [...navigation.querySelectorAll('a')].map(link => link.getBoundingClientRect().height),
						maximumScrollLeft: navigation.scrollWidth - navigation.clientWidth,
						scrollLeft: navigation.scrollLeft,
						scrollY: window.scrollY,
					}
				})()`)
				expect(navigationBeforeRefresh).toMatchObject({ currentPath: `/${route}`, currentVisible: true, scrollY: 0 })
				expect(Reflect.get(Object(navigationBeforeRefresh), 'bodyWidth')).toBe(Reflect.get(Object(navigationBeforeRefresh), 'clientWidth'))
				const navigationScrollLeft = Reflect.get(Object(navigationBeforeRefresh), 'scrollLeft')
				const maximumScrollLeft = Reflect.get(Object(navigationBeforeRefresh), 'maximumScrollLeft')
				if (typeof navigationScrollLeft !== 'number' || typeof maximumScrollLeft !== 'number') throw new Error(`/${route} navigation scroll metrics are unavailable`)
				if (route === 'ecosystem') {
					expect(navigationScrollLeft).toBeGreaterThan(0)
					expect(navigationScrollLeft).toBeLessThan(maximumScrollLeft)
					expect(Reflect.get(Object(navigationBeforeRefresh), 'centerDelta')).toBeLessThanOrEqual(1)
				} else expect(Math.abs(navigationScrollLeft - maximumScrollLeft)).toBeLessThanOrEqual(1)
				const linkHeights = Reflect.get(Object(navigationBeforeRefresh), 'linkHeights')
				expect(linkHeights).toHaveLength(6)
				for (const height of Array.isArray(linkHeights) ? linkHeights : []) expect(height).toBeGreaterThanOrEqual(44)
				const requestsBeforeRefresh = stateRequests
				await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
				for (let attempt = 0; attempt < 100 && stateRequests === requestsBeforeRefresh; attempt += 1) await Bun.sleep(10)
				expect(stateRequests).toBeGreaterThan(requestsBeforeRefresh)
				const navigationAfterRefresh = await cdp.evaluate(`({
					scrollLeft: document.querySelector('.section-nav')?.scrollLeft,
					scrollY: window.scrollY,
				})`)
				expect(navigationAfterRefresh).toEqual({ scrollLeft: Reflect.get(Object(navigationBeforeRefresh), 'scrollLeft'), scrollY: Reflect.get(Object(navigationBeforeRefresh), 'scrollY') })
			}
			// In-page navigation must move the `aria-current="page"` marker the stylesheet and
			// assistive technology key on, not just an empty `aria-current` attribute.
			for (const route of ['ecosystem', 'settings']) {
				await cdp.evaluate(`document.querySelector('.section-nav a[href="/${route}"]')?.click()`)
				await waitFor(`document.body.dataset.page === '${route}'`, `Clicking the /${route} link did not switch the page`)
				const currentLinks = await cdp.evaluate("[...document.querySelectorAll('.section-nav a')].filter(link => link.hasAttribute('aria-current')).map(link => [new URL(link.href).pathname, link.getAttribute('aria-current')])")
				expect(currentLinks).toEqual([[`/${route}`, 'page']])
			}
		} finally {
			try {
				await browserSession?.close()
			} finally {
				dashboard.stop(true)
			}
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)
