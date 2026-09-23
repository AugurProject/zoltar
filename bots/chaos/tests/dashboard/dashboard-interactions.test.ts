import { CHROMIUM_STARTUP_BUDGET_MILLISECONDS, startChromiumSession } from './chromium-session.ts'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE } from '../../src/runtime/configuration-commit.ts'
import { recordPreflightFailure } from '../../src/execution/preflight-failure.ts'
import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { RuntimeState } from '../../src/state/operator-state.ts'

type RecoveryScenario = {
	fieldsId: string
	formId: string
	label: string
	recoveredState: Record<string, unknown>
	retryId: string
	staleState: Record<string, unknown>
	statusId: string
}

const chromium = process.env['CHROMIUM_PATH'] ?? Bun.which('google-chrome') ?? Bun.which('chromium') ?? '/usr/bin/chromium'
const browserTest = existsSync(chromium) ? test : test.skip
const transactionHash = `0x${'12'.repeat(32)}`
const candidateHash = `0x${'34'.repeat(32)}`
const cancellationHash = `0x${'56'.repeat(32)}`
const activityHash = `0x${'78'.repeat(32)}`
const walletAddress = `0x${'ab'.repeat(20)}`
const explorerUrl = 'https://sepolia.etherscan.io'
const explorerTransaction = (hash: string) => `${explorerUrl}/tx/${hash}`
const longCatalogLabel = 'Blocked report sibling with an intentionally extended operation label that must remain associated with every mobile status field'
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
const dashboardCheckTime = new Date().toISOString()
const privateSubmissionHealth = [
	{ authenticatedAddress: walletAddress, chainId: 11_155_111, checkedAt: dashboardCheckTime, kind: 'private-relay', status: 'healthy', target: `https://relay-one.example/private?token=${rpcSecret}` },
	{ authenticatedAddress: walletAddress, chainId: 11_155_111, checkedAt: dashboardCheckTime, kind: 'private-relay', status: 'healthy', target: 'https://relay-two.example/private' },
	{ authenticatedAddress: walletAddress, chainId: undefined, checkedAt: dashboardCheckTime, failureDisposition: 'connectivity-degraded', kind: 'private-relay', status: 'failed', target: 'https://relay-three.example/private' },
] as const
const degradedPrivateSubmissionHealth = [privateSubmissionHealth[0], { ...privateSubmissionHealth[1], authenticatedAddress: '0x0000000000000000000000000000000000000002', status: 'failed' }, privateSubmissionHealth[2]] as const
const stalePrivateSubmissionHealth = privateSubmissionHealth.map(check => ({ ...check, checkedAt: '2020-08-24T00:00:00.000Z' }))
const workflowSteps = [
	{ label: 'Confirmed step', status: 'confirmed', transactionHash: `0x${'11'.repeat(32)}` },
	{ label: 'Complete step', status: 'complete', transactionHash: `0x${'22'.repeat(32)}` },
	{ label: 'Submitted step', status: 'submitted', transactionHash },
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
	lastScannedBlock: '12345678',
	lastScanAt: new Date(Date.now() - 12_000).toISOString(),
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
		{
			definition: {
				classification: 'selectable',
				description: 'Exact payable alias of WETH9.deposit and the same bounded wrap operation.',
				ecosystem: 'open-oracle',
				id: 'surface.weth9.receive',
				independentlyExecutable: false,
				label: 'WETH9.receive',
				risk: 'low',
			},
			eligibility: { blockers: ['Covered by open-oracle.weth.wrap'], eligible: false },
		},
		{ definition: { classification: 'role-restricted', description: 'Factory only.', ecosystem: 'statoblast', id: 'surface.pool.initialize', label: 'Pool.initialize', risk: 'high' }, eligibility: { blockers: ['factory only'], eligible: false } },
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'statoblast', id: 'surface.security-pool-forker.claim-auction-proceeds', independentlyExecutable: false, label: 'SecurityPoolForker.claimAuctionProceeds', risk: 'low' }, eligibility: { blockers: ['Covered by settleAuctionBids'], eligible: false } },
		{ definition: { classification: 'selectable', ecosystem: 'trading', id: 'trading.position.enter', label: 'Router enter', risk: 'low' }, eligibility: { blockers: ['No safe route exists'], eligible: false } },
	],
	inventoryAvailable: true,
	inventory: {
		eth: '1000000000000000001',
		rep: [{ balance: '123456789012345678901', symbol: 'REP', token: '0x9999999999999999999999999999999999999998', universeId: '0' }],
		weth: '42',
	},
	obligations: [
		{ id: 'obligation-rendering', label: 'Rendered obligation', status: 'executing', updatedAt: '2026-08-24T00:01:00.000Z' },
		{ attemptCount: 4, automaticRetryCount: 1, automaticRetryLimit: 3, ecosystem: 'open-oracle', id: 'obligation-deferred', label: 'Deferred obligation', notBefore: '2026-08-24T00:03:00.000Z', status: 'deferred', updatedAt: '2026-08-24T00:01:00.000Z' },
	],
	paused: false,
	pendingTransactions: [
		{
			cancellationHash,
			hash: transactionHash,
			label: 'Rendered pending transaction',
			maxBlockNumber: '12345700',
			nonce: 9,
			observation: { checkedAt: new Date(Date.now() - 20_000).toISOString(), head: '12345678', includedBlock: '12345670', kind: 'awaiting-finality' },
			replacementHash: candidateHash,
			status: 'waiting-transaction',
		},
	],
	rpcEndpointHealth: [...readRpcHealth, ...privateSubmissionHealth],
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
const degradedWorkflowRenderingState = { ...workflowRenderingState, rpcEndpointHealth: [...degradedReadRpcHealth, ...degradedPrivateSubmissionHealth] }
const staleSubmissionWorkflowRenderingState = { ...workflowRenderingState, rpcEndpointHealth: [...readRpcHealth, ...stalePrivateSubmissionHealth] }

