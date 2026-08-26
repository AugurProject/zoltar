import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'

type RecoveryScenario = {
	fieldsId: string
	formId: string
	label: string
	recoveredState: Record<string, unknown>
	staleState: Record<string, unknown>
	statusId: string
}

const chromium = process.env['CHROMIUM_PATH'] ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip
const dashboardPassword = 'dashboard interaction fixture password'
const transactionHash = `0x${'12'.repeat(32)}`
const candidateHash = `0x${'34'.repeat(32)}`
const cancellationHash = `0x${'56'.repeat(32)}`
const activityHash = `0x${'78'.repeat(32)}`
const walletAddress = `0x${'ab'.repeat(20)}`
const rpcSecret = 'dashboard-rpc-secret'
const readRpcHealth = [
	{ chainId: 11_155_111, checkedAt: '2026-08-24T00:03:00.000Z', kind: 'read-rpc', status: 'healthy', target: `https://operator:${rpcSecret}@read-one.example/private` },
	{ chainId: 11_155_111, checkedAt: '2026-08-24T00:03:01.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://read-two.example/?api_key=private' },
	{ chainId: undefined, checkedAt: '2026-08-24T00:03:02.000Z', error: `RPC read-three.example rejected token=${rpcSecret}`, kind: 'read-rpc', status: 'failed', target: 'https://read-three.example/private' },
	{ lastSuccessAt: '2026-08-24T00:03:03.000Z', status: 'healthy', target: `https://operator:${rpcSecret}@read-one.example/private` },
	{ lastSuccessAt: '2026-08-24T00:03:04.000Z', status: 'healthy', target: 'https://read-two.example/?api_key=private' },
] as const
const degradedReadRpcHealth = [...readRpcHealth.slice(0, 4), { error: `RPC read-two.example rejected api_key=${rpcSecret}`, lastFailureAt: '2026-08-24T00:05:00.000Z', status: 'degraded', target: 'https://read-two.example/?api_key=private' }] as const
const workflowSteps = [
	{ label: 'Confirmed step', status: 'confirmed', transactionHash: `0x${'11'.repeat(32)}` },
	{ label: 'Complete step', status: 'complete', transactionHash: `0x${'22'.repeat(32)}` },
	{ label: 'Submitted step', status: 'submitted', transactionHash: `0x${'33'.repeat(32)}` },
	{ label: 'Pending step', status: 'pending', transactionHash: `0x${'44'.repeat(32)}` },
	{ label: 'Failed step', status: 'failed', transactionHash: `0x${'55'.repeat(32)}` },
	{ label: 'Waiting step' },
]

function state(overrides: Record<string, unknown>) {
	return {
		activities: [],
		evaluations: [],
		inventory: { rep: [] },
		obligations: [],
		paused: true,
		pendingTransactions: [],
		scheduler: { status: 'paused' },
		workflows: [],
		...overrides,
	}
}

