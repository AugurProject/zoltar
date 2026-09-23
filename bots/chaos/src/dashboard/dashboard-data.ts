import { type Workflow, type WorkflowStep } from './workflow-history.js'
import { optionalRecord as record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { parsePublicRetirement } from './retirement-dashboard.js'
import { type PendingTransactionObservationView } from './pending-transaction-summary.js'

export type RepBalance = {
	balance?: string | number | undefined
	symbol?: string | undefined
	token?: string | undefined
	universeId?: string | undefined
}

export type OperationEvaluation = {
	blockers: string[]
	candidateCount?: string | number | undefined
	classification?: string | undefined
	description?: string | undefined
	ecosystem?: string | undefined
	eligible?: boolean | undefined
	enabled?: boolean | undefined
	id?: string | undefined
	independentlyExecutable?: boolean | undefined
	label?: string | undefined
	prerequisites: string[]
	risk?: string | undefined
}

export type Topology = {
	anchorBlock?: string | number | undefined
	anchorTimestamp?: string | number | undefined
	auctions: Array<{ address?: string | undefined; bidCount?: number | undefined; endTime?: string | number | undefined; finalized?: boolean | undefined; pool?: string | undefined; startTime?: string | number | undefined }>
	complete?: boolean | undefined
	pairs: Array<{ address?: string | undefined; feeBps?: string | number | undefined; pool?: string | undefined; status?: string | number | undefined; universeId?: string | undefined }>
	pools: Array<{ address?: string | undefined; awaitingForkContinuation?: boolean | undefined; coordinator?: string | undefined; questionId?: string | undefined; systemState?: string | number | undefined; universeId?: string | undefined; vaultCount?: number | undefined }>
	reports: Array<{ currentReporter?: string | undefined; flags?: string | number | undefined; reportId?: string | undefined; settlementTime?: string | number | undefined; token1?: string | undefined; token2?: string | undefined }>
	totalCounts: { auctions: number; pairs: number; pools: number; reports: number; universes: number }
	truncated?: boolean | undefined
	universes: Array<{ forkQuestionId?: string | undefined; forkTime?: string | number | undefined; id?: string | undefined; knownChildOutcomeCount?: number | undefined; parentUniverseId?: string | undefined; repToken?: string | undefined }>
}

export type PendingTransaction = {
	cancellationHash?: string | undefined
	hash?: string | undefined
	label?: string | undefined
	maxBlockNumber?: string | number | undefined
	nonce?: string | number | undefined
	observation?: PendingTransactionObservationView | undefined
	operationId?: string | undefined
	recoveryBlocker?: string | undefined
	replacementHash?: string | undefined
	status?: string | undefined
	submittedAt?: string | undefined
	submissionBlock?: string | number | undefined
}

export type Obligation = {
	attemptCount?: number | undefined
	automaticRetryCount?: number | undefined
	automaticRetryLimit?: number | undefined
	blockers: string[]
	dueAt?: string | undefined
	ecosystem?: string | undefined
	id?: string | undefined
	label?: string | undefined
	notBefore?: string | undefined
	operationId?: string | undefined
	status?: string | undefined
	updatedAt?: string | undefined
}

type Activity = {
	at?: string | undefined
	details?: string | undefined
	ecosystem?: string | undefined
	label?: string | undefined
	operationId?: string | undefined
	status?: string | undefined
	summary?: string | undefined
	txHash?: string | undefined
}

type RpcHealth = {
	chainReady?: boolean | undefined
	configuredReadEndpointCount?: number | undefined
	healthyReadEndpointCount?: number | undefined
	lastCheckedAt?: string | undefined
	requiredReadQuorum?: number | undefined
	status?: 'degraded' | 'not-checked' | 'not-configured' | 'ready' | undefined
}

export type SubmissionHealth = {
	checkedOriginCount?: number | undefined
	configuredOriginCount?: number | undefined
	freshOriginCount?: number | undefined
	healthyOriginCount?: number | undefined
	lastCheckedAt?: string | undefined
	mode?: 'private' | 'public' | undefined
	proofMatchesSigner?: boolean | undefined
	ready?: boolean | undefined
	requiredHealthyOriginCount?: number | undefined
	status?: 'degraded' | 'not-checked' | 'not-configured' | 'ready' | 'stale' | undefined
}

export type Snapshot = {
	activities: Activity[]
	alerts: { message?: string | undefined; severity?: string | undefined }[]
	chainId?: string | number | undefined
	currentWorkflow?: Workflow | undefined
	workflows: Workflow[]
	execute?: boolean | undefined
	inventory: { eth?: string | number | undefined; rep: RepBalance[]; weth?: string | number | undefined }
	inventoryAvailable?: boolean | undefined
	lastScanAt?: string | undefined
	lastDeploymentCheckedBlock?: string | number | undefined
	lastDeploymentCheckAt?: string | undefined
	lastScannedBlock?: string | number | undefined
	network?: string | undefined
	obligations: Obligation[]
	operationEvaluations: OperationEvaluation[]
	paused?: boolean | undefined
	pendingTransactions: PendingTransaction[]
	profileId?: string | undefined
	retirement?: { blockers: unknown[]; finalSweepStartedAt?: string | undefined; positions: unknown[]; recipient?: string | undefined; requestedAt?: string | undefined; status?: string | undefined; updatedAt?: string | undefined } | undefined
	rpcHealth: RpcHealth
	submissionHealth: SubmissionHealth
	safetyPaused?: boolean | undefined
	scheduler: {
		due?: boolean | undefined
		lastDelaySeconds?: string | number | undefined
		lastRunAt?: string | undefined
		nextRunAt?: string | undefined
		selectedOperationId?: string | undefined
		status?: string | undefined
	}
	signerReady?: boolean | undefined
	status?: string | undefined
	topology: Topology
	wallet?: string | undefined
}

export type Configuration = {
	allowHighRiskOperations?: boolean | undefined
	allowIrreversibleOperations?: boolean | undefined
	initializeGenesisUniverse?: boolean | undefined
	chainId?: string | number | undefined
	configurationCommitIndeterminate?: boolean | undefined
	connectivity?: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl?: string | undefined; rpcQuorum?: string | number | undefined } | undefined
	enabledEcosystems: string[]
	execute?: boolean | undefined
	explorerUrl?: string | undefined
	hasSigner?: boolean | undefined
	maximumDelaySeconds?: string | number | undefined
	maximumEthPerOperation?: string | number | undefined
	maximumGasCostEth?: string | number | undefined
	maximumRepPerOperation?: string | number | undefined
	minimumDelaySeconds?: string | number | undefined
	minimumEthReserve?: string | number | undefined
	minimumRepReserve?: string | number | undefined
	network?: string | undefined
	networkConfigured?: boolean | undefined
	paused?: boolean | undefined
	rememberSigner?: boolean | undefined
	revision?: string | number | undefined
	rpcQuorum?: string | number | undefined
	selectableOperationAllowlist?: string[] | null | undefined
	wallet?: string | undefined
	workflowValidForBlocks?: string | number | undefined
}

