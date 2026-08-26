import { startDashboardServer } from '../src/dashboard/dashboard-server.ts'

const now = Date.now()
const dashboardPassword = 'dashboard visual fixture password'
let paused = false
let revisionNumber = 7
let hasSigner = true

const definitions = [
	['zoltar-create-binary-question', 'Create binary question', 'zoltar', 'medium', true, 3, 'Create a binary market question with bounded randomized timing.'],
	['zoltar-fork-universe', 'Fork universe', 'zoltar', 'irreversible', false, 0, 'Begin a universe fork only when the irreversible gate is enabled.'],
	['statoblast-deposit-vault-rep', 'Deposit vault REP', 'statoblast', 'low', true, 2, 'Top up a security-pool vault while preserving the wallet reserve.'],
	['statoblast-truth-auction-bid', 'Bid in truth auction', 'statoblast', 'high', false, 0, 'Place a bounded truth-auction bid before the canonical deadline.'],
	['open-oracle-report', 'Submit oracle report', 'open-oracle', 'medium', true, 1, 'Start an Open Oracle report with a tracked settlement obligation.'],
	['open-oracle-settle', 'Settle oracle report', 'open-oracle', 'low', false, 0, 'Settle a mature report and verify its semantic outcome.'],
	['trading-enter-yes', 'Enter YES position', 'trading', 'medium', true, 4, 'Buy complete sets and sell the NO side through a discovered pair.'],
	['trading-remove-liquidity', 'Remove liquidity', 'trading', 'medium', false, 0, 'Remove wallet-owned liquidity within bounded price limits.'],
] as const

function evaluations() {
	return definitions.map(([id, label, ecosystem, risk, eligible, candidates, description]) => {
		let blockers: string[] = []
		if (!eligible) {
			if (id.includes('fork')) blockers = ['Irreversible operations are disabled']
			else if (id.includes('settle')) blockers = ['Settlement timestamp has not arrived']
			else blockers = ['No wallet-owned candidate satisfies the reserve policy']
		}
		return {
			definition: { classification: 'selectable', contract: `${ecosystem} contract`, description, discoveryInputs: [], ecosystem, id, label, method: id, risk },
			eligibility: { blockers, eligible },
			plan: eligible ? { id: `plan-${id}`, steps: Array.from({ length: candidates }, (_, index) => ({ id: `step-${index.toString()}` })) } : undefined,
		}
	})
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
	}
}

function state() {
	return {
		activities: [
			{ at: new Date(now - 45_000).toISOString(), ecosystem: 'trading', hash: `0x${'12'.repeat(32)}`, message: 'Entered YES position', operationId: 'trading-enter-yes', status: 'confirmed', summary: 'Receipt and share-balance postcondition confirmed.', type: 'operation' },
			{ at: new Date(now - 380_000).toISOString(), ecosystem: 'open-oracle', message: 'Report workflow planned', operationId: 'open-oracle-report', status: 'dry-run', summary: 'Anchored plan generated; no transaction was signed.', type: 'operation' },
			{ at: new Date(now - 740_000).toISOString(), message: 'Random delay scheduled', status: 'info', summary: 'Next delay differs from the previous delay.', type: 'scheduler' },
		],
		chainId: 11_155_111,
		error: undefined,
		evaluations: evaluations(),
		inventory: {
			eth: '1.8421',
			rep: [
				{ balance: '128.40', symbol: 'REP', token: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', universeId: '0' },
				{ balance: '24.00', symbol: 'REP-child', token: '0xcccccccccccccccccccccccccccccccccccccccc', universeId: '101' },
			],
			weth: '0.375',
		},
		lastScanAt: new Date(now - 8_000).toISOString(),
		lastScannedBlock: 8_842_011n,
		obligations: [{ blockers: [], dueAt: new Date(now + 42_000).toISOString(), ecosystem: 'open-oracle', id: 'obligation-1', label: 'Settle report 8124', operationId: 'open-oracle-settle', status: 'pending', updatedAt: new Date(now - 8_000).toISOString() }],
		paused,
		pendingTransactions: [
			{
				data: `0x${'ab'.repeat(256)}`,
				hash: `0x${'34'.repeat(32)}`,
				label: 'Enter YES position',
				nonce: 19n,
				operationId: 'trading-enter-yes',
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
			{ lastSuccessAt: new Date(now - 6_000).toISOString(), status: 'healthy', target: 'https://rpc.invalid' },
			{ lastSuccessAt: new Date(now - 6_100).toISOString(), status: 'healthy', target: 'https://quorum-one.invalid' },
			{ error: 'api_key=dashboard-secret', lastFailureAt: new Date(now - 5_900).toISOString(), status: 'degraded', target: 'https://quorum-two.invalid' },
		],
		scheduler: {
			lastDelaySeconds: 2_113,
			lastRunAt: new Date(now - 575_000).toISOString(),
			nextRunAt: new Date(now + 1_538_000).toISOString(),
			selectedOperationId: undefined,
			status: paused ? 'paused' : 'scheduled',
		},
		status: paused ? 'paused' : 'dry-run',
		wallet: hasSigner ? '0x9999999999999999999999999999999999999999' : undefined,
		workflows: [
			{
				createdAt: new Date(now - 20_000).toISOString(),
				ecosystem: 'trading',
				id: 'workflow-92',
				label: 'Enter YES position',
				operationId: 'trading-enter-yes',
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

console.log(`Chaos dashboard fixture listening at ${server.url.href}`)
