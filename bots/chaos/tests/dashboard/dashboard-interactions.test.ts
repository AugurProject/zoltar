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
const longCatalogLabel = 'Blocked report sibling with an intentionally extended operation label that must remain associated with every mobile status field'
const longCatalogIdentifier = `open-oracle.${'long-operation-identifier-segment-'.repeat(8)}blocked-sibling`
const longCatalogBlocker = `Canonical blocker ${'without-a-natural-break-'.repeat(12)}must-stay-inside-the-operation-card`
const topologyValues = {
	auctionAddress: `0x${'a1'.repeat(20)}`,
	auctionPoolAddress: `0x${'a2'.repeat(20)}`,
	pairAddress: `0x${'b1'.repeat(20)}`,
	pairPoolAddress: `0x${'b2'.repeat(20)}`,
	poolAddress: `0x${'c1'.repeat(20)}`,
	reportToken1: `0x${'d1'.repeat(20)}`,
	reportToken2: `0x${'d2'.repeat(20)}`,
	repToken: `0x${'e1'.repeat(20)}`,
}
const topologyIdentifiers = [
	{ type: 'universe REP token', value: topologyValues.repToken },
	{ type: 'security pool address', value: topologyValues.poolAddress },
	{ type: 'report token 1', value: topologyValues.reportToken1 },
	{ type: 'report token 2', value: topologyValues.reportToken2 },
	{ type: 'truth auction address', value: topologyValues.auctionAddress },
	{ type: 'truth auction pool address', value: topologyValues.auctionPoolAddress },
	{ type: 'trading pair address', value: topologyValues.pairAddress },
	{ type: 'trading pair pool address', value: topologyValues.pairPoolAddress },
]
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
		recoveredState: state({ workflows: [{ classification: 'selectable', id: 'workflow-1', status: 'waiting-continuation', updatedAt: '2026-08-24T00:00:00.000Z' }] }),
		retryId: 'workflow-retry',
		staleState: state({ workflows: [{ classification: 'selectable', id: 'workflow-1', status: 'waiting-continuation' }] }),
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
		{ definition: { classification: 'lifecycle-obligation', description: 'Settle the anchored report.', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: [], eligible: true }, plan: { id: 'settle-1' } },
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: [], eligible: true }, plan: { id: 'settle-2' } },
		{ definition: { classification: 'lifecycle-obligation', description: 'Settle the anchored report.', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: ['settle the anchored report'], eligible: false } },
		{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.blocked-sibling', label: 'Blocked report sibling', risk: 'low' }, eligibility: { blockers: ['No safe fixture candidate exists'], eligible: false } },
		{ definition: { classification: 'role-restricted', description: 'Factory only.', ecosystem: 'statoblast', id: 'surface.pool.initialize', label: 'Pool.initialize', risk: 'high' }, eligibility: { blockers: ['factory only'], eligible: false } },
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'statoblast', id: 'surface.security-pool-forker.claim-auction-proceeds', independentlyExecutable: false, label: 'SecurityPoolForker.claimAuctionProceeds', risk: 'low' }, eligibility: { blockers: ['Covered by settleAuctionBids'], eligible: false } },
		{ definition: { classification: 'selectable', ecosystem: 'trading', id: 'trading.position.enter', label: 'Router enter', risk: 'low' }, eligibility: { blockers: ['No safe route exists'], eligible: false } },
	],
	inventory: {
		eth: '1000000000000000001',
		rep: [{ balance: '123456789012345678901', symbol: 'REP', token: '0x9999999999999999999999999999999999999998', universeId: '0' }],
		weth: '42',
	},
	obligations: [
		{ id: 'obligation-rendering', label: 'Rendered obligation', status: 'executing', updatedAt: '2026-08-24T00:01:00.000Z' },
		{ ecosystem: 'open-oracle', id: 'obligation-deferred', label: 'Deferred obligation', status: 'deferred', updatedAt: '2026-08-24T00:01:00.000Z' },
	],
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
	scheduler: { lastDelaySeconds: 60, nextRunAt: '2020-08-24T00:01:00.000Z', selectedOperationId: 'open-oracle.settle', status: 'running' },
	topology: {
		anchor: { blockNumber: '4242', timestamp: '1000' },
		auctions: [{ address: topologyValues.auctionAddress, bids: [], finalized: false, pool: topologyValues.auctionPoolAddress }],
		complete: true,
		pairs: [{ address: topologyValues.pairAddress, feeBps: 30, pool: topologyValues.pairPoolAddress, status: 1, universeId: '0' }],
		pools: [{ address: topologyValues.poolAddress, systemState: 0, universeId: '0', vaults: [] }],
		reports: [{ reportId: '7', settlementTime: '2000', token1: topologyValues.reportToken1, token2: topologyValues.reportToken2 }],
		universes: [{ id: '0', knownChildOutcomes: [], repToken: topologyValues.repToken }],
	},
	wallet: walletAddress,
})

