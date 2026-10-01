import { expect } from 'bun:test'
import { activityHash, explorerTransaction, walletAddress } from './dashboard-harness.ts'
import { partialRecoveryDashboardState, rpcSecret, scenarios, workflowRenderingState, workflowSteps } from './dashboard-workflow-fixtures.ts'
import type { WorkflowRecoveryContext, WorkflowViewport } from './workflow-recovery-harness.ts'

// Staged checks of the workflow-recovery dashboard test: stale-state recovery, the safety-pause overview, and the per-viewport overview.

/** Every recovery form exposes a local Retry after a failed state read and recovers through it on a narrow viewport. */
export async function verifyStaleRecoveryScenarios(context: WorkflowRecoveryContext) {
	const { cdp, dashboard, fixture, waitFor } = context
	for (const scenario of scenarios) {
		await cdp.command('Page.navigate', { url: 'about:blank' })
		await waitFor("document.readyState === 'complete'", 'Chromium did not reset between scenarios')
		await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
		fixture.initialDashboardState = scenario.staleState
		fixture.recoveredDashboardState = scenario.recoveredState
		fixture.failSecondStateRead = true
		fixture.stateRequests = 0
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
		expect(fixture.stateRequests).toBe(2)
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
		expect(fixture.stateRequests).toBe(3)
		expect(await cdp.evaluate(`document.querySelector('#${scenario.fieldsId}')?.disabled`)).toBe(false)
	}
}

/** The header reports the deployment-check block before the first complete canonical scan. */
export async function verifyDeploymentCheckBeforeCompleteScan(context: WorkflowRecoveryContext) {
	const { cdp, dashboard, fixture, waitFor } = context
	fixture.initialDashboardState = { ...partialRecoveryDashboardState, lastScannedBlock: undefined, lastScanAt: undefined, lastDeploymentCheckedBlock: '100', lastDeploymentCheckAt: new Date().toISOString(), pendingTransactions: [], obligations: [], workflows: [], currentWorkflow: undefined }
	fixture.recoveredDashboardState = fixture.initialDashboardState
	fixture.failSecondStateRead = false
	fixture.stateRequests = 0
	await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
	await waitFor("document.querySelector('#last-block')?.textContent === 'Block 100'", 'Deployment check block was not displayed before a complete scan')
	expect(await cdp.evaluate("document.querySelector('#last-scan')?.textContent")).toContain('Deployments checked')
	expect(await cdp.evaluate("document.querySelector('#recovery-badge')?.getClientRects().length")).toBe(0)
	expect(await cdp.evaluate("document.querySelector('#rep-balances')?.textContent")).toBe('—')
}

/** The overview renders the durable safety latch, operator alerts, the partial workflow recovery panel, and the resume preflight. */
export async function verifySafetyPauseOverview(context: WorkflowRecoveryContext) {
	const { cdp, dashboard, fixture, waitFor } = context
	fixture.initialDashboardState = partialRecoveryDashboardState
	fixture.recoveredDashboardState = partialRecoveryDashboardState
	fixture.failSecondStateRead = false
	fixture.stateRequests = 0
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
}

/** Serves the rendered workflow fixture for the per-viewport checks. */
export function startWorkflowRenderingStage(context: WorkflowRecoveryContext) {
	const { fixture } = context
	fixture.initialDashboardState = workflowRenderingState
	fixture.recoveredDashboardState = workflowRenderingState
	fixture.failSecondStateRead = false
}

/** RPC and submission health, local RPC recovery, workflow steps, and visible identifiers on the overview. */
export async function verifyOverviewHealthAndWorkflow(context: WorkflowRecoveryContext, viewport: WorkflowViewport) {
	const { cdp, dashboard, expectVisibleIdentifiers, fixture, waitFor } = context
	await cdp.command('Page.navigate', { url: 'about:blank' })
	await waitFor("document.readyState === 'complete'", `Chromium did not reset before the ${viewport.label} workflow check`)
	fixture.stateRequests = 0
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
	fixture.failSecondStateRead = true
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
	fixture.failSecondStateRead = false
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
}