async function connectToChromium() {
	const session = await startChromiumSession(chromium)
	try {
		await session.send('Runtime.enable')
		await session.send('Page.enable')
		const evaluate = async (expression: string) => {
			const response = await session.send('Runtime.evaluate', { awaitPromise: true, expression, returnByValue: true })
			const result = typeof response === 'object' && response !== null ? Reflect.get(response, 'result') : undefined
			return typeof result === 'object' && result !== null ? Reflect.get(result, 'value') : undefined
		}
		return { command: session.send, evaluate, close: session.close, issues: session.issues }
	} catch (error) {
		await session.close()
		throw error
	}
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
			const waitFor = async (expression: string, message: string) => {
				for (let attempt = 0; attempt < 400; attempt += 1) {
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
			const expectVisibleIdentifiers = async (expected: { explorerUrl?: string; type: string; value: string }[], minimumButtonHeight: number, selector = '.full-identifier') => {
				const identifiers = await cdp.evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].flatMap(wrapper => {
					const bounds = wrapper.getBoundingClientRect()
					if (bounds.width === 0 || bounds.height === 0) return []
					const display = wrapper.querySelector('.identifier-value')
					const displayBounds = display?.getBoundingClientRect()
					const explorer = wrapper.querySelector('.identifier-explorer')
					const explorerBounds = explorer?.getBoundingClientRect()
					return [{
						display: display?.textContent,
						visible: (displayBounds?.width ?? 0) > 0 && (displayBounds?.height ?? 0) > 0,
						unclipped: display !== null && display.scrollWidth <= display.clientWidth,
						buttonCount: wrapper.querySelectorAll('button').length,
						explorerHeight: explorerBounds?.height,
						explorerHref: explorer?.getAttribute('href') ?? null,
						explorerName: explorer?.getAttribute('aria-label') ?? null,
						explorerRel: explorer?.getAttribute('rel') ?? null,
						explorerTarget: explorer?.getAttribute('target') ?? null,
						explorerText: explorer?.textContent ?? null,
						explorerTitle: explorer?.getAttribute('title') ?? null,
						explorerVisible: (explorerBounds?.width ?? 0) > 0 && (explorerBounds?.height ?? 0) > 0,
						right: bounds.right,
						type: wrapper.getAttribute('data-identifier-type'),
					}]
				})`)
				expect(identifiers).toHaveLength(expected.length)
				const viewportRight = await cdp.evaluate('document.documentElement.clientWidth + 1')
				if (typeof viewportRight !== 'number') throw new Error('Missing dashboard viewport width')
				for (const identifier of expected) {
					const rendered = Array.isArray(identifiers) ? identifiers.find(candidate => Reflect.get(candidate, 'type') === identifier.type && Reflect.get(candidate, 'display') === identifier.value) : undefined
					if (rendered === undefined) throw new Error(`Missing visible ${identifier.type}`)
					expect(Reflect.get(rendered, 'type')).toBe(identifier.type)
					expect(Reflect.get(rendered, 'display')).toBe(identifier.value)
					expect(Reflect.get(rendered, 'visible')).toBe(true)
					expect(Reflect.get(rendered, 'unclipped')).toBe(true)
					expect(Reflect.get(rendered, 'buttonCount')).toBe(0)
					if (identifier.explorerUrl === undefined) {
						expect(Reflect.get(rendered, 'explorerHref')).toBeNull()
					} else {
						expect(Reflect.get(rendered, 'explorerHref')).toBe(identifier.explorerUrl)
						expect(Reflect.get(rendered, 'explorerName')).toBe(`Open ${identifier.type} on ${new URL(identifier.explorerUrl).hostname}: ${identifier.value}`)
						expect(Reflect.get(rendered, 'explorerRel')).toBe('noreferrer')
						expect(Reflect.get(rendered, 'explorerTarget')).toBe('_blank')
						expect(Reflect.get(rendered, 'explorerText')).toBe('Explorer')
						expect(Reflect.get(rendered, 'explorerTitle')).toBe(`Open on ${new URL(identifier.explorerUrl).hostname}`)
						expect(Reflect.get(rendered, 'explorerVisible')).toBe(true)
						expect(Reflect.get(rendered, 'explorerHeight')).toBeGreaterThanOrEqual(minimumButtonHeight)
					}
					const right = Reflect.get(rendered, 'right')
					if (typeof right !== 'number') throw new Error(`Missing ${identifier.type} bounds`)
					expect(right).toBeLessThanOrEqual(viewportRight)
				}
				expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
				const screenshots = process.env['CHAOS_QA_SCREENSHOTS']
				if (screenshots !== undefined) {
					await mkdir(screenshots, { recursive: true })
					const targets = selector === '.full-identifier' ? ['[data-identifier-type="wallet address"]', '#current-workflow', '#activity-list'] : [selector]
					for (const [index, target] of targets.entries()) {
						await cdp.evaluate(`document.querySelector(${JSON.stringify(target)})?.scrollIntoView({ block: 'center' })`)
						const name = await cdp.evaluate(`location.pathname.slice(1) + '-' + innerWidth + '-' + ${JSON.stringify(selector.replace(/[^a-z0-9]/gi, '-'))}`)
						const capture = await cdp.command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
						const data = typeof capture === 'object' && capture !== null ? Reflect.get(capture, 'data') : undefined
						if (typeof data !== 'string') throw new Error('Identifier screenshot unavailable')
						await Bun.write(`${screenshots}/${String(name)}-${index.toString()}.png`, Buffer.from(data, 'base64'))
					}
				}
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
				expect(Reflect.get(health, 'lastCheck')).not.toBe('No completed check')
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
					expect(Reflect.get(bounds, 'top')).toBeGreaterThanOrEqual(0)
					expect(Reflect.get(bounds, 'bottom')).toBeLessThanOrEqual(viewport.height)
					expect(Reflect.get(bounds, 'height')).toBeGreaterThanOrEqual(44)
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
				expect(Reflect.get(topologyPresentation, 'topbarBackground')).toBe('color(srgb 0.0627451 0.0823529 0.113725 / 0.82)')
				const summaryHeights = Reflect.get(topologyPresentation, 'summaryHeights')
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
			const formLeft = Reflect.get(connectivityLayout, 'formLeft')
			const formRight = Reflect.get(connectivityLayout, 'formRight')
			const viewportWidth = Reflect.get(connectivityLayout, 'viewportWidth')
			const buttonHeight = Reflect.get(connectivityLayout, 'buttonHeight')
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
				expect(Reflect.get(navigationBeforeRefresh, 'bodyWidth')).toBe(Reflect.get(navigationBeforeRefresh, 'clientWidth'))
				const navigationScrollLeft = Reflect.get(navigationBeforeRefresh, 'scrollLeft')
				const maximumScrollLeft = Reflect.get(navigationBeforeRefresh, 'maximumScrollLeft')
				if (typeof navigationScrollLeft !== 'number' || typeof maximumScrollLeft !== 'number') throw new Error(`/${route} navigation scroll metrics are unavailable`)
				if (route === 'ecosystem') {
					expect(navigationScrollLeft).toBeGreaterThan(0)
					expect(navigationScrollLeft).toBeLessThan(maximumScrollLeft)
					expect(Reflect.get(navigationBeforeRefresh, 'centerDelta')).toBeLessThanOrEqual(1)
				} else expect(Math.abs(navigationScrollLeft - maximumScrollLeft)).toBeLessThanOrEqual(1)
				const linkHeights = Reflect.get(navigationBeforeRefresh, 'linkHeights')
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
				expect(navigationAfterRefresh).toEqual({ scrollLeft: Reflect.get(navigationBeforeRefresh, 'scrollLeft'), scrollY: Reflect.get(navigationBeforeRefresh, 'scrollY') })
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
			for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#rpc-health-retry-button')?.disabled")) !== false; attempt++) await Bun.sleep(25)
			expect(await cdp.evaluate("document.querySelector('#rpc-health-retry-button')?.disabled")).toBe(false)
			for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#retirement-start')?.disabled")) !== false; attempt++) await Bun.sleep(25)
			expect(await cdp.evaluate("document.querySelector('#retirement-start')?.disabled")).toBe(false)
			await cdp.evaluate("document.querySelector('#retirement-start')?.click()")
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
					for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#rpc-health-retry-button')?.disabled")) !== false; attempt++) await Bun.sleep(25)
					for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#retirement-start')?.disabled")) !== false; attempt++) await Bun.sleep(25)
					await cdp.evaluate("document.querySelector('#retirement-start')?.click()")
					for (let attempt = 0; attempt < 100 && (await cdp.evaluate("document.querySelector('#retirement-form')?.hidden")) !== false; attempt++) await Bun.sleep(25)
					expect(await cdp.evaluate("document.querySelector('#retirement-form')?.hidden")).toBe(false)
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
		let browserSession: Awaited<ReturnType<typeof connectToChromium>> | undefined
		try {
			const cdp = await connectToChromium()
			browserSession = cdp
			await cdp.command('Network.enable')
			const waitFor = async (expression: string, message: string) => {
				for (let attempt = 0; attempt < 200; attempt += 1) {
					if ((await cdp.evaluate(expression)) === true) return
					await Bun.sleep(25)
				}
				throw new Error(message)
			}
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#signer-summary .identifier-value') !== null && document.querySelector('#signer-fieldset')?.disabled === false", 'Signer controls did not load before the indeterminate mutation')
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
					signerDisabled: document.querySelector('#signer-fieldset')?.disabled,
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

			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor("document.querySelector('#rpc-health-retry-button')?.disabled === false", 'Refresh did not finish after the indeterminate mutation')
			expect(await cdp.evaluate("document.querySelector('#signer-fieldset')?.disabled === true && document.querySelector('#signer-status')?.textContent?.includes('permanently frozen') === true")).toBe(true)

			await cdp.command('Page.navigate', { url: 'about:blank' })
			await waitFor("document.readyState === 'complete'", 'Chromium did not reset before checking the server-process latch')
			await cdp.command('Page.navigate', { url: new URL('/settings', dashboard.url).href })
			await waitFor("document.querySelector('#configuration-status')?.textContent?.includes('permanently frozen in this server process and page') === true", 'A new page did not inherit the server-process mutation latch')
			expect(await cdp.evaluate("document.querySelector('#pause-button')?.disabled === true && document.querySelector('#settings-fields')?.disabled === true && document.querySelector('#signer-fieldset')?.disabled === true")).toBe(true)
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

browserTest(
	'schedule shortcut and catalog selection save through the dashboard',
	async () => {
		let paused = false
		let revision = 'controls-1'
		let selection: string[] = []
		const initialSchedule = new Date(Date.now() + 60_000).toISOString()
		let scheduledAt = initialSchedule
		let scheduleStatus = 'scheduled'
		let rejectSelection = false
		let selectionGate: Promise<void> | undefined
		let scans = 0
		const mutations: unknown[] = []
		const dashboard = startDashboardServer(0, {
			hostname: '127.0.0.1',
			getConfiguration: () => ({ revision, settings: { paused, runtime: { execute: false }, scheduler: { minimumDelaySeconds: 60, maximumDelaySeconds: 3600 }, strategy: { selectableOperationAllowlist: selection } } }),
			getState: () =>
				state({
					paused,
					scheduler: { status: scheduleStatus, nextRunAt: scheduledAt, lastDelaySeconds: 60 },
					evaluations: [
						{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.wrap', label: 'Wrap ETH', risk: 'low' }, eligibility: { eligible: false, blockers: ['No ETH available'] } },
						{ definition: { classification: 'selectable', ecosystem: 'open-oracle', id: 'open-oracle.weth.unwrap', label: 'Unwrap WETH', risk: 'low' }, eligibility: { eligible: false, blockers: ['No WETH available'] } },
						{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { eligible: false, blockers: [`No report due after scan ${((scans += 1)).toString()}`] } },
					],
				}),
			setSchedule: value => {
				mutations.push(value)
				scheduledAt = new Date().toISOString()
				scheduleStatus = 'due'
			},
			setSelection: async value => {
				await selectionGate
				if (rejectSelection) throw new Error('Selection save failed')
				mutations.push(value)
				selection = [...selection, String(Reflect.get(Object(value), 'operationId'))]
				revision = 'controls-2'
			},
			setCancellation: () => {},
			setCandidate: () => {},
			setObligation: () => {},
			setPaused: () => {},
			setReplacement: () => {},
			setSettings: () => {},
			setSigner: () => {},
			setWorkflow: () => {},
		})
		const port = dashboard.port
		if (port === undefined) throw new Error('Dashboard port is unavailable')
		const cdp = await connectToChromium()
		try {
			const waitFor = async (expression: string) => {
				for (let attempt = 0; attempt < 400; attempt += 1) {
					if ((await cdp.evaluate(expression)) === true) return
					await Bun.sleep(25)
				}
				throw new Error(`Timed out: ${expression}`)
			}
			const capture = async (name: string) => {
				const result = await cdp.command('Page.captureScreenshot', { format: 'png' })
				const data = typeof result === 'object' && result !== null ? Reflect.get(result, 'data') : undefined
				if (typeof data !== 'string') throw new Error('Screenshot unavailable')
				await Bun.write(`/tmp/chaos-controls-qa/${name}.png`, Buffer.from(data, 'base64'))
			}
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/overview` })
			await waitFor("document.querySelector('#run-next-now')?.disabled === false")
			await capture('overview-desktop-1440x900')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
			await cdp.evaluate("document.querySelector('#run-next-now').scrollIntoView({ block: 'center' })")
			await capture('overview-scheduled-mobile-390x844')
			await cdp.evaluate("document.querySelector('#run-next-now').click()")
			await waitFor("document.querySelector('#schedule-action-status')?.textContent.startsWith('Next choice requested.')")
			expect(mutations[0]).toEqual({ revision: 'controls-1', nextRunAt: initialSchedule })
			expect(await cdp.evaluate("document.querySelector('#run-next-now').disabled")).toBe(true)
			await waitFor("document.querySelector('#schedule-action-status')?.textContent === ''")
			await capture('overview-due-mobile-390x844')
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
			paused = true
			await waitFor("document.querySelector('#countdown')?.textContent === 'Paused'")
			expect(await cdp.evaluate("document.querySelector('#schedule-action-status').textContent")).toBe('')
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/catalog` })
			await waitFor("document.querySelector('[data-selection-toggle]')?.disabled === false")
			expect(await cdp.evaluate("document.querySelectorAll('[data-selection-toggle]').length")).toBe(2)
			await cdp.evaluate("document.querySelector('#catalog-rows summary').click()")
			await capture('catalog-desktop-1440x900')
			rejectSelection = true
			// The refresh that follows a failed save renders a snapshot that throws once. A save that
			// rejects inside its own recovery path must not strand every later save.
			await cdp.evaluate(`(() => {
				const countdown = document.querySelector('#countdown')
				const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent')
				Object.defineProperty(countdown, 'textContent', {
					configurable: true,
					get: () => descriptor.get.call(countdown),
					set: value => {
						delete countdown.textContent
						throw new Error('Injected render failure')
					},
				})
			})()`)
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').click()")
			await waitFor("document.querySelector('#catalog-selection-status')?.textContent.includes('Selection save failed')")
			await waitFor("document.querySelector('[data-selection-toggle]')?.disabled === false")
			expect(await cdp.evaluate("document.querySelector('[data-selection-toggle]').checked")).toBe(false)
			rejectSelection = false
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').click()")
			await waitFor("document.querySelector('#selectable-operation-allowlist')?.value === 'open-oracle.weth.wrap'")
			expect(mutations[1]).toEqual({ revision: 'controls-1', operationId: 'open-oracle.weth.wrap', enabled: true })
			// A save must not blink the rest of the catalog: only the saving toggle changes state.
			let releaseSelection = () => {}
			selectionGate = new Promise(resolve => {
				releaseSelection = resolve
			})
			await cdp.evaluate(`(() => {
				const rows = [...document.querySelectorAll('#catalog-rows tbody tr')]
				rows.forEach((row, index) => { row.dataset.stableRow = String(index) })
				document.querySelector('[data-selection-toggle="open-oracle.weth.unwrap"]').click()
			})()`)
			await waitFor('document.querySelector(\'[data-selection-toggle="open-oracle.weth.unwrap"]\')?.disabled === true')
			expect(
				await cdp.evaluate(`({
					otherChecked: document.querySelector('[data-selection-toggle="open-oracle.weth.wrap"]').checked,
					otherDisabled: document.querySelector('[data-selection-toggle="open-oracle.weth.wrap"]').disabled,
					savingChecked: document.querySelector('[data-selection-toggle="open-oracle.weth.unwrap"]').checked,
				})`),
			).toEqual({ otherChecked: true, otherDisabled: false, savingChecked: true })
			releaseSelection()
			await waitFor("document.querySelector('#selectable-operation-allowlist')?.value === 'open-oracle.weth.wrap\\nopen-oracle.weth.unwrap'")
			selectionGate = undefined
			// Only the row whose data changed is rebuilt; the rest keep their DOM nodes so the catalog never reflows.
			const scansBeforeRefresh = scans
			await cdp.evaluate("window.dispatchEvent(new Event('focus'))")
			await waitFor(`document.querySelector('#catalog-rows')?.textContent?.includes('No report due after scan ${(scansBeforeRefresh + 1).toString()}') === true`)
			expect(await cdp.evaluate("[...document.querySelectorAll('#catalog-rows tbody tr')].map(row => row.dataset.stableRow ?? 'rebuilt')")).toEqual(['0', '1', 'rebuilt'])
			await cdp.command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
			await cdp.evaluate("document.querySelector('[data-selection-toggle]').scrollIntoView({ block: 'center' })")
			await capture('catalog-mobile-390x844')
			expect(await cdp.evaluate('document.body.scrollWidth === document.documentElement.clientWidth')).toBe(true)
			await cdp.command('Page.navigate', { url: `http://127.0.0.1:${port.toString()}/overview` })
			await waitFor("document.querySelector('#countdown')?.textContent === 'Paused'")
			await cdp.evaluate("document.querySelector('#run-next-now').scrollIntoView({ block: 'center' })")
			await capture('overview-paused-mobile-390x844')
			expect(cdp.issues.filter(issue => issue.kind === 'pageerror')).toEqual([])
		} finally {
			await cdp.close()
			await dashboard.stop(true)
		}
	},
	CHROMIUM_STARTUP_BUDGET_MILLISECONDS + 60_000,
)

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
				for (const mode of ['keyless', 'read-only', 'signer'] as const) {
					current = state({
						inventory: { eth: '1000000000000000000', rep: [], weth: '2000000000000000000' },
						inventoryAvailable: mode !== 'keyless',
						signerReady: mode === 'signer',
						...(mode === 'keyless' ? {} : { wallet: walletAddress }),
					})
					await cdp.command('Page.navigate', { url: `http://127.0.0.1:${dashboard.port}/overview` })
					const expectedEthText = mode === 'keyless' ? '—' : '1 ETH'
					const expectedBadge = { keyless: 'Signer missing', 'read-only': 'Read-only — signer not loaded', signer: 'Signer ready' }[mode]
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
			const waitFor = async (expression: string) => {
				for (let attempt = 0; attempt < 400; attempt += 1) {
					if ((await cdp.evaluate(expression)) === true) return
					await Bun.sleep(25)
				}
				throw new Error(`Timed out: ${expression}`)
			}
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