const partialRecoveryDashboardState = state({
	inventory: { eth: '1000000000000000000', rep: [], weth: '2000000000000000000' },
	inventoryAvailable: false,
	paused: true,
	safetyPaused: true,
	workflows: [
		{
			classification: 'selectable',
			id: 'workflow-partial-dashboard',
			label: 'Partial dashboard workflow',
			status: 'waiting-continuation',
			steps: [
				{ label: 'Confirmed preparation', status: 'confirmed' },
				{ label: 'Canonical cleanup', status: 'blocked' },
			],
			updatedAt: '2026-08-24T00:00:00.000Z',
		},
	],
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
		const settingsMutations: unknown[] = []
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
			setSettings: value => settingsMutations.push(value),
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
			const accessibilityIdentity = async (selector: string) => {
				const documentResult = await cdp.command('DOM.getDocument', { depth: 0 })
				const rootNode = typeof documentResult === 'object' && documentResult !== null ? Reflect.get(documentResult, 'root') : undefined
				const rootNodeId = typeof rootNode === 'object' && rootNode !== null ? Reflect.get(rootNode, 'nodeId') : undefined
				if (typeof rootNodeId !== 'number') throw new Error('Chromium did not return the dashboard document node')
				const queryResult = await cdp.command('DOM.querySelector', { nodeId: rootNodeId, selector })
				const nodeId = typeof queryResult === 'object' && queryResult !== null ? Reflect.get(queryResult, 'nodeId') : undefined
				if (typeof nodeId !== 'number' || nodeId === 0) throw new Error(`Chromium did not find ${selector}`)
				const accessibilityResult = await cdp.command('Accessibility.getPartialAXTree', { fetchRelatives: false, nodeId })
				const nodes = typeof accessibilityResult === 'object' && accessibilityResult !== null ? Reflect.get(accessibilityResult, 'nodes') : undefined
				if (!Array.isArray(nodes) || nodes.length !== 1) throw new Error(`Chromium did not return one accessibility node for ${selector}`)
				const node = nodes[0]
				const name = typeof node === 'object' && node !== null ? Reflect.get(node, 'name') : undefined
				const role = typeof node === 'object' && node !== null ? Reflect.get(node, 'role') : undefined
				return {
					name: typeof name === 'object' && name !== null ? Reflect.get(name, 'value') : undefined,
					role: typeof role === 'object' && role !== null ? Reflect.get(role, 'value') : undefined,
				}
			}
			const waitForSettingsMutation = async (count: number, message: string) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if (settingsMutations.length === count) return
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
			const touchControl = async (selector: string) => {
				const center = await cdp.evaluate(`new Promise(resolve => {
					const control = document.querySelector(${JSON.stringify(selector)})
					control?.scrollIntoView({ block: 'center' })
					requestAnimationFrame(() => requestAnimationFrame(() => {
						const bounds = control?.getBoundingClientRect()
						resolve({ x: bounds === undefined ? undefined : bounds.left + bounds.width / 2, y: bounds === undefined ? undefined : bounds.top + bounds.height / 2 })
					}))
				})`)
				const x = typeof center === 'object' && center !== null ? Reflect.get(center, 'x') : undefined
				const y = typeof center === 'object' && center !== null ? Reflect.get(center, 'y') : undefined
				if (typeof x !== 'number' || typeof y !== 'number') throw new Error(`Missing touch target for ${selector}`)
				await cdp.command('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 })
				await cdp.command('Input.dispatchTouchEvent', { touchPoints: [{ x, y }], type: 'touchStart' })
				await cdp.command('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' })
				await cdp.command('Emulation.setTouchEmulationEnabled', { enabled: false })
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

			initialDashboardState = partialRecoveryDashboardState
			recoveredDashboardState = partialRecoveryDashboardState
			failSecondStateRead = false
			stateRequests = 0
			await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
			await waitFor("document.querySelector('#mode-badge')?.textContent === 'Safety paused'", 'Safety-pause fixture did not render its durable latch')
			expect(
				await cdp.evaluate(`({
					eth: document.querySelector('#balance-eth')?.textContent,
					recovery: document.querySelector('#recovery-badge')?.textContent,
					rep: document.querySelector('#rep-balances')?.textContent,
					weth: document.querySelector('#balance-weth')?.textContent,
				})`),
			).toEqual({ eth: '—', recovery: '1 recovery item', rep: 'Inventory unavailable until the first canonical scan.', weth: '—' })
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
				await cdp.command('Page.navigate', { url: 'about:blank' })
				await waitFor("document.readyState === 'complete'", `Chromium did not reset before the ${viewport.label} workflow check`)
				stateRequests = 0
				await cdp.command('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, height: viewport.height, mobile: false, width: viewport.width })
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor(`document.querySelectorAll('#current-workflow .step-list li').length === ${workflowSteps.length.toString()}`, `${viewport.label} workflow steps did not render`)
				expect(await cdp.evaluate("document.querySelector('#scheduler-state')?.textContent")).toBe('Transaction recovery pending')
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
				expect(await cdp.evaluate(`({ scheduler: document.querySelector('#scheduler-state')?.textContent, workflow: document.querySelector('#current-workflow .workflow-heading .badge')?.textContent })`)).toEqual({ scheduler: 'Transaction recovery pending', workflow: 'Waiting transaction' })
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

				await cdp.command('Page.navigate', { url: new URL('/catalog', dashboard.url).href })
				await waitFor("document.querySelector('#catalog-caption')?.textContent?.includes('2 live candidates') === true", 'Grouped operation catalog did not render')
				expect(
					await cdp.evaluate(`(() => {
						const alias = [...document.querySelectorAll('#catalog-rows tr')].find(row => row.textContent?.includes('claimAuctionProceeds'))
						const statoblast = [...document.querySelectorAll('#coverage-summary .coverage-card')].find(card => card.textContent?.includes('Statoblast'))
						return { coverage: statoblast?.querySelector('strong')?.textContent, eligibility: alias?.querySelector('td:nth-child(6) .badge')?.textContent }
					})()`),
				).toEqual({ coverage: '0/0', eligibility: 'Not independently selectable' })
				const redundantCatalogCopy = await cdp.evaluate(`(() => {
					const normalize = value => value?.trim().replaceAll(/\\s+/g, ' ').replace(/[.?!]+$/, '').toLowerCase()
					return [...document.querySelectorAll('#catalog-rows tr')].flatMap(row => {
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
						const row = [...document.querySelectorAll('#catalog-rows tr')].find(candidate => candidate.textContent?.includes('Pool.initialize'))
						return {
							blockers: [...(row?.querySelectorAll('.blocker-list li') ?? [])].map(blocker => blocker.textContent),
							descriptions: row?.querySelectorAll('.operation-name > small:not(.mono)').length,
						}
					})()`),
				).toEqual({ blockers: ['factory only'], descriptions: 0 })
				expect(
					await cdp.evaluate(`(() => {
						const row = [...document.querySelectorAll('#catalog-rows tr')].find(candidate => candidate.querySelector('.operation-name small.mono')?.textContent === 'open-oracle.settle')
						return {
							blockers: row?.querySelectorAll('.blocker-list li').length,
							description: row?.querySelector('.operation-description')?.textContent,
						}
					})()`),
				).toEqual({ blockers: 0, description: 'Settle the anchored report.' })
				if (viewport.label === 'desktop') {
					expect(
						await cdp.evaluate(`({
								candidate: [...document.querySelectorAll('#catalog-rows tr')].find(row => row.textContent?.includes('open-oracle.settle'))?.querySelector('td:nth-child(5)')?.textContent,
								rows: document.querySelectorAll('#catalog-rows tr').length,
							})`),
					).toEqual({ candidate: '2', rows: 5 })
					expect(
						await cdp.evaluate(`(() => {
							const shell = document.querySelector('.table-shell')
							const headers = [...document.querySelectorAll('.table-shell thead th')]
							if (!(shell instanceof HTMLElement)) return undefined
							const eligibilityBounds = headers.at(-1)?.getBoundingClientRect()
							return {
								allColumnsVisible: eligibilityBounds !== undefined && eligibilityBounds.right <= shell.getBoundingClientRect().right + 1,
								headerLabels: headers.map(header => header.textContent?.trim()),
								horizontalOverflow: shell.scrollWidth > shell.clientWidth,
							}
						})()`),
					).toEqual({ allColumnsVisible: true, headerLabels: ['Operation', 'Ecosystem', 'Classification', 'Risk', 'Candidates', 'Eligibility'], horizontalOverflow: false })
					await cdp.evaluate(`(() => {
							const filter = document.querySelector('#catalog-classification-filter')
							if (!(filter instanceof HTMLSelectElement)) return
							filter.value = 'role-restricted'
							filter.dispatchEvent(new Event('change', { bubbles: true }))
						})()`)
					expect(await cdp.evaluate(`document.querySelector('#catalog-rows')?.textContent?.includes('Pool.initialize') === true && document.querySelectorAll('#catalog-rows tr').length === 1`)).toBe(true)
				} else {
					const mobileCatalog = await cdp.evaluate(`(() => {
						const shell = document.querySelector('[data-page-content="catalog"] .table-shell')
						const row = [...document.querySelectorAll('#catalog-rows tr')].find(candidate => candidate.textContent?.includes('open-oracle.blocked-sibling'))
						if (!(shell instanceof HTMLElement) || !(row instanceof HTMLTableRowElement)) return undefined
						const operationLabel = row.querySelector('.operation-name strong')
						const operationId = row.querySelector('.operation-name small.mono')
						const blocker = row.querySelector('.blocker-list li')
						if (operationLabel !== null) operationLabel.textContent = ${JSON.stringify(longCatalogLabel)}
						if (operationId !== null) operationId.textContent = ${JSON.stringify(longCatalogIdentifier)}
						if (blocker !== null) blocker.textContent = ${JSON.stringify(longCatalogBlocker)}
						shell.scrollLeft = shell.scrollWidth
						const cells = [...row.querySelectorAll(':scope > td')]
						const rowBounds = row.getBoundingClientRect()
						const shellBounds = shell.getBoundingClientRect()
						return {
							blocker: blocker?.textContent,
							candidateCount: cells[4]?.textContent?.trim(),
							cellLabels: cells.map(cell => getComputedStyle(cell, '::before').content.replaceAll('"', '')),
							cellsContained: cells.every(cell => {
								const bounds = cell.getBoundingClientRect()
								return bounds.left >= rowBounds.left - 1 && bounds.right <= rowBounds.right + 1 && cell.scrollWidth <= cell.clientWidth
							}),
							documentOverflow: document.body.scrollWidth > document.documentElement.clientWidth,
							eligibility: cells[5]?.querySelector('.badge')?.textContent,
							identity: operationLabel?.textContent,
							identifier: operationId?.textContent,
							maximumHorizontalScroll: shell.scrollWidth - shell.clientWidth,
							risk: cells[3]?.querySelector('.badge')?.textContent,
							rowContained: rowBounds.left >= shellBounds.left - 1 && rowBounds.right <= shellBounds.right + 1 && row.scrollWidth <= row.clientWidth,
							rowDisplay: getComputedStyle(row).display,
							shellOverflow: shell.scrollWidth > shell.clientWidth,
						}
					})()`)
					expect(mobileCatalog).toEqual({
						blocker: longCatalogBlocker,
						candidateCount: '0',
						cellLabels: ['Operation', 'Ecosystem', 'Classification', 'Risk', 'Candidates', 'Eligibility'],
						cellsContained: true,
						documentOverflow: false,
						eligibility: 'Blocked',
						identity: longCatalogLabel,
						identifier: longCatalogIdentifier,
						maximumHorizontalScroll: 0,
						risk: 'Low',
						rowContained: true,
						rowDisplay: 'grid',
						shellOverflow: false,
					})
				}

				await cdp.command('Page.navigate', { url: new URL('/ecosystem', dashboard.url).href })
				await waitFor("document.querySelector('#topology-anchor')?.textContent === 'Block 4242'", `${viewport.label} anchored topology did not render`)
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
					topbarBackground: getComputedStyle(document.querySelector('.topbar')).backgroundColor,
				})`)
				expect(Reflect.get(topologyPresentation, 'topbarBackground')).toBe('rgb(9, 11, 13)')
				const summaryHeights = Reflect.get(topologyPresentation, 'summaryHeights')
				expect(summaryHeights).toHaveLength(5)
				if (!Array.isArray(summaryHeights)) throw new Error('Missing topology summary bounds')
				for (const height of summaryHeights) {
					if (typeof height !== 'number') throw new Error('Missing topology summary bounds')
					expect(height).toBeGreaterThanOrEqual(44)
				}
				await expectVisibleIdentifiers(topologyIdentifiers, viewport.width === 390 ? 44 : 32, '.topology-panel .compact-identifier')
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
				await cdp.evaluate(`Object.defineProperty(navigator, 'clipboard', {
					configurable: true,
					value: { writeText: value => { window.__topologyCopies = [...(window.__topologyCopies ?? []), value]; return Promise.resolve() } },
				}); window.__topologyCopies = []`)
				if (viewport.label === 'desktop') {
					expect(
						await cdp.evaluate(`(() => {
							const disclosure = document.querySelector('[data-identifier-type="universe REP token"] .identifier-disclosure')
							disclosure?.focus()
							return { focused: document.activeElement === disclosure, tag: disclosure?.tagName }
						})()`),
					).toEqual({ focused: true, tag: 'BUTTON' })
					await cdp.command('Input.dispatchKeyEvent', { code: 'Space', key: ' ', nativeVirtualKeyCode: 32, type: 'rawKeyDown', windowsVirtualKeyCode: 32 })
					await cdp.command('Input.dispatchKeyEvent', { code: 'Space', key: ' ', nativeVirtualKeyCode: 32, type: 'keyUp', windowsVirtualKeyCode: 32 })
					expect(
						await cdp.evaluate(`({
							expanded: document.querySelector('[data-identifier-type="universe REP token"] .identifier-disclosure')?.getAttribute('aria-expanded'),
							hidden: document.querySelector('[data-identifier-type="universe REP token"] .identifier-full')?.hidden,
							value: document.querySelector('[data-identifier-type="universe REP token"] .identifier-full')?.value,
						})`),
					).toEqual({ expanded: 'true', hidden: false, value: topologyValues.repToken })
					expect(await cdp.evaluate(`(() => { const copy = document.querySelector('[data-identifier-type="security pool address"] .identifier-copy'); copy?.focus(); return { focused: document.activeElement === copy, tag: copy?.tagName } })()`)).toEqual({ focused: true, tag: 'BUTTON' })
					await cdp.command('Input.dispatchKeyEvent', { code: 'Space', key: ' ', nativeVirtualKeyCode: 32, type: 'rawKeyDown', windowsVirtualKeyCode: 32 })
					await cdp.command('Input.dispatchKeyEvent', { code: 'Space', key: ' ', nativeVirtualKeyCode: 32, type: 'keyUp', windowsVirtualKeyCode: 32 })
					await waitFor(`document.querySelector('[data-identifier-type="security pool address"] .identifier-feedback')?.textContent === 'Copied'`, 'Keyboard topology copy did not report success')
					expect(await cdp.evaluate('window.__topologyCopies')).toEqual([topologyValues.poolAddress])
				} else {
					await touchControl('[data-identifier-type="report token 1"] .identifier-disclosure')
					expect(
						await cdp.evaluate(`({
							expanded: document.querySelector('[data-identifier-type="report token 1"] .identifier-disclosure')?.getAttribute('aria-expanded'),
							hidden: document.querySelector('[data-identifier-type="report token 1"] .identifier-full')?.hidden,
							value: document.querySelector('[data-identifier-type="report token 1"] .identifier-full')?.value,
						})`),
					).toEqual({ expanded: 'true', hidden: false, value: topologyValues.reportToken1 })
					await touchControl('[data-identifier-type="report token 2"] .identifier-copy')
					await waitFor(`document.querySelector('[data-identifier-type="report token 2"] .identifier-feedback')?.textContent === 'Copied'`, 'Touch topology copy did not report success')
					expect(await cdp.evaluate('window.__topologyCopies')).toEqual([topologyValues.reportToken2])
				}
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

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
				expect(
					await cdp.evaluate(`(() => {
						const row = [...document.querySelectorAll('#obligations .stack-row')].find(candidate => candidate.textContent?.includes('Deferred obligation'))
						return { detail: row?.querySelector('small')?.textContent, status: row?.querySelector('.badge')?.textContent, tone: row?.querySelector('.badge')?.className }
					})()`),
				).toEqual({ detail: 'Open Oracle · tracked, not currently actionable', status: 'Deferred', tone: 'badge neutral' })
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
				expect(
					await cdp.evaluate(`({
						executeDescription: document.querySelector('#execute')?.getAttribute('aria-describedby'),
						executeHelp: document.querySelector('#execute-help')?.textContent,
						lede: document.querySelector('.settings-intro .lede')?.textContent,
						locked: document.querySelector('#settings-fields')?.disabled,
						pauseNote: document.querySelector('#settings-pause-note')?.textContent,
						pauseNoteVisible: document.querySelector('#settings-pause-note')?.classList.contains('hidden') === false,
					})`),
				).toEqual({
					executeDescription: 'execute-help',
					executeHelp: 'Off is dry-run mode. Live mode can spend gas and protocol assets. It requires positive reserves and retains an ETH safety floor at least as large as one maximum gas-cost budget.',
					lede: 'Changes apply before the next selection cycle.',
					locked: true,
					pauseNote: 'Execution-policy controls are locked while the bot is running. Pause the bot to review and change risk, caps, reserves, timing, or ecosystem scope.',
					pauseNoteVisible: true,
				})
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
				expect(Reflect.get(disabledButtonPresentation, 'opacity')).toBe('1')
				expect(Reflect.get(disabledButtonPresentation, 'contrast')).toBeGreaterThanOrEqual(4.5)
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
				await cdp.evaluate(`(() => {
					const execute = document.querySelector('#execute')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(execute instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					execute.checked = true
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
				await cdp.evaluate(`(() => {
					const execute = document.querySelector('#execute')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(execute instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					execute.checked = false
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
				await cdp.evaluate(`(() => {
					const execute = document.querySelector('#execute')
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const form = document.querySelector('#settings-form')
					if (!(execute instanceof HTMLInputElement) || !(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					execute.checked = true
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
				await cdp.evaluate(`(() => {
					const execute = document.querySelector('#execute')
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const maximumGasCost = document.querySelector('#maximum-gas-cost')
					const form = document.querySelector('#settings-form')
					if (!(execute instanceof HTMLInputElement) || !(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					execute.checked = false
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
							enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
							maximumEthPerOperation: '0.05',
							maximumGasCostEth: '0.02',
							maximumRepPerOperation: '10',
							minimumEthReserve: '0',
							minimumRepReserve: '0.000000000000000000',
							workflowValidForBlocks: 96,
						},
					},
					revision: 'fixture-1',
				})
				await waitFor("document.querySelector('#settings-save-status')?.textContent === 'Execution policy saved.' && document.querySelector('#settings-fields')?.disabled === false", `${viewport.label} dry-run zero-reserve policy did not reconcile`)

				const exactBoundaryMutationCount = settingsMutations.length + 1
				await cdp.evaluate(`(() => {
					const execute = document.querySelector('#execute')
					const minDelay = document.querySelector('#min-delay')
					const maxDelay = document.querySelector('#max-delay')
					const ethReserve = document.querySelector('#reserve-eth')
					const repReserve = document.querySelector('#reserve-rep')
					const maximumGasCost = document.querySelector('#maximum-gas-cost')
					const form = document.querySelector('#settings-form')
					if (!(execute instanceof HTMLInputElement) || !(minDelay instanceof HTMLInputElement) || !(maxDelay instanceof HTMLInputElement) || !(ethReserve instanceof HTMLInputElement) || !(repReserve instanceof HTMLInputElement) || !(maximumGasCost instanceof HTMLInputElement) || !(form instanceof HTMLFormElement)) return
					execute.checked = true
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
							enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
							maximumEthPerOperation: '0.05',
							maximumGasCostEth: '0.123456789012345678',
							maximumRepPerOperation: '10',
							minimumEthReserve: '0.123456789012345678',
							minimumRepReserve: '0.000000000000000001',
							workflowValidForBlocks: 96,
						},
					},
					revision: 'fixture-1',
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
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)

				initialDashboardState = pausedWorkflowRenderingState
				recoveredDashboardState = pausedWorkflowRenderingState
				stateRequests = 0
				await cdp.command('Page.navigate', { url: new URL('/overview', dashboard.url).href })
				await waitFor("document.querySelector('#mode-badge')?.textContent === 'Paused'", `${viewport.label} paused resume fixture did not render`)
				await cdp.evaluate("document.querySelector('#pause-button')?.click()")
				await waitFor("document.querySelector('#resume-dialog')?.open === true", `${viewport.label} resume dialog did not open`)
				expect(await accessibilityIdentity('#resume-dialog')).toEqual({ name: 'Resume chaos scheduling?', role: 'dialog' })
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
			await waitFor("document.querySelector('#settings-scope')?.textContent === 'sepolia · chain 11155111'", 'Mobile settings fixture did not load')
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
				await waitFor("document.querySelector('#refresh-button')?.disabled === false && document.querySelector('#refresh-button')?.textContent === 'Refresh'", `/${route} initial refresh did not settle`)
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
