import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE } from '../../src/runtime/dashboard-controller.ts'

type RecoveryScenario = {
	fieldsId: string
	formId: string
	label: string
	recoveredState: Record<string, unknown>
	retryId: string
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
		retryId: 'replacement-retry',
		staleState: state({ pendingTransactions: [{ status: 'submitted' }] }),
		statusId: 'replacement-status',
	},
	{
		fieldsId: 'cancellation-fields',
		formId: 'cancellation-form',
		label: 'pending intent cancellation',
		recoveredState: state({ pendingTransactions: [{ hash: transactionHash, status: 'submitted' }] }),
		retryId: 'cancellation-retry',
		staleState: state({ pendingTransactions: [{ status: 'submitted' }] }),
		statusId: 'cancellation-status',
	},
	{
		fieldsId: 'candidate-fields',
		formId: 'candidate-form',
		label: 'queued recovery candidate',
		recoveredState: state({ pendingTransactions: [{ hash: transactionHash, replacementHash: candidateHash, status: 'submitted' }] }),
		retryId: 'candidate-retry',
		staleState: state({ pendingTransactions: [{ replacementHash: candidateHash, status: 'submitted' }] }),
		statusId: 'candidate-status',
	},
	{
		fieldsId: 'workflow-fields',
		formId: 'workflow-form',
		label: 'partial workflow',
		recoveredState: state({ workflows: [{ id: 'workflow-1', status: 'waiting-continuation', updatedAt: '2026-08-24T00:00:00.000Z' }] }),
		retryId: 'workflow-retry',
		staleState: state({ workflows: [{ id: 'workflow-1', status: 'waiting-continuation' }] }),
		statusId: 'workflow-status',
	},
	{
		fieldsId: 'obligation-fields',
		formId: 'obligation-form',
		label: 'lifecycle obligation',
		recoveredState: state({ obligations: [{ id: 'obligation-1', status: 'pending', updatedAt: '2026-08-24T00:00:00.000Z' }] }),
		retryId: 'obligation-retry',
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
	evaluations: [
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: [], eligible: true }, plan: { id: 'settle-1' } },
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: [], eligible: true }, plan: { id: 'settle-2' } },
		{ definition: { classification: 'role-restricted', ecosystem: 'statoblast', id: 'surface.pool.initialize', label: 'Pool.initialize', risk: 'high' }, eligibility: { blockers: ['Factory only'], eligible: false } },
	],
	inventory: {
		eth: '1000000000000000001',
		rep: [{ balance: '123456789012345678901', symbol: 'REP', token: '0x9999999999999999999999999999999999999998', universeId: '0' }],
		weth: '42',
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
	topology: {
		anchor: { blockNumber: '4242', timestamp: '1000' },
		auctions: [{ address: '0x1111111111111111111111111111111111111111', bids: [], finalized: false, pool: '0x2222222222222222222222222222222222222222' }],
		complete: true,
		pairs: [{ address: '0x3333333333333333333333333333333333333333', feeBps: 30, pool: '0x2222222222222222222222222222222222222222', status: 1, universeId: '0' }],
		pools: [{ address: '0x2222222222222222222222222222222222222222', systemState: 0, universeId: '0', vaults: [] }],
		reports: [{ reportId: '7', settlementTime: '2000', token1: '0x4444444444444444444444444444444444444444', token2: '0x5555555555555555555555555555555555555555' }],
		universes: [{ id: '0', knownChildOutcomes: [], repToken: '0x9999999999999999999999999999999999999998' }],
	},
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
		let failNextStateRead = false
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
					paused: Reflect.get(initialDashboardState, 'paused') === true,
					runtime: { execute: false },
					scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
					strategy: {
						allowHighRiskOperations: false,
						allowIrreversibleOperations: false,
						enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
						maximumEthPerOperation: '0.05',
						maximumGasCostEth: '0.02',
						maximumRepPerOperation: '10',
						minimumEthReserve: '0.05',
						minimumRepReserve: '10',
						workflowValidForBlocks: 96,
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
		const dashboardPort = dashboard.port
		if (dashboardPort === undefined) throw new Error('Dashboard interaction fixture did not expose a port')
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
				await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: 844, mobile: false, width: 390 })
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
						retryDisabled: document.querySelector('#${scenario.retryId}')?.disabled,
						retryHidden: document.querySelector('#${scenario.retryId}')?.classList.contains('hidden'),
						retryText: document.querySelector('#${scenario.retryId}')?.textContent,
						status: document.querySelector('#${scenario.statusId}')?.textContent,
					}
				})()`)
				expect(loading).toEqual({ disabled: true, retryDisabled: true, retryHidden: false, retryText: 'Refreshing…', status: expect.stringContaining('Loading the current') })
				await waitFor(
					`document.querySelector('#${scenario.statusId}')?.textContent?.includes('unavailable') === true && document.querySelector('#refresh-button')?.textContent === 'Retry' && document.querySelector('#${scenario.retryId}')?.textContent === 'Retry' && document.querySelector('#${scenario.retryId}')?.disabled === false`,
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
				expect(Reflect.get(failure, 'top')).toBeGreaterThanOrEqual(0)
				expect(Reflect.get(failure, 'bottom')).toBeLessThanOrEqual(844)
				expect(Reflect.get(failure, 'height')).toBeGreaterThanOrEqual(44)
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
					`document.querySelector('#${scenario.statusId}')?.textContent?.includes('loaded') === true && document.querySelector('#refresh-button')?.textContent === 'Refresh' && document.querySelector('#${scenario.retryId}')?.classList.contains('hidden') === true`,
					`${scenario.label} did not recover through its local Retry`,
				)
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
				expect(Reflect.get(health, 'lastCheck')).not.toBe('No completed check')
				expect(
					await cdp.evaluate(`({
						eth: document.querySelector('#balance-eth')?.textContent,
						rep: document.querySelector('#rep-balances .token-row > strong')?.textContent,
						weth: document.querySelector('#balance-weth')?.textContent,
					})`),
				).toEqual({ eth: '1.000000000000000001', rep: '123.456789012345678901', weth: '0.000000000000000042' })
				failSecondStateRead = true
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor(
					"document.querySelector('#rpc-health-status')?.textContent === 'Health unavailable' && document.querySelector('#refresh-button')?.textContent === 'Retry' && document.querySelector('#rpc-health-retry-button')?.textContent === 'Retry' && document.querySelector('#rpc-health-retry-button')?.classList.contains('hidden') === false",
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
				if (viewport.label === 'mobile') {
					const bounds = await cdp.evaluate(`new Promise(resolve => {
						const panel = document.querySelector('.rpc-health-panel')
						panel?.scrollIntoView({ block: 'start' })
						requestAnimationFrame(() => requestAnimationFrame(() => {
							const buttonBounds = document.querySelector('#rpc-health-retry-button')?.getBoundingClientRect()
							resolve({ bottom: buttonBounds?.bottom, height: buttonBounds?.height, top: buttonBounds?.top })
						}))
					})`)
					expect(Reflect.get(bounds, 'top')).toBeGreaterThanOrEqual(0)
					expect(Reflect.get(bounds, 'bottom')).toBeLessThanOrEqual(viewport.height)
					expect(Reflect.get(bounds, 'height')).toBeGreaterThanOrEqual(44)
				}
				failSecondStateRead = false
				await cdp.evaluate("document.querySelector('#rpc-health-retry-button')?.click()")
				await waitFor(
					"document.querySelector('#rpc-health-status')?.textContent === 'Quorum ready' && document.querySelector('#refresh-button')?.textContent === 'Refresh' && document.querySelector('#rpc-health-retry-button')?.classList.contains('hidden') === true",
					`${viewport.label} RPC health did not recover through its local Retry`,
				)
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

				if (viewport.label === 'desktop') {
					await cdp.command('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
					await waitFor("document.querySelector('#catalog-caption')?.textContent?.includes('2 live candidates') === true", 'Grouped operation catalog did not render')
					expect(
						await cdp.evaluate(`({
								candidate: [...document.querySelectorAll('#catalog-rows tr')].find(row => row.textContent?.includes('open-oracle.settle'))?.querySelector('td:nth-child(5)')?.textContent,
								rows: document.querySelectorAll('#catalog-rows tr').length,
							})`),
					).toEqual({ candidate: '2', rows: 2 })
					await cdp.evaluate(`(() => {
							const filter = document.querySelector('#catalog-classification-filter')
							if (!(filter instanceof HTMLSelectElement)) return
							filter.value = 'role-restricted'
							filter.dispatchEvent(new Event('change', { bubbles: true }))
						})()`)
					expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('Pool.initialize') === true && document.querySelectorAll('#catalog-rows tr').length === 1`)).toBe(true)

					await cdp.command('Page.navigate', { url: new URL('/ecosystem', dashboard.url).href })
					await waitFor("document.querySelector('#topology-anchor')?.textContent === 'Block 4242'", 'Anchored topology did not render')
					expect(await cdp.evaluate("document.querySelector('#topology-status')?.textContent")).toBe('5 anchored protocol identities · sanitized canonical snapshot.')
					expect(
						await cdp.evaluate(`({
								auctions: document.querySelectorAll('#topology-auctions .topology-row').length,
								pairs: document.querySelectorAll('#topology-pairs .topology-row').length,
								pools: document.querySelectorAll('#topology-pools .topology-row').length,
								reports: document.querySelectorAll('#topology-reports .topology-row').length,
								universes: document.querySelectorAll('#topology-universes .topology-row').length,
							})`),
					).toEqual({ auctions: 1, pairs: 1, pools: 1, reports: 1, universes: 1 })
				}

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

				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#signer-summary .identifier-copy') !== null", `${viewport.label} signer identifier did not render`)
				await expectVisibleIdentifiers([{ type: 'transaction signer address', value: walletAddress }], viewport.width === 390 ? 44 : 32)
				expect(await cdp.evaluate(`document.querySelector('#settings-fields')?.disabled === true && document.querySelector('#settings-pause-note')?.classList.contains('hidden') === false`)).toBe(true)
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
				expect(await cdp.evaluate(`document.querySelector('#signer-fields')?.disabled`)).toBe(true)
				await cdp.command('Network.setBlockedURLs', { urls: [] })
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor("document.querySelector('#signer-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#signer-fields')?.disabled === false", `${viewport.label} unresolved signer mutation did not recover after a complete refresh`)

				initialDashboardState = pausedWorkflowRenderingState
				recoveredDashboardState = pausedWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
				await waitFor("document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} paused execution policy did not become editable`)
				failNextStateRead = true
				await cdp.command('Network.setBlockedURLs', { urls: [`*://127.0.0.1:${dashboardPort.toString()}/api/settings`] })
				await cdp.evaluate(`document.querySelector('#settings-form')?.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))`)
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('configuration and state could not be reloaded') === true", `${viewport.label} partial settings reconciliation did not remain unresolved`)
				expect(await cdp.evaluate(`document.querySelector('#settings-fields')?.disabled`)).toBe(true)
				await cdp.command('Network.setBlockedURLs', { urls: [] })
				await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
				await waitFor("document.querySelector('#settings-save-status')?.textContent?.includes('Current configuration and state were reloaded') === true && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} unresolved settings mutation did not recover after a complete refresh`)

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

browserTest(
	'permanently freezes dashboard mutations after an indeterminate configuration commit',
	async () => {
		const indeterminate = new Error('sensitive post-rename owner-file failure')
		indeterminate.name = CONFIGURATION_COMMIT_INDETERMINATE
		const dashboard = startDashboardServer(0, {
			getConfiguration: () => ({
				hasSigner: true,
				rememberSigner: true,
				revision: 'fixture-indeterminate',
				settings: {
					network: { chainId: 11_155_111, name: 'sepolia' },
					paused: true,
					runtime: { execute: false },
					scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
					strategy: { enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'] },
				},
				signerAddress: walletAddress,
			}),
			getState: () => state({ signerReady: true, wallet: walletAddress }),
			hostname: '127.0.0.1',
			password: dashboardPassword,
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {
				throw indeterminate
			},
			setWorkflow: () => {},
		})
		const debuggingPort = await availablePort()
		const userDataDirectory = await mkdtemp(join(tmpdir(), 'chaos-dashboard-indeterminate-chromium-'))
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
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#signer-summary .identifier-copy') !== null && document.querySelector('#signer-fields')?.disabled === false", 'Signer controls did not load before the indeterminate mutation')
			await cdp.evaluate(`(() => {
				const input = document.querySelector('#private-key')
				const form = document.querySelector('#signer-form')
				if (!(input instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
				input.value = ${JSON.stringify(`0x${'99'.repeat(32)}`)}
				form.dispatchEvent(new SubmitEvent('submit', { bubbles: true, cancelable: true }))
			})()`)
			await waitFor("document.querySelector('#signer-status')?.textContent?.includes('permanently frozen in this server process and page') === true", 'Indeterminate signer commit did not latch the dashboard')
			expect(
				await cdp.evaluate(`({
					configurationNotice: document.querySelector('#configuration-status')?.textContent,
					confirmationDisabled: document.querySelector('#confirm-resume')?.disabled,
					pauseDisabled: document.querySelector('#pause-button')?.disabled,
					settingsDisabled: document.querySelector('#settings-fields')?.disabled,
					signerDisabled: document.querySelector('#signer-fields')?.disabled,
					sensitiveVisible: document.documentElement.textContent?.includes('sensitive post-rename'),
				})`),
			).toMatchObject({
				configurationNotice: expect.stringContaining('inspect and reload the owner configuration and runtime-state files offline'),
				confirmationDisabled: true,
				pauseDisabled: true,
				settingsDisabled: true,
				signerDisabled: true,
				sensitiveVisible: false,
			})

			await cdp.evaluate("document.querySelector('#refresh-button')?.click()")
			await waitFor("document.querySelector('#refresh-button')?.textContent === 'Refresh'", 'Refresh did not finish after the indeterminate mutation')
			expect(await cdp.evaluate("document.querySelector('#signer-fields')?.disabled === true && document.querySelector('#signer-status')?.textContent?.includes('permanently frozen') === true")).toBe(true)

			await cdp.command('Page.navigate', { url: 'about:blank' })
			await waitFor("document.readyState === 'complete'", 'Chromium did not reset before checking the server-process latch')
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#configuration-status')?.textContent?.includes('permanently frozen in this server process and page') === true", 'A new page did not inherit the server-process mutation latch')
			expect(await cdp.evaluate("document.querySelector('#pause-button')?.disabled === true && document.querySelector('#settings-fields')?.disabled === true && document.querySelector('#signer-fields')?.disabled === true")).toBe(true)
		} finally {
			socket?.close()
			browser.kill()
			await browser.exited
			dashboard.stop(true)
			await rm(userDataDirectory, { force: true, recursive: true })
		}
	},
	30_000,
)

test('recovery dashboard source has no generic manual-load fallback', async () => {
	const source = await Bun.file(join(import.meta.dir, '..', '..', 'src', 'dashboard', 'dashboard.ts')).text()
	expect(source).not.toContain('Refresh to load')
	for (const context of ['replacementRecoveryContext', 'cancellationRecoveryContext', 'candidateRecoveryContext', 'workflowRecoveryContext', 'obligationRecoveryContext']) {
		expect(source).toContain(`await requestRecoveryContextRefresh(${context})`)
	}
})