const scenarios: RecoveryScenario[] = [
	{
		fieldsId: 'replacement-fields',
		formId: 'replacement-form',
		label: 'pending intent replacement',
		recoveredState: state({ pendingTransactions: [{ hash: transactionHash, status: 'submitted' }] }),
		staleState: state({ pendingTransactions: [{ status: 'submitted' }] }),
		statusId: 'replacement-status',
	},
	{
		fieldsId: 'cancellation-fields',
		formId: 'cancellation-form',
		label: 'pending intent cancellation',
		recoveredState: state({ pendingTransactions: [{ hash: transactionHash, status: 'submitted' }] }),
		staleState: state({ pendingTransactions: [{ status: 'submitted' }] }),
		statusId: 'cancellation-status',
	},
	{
		fieldsId: 'candidate-fields',
		formId: 'candidate-form',
		label: 'queued recovery candidate',
		recoveredState: state({ pendingTransactions: [{ hash: transactionHash, replacementHash: candidateHash, status: 'submitted' }] }),
		staleState: state({ pendingTransactions: [{ replacementHash: candidateHash, status: 'submitted' }] }),
		statusId: 'candidate-status',
	},
	{
		fieldsId: 'workflow-fields',
		formId: 'workflow-form',
		label: 'partial workflow',
		recoveredState: state({ workflows: [{ id: 'workflow-1', status: 'waiting-continuation', updatedAt: '2026-08-24T00:00:00.000Z' }] }),
		staleState: state({ workflows: [{ id: 'workflow-1', status: 'waiting-continuation' }] }),
		statusId: 'workflow-status',
	},
	{
		fieldsId: 'obligation-fields',
		formId: 'obligation-form',
		label: 'lifecycle obligation',
		recoveredState: state({ obligations: [{ id: 'obligation-1', status: 'pending', updatedAt: '2026-08-24T00:00:00.000Z' }] }),
		staleState: state({ obligations: [{ id: 'obligation-1', status: 'pending' }] }),
		statusId: 'obligation-status',
	},
]

const workflowRenderingState = state({
	activities: [{ at: '2026-08-24T00:02:00.000Z', label: 'Rendered activity', status: 'dry-run', txHash: activityHash }],
	currentWorkflow: {
		createdAt: '2026-08-24T00:00:00.000Z',
		id: 'workflow-rendering',
		label: 'Workflow rendering fixture',
		status: 'waiting-transaction',
		steps: workflowSteps,
	},
	obligations: [{ id: 'obligation-rendering', label: 'Rendered obligation', status: 'executing', updatedAt: '2026-08-24T00:01:00.000Z' }],
	paused: false,
	pendingTransactions: [
		{
			cancellationHash,
			hash: transactionHash,
			label: 'Rendered pending transaction',
			nonce: 9,
			replacementHash: candidateHash,
			status: 'waiting-transaction',
		},
	],
	rpcEndpointHealth: readRpcHealth,
	scheduler: { status: 'waiting-transaction' },
	wallet: walletAddress,
})

const pausedWorkflowRenderingState = { ...workflowRenderingState, paused: true }
const degradedWorkflowRenderingState = { ...workflowRenderingState, rpcEndpointHealth: degradedReadRpcHealth }

async function availablePort() {
	const listener = createServer()
	await new Promise<void>((resolve, reject) => {
		listener.once('error', reject)
		listener.listen(0, '127.0.0.1', resolve)
	})
	const address = listener.address()
	if (address === null || typeof address === 'string') throw new Error('Could not allocate a Chromium debugging port')
	await new Promise<void>((resolve, reject) => listener.close(error => (error === undefined ? resolve() : reject(error))))
	return address.port
}

