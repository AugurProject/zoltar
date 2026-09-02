import { startDashboardServer } from '../src/dashboard/dashboard-server.ts'
import { unavailableOperationCatalog } from '../src/runtime/canonical-scan.ts'

const now = Date.now()
const dashboardPassword = 'dashboard visual fixture password'
const scenario = process.argv[2] ?? 'baseline'
if (scenario !== 'baseline' && scenario !== 'safety-recovery' && scenario !== 'private-relay-ready' && scenario !== 'private-relay-blocked') {
	throw new Error('Dashboard fixture scenario must be baseline, safety-recovery, private-relay-ready, or private-relay-blocked')
}
const safetyRecovery = scenario === 'safety-recovery'
const privateRelayScenario = scenario === 'private-relay-ready' || scenario === 'private-relay-blocked'
const privateRelayReady = scenario === 'private-relay-ready'
let paused = safetyRecovery
let revisionNumber = 7
let hasSigner = true

function executionStatus() {
	if (paused) return 'paused'
	if (privateRelayScenario) return 'running'
	return 'dry-run'
}

function evaluations() {
	const eligibleIds = new Set(['open-oracle.report', 'statoblast.vault.deposit-rep', 'trading.position.enter', 'zoltar.question.create-binary'])
	const productionCatalog = unavailableOperationCatalog('No safe fixture candidate exists at the anchored snapshot')
	const projected = productionCatalog.map(evaluation => (eligibleIds.has(evaluation.definition.id) ? { ...evaluation, eligibility: { blockers: [], eligible: true }, plan: { id: `fixture:${evaluation.definition.id}`, steps: [] } } : evaluation))
	const lifecycle = productionCatalog.find(evaluation => evaluation.definition.id === 'open-oracle.settle')
	if (lifecycle === undefined) throw new Error('Production chaos catalog is missing open-oracle.settle')
	return [...projected.filter(evaluation => evaluation.definition.id !== lifecycle.definition.id), ...Array.from({ length: 3 }, (_, index) => ({ ...lifecycle, eligibility: { blockers: [], eligible: true }, plan: { id: `fixture:${lifecycle.definition.id}:${index.toString()}`, steps: [] } }))]
}

function settings() {
	return {
		connectivity: {
			publicRpcUrls: ['https://fixture-user:fixture-password@rpc.invalid/private'],
			quorumRpcUrls: ['https://quorum-one.invalid/?api_key=dashboard-secret', 'https://quorum-two.invalid/private-token'],
			readRpcUrl: 'https://rpc.invalid/private',
			rpcQuorum: 2,
		},
		deployment: {},
		network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
		networkConfigured: true,
		paused,
		privateKey: hasSigner ? '__PRESERVE_SAVED_PRIVATE_KEY__' : null,
		runtime: { execute: privateRelayScenario, lifecyclePollMilliseconds: 12_000 },
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
			selectableOperationAllowlist: ['open-oracle.report', 'statoblast.vault.deposit-rep', 'trading.position.enter', 'zoltar.question.create-binary'],
			workflowValidForBlocks: 288,
		},
		submission: privateRelayScenario
			? {
					minimumBundleRelaySuccesses: 2,
					mode: 'private',
					relayUrls: ['https://relay-one.invalid', 'https://relay-two.invalid', 'https://relay-three.invalid'],
				}
			: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
	}
}