export function stringValue(value: unknown) {
	return typeof value === 'string' ? value : undefined
}

function booleanValue(value: unknown) {
	return typeof value === 'boolean' ? value : undefined
}

function scalarValue(value: unknown) {
	return typeof value === 'string' || typeof value === 'number' ? value : undefined
}

function nonnegativeIntegerValue(value: unknown) {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function parsePendingTransactionObservation(value: unknown): PendingTransactionObservationView | undefined {
	const source = record(value)
	if (source === undefined) return undefined
	return { checkedAt: stringValue(source['checkedAt']), head: scalarValue(source['head']), includedBlock: scalarValue(source['includedBlock']), kind: stringValue(source['kind']) }
}

function rpcHealthStatusValue(value: unknown): RpcHealth['status'] {
	return value === 'degraded' || value === 'not-checked' || value === 'not-configured' || value === 'ready' ? value : undefined
}

function submissionHealthStatusValue(value: unknown): SubmissionHealth['status'] {
	return value === 'degraded' || value === 'not-checked' || value === 'not-configured' || value === 'ready' || value === 'stale' ? value : undefined
}

function strings(value: unknown) {
	return Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' ? [entry] : [])) : []
}

function nullableStrings(value: unknown) {
	if (value === null) return null
	return Array.isArray(value) ? strings(value) : undefined
}

function list<T>(value: unknown, transform: (entry: Record<string, unknown>) => T) {
	return Array.isArray(value)
		? value.flatMap(entry => {
				const source = record(entry)
				return source === undefined ? [] : [transform(source)]
			})
		: []
}

function parseWorkflowStep(source: Record<string, unknown>): WorkflowStep {
	return {
		confirmedAt: stringValue(source['confirmedAt']),
		label: stringValue(source['label']),
		status: stringValue(source['status']),
		txHash: stringValue(source['txHash']),
	}
}

function parseWorkflow(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return {
		classification: stringValue(source['classification']),
		completedAt: stringValue(source['completedAt']),
		ecosystem: stringValue(source['ecosystem']),
		id: stringValue(source['id']),
		label: stringValue(source['label']),
		operationId: stringValue(source['operationId']),
		startedAt: stringValue(source['startedAt']),
		status: stringValue(source['status']),
		updatedAt: stringValue(source['updatedAt']),
		steps: list(source['steps'], parseWorkflowStep),
	}
}

function parseTopology(value: unknown): Topology {
	const source = record(value) ?? {}
	const counts = record(source['totalCounts']) ?? {}
	return {
		anchorBlock: scalarValue(source['anchorBlock']),
		anchorTimestamp: scalarValue(source['anchorTimestamp']),
		auctions: list(source['auctions'], entry => ({
			address: stringValue(entry['address']),
			bidCount: nonnegativeIntegerValue(entry['bidCount']),
			endTime: scalarValue(entry['endTime']),
			finalized: booleanValue(entry['finalized']),
			pool: stringValue(entry['pool']),
			startTime: scalarValue(entry['startTime']),
		})),
		complete: booleanValue(source['complete']),
		pairs: list(source['pairs'], entry => ({
			address: stringValue(entry['address']),
			feeBps: scalarValue(entry['feeBps']),
			pool: stringValue(entry['pool']),
			status: scalarValue(entry['status']),
			universeId: stringValue(entry['universeId']),
		})),
		pools: list(source['pools'], entry => ({
			address: stringValue(entry['address']),
			awaitingForkContinuation: booleanValue(entry['awaitingForkContinuation']),
			coordinator: stringValue(entry['coordinator']),
			questionId: stringValue(entry['questionId']),
			systemState: scalarValue(entry['systemState']),
			universeId: stringValue(entry['universeId']),
			vaultCount: nonnegativeIntegerValue(entry['vaultCount']),
		})),
		reports: list(source['reports'], entry => ({
			currentReporter: stringValue(entry['currentReporter']),
			flags: scalarValue(entry['flags']),
			reportId: stringValue(entry['reportId']),
			settlementTime: scalarValue(entry['settlementTime']),
			token1: stringValue(entry['token1']),
			token2: stringValue(entry['token2']),
		})),
		totalCounts: {
			auctions: nonnegativeIntegerValue(counts['auctions']) ?? 0,
			pairs: nonnegativeIntegerValue(counts['pairs']) ?? 0,
			pools: nonnegativeIntegerValue(counts['pools']) ?? 0,
			reports: nonnegativeIntegerValue(counts['reports']) ?? 0,
			universes: nonnegativeIntegerValue(counts['universes']) ?? 0,
		},
		truncated: booleanValue(source['truncated']),
		universes: list(source['universes'], entry => ({
			forkQuestionId: stringValue(entry['forkQuestionId']),
			forkTime: scalarValue(entry['forkTime']),
			id: stringValue(entry['id']),
			knownChildOutcomeCount: nonnegativeIntegerValue(entry['knownChildOutcomeCount']),
			parentUniverseId: stringValue(entry['parentUniverseId']),
			repToken: stringValue(entry['repToken']),
		})),
	}
}

export function parseSnapshot(value: unknown): Snapshot {
	const source = record(value) ?? {}
	const inventory = record(source['inventory']) ?? {}
	const rpcHealth = record(source['rpcHealth']) ?? {}
	const submissionHealth = record(source['submissionHealth']) ?? {}
	const scheduler = record(source['scheduler']) ?? {}
	return {
		activities: list(source['activities'], entry => ({
			at: stringValue(entry['at']),
			details: stringValue(entry['details']),
			ecosystem: stringValue(entry['ecosystem']),
			label: stringValue(entry['label']),
			operationId: stringValue(entry['operationId']),
			status: stringValue(entry['status']),
			summary: stringValue(entry['summary']),
			txHash: stringValue(entry['txHash']),
		})),
		alerts: list(source['alerts'], entry => ({ message: stringValue(entry['message']), severity: stringValue(entry['severity']) })),
		chainId: scalarValue(source['chainId']),
		currentWorkflow: parseWorkflow(source['currentWorkflow']),
		workflows: list(source['workflows'], parseWorkflow).filter(value => value !== undefined),
		execute: booleanValue(source['execute']),
		inventory: {
			eth: scalarValue(inventory['eth']),
			rep: list(inventory['rep'], entry => ({
				balance: scalarValue(entry['balance']),
				symbol: stringValue(entry['symbol']),
				token: stringValue(entry['token']),
				universeId: stringValue(entry['universeId']),
			})),
			weth: scalarValue(inventory['weth']),
		},
		inventoryAvailable: booleanValue(source['inventoryAvailable']),
		lastScanAt: stringValue(source['lastScanAt']),
		lastDeploymentCheckedBlock: scalarValue(source['lastDeploymentCheckedBlock']),
		lastDeploymentCheckAt: stringValue(source['lastDeploymentCheckAt']),
		lastScannedBlock: scalarValue(source['lastScannedBlock']),
		network: stringValue(source['network']),
		obligations: list(source['obligations'], entry => ({
			attemptCount: nonnegativeIntegerValue(entry['attemptCount']),
			automaticRetryCount: nonnegativeIntegerValue(entry['automaticRetryCount']),
			automaticRetryLimit: nonnegativeIntegerValue(entry['automaticRetryLimit']),
			blockers: strings(entry['blockers']),
			dueAt: stringValue(entry['dueAt']),
			ecosystem: stringValue(entry['ecosystem']),
			id: stringValue(entry['id']),
			label: stringValue(entry['label']),
			notBefore: stringValue(entry['notBefore']),
			operationId: stringValue(entry['operationId']),
			status: stringValue(entry['status']),
			updatedAt: stringValue(entry['updatedAt']),
		})),
		operationEvaluations: list(source['operationEvaluations'], entry => ({
			blockers: strings(entry['blockers']),
			candidateCount: scalarValue(entry['candidateCount']),
			classification: stringValue(entry['classification']),
			description: stringValue(entry['description']),
			ecosystem: stringValue(entry['ecosystem']),
			eligible: booleanValue(entry['eligible']),
			enabled: booleanValue(entry['enabled']),
			id: stringValue(entry['id']),
			independentlyExecutable: booleanValue(entry['independentlyExecutable']),
			label: stringValue(entry['label']),
			prerequisites: strings(entry['prerequisites']),
			risk: stringValue(entry['risk']),
		})),
		paused: booleanValue(source['paused']),
		pendingTransactions: list(source['pendingTransactions'], entry => ({
			cancellationHash: stringValue(entry['cancellationHash']),
			hash: stringValue(entry['hash']),
			label: stringValue(entry['label']),
			maxBlockNumber: scalarValue(entry['maxBlockNumber']),
			nonce: scalarValue(entry['nonce']),
			observation: parsePendingTransactionObservation(entry['observation']),
			operationId: stringValue(entry['operationId']),
			recoveryBlocker: stringValue(entry['recoveryBlocker']),
			replacementHash: stringValue(entry['replacementHash']),
			status: stringValue(entry['status']),
			submittedAt: stringValue(entry['submittedAt']),
			submissionBlock: scalarValue(entry['submissionBlock']),
		})),
		profileId: stringValue(source['profileId']),
		retirement: parsePublicRetirement(source['retirement']),
		rpcHealth: {
			chainReady: booleanValue(rpcHealth['chainReady']),
			configuredReadEndpointCount: nonnegativeIntegerValue(rpcHealth['configuredReadEndpointCount']),
			healthyReadEndpointCount: nonnegativeIntegerValue(rpcHealth['healthyReadEndpointCount']),
			lastCheckedAt: stringValue(rpcHealth['lastCheckedAt']),
			requiredReadQuorum: nonnegativeIntegerValue(rpcHealth['requiredReadQuorum']),
			status: rpcHealthStatusValue(rpcHealth['status']),
		},
		submissionHealth: {
			checkedOriginCount: nonnegativeIntegerValue(submissionHealth['checkedOriginCount']),
			configuredOriginCount: nonnegativeIntegerValue(submissionHealth['configuredOriginCount']),
			freshOriginCount: nonnegativeIntegerValue(submissionHealth['freshOriginCount']),
			healthyOriginCount: nonnegativeIntegerValue(submissionHealth['healthyOriginCount']),
			lastCheckedAt: stringValue(submissionHealth['lastCheckedAt']),
			mode: submissionHealth['mode'] === 'private' || submissionHealth['mode'] === 'public' ? submissionHealth['mode'] : undefined,
			proofMatchesSigner: booleanValue(submissionHealth['proofMatchesSigner']),
			ready: booleanValue(submissionHealth['ready']),
			requiredHealthyOriginCount: nonnegativeIntegerValue(submissionHealth['requiredHealthyOriginCount']),
			status: submissionHealthStatusValue(submissionHealth['status']),
		},
		safetyPaused: booleanValue(source['safetyPaused']),
		scheduler: {
			due: booleanValue(scheduler['due']),
			lastDelaySeconds: scalarValue(scheduler['lastDelaySeconds']),
			lastRunAt: stringValue(scheduler['lastRunAt']),
			nextRunAt: stringValue(scheduler['nextRunAt']),
			selectedOperationId: stringValue(scheduler['selectedOperationId']),
			status: stringValue(scheduler['status']),
		},
		signerReady: booleanValue(source['signerReady']),
		status: stringValue(source['status']),
		topology: parseTopology(source['topology']),
		wallet: stringValue(source['wallet']),
	}
}

export function parseConfiguration(value: unknown): Configuration {
	const source = record(value) ?? {}
	const connectivity = record(source['connectivity'])
	const selectableOperationAllowlist = source['selectableOperationAllowlist']
	return {
		allowHighRiskOperations: booleanValue(source['allowHighRiskOperations']),
		allowIrreversibleOperations: booleanValue(source['allowIrreversibleOperations']),
		chainId: scalarValue(source['chainId']),
		configurationCommitIndeterminate: booleanValue(source['configurationCommitIndeterminate']),
		connectivity:
			connectivity === undefined
				? undefined
				: {
						publicRpcUrls: strings(connectivity['publicRpcUrls']),
						quorumRpcUrls: strings(connectivity['quorumRpcUrls']),
						readRpcUrl: stringValue(connectivity['readRpcUrl']),
						rpcQuorum: scalarValue(connectivity['rpcQuorum']),
					},
		enabledEcosystems: strings(source['enabledEcosystems']),
		execute: booleanValue(source['execute']),
		explorerUrl: stringValue(source['explorerUrl']),
		hasSigner: booleanValue(source['hasSigner']),
		initializeGenesisUniverse: booleanValue(source['initializeGenesisUniverse']),
		maximumDelaySeconds: scalarValue(source['maximumDelaySeconds']),
		maximumEthPerOperation: scalarValue(source['maximumEthPerOperation']),
		maximumGasCostEth: scalarValue(source['maximumGasCostEth']),
		maximumRepPerOperation: scalarValue(source['maximumRepPerOperation']),
		minimumDelaySeconds: scalarValue(source['minimumDelaySeconds']),
		minimumEthReserve: scalarValue(source['minimumEthReserve']),
		minimumRepReserve: scalarValue(source['minimumRepReserve']),
		network: stringValue(source['network']),
		networkConfigured: booleanValue(source['networkConfigured']),
		paused: booleanValue(source['paused']),
		rememberSigner: booleanValue(source['rememberSigner']),
		revision: scalarValue(source['revision']),
		rpcQuorum: scalarValue(source['rpcQuorum']),
		selectableOperationAllowlist: nullableStrings(selectableOperationAllowlist),
		wallet: stringValue(source['wallet']),
		workflowValidForBlocks: scalarValue(source['workflowValidForBlocks']),
	}
}