async function connectToChromium(port: number) {
	let tabs: unknown
	for (let attempt = 0; attempt < 100; attempt += 1) {
		try {
			const response: unknown = await fetch(`http://127.0.0.1:${port.toString()}/json/list`).then(value => value.json())
			if (Array.isArray(response) && response.length > 0) {
				tabs = response
				break
			}
		} catch (error) {
			if (!(error instanceof Error) || Reflect.get(error, 'code') !== 'ConnectionRefused') throw error
		}
		await Bun.sleep(50)
	}
	if (!Array.isArray(tabs) || tabs.length === 0) throw new Error('Chromium debugging tab did not become available')
	const debuggerUrl = Reflect.get(tabs[0], 'webSocketDebuggerUrl')
	if (typeof debuggerUrl !== 'string') throw new Error('Chromium tab is missing a debugger URL')
	const socket = new WebSocket(debuggerUrl)
	const pending = new Map<number, { reject: (error: Error) => void; resolve: (value: unknown) => void }>()
	let requestId = 0
	socket.addEventListener('message', event => {
		const response: unknown = JSON.parse(String(event.data))
		if (typeof response !== 'object' || response === null || Array.isArray(response)) return
		const responseId = Reflect.get(response, 'id')
		if (typeof responseId !== 'number') return
		const callback = pending.get(responseId)
		if (callback === undefined) return
		pending.delete(responseId)
		const responseError = Reflect.get(response, 'error')
		if (responseError === undefined) callback.resolve(Reflect.get(response, 'result'))
		else {
			const message = typeof responseError === 'object' && responseError !== null ? Reflect.get(responseError, 'message') : undefined
			callback.reject(new Error(typeof message === 'string' ? message : 'CDP command failed'))
		}
	})
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener('open', () => resolve(), { once: true })
		socket.addEventListener('error', () => reject(new Error('Chromium debugger connection failed')), { once: true })
	})
	const command = (method: string, params: Record<string, unknown> = {}) =>
		new Promise<unknown>((resolve, reject) => {
			requestId += 1
			pending.set(requestId, { reject, resolve })
			socket.send(JSON.stringify({ id: requestId, method, params }))
		})
	await command('Runtime.enable')
	await command('Page.enable')
	const evaluate = async (expression: string) => {
		const response = await command('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
		const result = typeof response === 'object' && response !== null ? Reflect.get(response, 'result') : undefined
		return typeof result === 'object' && result !== null ? Reflect.get(result, 'value') : undefined
	}
	return { command, evaluate, socket }
}