function state() {
	return {
		activities: safetyRecovery
			? [{ at: new Date(now - 12_000).toISOString(), ecosystem: 'statoblast', message: 'Safety pause latched after a semantic evidence mismatch', operationId: 'statoblast.oracle.request-price', status: 'failed', summary: 'Review the partial workflow before explicitly resuming.', type: 'recovery' }]
			: [
					{ at: new Date(now - 45_000).toISOString(), ecosystem: 'trading', hash: `0x${'12'.repeat(32)}`, message: 'Entered YES position', operationId: 'trading.position.enter', status: 'confirmed', summary: 'Receipt and share-balance postcondition confirmed.', type: 'operation' },
					{ at: new Date(now - 380_000).toISOString(), ecosystem: 'open-oracle', message: 'Report workflow planned', operationId: 'open-oracle.report', status: 'dry-run', summary: 'Anchored plan generated; no transaction was signed.', type: 'operation' },
					{ at: new Date(now - 740_000).toISOString(), message: 'Random delay scheduled', status: 'info', summary: 'Next delay differs from the previous delay.', type: 'scheduler' },
				],
		alerts: safetyRecovery ? [{ message: 'Safety pause is latched; review the failure activity and current recovery state before explicitly resuming execution', severity: 'error' }] : [],
		chainId: 11_155_111,
		error: undefined,
		evaluations: evaluations(),
		execute: privateRelayScenario,
		inventory: {
			eth: '1842100000000000000',
			rep: [
				{ balance: '128400000000000000000', symbol: 'REP', token: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', universeId: '0' },
				{ balance: '24000000000000000000', symbol: 'REP-child', token: '0xcccccccccccccccccccccccccccccccccccccccc', universeId: '101' },
			],
			weth: '375000000000000000',
		},
		inventoryAvailable: !safetyRecovery,
		lastScanAt: safetyRecovery ? undefined : new Date(now - 8_000).toISOString(),
		lastScannedBlock: 8_842_011n,
		obligations: safetyRecovery ? [] : [{ blockers: [], dueAt: new Date(now + 42_000).toISOString(), ecosystem: 'open-oracle', id: 'obligation-1', label: 'Settle report 8124', operationId: 'open-oracle.settle', status: 'pending', updatedAt: new Date(now - 8_000).toISOString() }],
		paused,
		pendingTransactions: safetyRecovery
			? []
			: [
					{
						data: `0x${'ab'.repeat(256)}`,
						hash: `0x${'34'.repeat(32)}`,
						label: 'Enter YES position',
						nonce: 19n,
						operationId: 'trading.position.enter',
						recoveryBlocker: 'Automatic resubmission window closed; verify a receipt, exact replacement, or nonce cancellation',
						serializedTransaction: `0x${'cd'.repeat(512)}`,
						status: 'submitted',
						submissionBlock: 8_842_010n,
						submittedAt: new Date(now - 12_000).toISOString(),
					},
				],
		rpcEndpointHealth: [
			{ chainId: 11_155_111, checkedAt: new Date(now - 7_000).toISOString(), error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://rpc.invalid' },
			{ chainId: 11_155_111, checkedAt: new Date(now - 7_100).toISOString(), error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://quorum-one.invalid' },
			{ chainId: undefined, checkedAt: new Date(now - 7_200).toISOString(), error: 'RPC https://quorum-two.invalid failed with dashboard-secret', kind: 'read-rpc', status: 'failed', target: 'https://quorum-two.invalid' },
			{ chainId: 11_155_111, checkedAt: new Date(now - 6_900).toISOString(), error: undefined, kind: 'public-rpc', status: 'healthy', target: 'https://fixture-user:fixture-password@rpc.invalid' },
			...(privateRelayScenario
				? [
						{ authenticatedAddress: '0x9999999999999999999999999999999999999999', chainId: 11_155_111, checkedAt: new Date(now - 6_800).toISOString(), error: undefined, kind: 'private-relay', status: 'healthy', target: 'https://relay-one.invalid' },
						{
							authenticatedAddress: '0x9999999999999999999999999999999999999999',
							chainId: privateRelayReady ? 11_155_111 : undefined,
							checkedAt: new Date(now - 6_700).toISOString(),
							error: privateRelayReady ? undefined : 'Relay rejected fixture request',
							failureDisposition: privateRelayReady ? undefined : 'connectivity-degraded',
							kind: 'private-relay',
							status: privateRelayReady ? 'healthy' : 'failed',
							target: 'https://relay-two.invalid',
						},
						{
							authenticatedAddress: '0x9999999999999999999999999999999999999999',
							chainId: undefined,
							checkedAt: new Date(now - 6_600).toISOString(),
							error: 'Relay temporarily unavailable',
							failureDisposition: 'connectivity-degraded',
							kind: 'private-relay',
							status: 'failed',
							target: 'https://relay-three.invalid',
						},
					]
				: []),
			{ lastSuccessAt: new Date(now - 6_000).toISOString(), status: 'healthy', target: 'https://rpc.invalid' },
			{ lastSuccessAt: new Date(now - 6_100).toISOString(), status: 'healthy', target: 'https://quorum-one.invalid' },
			{ error: 'api_key=dashboard-secret', lastFailureAt: new Date(now - 5_900).toISOString(), status: 'degraded', target: 'https://quorum-two.invalid' },
		],
		safetyPaused: safetyRecovery,
		scheduler: {
			lastDelaySeconds: 2_113,
			lastRunAt: new Date(now - 575_000).toISOString(),
			nextRunAt: new Date(now + 1_538_000).toISOString(),
			selectedOperationId: undefined,
			status: paused ? 'paused' : 'scheduled',
		},
		status: executionStatus(),
		topology: {
			anchor: { blockNumber: '8842011', timestamp: Math.floor(now / 1_000).toString() },
			auctions: [{ address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', bids: [{}, {}], endTime: Math.floor((now + 3_600_000) / 1_000).toString(), finalized: false, pool: '0xdddddddddddddddddddddddddddddddddddddddd', startTime: Math.floor((now - 3_600_000) / 1_000).toString() }],
			complete: true,
			pairs: [{ address: '0x1212121212121212121212121212121212121212', feeBps: 30, pool: '0xdddddddddddddddddddddddddddddddddddddddd', status: 1, universeId: '0' }],
			pools: [{ address: '0xdddddddddddddddddddddddddddddddddddddddd', awaitingForkContinuation: false, coordinator: '0xabababababababababababababababababababab', questionId: '8124', systemState: 0, universeId: '0', vaults: [{}, {}] }],
			reports: [{ currentReporter: '0x9999999999999999999999999999999999999999', flags: 1, reportId: '8124', settlementTime: Math.floor((now + 42_000) / 1_000).toString(), token1: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', token2: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
			universes: [
				{ forkQuestionId: '0', forkTime: '0', id: '0', knownChildOutcomes: ['101'], repToken: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
				{ forkQuestionId: '8124', forkTime: Math.floor((now - 86_400_000) / 1_000).toString(), id: '101', knownChildOutcomes: [], parentUniverseId: '0', repToken: '0xcccccccccccccccccccccccccccccccccccccccc' },
			],
		},
		wallet: hasSigner ? '0x9999999999999999999999999999999999999999' : undefined,
		workflows: safetyRecovery
			? [
					{
						classification: 'selectable',
						createdAt: new Date(now - 60_000).toISOString(),
						ecosystem: 'statoblast',
						id: 'workflow-safety-recovery',
						label: 'Request oracle price',
						operationId: 'statoblast.oracle.request-price',
						status: 'waiting-continuation',
						steps: [
							{ label: 'Approve WETH', status: 'confirmed', transactionHash: `0x${'56'.repeat(32)}` },
							{ label: 'Revoke WETH approval', status: 'blocked' },
						],
						updatedAt: new Date(now - 12_000).toISOString(),
					},
				]
			: [
					{
						classification: 'selectable',
						createdAt: new Date(now - 20_000).toISOString(),
						ecosystem: 'trading',
						id: 'workflow-92',
						label: 'Enter YES position',
						operationId: 'trading.position.enter',
						status: 'waiting-transaction',
						steps: [
							{ data: `0x${'ab'.repeat(256)}`, label: 'Approve router', status: 'confirmed', transactionHash: `0x${'56'.repeat(32)}` },
							{ data: `0x${'ef'.repeat(256)}`, label: 'Enter YES', status: 'submitted', transactionHash: `0x${'34'.repeat(32)}` },
						],
						updatedAt: new Date(now - 12_000).toISOString(),
					},
				],
	}
}

const server = startDashboardServer(4193, {
	getConfiguration: () => ({
		revision: `fixture-${revisionNumber.toString()}`,
		settings: settings(),
		signerAddress: hasSigner ? '0x9999999999999999999999999999999999999999' : undefined,
	}),
	getState: state,
	hostname: '127.0.0.1',
	password: dashboardPassword,
	setCancellation: () => {},
	setCandidate: () => {},
	setObligation: () => {},
	setReplacement: () => {},
	setPaused: value => {
		paused = typeof value === 'object' && value !== null && Reflect.get(value, 'paused') === true
		revisionNumber += 1
	},
	setSettings: () => {
		revisionNumber += 1
	},
	setSigner: value => {
		hasSigner = typeof value === 'object' && value !== null && Reflect.get(value, 'privateKey') !== null
		revisionNumber += 1
	},
	setWorkflow: () => {},
})

console.log(`Chaos dashboard ${scenario} fixture listening at ${server.url.href}`)
