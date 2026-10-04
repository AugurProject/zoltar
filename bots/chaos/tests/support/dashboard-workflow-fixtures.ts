import { activityHash, state, walletAddress } from './dashboard-harness.ts'

type RecoveryScenario = {
	fieldsId: string
	formId: string
	label: string
	recoveredState: Record<string, unknown>
	retryId: string
	staleState: Record<string, unknown>
	statusId: string
}

export const transactionHash = `0x${'12'.repeat(32)}`
export const candidateHash = `0x${'34'.repeat(32)}`
export const cancellationHash = `0x${'56'.repeat(32)}`
export const longCatalogLabel = 'Blocked report sibling with an intentionally extended operation label that must remain associated with every mobile status field'
export const longCatalogBlocker = `Canonical blocker ${'without-a-natural-break-'.repeat(12)}must-stay-inside-the-operation-card`
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
export const topologyIdentifiers = [
	{ type: 'universe REP token', value: topologyValues.repToken },
	{ type: 'security pool address', value: topologyValues.poolAddress },
	{ type: 'report token 1', value: topologyValues.reportToken1 },
	{ type: 'report token 2', value: topologyValues.reportToken2 },
	{ type: 'truth auction address', value: topologyValues.auctionAddress },
	{ type: 'truth auction pool address', value: topologyValues.auctionPoolAddress },
	{ type: 'trading pair address', value: topologyValues.pairAddress },
	{ type: 'trading pair pool address', value: topologyValues.pairPoolAddress },
]
export const rpcSecret = 'dashboard-rpc-secret'
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
export const workflowSteps = [
	{ label: 'Confirmed step', status: 'confirmed', transactionHash: `0x${'11'.repeat(32)}` },
	{ label: 'Complete step', status: 'complete', transactionHash: `0x${'22'.repeat(32)}` },
	{ label: 'Submitted step', status: 'submitted', transactionHash },
	{ label: 'Pending step', status: 'pending', transactionHash: `0x${'44'.repeat(32)}` },
	{ label: 'Failed step', status: 'failed', transactionHash: `0x${'55'.repeat(32)}` },
	{ label: 'Waiting step' },
]

export const scenarios: RecoveryScenario[] = [
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

export const workflowRenderingState = state({
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
		{
			definition: { classification: 'lifecycle-obligation', description: 'Settle the anchored report.', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' },
			eligibility: { blockers: [], eligible: true },
			lifecycleEligible: true,
			randomAllowed: false,
			randomEligible: false,
			plan: { id: 'settle-1' },
		},
		{ definition: { classification: 'lifecycle-obligation', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }, eligibility: { blockers: [], eligible: true }, lifecycleEligible: true, randomAllowed: false, randomEligible: false, plan: { id: 'settle-2' } },
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

export const partialRecoveryDashboardState = state({
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

export const pausedWorkflowRenderingState = { ...workflowRenderingState, paused: true }
export const degradedWorkflowRenderingState = { ...workflowRenderingState, rpcEndpointHealth: [...degradedReadRpcHealth, ...degradedPrivateSubmissionHealth] }
export const staleSubmissionWorkflowRenderingState = { ...workflowRenderingState, rpcEndpointHealth: [...readRpcHealth, ...stalePrivateSubmissionHealth] }