browserTest(
	'validates stale recovery, workflow status semantics, and mobile interaction targets',
	async () => {
		const firstScenario = scenarios[0]
		if (firstScenario === undefined) throw new Error('Recovery scenarios are required')
		let initialDashboardState = firstScenario.staleState
		let recoveredDashboardState = firstScenario.recoveredState
		let failSecondStateRead = true
		let stateRequests = 0
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({
				hasSigner: true,
				revision: 'fixture-1',
				settings: {
					connectivity: {
						publicRpcUrls: [`https://submit.example/?token=${rpcSecret}`],
						quorumRpcUrls: ['https://read-two.example/?api_key=private', 'https://read-three.example/private'],
						readRpcUrl: `https://operator:${rpcSecret}@read-one.example/private`,
						rpcQuorum: 2,
					},
					network: { chainId: 11_155_111, name: 'sepolia' },
					paused: true,
				},
				signerAddress: walletAddress,
			}),
			getState: async () => {
				stateRequests += 1
				if (failSecondStateRead && stateRequests === 2) {
					await Bun.sleep(150)
					throw new Error('intentional state-read failure')
				}
				return stateRequests >= 3 ? recoveredDashboardState : initialDashboardState
			},
			hostname: '127.0.0.1',
			password: dashboardPassword,
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const debuggingPort = await availablePort()
		const userDataDirectory = await mkdtemp(join(tmpdir(), 'chaos-dashboard-chromium-'))
		const browser = Bun.spawn([chromium, '--headless', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debuggingPort.toString()}`, `--user-data-dir=${userDataDirectory}`, 'about:blank'], { stderr: 'ignore', stdout: 'ignore' })
		let socket: WebSocket | undefined
		try {
			const cdp = await connectToChromium(debuggingPort)
			socket = cdp.socket
			await cdp.command('Network.enable')
			await cdp.command('Network.setExtraHTTPHeaders', { headers: { Authorization: `Basic ${Buffer.from(`operator:${dashboardPassword}`).toString('base64')}` } })
			const waitFor = async (expression: string, message: string) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if ((await cdp.evaluate(expression)) === true) return
					await Bun.sleep(25)
				}
				throw new Error(message)
			}
			const expectVisibleIdentifiers = async (expected: { type: string; value: string }[], minimumButtonHeight: number, selector = '.compact-identifier') => {
				const identifiers = await cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].flatMap(wrapper => {
					const bounds = wrapper.getBoundingClientRect()
					if (bounds.width === 0 || bounds.height === 0) return []
					const button = wrapper.querySelector('.identifier-copy')
					const buttonBounds = button?.getBoundingClientRect()
					const disclosure = wrapper.querySelector('.identifier-disclosure')
					const disclosureBounds = disclosure?.getBoundingClientRect()
					const full = wrapper.querySelector('.identifier-full')
					return [{
						accessibleName: button?.getAttribute('aria-label'),
						buttonHeight: buttonBounds?.height,
						buttonVisible: (buttonBounds?.width ?? 0) > 0 && (buttonBounds?.height ?? 0) > 0,
						disclosureExpanded: disclosure?.getAttribute('aria-expanded'),
						disclosureHeight: disclosureBounds?.height,
						disclosureName: disclosure?.getAttribute('aria-label'),
						disclosureTabIndex: disclosure?.tabIndex,
						disclosureVisible: (disclosureBounds?.width ?? 0) > 0 && (disclosureBounds?.height ?? 0) > 0,
						display: wrapper.querySelector('.identifier-value')?.textContent,
						feedback: wrapper.querySelector('.identifier-feedback')?.textContent,
						fullHidden: full?.hidden,
						fullValue: full?.value,
						right: bounds.right,
						tabIndex: button?.tabIndex,
						type: wrapper.getAttribute('data-identifier-type'),
					}]
				})`)
				expect(identifiers).toHaveLength(expected.length)
				const viewportRight = await cdp.evaluate('document.documentElement.clientWidth + 1')
				if (typeof viewportRight !== 'number') throw new Error('Missing dashboard viewport width')
				for (const identifier of expected) {
					const rendered = Array.isArray(identifiers) ? identifiers.find(candidate => Reflect.get(candidate, 'accessibleName') === `Copy ${identifier.type}: ${identifier.value}`) : undefined
					if (rendered === undefined) throw new Error(`Missing visible ${identifier.type}`)
					expect(Reflect.get(rendered, 'type')).toBe(identifier.type)
					expect(Reflect.get(rendered, 'display')).toBe(`${identifier.value.slice(0, 8)}…${identifier.value.slice(-6)}`)
					expect(Reflect.get(rendered, 'buttonVisible')).toBe(true)
					expect(Reflect.get(rendered, 'buttonHeight')).toBeGreaterThanOrEqual(minimumButtonHeight)
					expect(Reflect.get(rendered, 'tabIndex')).toBe(0)
					expect(Reflect.get(rendered, 'disclosureName')).toBe(`Show full ${identifier.type}: ${identifier.value}`)
					expect(Reflect.get(rendered, 'disclosureVisible')).toBe(true)
					expect(Reflect.get(rendered, 'disclosureHeight')).toBeGreaterThanOrEqual(minimumButtonHeight)
					expect(Reflect.get(rendered, 'disclosureTabIndex')).toBe(0)
					expect(Reflect.get(rendered, 'disclosureExpanded')).toBe('false')
					expect(Reflect.get(rendered, 'fullHidden')).toBe(true)
					expect(Reflect.get(rendered, 'fullValue')).toBe(identifier.value)
					const right = Reflect.get(rendered, 'right')
					if (typeof right !== 'number') throw new Error(`Missing ${identifier.type} bounds`)
					expect(right).toBeLessThanOrEqual(viewportRight)
				}
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
				return identifiers
			}

			for (const scenario of scenarios) {
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", 'Chromium did not reset between scenarios')
				initialDashboardState = scenario.staleState
				recoveredDashboardState = scenario.recoveredState
				failSecondStateRead = true
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/activity', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Paused'", `${scenario.label} fixture did not load`)
				const loading = await cdp.evaluate(`(() => {
					const form = document.querySelector('#${scenario.formId}')
					if (!(form instanceof HTMLFormElement)) return undefined
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
					return {
						disabled: document.querySelector('#${scenario.fieldsId}')?.disabled,
						status: document.querySelector('#${scenario.statusId}')?.textContent,
					}
				})()`)
				expect(loading).toEqual({ disabled: true, status: expect.stringContaining('Loading the current') })
				await waitFor(`document.querySelector('#${scenario.statusId}')?.textContent?.includes('unavailable') === true && document.querySelector('#refresh-button')?.textContent === 'Retry'`, `${scenario.label} did not expose its failed refresh and Retry action`)
				expect(stateRequests).toBe(2)
				const failure = await cdp.evaluate(`({
					disabled: document.querySelector('#${scenario.fieldsId}')?.disabled,
					refreshDisabled: document.querySelector('#refresh-button')?.disabled,
					status: document.querySelector('#${scenario.statusId}')?.textContent,
				})`)
				expect(failure).toEqual({ disabled: true, refreshDisabled: false, status: expect.stringContaining('Use Retry in the header') })
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor(`document.querySelector('#${scenario.statusId}')?.textContent?.includes('loaded') === true && document.querySelector('#refresh-button')?.textContent === 'Refresh'`, `${scenario.label} did not recover through Retry`)
				expect(stateRequests).toBe(3)
				expect(await cdp.evaluate(`document.querySelector('#${scenario.fieldsId}')?.disabled`)).toBe(false)
			}

			initialDashboardState = workflowRenderingState
			recoveredDashboardState = workflowRenderingState
			failSecondStateRead = false
			for (const viewport of [
				{ height: 900, label: 'desktop', width: 1_440 },
				{ height: 844, label: 'mobile', width: 390 },
			]) {
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", `Chromium did not reset before the ${viewport.label} workflow check`)
				stateRequests = 0
				await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: viewport.height, mobile: false, width: viewport.width })
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor(`document.querySelectorAll('#current-workflow .step-list li').length === ${workflowSteps.length.toString()}`, `${viewport.label} workflow steps did not render`)
				const health = await cdp.evaluate(`({
					chain: document.querySelector('#rpc-chain-readiness')?.textContent,
					configured: document.querySelector('#rpc-configured-total')?.textContent,
					healthy: document.querySelector('#rpc-healthy-count')?.textContent,
					lastCheck: document.querySelector('#rpc-last-check')?.textContent,
					required: document.querySelector('#rpc-required-quorum')?.textContent,
					secretVisible: document.documentElement.textContent?.includes(${JSON.stringify(rpcSecret)}),
					status: document.querySelector('#rpc-health-status')?.textContent,
				})`)
				expect(health).toMatchObject({
					chain: 'Ready for chain 11155111',
					configured: '3 endpoints',
					healthy: '2 of 3',
					required: '2 endpoints',
					secretVisible: false,
					status: 'Quorum ready',
				})
				expect(Reflect.get(health, 'lastCheck')).not.toBe('No completed check')
				failSecondStateRead = true
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor("document.querySelector('#rpc-health-status')?.textContent === 'Health unavailable' && document.querySelector('#refresh-button')?.textContent === 'Retry'", `${viewport.label} failed refresh did not invalidate RPC health`)
				expect(
					await cdp.evaluate(`({
						chain: document.querySelector('#rpc-chain-readiness')?.textContent,
						configured: document.querySelector('#rpc-configured-total')?.textContent,
						healthy: document.querySelector('#rpc-healthy-count')?.textContent,
						lastCheck: document.querySelector('#rpc-last-check')?.textContent,
						required: document.querySelector('#rpc-required-quorum')?.textContent,
						status: document.querySelector('#rpc-health-status')?.textContent,
					})`),
				).toEqual({
					chain: 'Unavailable until state refresh succeeds',
					configured: '—',
					healthy: '—',
					lastCheck: 'Previous health result is stale',
					required: '—',
					status: 'Health unavailable',
				})
				failSecondStateRead = false
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor("document.querySelector('#rpc-health-status')?.textContent === 'Quorum ready' && document.querySelector('#refresh-button')?.textContent === 'Refresh'", `${viewport.label} RPC health did not recover after Retry`)
				const renderedSteps = await cdp.evaluate(`[...document.querySelectorAll('#current-workflow .step-list li')].map(row => {
					const status = row.querySelector('[data-step-status]')
					const hash = row.querySelector('[data-step-hash]')
					const hashDisplay = hash?.querySelector('.identifier-value')
					const statusBounds = status?.getBoundingClientRect()
					return {
						copyName: hash?.querySelector('.identifier-copy')?.getAttribute('aria-label') ?? null,
						fullHash: hash?.querySelector('.identifier-full')?.value ?? null,
						hash: hashDisplay?.textContent ?? null,
						label: row.querySelector('.step-label')?.textContent,
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
					expect(Reflect.get(rendered, 'status')).toBe(expectedStatus)
					expect(Reflect.get(rendered, 'statusCode')).toBe(expected.status ?? 'waiting')
					expect(Reflect.get(rendered, 'statusVisible')).toBe(true)
					expect(Reflect.get(rendered, 'markerHidden')).toBe('true')
					if (expected.transactionHash === undefined) {
						expect(Reflect.get(rendered, 'hash')).toBeNull()
						expect(Reflect.get(rendered, 'fullHash')).toBeNull()
						expect(Reflect.get(rendered, 'copyName')).toBeNull()
					} else {
						expect(Reflect.get(rendered, 'hash')).toBe(`${expected.transactionHash.slice(0, 8)}…${expected.transactionHash.slice(-6)}`)
						expect(Reflect.get(rendered, 'fullHash')).toBe(expected.transactionHash)
						expect(Reflect.get(rendered, 'copyName')).toBe(`Copy workflow transaction hash: ${expected.transactionHash}`)
					}
				}
				expect(await cdp.evaluate(`({ scheduler: document.querySelector('#scheduler-state')?.textContent, workflow: document.querySelector('#current-workflow .workflow-heading .badge')?.textContent })`)).toEqual({ scheduler: 'Waiting transaction', workflow: 'Waiting transaction' })
				await expectVisibleIdentifiers([{ type: 'wallet address', value: walletAddress }, ...workflowSteps.flatMap(step => (step.transactionHash === undefined ? [] : [{ type: 'workflow transaction hash', value: step.transactionHash }]))], viewport.width === 390 ? 44 : 32)
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
						const wrapper = document.querySelector('[data-identifier-type="wallet address"]')
						const disclosure = wrapper?.querySelector('.identifier-disclosure')
						const full = wrapper?.querySelector('.identifier-full')
						disclosure?.focus()
						disclosure?.click()
						return {
							active: document.activeElement === disclosure,
							expanded: disclosure?.getAttribute('aria-expanded'),
							hidden: full?.hidden,
							value: full?.value,
						}
					})()`),
				).toEqual({ active: true, expanded: 'true', hidden: false, value: walletAddress })
				await cdp.evaluate(`document.querySelector('[data-identifier-type="wallet address"] .identifier-disclosure')?.click()`)
				expect(await cdp.evaluate(`document.querySelector('[data-identifier-type="wallet address"] .identifier-full')?.hidden`)).toBe(true)

				await cdp.evaluate(`Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: { writeText: value => { window.__identifierCopies = [...(window.__identifierCopies ?? []), value]; return Promise.resolve() } },
				})`)
				expect(await cdp.evaluate(`(() => { const button = document.querySelector('[data-identifier-type="wallet address"] .identifier-copy'); button?.focus(); return { active: document.activeElement === button, name: button?.getAttribute('aria-label') } })()`)).toEqual({
					active: true,
					name: `Copy wallet address: ${walletAddress}`,
				})
				await cdp.evaluate(`document.querySelector('[data-identifier-type="wallet address"] .identifier-copy')?.click()`)
				await waitFor(`document.querySelector('[data-identifier-type="wallet address"] .identifier-feedback')?.textContent === 'Copied'`, `${viewport.label} keyboard copy did not report success`)
				expect(await cdp.evaluate('window.__identifierCopies')).toEqual([walletAddress])
				await cdp.evaluate(`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } }); document.querySelector('[data-identifier-type="wallet address"] .identifier-copy')?.click()`)
				await waitFor(`document.querySelector('[data-identifier-type="wallet address"] .identifier-feedback')?.textContent === 'Copy failed; full value shown'`, `${viewport.label} rejected copy did not report failure`)
				expect(await cdp.evaluate(`document.querySelector('[data-identifier-type="wallet address"] .identifier-value')?.textContent`)).toBe(`${walletAddress.slice(0, 8)}…${walletAddress.slice(-6)}`)
				expect(
					await cdp.evaluate(`(() => {
						const wrapper = document.querySelector('[data-identifier-type="wallet address"]')
						const disclosure = wrapper?.querySelector('.identifier-disclosure')
						const full = wrapper?.querySelector('.identifier-full')
						full?.focus()
						full?.select()
						return {
							expanded: disclosure?.getAttribute('aria-expanded'),
							focused: document.activeElement === full,
							hidden: full?.hidden,
							selected: full?.value.slice(full.selectionStart, full.selectionEnd),
							value: full?.value,
						}
					})()`),
				).toEqual({ expanded: 'true', focused: true, hidden: false, selected: walletAddress, value: walletAddress })
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
				await cdp.evaluate(
					`Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: value => { window.__identifierCopies = [...(window.__identifierCopies ?? []), value]; return Promise.resolve() } } }); document.querySelector('[data-identifier-type="wallet address"] .identifier-copy')?.click()`,
				)
				await waitFor(`document.querySelector('[data-identifier-type="wallet address"] .identifier-feedback')?.textContent === 'Copied'`, `${viewport.label} copy retry did not succeed`)
				expect(await cdp.evaluate('window.__identifierCopies')).toEqual([walletAddress, walletAddress])

				await cdp.command('Page.navigate', { url: new URL('/activity', dashboard.url).href })
				await waitFor("document.querySelector('#pending-transactions .identifier-copy') !== null && document.querySelector('#activity-list .identifier-copy') !== null", `${viewport.label} recovery identifiers did not render`)
				await expectVisibleIdentifiers(
					[
						{ type: 'pending transaction hash', value: transactionHash },
						{ type: 'replacement transaction hash', value: candidateHash },
						{ type: 'cancellation transaction hash', value: cancellationHash },
						{ type: 'activity transaction hash', value: activityHash },
					],
					viewport.width === 390 ? 44 : 32,
				)
				expect(
					await cdp.evaluate(`({
						activity: document.querySelector('#activity-list .badge')?.textContent,
						obligation: document.querySelector('#obligations .badge')?.textContent,
						option: document.querySelector('#obligation-id option')?.textContent,
						pending: document.querySelector('#pending-transactions .badge')?.textContent,
					})`),
				).toEqual({ activity: 'Dry run', obligation: 'Executing', option: 'Rendered obligation · Executing', pending: 'Waiting transaction' })

				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#signer-summary .identifier-copy') !== null", `${viewport.label} signer identifier did not render`)
				await expectVisibleIdentifiers([{ type: 'transaction signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32)

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
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

				initialDashboardState = pausedWorkflowRenderingState
				recoveredDashboardState = pausedWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Paused'", `${viewport.label} paused resume fixture did not render`)
				await cdp.evaluate("document.querySelector('#pause-button')?.click()")
				await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} resume dialog did not open`)
				await expectVisibleIdentifiers([{ type: 'recovery signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32, '#resume-dialog .compact-identifier')
				await cdp.evaluate("document.querySelector('#cancel-resume')?.click()")
				initialDashboardState = workflowRenderingState
				recoveredDashboardState = workflowRenderingState
			}

			await cdp.command('Page.navigate', { url: 'about:blank' })
			await waitFor("document.readyState === 'complete'", 'Chromium did not reset before the settings layout check')
			stateRequests = 3
			await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#settings-scope')?.textContent !== 'Configuration loading'", 'Mobile settings fixture did not load')
			const checkboxTargets = await cdp.evaluate(`[
				...document.querySelectorAll('#execute, #allow-high-risk, #allow-irreversible, [data-ecosystem-toggle], #remember-signer'),
			].map(input => {
				const label = input.closest('.checkbox-row') ?? input.labels?.[0]
				const bounds = label?.getBoundingClientRect()
				return { height: bounds?.height, name: input.id || input.dataset.ecosystemToggle, width: bounds?.width }
			})`)
			expect(checkboxTargets).toHaveLength(8)
			for (const target of Array.isArray(checkboxTargets) ? checkboxTargets : []) {
				expect(Reflect.get(target, 'width'), `${String(Reflect.get(target, 'name'))} label width`).toBeGreaterThanOrEqual(44)
				expect(Reflect.get(target, 'height'), `${String(Reflect.get(target, 'name'))} label height`).toBeGreaterThanOrEqual(44)
			}

			for (const route of ['activity', 'settings']) {
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
				expect(Reflect.get(navigationBeforeRefresh, 'bodyWidth')).toBe(Reflect.get(navigationBeforeRefresh, 'clientWidth'))
				const navigationScrollLeft = Reflect.get(navigationBeforeRefresh, 'scrollLeft')
				const maximumScrollLeft = Reflect.get(navigationBeforeRefresh, 'maximumScrollLeft')
				if (typeof navigationScrollLeft !== 'number' || typeof maximumScrollLeft !== 'number') throw new Error(`/${route} navigation scroll metrics are unavailable`)
				if (route === 'activity') {
					expect(navigationScrollLeft).toBeGreaterThan(0)
					expect(navigationScrollLeft).toBeLessThan(maximumScrollLeft)
					expect(Reflect.get(navigationBeforeRefresh, 'centerDelta')).toBeLessThanOrEqual(1)
				} else expect(Math.abs(navigationScrollLeft - maximumScrollLeft)).toBeLessThanOrEqual(1)
				const linkHeights = Reflect.get(navigationBeforeRefresh, 'linkHeights')
				expect(linkHeights).toHaveLength(5)
				for (const height of Array.isArray(linkHeights) ? linkHeights : []) expect(height).toBeGreaterThanOrEqual(44)
				const requestsBeforeRefresh = stateRequests
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				for (let attempt = 0; attempt < 100 && stateRequests === requestsBeforeRefresh; attempt += 1) await Bun.sleep(10)
				expect(stateRequests).toBeGreaterThan(requestsBeforeRefresh)
				const navigationAfterRefresh = await cdp.evaluate(`({
					scrollLeft: document.querySelector('.section-nav')?.scrollLeft,
					scrollY: window.scrollY,
				})`)
				expect(navigationAfterRefresh).toEqual({ scrollLeft: Reflect.get(navigationBeforeRefresh, 'scrollLeft'), scrollY: Reflect.get(navigationBeforeRefresh, 'scrollY') })
			}
		} finally {
			socket?.close()
			browser.kill()
			await browser.exited
			dashboard.stop(true)
			await rm(userDataDirectory, { force: true, recursive: true })
		}
	},
	60_000,
)

test('recovery dashboard source has no generic manual-load fallback', async () => {
	const source = await Bun.file(join(import.meta.dir, '..', '..', 'src', 'dashboard', 'dashboard.ts')).text()
	expect(source).not.toContain('Refresh to load')
	for (const context of ['replacementRecoveryContext', 'cancellationRecoveryContext', 'candidateRecoveryContext', 'workflowRecoveryContext', 'obligationRecoveryContext']) {
		expect(source).toContain(`await requestRecoveryContextRefresh(${context})`)
	}
})
