type RepBalance = {
	balance?: string | number | undefined
	symbol?: string | undefined
	token?: string | undefined
	universeId?: string | undefined
}

type OperationEvaluation = {
	blockers: string[]
	candidateCount?: string | number | undefined
	classification?: string | undefined
	description?: string | undefined
	ecosystem?: string | undefined
	eligible?: boolean | undefined
	enabled?: boolean | undefined
	id?: string | undefined
	label?: string | undefined
	prerequisites: string[]
	risk?: string | undefined
}

type Topology = {
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

type WorkflowStep = {
	confirmedAt?: string | undefined
	label?: string | undefined
	status?: string | undefined
	txHash?: string | undefined
}

type Workflow = {
	completedAt?: string | undefined
	ecosystem?: string | undefined
	id?: string | undefined
	label?: string | undefined
	operationId?: string | undefined
	startedAt?: string | undefined
	status?: string | undefined
	updatedAt?: string | undefined
	steps: WorkflowStep[]
}

type PendingTransaction = {
	cancellationHash?: string | undefined
	hash?: string | undefined
	label?: string | undefined
	nonce?: string | number | undefined
	operationId?: string | undefined
	recoveryBlocker?: string | undefined
	replacementHash?: string | undefined
	status?: string | undefined
	submittedAt?: string | undefined
	submissionBlock?: string | number | undefined
}

type Obligation = {
	blockers: string[]
	dueAt?: string | undefined
	ecosystem?: string | undefined
	id?: string | undefined
	label?: string | undefined
	operationId?: string | undefined
	status?: string | undefined
	updatedAt?: string | undefined
}

type Activity = {
	at?: string | undefined
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

type Snapshot = {
	activities: Activity[]
	alerts: { message?: string | undefined; severity?: string | undefined }[]
	chainId?: string | number | undefined
	currentWorkflow?: Workflow | undefined
	execute?: boolean | undefined
	inventory: { eth?: string | number | undefined; rep: RepBalance[]; weth?: string | number | undefined }
	lastScanAt?: string | undefined
	lastScannedBlock?: string | number | undefined
	network?: string | undefined
	obligations: Obligation[]
	operationEvaluations: OperationEvaluation[]
	paused?: boolean | undefined
	pendingTransactions: PendingTransaction[]
	rpcHealth: RpcHealth
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

type Configuration = {
	allowHighRiskOperations?: boolean | undefined
	allowIrreversibleOperations?: boolean | undefined
	chainId?: string | number | undefined
	configurationCommitIndeterminate?: boolean | undefined
	enabledEcosystems: string[]
	execute?: boolean | undefined
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
	wallet?: string | undefined
	workflowValidForBlocks?: string | number | undefined
}

const stateRequestTimeoutMilliseconds = 5_000
const configurationRequestTimeoutMilliseconds = 5_000
const stateRefreshMilliseconds = 10_000
const ecosystemOrder = ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const
const ecosystemLabels = new Map<string, string>([
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'Open Oracle'],
	['trading', 'Trading'],
])

function element<T extends Element>(id: string, constructor: { new (): T }) {
	const value = document.getElementById(id)
	if (!(value instanceof constructor)) throw new Error(`Missing dashboard element #${id}`)
	return value
}

const modeBadge = element('mode-badge', HTMLSpanElement)
const networkBadge = element('network-badge', HTMLSpanElement)
const signerBadge = element('signer-badge', HTMLSpanElement)
const recoveryBadge = element('recovery-badge', HTMLAnchorElement)
const refreshButton = element('refresh-button', HTMLButtonElement)
const pauseButton = element('pause-button', HTMLButtonElement)
const pauseStatus = element('pause-status', HTMLSpanElement)
const globalError = element('global-error', HTMLDivElement)
const operatorAlerts = element('operator-alerts', HTMLUListElement)
const lastBlock = element('last-block', HTMLParagraphElement)
const lastScan = element('last-scan', HTMLParagraphElement)
const countdown = element('countdown', HTMLHeadingElement)
const countdownProgress = element('countdown-progress', HTMLSpanElement)
const schedulerState = element('scheduler-state', HTMLSpanElement)
const nextRun = element('next-run', HTMLElement)
const lastDelay = element('last-delay', HTMLElement)
const eligibleCount = element('eligible-count', HTMLElement)
const selectedOperation = element('selected-operation', HTMLElement)
const walletShort = element('wallet-short', HTMLSpanElement)
const balanceEth = element('balance-eth', HTMLElement)
const balanceWeth = element('balance-weth', HTMLElement)
const balanceRepTotal = element('balance-rep-total', HTMLElement)
const repBalances = element('rep-balances', HTMLDivElement)
const rpcHealthStatus = element('rpc-health-status', HTMLSpanElement)
const rpcConfiguredTotal = element('rpc-configured-total', HTMLElement)
const rpcHealthyCount = element('rpc-healthy-count', HTMLElement)
const rpcRequiredQuorum = element('rpc-required-quorum', HTMLElement)
const rpcChainReadiness = element('rpc-chain-readiness', HTMLElement)
const rpcLastCheck = element('rpc-last-check', HTMLElement)
const rpcHealthRetryButton = element('rpc-health-retry-button', HTMLButtonElement)
const currentWorkflow = element('current-workflow', HTMLDivElement)
const coverageSummary = element('coverage-summary', HTMLDivElement)
const catalogFilter = element('catalog-filter', HTMLSelectElement)
const catalogClassificationFilter = element('catalog-classification-filter', HTMLSelectElement)
const catalogEligibilityFilter = element('catalog-eligibility-filter', HTMLSelectElement)
const catalogCaption = element('catalog-caption', HTMLTableCaptionElement)
const catalogRows = element('catalog-rows', HTMLTableSectionElement)
const ecosystemGrid = element('ecosystem-grid', HTMLDivElement)
const topologyAnchor = element('topology-anchor', HTMLSpanElement)
const topologyStatus = element('topology-status', HTMLParagraphElement)
const topologyUniverses = element('topology-universes', HTMLDivElement)
const topologyPools = element('topology-pools', HTMLDivElement)
const topologyReports = element('topology-reports', HTMLDivElement)
const topologyAuctions = element('topology-auctions', HTMLDivElement)
const topologyPairs = element('topology-pairs', HTMLDivElement)
const pendingCount = element('pending-count', HTMLSpanElement)
const obligationCount = element('obligation-count', HTMLSpanElement)
const pendingTransactions = element('pending-transactions', HTMLDivElement)
const replacementForm = element('replacement-form', HTMLFormElement)
const replacementFields = element('replacement-fields', HTMLFieldSetElement)
const replacementHashInput = element('replacement-hash', HTMLInputElement)
const replacementStatus = element('replacement-status', HTMLSpanElement)
const replacementRetryButton = element('replacement-retry', HTMLButtonElement)
const cancellationForm = element('cancellation-form', HTMLFormElement)
const cancellationFields = element('cancellation-fields', HTMLFieldSetElement)
const cancellationHashInput = element('cancellation-hash', HTMLInputElement)
const cancellationReasonInput = element('cancellation-reason', HTMLTextAreaElement)
const cancellationConfirmationInput = element('cancellation-confirmation', HTMLInputElement)
const cancellationStatus = element('cancellation-status', HTMLSpanElement)
const cancellationRetryButton = element('cancellation-retry', HTMLButtonElement)
const candidateForm = element('candidate-form', HTMLFormElement)
const candidateFields = element('candidate-fields', HTMLFieldSetElement)
const candidateReasonInput = element('candidate-reason', HTMLTextAreaElement)
const candidateConfirmationInput = element('candidate-confirmation', HTMLInputElement)
const candidateStatus = element('candidate-status', HTMLSpanElement)
const candidateRetryButton = element('candidate-retry', HTMLButtonElement)
const workflowForm = element('workflow-form', HTMLFormElement)
const workflowFields = element('workflow-fields', HTMLFieldSetElement)
const workflowReasonInput = element('workflow-reason', HTMLTextAreaElement)
const workflowConfirmationInput = element('workflow-confirmation', HTMLInputElement)
const workflowStatus = element('workflow-status', HTMLSpanElement)
const workflowRetryButton = element('workflow-retry', HTMLButtonElement)
const obligations = element('obligations', HTMLDivElement)
const obligationForm = element('obligation-form', HTMLFormElement)
const obligationFields = element('obligation-fields', HTMLFieldSetElement)
const obligationIdInput = element('obligation-id', HTMLSelectElement)
const obligationActionInput = element('obligation-action', HTMLSelectElement)
const obligationReasonInput = element('obligation-reason', HTMLTextAreaElement)
const obligationConfirmationInput = element('obligation-confirmation', HTMLInputElement)
const obligationConfirmationHelp = element('obligation-confirmation-help', HTMLParagraphElement)
const obligationStatus = element('obligation-status', HTMLSpanElement)
const obligationRetryButton = element('obligation-retry', HTMLButtonElement)
const activityList = element('activity-list', HTMLOListElement)
const settingsScope = element('settings-scope', HTMLSpanElement)
const configurationStatus = element('configuration-status', HTMLDivElement)
const settingsPauseNote = element('settings-pause-note', HTMLDivElement)
const settingsForm = element('settings-form', HTMLFormElement)
const settingsFields = element('settings-fields', HTMLFieldSetElement)
const executeInput = element('execute', HTMLInputElement)
const highRiskInput = element('allow-high-risk', HTMLInputElement)
const irreversibleInput = element('allow-irreversible', HTMLInputElement)
const minDelayInput = element('min-delay', HTMLInputElement)
const maxDelayInput = element('max-delay', HTMLInputElement)
const reserveEthInput = element('reserve-eth', HTMLInputElement)
const reserveRepInput = element('reserve-rep', HTMLInputElement)
const maximumEthOperationInput = element('maximum-eth-operation', HTMLInputElement)
const maximumGasCostInput = element('maximum-gas-cost', HTMLInputElement)
const maximumRepOperationInput = element('maximum-rep-operation', HTMLInputElement)
const workflowValidBlocksInput = element('workflow-valid-blocks', HTMLInputElement)
const saveSettingsButton = element('save-settings', HTMLButtonElement)
const discardSettingsButton = element('discard-settings', HTMLButtonElement)
const settingsSaveStatus = element('settings-save-status', HTMLSpanElement)
const signerForm = element('signer-form', HTMLFormElement)
const signerFields = element('signer-fields', HTMLFieldSetElement)
const signerSummary = element('signer-summary', HTMLElement)
const privateKeyInput = element('private-key', HTMLInputElement)
const rememberSignerInput = element('remember-signer', HTMLInputElement)
const clearSignerButton = element('clear-signer', HTMLButtonElement)
const signerStatus = element('signer-status', HTMLSpanElement)
const resumeDialog = element('resume-dialog', HTMLDialogElement)
const resumePreflight = element('resume-preflight', HTMLUListElement)
const cancelResume = element('cancel-resume', HTMLButtonElement)
const confirmResume = element('confirm-resume', HTMLButtonElement)

let snapshot: Snapshot | undefined
let configuration: Configuration | undefined
type RefreshResult = { configurationAvailable: boolean; stateAvailable: boolean }
let refreshPromise: Promise<RefreshResult> | undefined
let settingsDirty = false
let settingsConflict = false
let settingsRevision: string | number | undefined
let pauseMutationPending = false
let pauseMutationUnreconciled = false
let settingsMutationUnreconciled = false
let signerMutationUnreconciled = false
let configurationCommitIndeterminate = false

const configurationCommitIndeterminateRecoveryMessage = 'Dashboard mutation controls are permanently frozen in this server process and page. Stop the bot, inspect and reload the owner configuration and runtime-state files offline, then restart it before making another mutation.'
const configurationCommitIndeterminateMessage = 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.'

type MutationReconciliationTarget = 'pause' | 'settings' | 'signer'

type RecoveryContextRefresh = {
	available: (value: Snapshot) => boolean
	fields: HTMLFieldSetElement
	loadedMessage: string
	missingMessage: string
	name: string
	retryButton: HTMLButtonElement
	status: HTMLSpanElement
}

const pendingRecoveryContextRefreshes = new Set<RecoveryContextRefresh>()

const replacementRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.cancellationHash === undefined,
	fields: replacementFields,
	loadedMessage: 'Current pending intent loaded. Review the transaction hash, then submit again.',
	missingMessage: 'No pending intent is currently actionable for replacement. Recovery controls remain disabled.',
	name: 'pending intent',
	retryButton: replacementRetryButton,
	status: replacementStatus,
}

const cancellationRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.pendingTransactions.length === 1 && value.pendingTransactions[0]?.hash !== undefined && value.pendingTransactions[0]?.replacementHash === undefined,
	fields: cancellationFields,
	loadedMessage: 'Current pending intent loaded. Review the cancellation details, then submit again.',
	missingMessage: 'No pending intent is currently actionable for cancellation. Recovery controls remain disabled.',
	name: 'pending intent',
	retryButton: cancellationRetryButton,
	status: cancellationStatus,
}

const candidateRecoveryContext: RecoveryContextRefresh = {
	available: value => {
		const intent = value.pendingTransactions[0]
		return value.paused === true && value.pendingTransactions.length === 1 && intent?.hash !== undefined && (intent.replacementHash !== undefined || intent.cancellationHash !== undefined)
	},
	fields: candidateFields,
	loadedMessage: 'Current recovery candidate loaded. Review it, then submit again.',
	missingMessage: 'No queued recovery candidate is available. Candidate controls remain disabled.',
	name: 'recovery candidate',
	retryButton: candidateRetryButton,
	status: candidateStatus,
}

const workflowRecoveryContext: RecoveryContextRefresh = {
	available: value => value.paused === true && value.currentWorkflow?.status === 'waiting-continuation' && value.currentWorkflow.id !== undefined && value.currentWorkflow.updatedAt !== undefined,
	fields: workflowFields,
	loadedMessage: 'Partial workflow loaded. Review it, then submit again.',
	missingMessage: 'No partial workflow awaiting continuation is available. Workflow controls remain disabled.',
	name: 'partial workflow',
	retryButton: workflowRetryButton,
	status: workflowStatus,
}

const obligationRecoveryContext: RecoveryContextRefresh = {
	available: value => {
		const obligation = value.obligations.find(candidate => candidate.id === obligationIdInput.value)
		return value.paused === true && obligation?.id !== undefined && obligation.updatedAt !== undefined
	},
	fields: obligationFields,
	loadedMessage: 'Current lifecycle item loaded. Review it, then submit again.',
	missingMessage: 'No current lifecycle item is available. Lifecycle controls remain disabled.',
	name: 'lifecycle item',
	retryButton: obligationRetryButton,
	status: obligationStatus,
}

const recoveryContexts = [replacementRecoveryContext, cancellationRecoveryContext, candidateRecoveryContext, workflowRecoveryContext, obligationRecoveryContext] as const

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function stringValue(value: unknown) {
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

function rpcHealthStatusValue(value: unknown): RpcHealth['status'] {
	return value === 'degraded' || value === 'not-checked' || value === 'not-configured' || value === 'ready' ? value : undefined
}

function strings(value: unknown) {
	return Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' ? [entry] : [])) : []
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

function parseSnapshot(value: unknown): Snapshot {
	const source = record(value) ?? {}
	const inventory = record(source['inventory']) ?? {}
	const rpcHealth = record(source['rpcHealth']) ?? {}
	const scheduler = record(source['scheduler']) ?? {}
	return {
		activities: list(source['activities'], entry => ({
			at: stringValue(entry['at']),
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
		lastScanAt: stringValue(source['lastScanAt']),
		lastScannedBlock: scalarValue(source['lastScannedBlock']),
		network: stringValue(source['network']),
		obligations: list(source['obligations'], entry => ({
			blockers: strings(entry['blockers']),
			dueAt: stringValue(entry['dueAt']),
			ecosystem: stringValue(entry['ecosystem']),
			id: stringValue(entry['id']),
			label: stringValue(entry['label']),
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
			label: stringValue(entry['label']),
			prerequisites: strings(entry['prerequisites']),
			risk: stringValue(entry['risk']),
		})),
		paused: booleanValue(source['paused']),
		pendingTransactions: list(source['pendingTransactions'], entry => ({
			cancellationHash: stringValue(entry['cancellationHash']),
			hash: stringValue(entry['hash']),
			label: stringValue(entry['label']),
			nonce: scalarValue(entry['nonce']),
			operationId: stringValue(entry['operationId']),
			recoveryBlocker: stringValue(entry['recoveryBlocker']),
			replacementHash: stringValue(entry['replacementHash']),
			status: stringValue(entry['status']),
			submittedAt: stringValue(entry['submittedAt']),
			submissionBlock: scalarValue(entry['submissionBlock']),
		})),
		rpcHealth: {
			chainReady: booleanValue(rpcHealth['chainReady']),
			configuredReadEndpointCount: nonnegativeIntegerValue(rpcHealth['configuredReadEndpointCount']),
			healthyReadEndpointCount: nonnegativeIntegerValue(rpcHealth['healthyReadEndpointCount']),
			lastCheckedAt: stringValue(rpcHealth['lastCheckedAt']),
			requiredReadQuorum: nonnegativeIntegerValue(rpcHealth['requiredReadQuorum']),
			status: rpcHealthStatusValue(rpcHealth['status']),
		},
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

function parseConfiguration(value: unknown): Configuration {
	const source = record(value) ?? {}
	return {
		allowHighRiskOperations: booleanValue(source['allowHighRiskOperations']),
		allowIrreversibleOperations: booleanValue(source['allowIrreversibleOperations']),
		chainId: scalarValue(source['chainId']),
		configurationCommitIndeterminate: booleanValue(source['configurationCommitIndeterminate']),
		enabledEcosystems: strings(source['enabledEcosystems']),
		execute: booleanValue(source['execute']),
		hasSigner: booleanValue(source['hasSigner']),
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
		wallet: stringValue(source['wallet']),
		workflowValidForBlocks: scalarValue(source['workflowValidForBlocks']),
	}
}

async function requestJson(path: string, timeoutMilliseconds: number, init?: RequestInit) {
	const controller = new AbortController()
	const timeout = window.setTimeout(() => controller.abort(), timeoutMilliseconds)
	try {
		let response: Response
		let value: unknown
		try {
			response = await fetch(path, { ...init, headers: { accept: 'application/json', ...init?.headers }, signal: controller.signal })
			value = await response.json()
		} catch (error) {
			if (init?.method !== 'PUT') throw error
			const unknown = new Error(error instanceof DOMException && error.name === 'AbortError' ? 'The mutation timed out and may have committed.' : 'The mutation response was lost and the change may have committed.')
			unknown.name = 'MutationOutcomeUnknown'
			throw unknown
		}
		if (!response.ok) {
			const responseRecord = record(value)
			const message = stringValue(responseRecord?.['error'])
			const error = new Error(message ?? 'Dashboard request failed')
			if (response.status === 409 && responseRecord?.['code'] === 'configuration_revision_conflict') {
				error.name = 'ConfigurationRevisionConflict'
			}
			if (responseRecord?.['code'] === 'configuration_committed_safely_paused') error.name = 'MutationOutcomeUnknown'
			if (responseRecord?.['code'] === 'configuration_commit_indeterminate') error.name = 'ConfigurationCommitIndeterminate'
			throw error
		}
		return value
	} finally {
		window.clearTimeout(timeout)
	}
}

function node(tag: keyof HTMLElementTagNameMap, className?: string, text?: string) {
	const value = document.createElement(tag)
	if (className !== undefined) value.className = className
	if (text !== undefined) value.textContent = text
	return value
}

let identifierSequence = 0

function compactIdentifier(value: string, type: string) {
	const wrapper = node('span', 'compact-identifier')
	wrapper.dataset['identifierType'] = type
	const display = node('span', 'identifier-value mono', shortHex(value))
	const copy = document.createElement('button')
	copy.className = 'identifier-copy'
	copy.textContent = 'Copy'
	copy.type = 'button'
	copy.setAttribute('aria-label', `Copy ${type}: ${value}`)
	identifierSequence += 1
	const full = document.createElement('textarea')
	full.className = 'identifier-full mono'
	full.hidden = true
	full.id = `identifier-full-${identifierSequence.toString()}`
	full.readOnly = true
	full.rows = 2
	full.spellcheck = false
	full.value = value
	full.wrap = 'soft'
	full.setAttribute('aria-label', `Full ${type}`)
	const disclosure = document.createElement('button')
	disclosure.className = 'identifier-disclosure'
	disclosure.textContent = 'Show full'
	disclosure.type = 'button'
	disclosure.setAttribute('aria-controls', full.id)
	disclosure.setAttribute('aria-expanded', 'false')
	disclosure.setAttribute('aria-label', `Show full ${type}: ${value}`)
	const feedback = node('span', 'identifier-feedback')
	feedback.setAttribute('aria-live', 'polite')
	feedback.setAttribute('role', 'status')
	const setExpanded = (expanded: boolean) => {
		full.hidden = !expanded
		disclosure.textContent = expanded ? 'Hide full' : 'Show full'
		disclosure.setAttribute('aria-expanded', expanded ? 'true' : 'false')
		disclosure.setAttribute('aria-label', `${expanded ? 'Hide' : 'Show'} full ${type}: ${value}`)
	}
	disclosure.addEventListener('click', () => setExpanded(full.hidden))
	copy.addEventListener('click', () => {
		copy.disabled = true
		feedback.className = 'identifier-feedback'
		feedback.textContent = 'Copying…'
		const clipboard = navigator.clipboard
		const write = clipboard === undefined ? Promise.reject(new Error('Clipboard API unavailable')) : Promise.resolve().then(() => clipboard.writeText(value))
		void write.then(
			() => {
				copy.disabled = false
				feedback.className = 'identifier-feedback success'
				feedback.textContent = 'Copied'
			},
			() => {
				copy.disabled = false
				feedback.className = 'identifier-feedback error'
				feedback.textContent = 'Copy failed; full value shown'
				setExpanded(true)
			},
		)
	})
	wrapper.append(display, copy, disclosure, feedback, full)
	return wrapper
}

function identifierLine(prefix: string, value: string | undefined, type: string) {
	const line = node('small', 'identifier-line')
	line.append(node('span', undefined, prefix))
	if (value === undefined) line.append(node('span', 'mono muted', 'Unavailable'))
	else line.append(compactIdentifier(value, type))
	return line
}

function setBadge(target: HTMLElement, label: string, tone: 'error' | 'info' | 'neutral' | 'success' | 'warning') {
	target.textContent = label
	target.className = `badge ${tone}`
}

function normalizeEcosystem(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
	if (normalized === 'openoracle' || normalized === 'oracle') return 'open-oracle'
	const candidate = normalized ?? 'zoltar'
	return ecosystemOrder.some(ecosystem => ecosystem === candidate) ? candidate : 'zoltar'
}

function ecosystemLabel(value: string | undefined) {
	return ecosystemLabels.get(normalizeEcosystem(value)) ?? 'Zoltar'
}

function operationIsIndependentlyExecutable(value: OperationEvaluation) {
	return value.classification === 'selectable' || value.classification === 'lifecycle-obligation'
}

function classificationLabel(value: string | undefined) {
	if (value === 'lifecycle-obligation') return 'Lifecycle obligation'
	if (value === 'excluded-dangerous') return 'Excluded: dangerous'
	if (value === 'role-restricted') return 'Role restricted'
	if (value === 'prerequisite') return 'Workflow prerequisite'
	if (value === 'selectable') return 'Randomly selectable'
	return 'Classification unavailable'
}

function shortHex(value: string | undefined) {
	if (value === undefined || value.length < 14) return value ?? '—'
	return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function parsePositiveNumber(value: string | number | undefined) {
	let parsed = Number.NaN
	if (typeof value === 'number') parsed = value
	else if (value !== undefined) parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function publicCandidateCount(value: string | number | undefined) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined
	const count = BigInt(value)
	return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString()
}

function formatAtomic18(value: string | number | undefined) {
	if (value === undefined) return '—'
	let atomic = ''
	if (typeof value === 'string') atomic = value
	else if (Number.isSafeInteger(value) && value >= 0) atomic = value.toString()
	if (!/^(?:0|[1-9]\d*)$/.test(atomic)) return 'Invalid atomic balance'
	const padded = atomic.padStart(19, '0')
	const integer = padded.slice(0, -18).replace(/^0+(?=\d)/, '')
	return `${integer}.${padded.slice(-18)}`
}

function formatDuration(totalSeconds: number) {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const hours = Math.floor(seconds / 3_600)
	const minutes = Math.floor((seconds % 3_600) / 60)
	const remainingSeconds = seconds % 60
	return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}` : `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

function formatDate(value: string | undefined) {
	if (value === undefined) return 'Not scheduled'
	const date = new Date(value)
	return Number.isNaN(date.getTime()) ? 'Timestamp unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(date)
}

function formatRelative(value: string | undefined) {
	if (value === undefined) return 'Waiting for first scan'
	const timestamp = new Date(value).getTime()
	if (!Number.isFinite(timestamp)) return 'Scan time unavailable'
	const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
	if (seconds < 60) return `Scanned ${seconds.toString()}s ago`
	if (seconds < 3_600) return `Scanned ${Math.floor(seconds / 60).toString()}m ago`
	return `Scanned ${Math.floor(seconds / 3_600).toString()}h ago`
}

function statusTone(status: string | undefined): 'error' | 'info' | 'neutral' | 'success' | 'warning' {
	const normalized = status?.toLowerCase()
	if (normalized === 'confirmed' || normalized === 'complete' || normalized === 'eligible' || normalized === 'healthy' || normalized === 'success') return 'success'
	if (normalized === 'failed' || normalized === 'error' || normalized === 'blocked') return 'error'
	if (normalized === 'pending' || normalized === 'submitted' || normalized === 'recovering' || normalized === 'due') return 'warning'
	if (normalized === 'dry-run' || normalized === 'simulated') return 'info'
	return 'neutral'
}

function statusLabel(status: string | undefined) {
	const normalized = status?.trim().replaceAll('_', ' ').replaceAll('-', ' ')
	if (normalized === undefined || normalized.length === 0) return 'Waiting'
	return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1).toLowerCase()}`
}

function applyMutationControlLatches() {
	if (pauseMutationUnreconciled || configurationCommitIndeterminate) pauseButton.disabled = true
	if (settingsMutationUnreconciled || configurationCommitIndeterminate) settingsFields.disabled = true
	if (signerMutationUnreconciled || configurationCommitIndeterminate) signerFields.disabled = true
	if (!configurationCommitIndeterminate) return
	confirmResume.disabled = true
	for (const fields of [replacementFields, cancellationFields, candidateFields, workflowFields, obligationFields]) fields.disabled = true
}

function setMutationReconciliationPending(target: MutationReconciliationTarget) {
	if (target === 'pause') pauseMutationUnreconciled = true
	else if (target === 'settings') settingsMutationUnreconciled = true
	else signerMutationUnreconciled = true
	applyMutationControlLatches()
}

function resolveMutationReconciliations() {
	if (configurationCommitIndeterminate) {
		applyMutationControlLatches()
		return
	}
	const reconciliationMessage = 'The request outcome was unknown. Current configuration and state were reloaded; review it before another mutation.'
	if (pauseMutationUnreconciled) {
		pauseMutationUnreconciled = false
		pauseStatus.textContent = reconciliationMessage
	}
	if (settingsMutationUnreconciled) {
		settingsMutationUnreconciled = false
		settingsSaveStatus.textContent = reconciliationMessage
	}
	if (signerMutationUnreconciled) {
		signerMutationUnreconciled = false
		signerStatus.textContent = reconciliationMessage
	}
	if (snapshot !== undefined) renderHeader(snapshot)
	if (configuration !== undefined) renderConfiguration(configuration)
}

function latchConfigurationCommitIndeterminate(status?: HTMLElement, message = configurationCommitIndeterminateMessage) {
	configurationCommitIndeterminate = true
	const recovery = `${message} ${configurationCommitIndeterminateRecoveryMessage}`
	if (status !== undefined) status.textContent = recovery
	configurationStatus.textContent = recovery
	configurationStatus.className = 'notice error'
	applyMutationControlLatches()
}

function renderHeader(value: Snapshot) {
	if (value.paused === true) setBadge(modeBadge, 'Paused', 'warning')
	else if (value.execute === true) setBadge(modeBadge, 'Live execution', 'error')
	else setBadge(modeBadge, 'Dry run', 'info')
	const networkName = value.network ?? configuration?.network ?? 'Network unknown'
	const chainId = value.chainId ?? configuration?.chainId
	setBadge(networkBadge, chainId === undefined ? networkName : `${networkName} · ${String(chainId)}`, value.network === undefined && configuration?.network === undefined ? 'warning' : 'neutral')
	setBadge(signerBadge, value.signerReady === true ? 'Signer ready' : 'Signer missing', value.signerReady === true ? 'success' : 'warning')
	const recoveryItems = value.pendingTransactions.length + value.obligations.length
	setBadge(recoveryBadge, recoveryItems === 0 ? 'Recovery clear' : `${recoveryItems.toString()} recovery item${recoveryItems === 1 ? '' : 's'}`, recoveryItems === 0 ? 'success' : 'warning')
	let pauseLabel = value.paused === true ? 'Resume' : 'Pause'
	if (pauseMutationPending) pauseLabel = value.paused === true ? 'Resuming…' : 'Pausing…'
	pauseButton.textContent = pauseLabel
	pauseButton.disabled = pauseMutationPending || pauseMutationUnreconciled || configurationCommitIndeterminate
}

function renderOverview(value: Snapshot) {
	lastBlock.textContent = value.lastScannedBlock === undefined ? 'Block —' : `Block ${String(value.lastScannedBlock)}`
	lastScan.textContent = formatRelative(value.lastScanAt)
	nextRun.textContent = formatDate(value.scheduler.nextRunAt)
	const delay = parsePositiveNumber(value.scheduler.lastDelaySeconds)
	lastDelay.textContent = delay === undefined ? '—' : formatDuration(delay)
	const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
	const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true)
	eligibleCount.textContent = `${eligible.length.toString()} of ${executable.length.toString()}`
	const selected = value.operationEvaluations.find(operation => operation.id === value.scheduler.selectedOperationId)
	selectedOperation.textContent = selected?.label ?? value.scheduler.selectedOperationId ?? 'None'
	walletShort.replaceChildren(value.wallet === undefined ? document.createTextNode('No signer') : compactIdentifier(value.wallet, 'wallet address'))
	walletShort.removeAttribute('title')
	balanceEth.textContent = formatAtomic18(value.inventory.eth)
	balanceWeth.textContent = formatAtomic18(value.inventory.weth)
	balanceRepTotal.textContent = value.inventory.rep.length === 0 ? '—' : `${value.inventory.rep.length.toString()} token${value.inventory.rep.length === 1 ? '' : 's'}`
	renderRepBalances(value.inventory.rep)
	renderRpcHealth(value)
	renderWorkflow(value.currentWorkflow)
	renderCoverage(value.operationEvaluations)
}

function renderRpcHealth(value: Snapshot) {
	rpcHealthRetryButton.classList.add('hidden')
	const health = value.rpcHealth
	if (health.status === 'ready') setBadge(rpcHealthStatus, 'Quorum ready', 'success')
	else if (health.status === 'degraded') setBadge(rpcHealthStatus, 'Quorum blocked', 'error')
	else if (health.status === 'not-checked') setBadge(rpcHealthStatus, 'Awaiting health check', 'warning')
	else setBadge(rpcHealthStatus, 'Health unavailable', 'warning')
	const configured = health.configuredReadEndpointCount
	rpcConfiguredTotal.textContent = configured === undefined ? '—' : `${configured.toString()} endpoint${configured === 1 ? '' : 's'}`
	const healthy = health.healthyReadEndpointCount
	if (healthy === undefined) rpcHealthyCount.textContent = '—'
	else rpcHealthyCount.textContent = configured === undefined ? healthy.toString() : `${healthy.toString()} of ${configured.toString()}`
	const quorum = health.requiredReadQuorum
	rpcRequiredQuorum.textContent = quorum === undefined ? '—' : `${quorum.toString()} endpoint${quorum === 1 ? '' : 's'}`
	const chain = value.chainId === undefined ? 'configured chain' : `chain ${String(value.chainId)}`
	if (health.chainReady === true) rpcChainReadiness.textContent = `Ready for ${chain}`
	else if (health.chainReady === false) rpcChainReadiness.textContent = `Not ready for ${chain}`
	else rpcChainReadiness.textContent = 'Not yet verified'
	rpcLastCheck.textContent = health.lastCheckedAt === undefined ? 'No completed check' : formatDate(health.lastCheckedAt)
}

function renderUnavailableRpcHealth(previousResultIsStale: boolean) {
	rpcHealthRetryButton.classList.remove('hidden')
	setBadge(rpcHealthStatus, 'Health unavailable', 'warning')
	rpcConfiguredTotal.textContent = '—'
	rpcHealthyCount.textContent = '—'
	rpcRequiredQuorum.textContent = '—'
	rpcChainReadiness.textContent = 'Unavailable until state refresh succeeds'
	rpcLastCheck.textContent = previousResultIsStale ? 'Previous health result is stale' : 'No current health result'
}

function renderRepBalances(values: RepBalance[]) {
	if (values.length === 0) {
		repBalances.className = 'token-list empty-state'
		repBalances.textContent = 'No REP inventory observed.'
		return
	}
	repBalances.className = 'token-list'
	const rows = values.map(value => {
		const row = node('div', 'token-row')
		const identity = node('div')
		identity.append(node('strong', undefined, value.symbol ?? 'REP'))
		identity.append(node('small', 'mono', value.universeId === undefined ? shortHex(value.token) : `Universe ${value.universeId}`))
		row.append(identity, node('strong', 'mono', formatAtomic18(value.balance)))
		return row
	})
	repBalances.replaceChildren(...rows)
}

function renderWorkflow(value: Workflow | undefined) {
	if (value === undefined) {
		currentWorkflow.className = 'empty-state'
		currentWorkflow.textContent = 'No operation is in progress.'
		return
	}
	currentWorkflow.className = ''
	const heading = node('div', 'workflow-heading')
	const copy = node('div')
	copy.append(node('strong', undefined, value.label ?? value.operationId ?? 'Active workflow'))
	copy.append(node('p', undefined, `${ecosystemLabel(value.ecosystem)} · started ${formatDate(value.startedAt)}`))
	const status = node('span')
	setBadge(status, value.status === undefined ? 'In progress' : statusLabel(value.status), statusTone(value.status))
	heading.append(copy, status)
	const steps = node('ol', 'step-list')
	for (const step of value.steps) {
		const row = node('li')
		const marker = node('span', `step-dot ${step.status ?? ''}`)
		marker.setAttribute('aria-hidden', 'true')
		const detail = node('span', 'step-detail')
		const readableStatus = statusLabel(step.status)
		const status = node('span', `step-status ${statusTone(step.status)}`, readableStatus)
		status.dataset['stepStatus'] = step.status?.trim().toLowerCase() || 'waiting'
		detail.append(status)
		if (step.txHash !== undefined) {
			const hash = compactIdentifier(step.txHash, 'workflow transaction hash')
			hash.classList.add('step-hash')
			hash.dataset['stepHash'] = ''
			detail.append(hash)
		}
		row.append(marker, node('span', 'step-label', step.label ?? 'Workflow step'), detail)
		steps.append(row)
	}
	if (value.steps.length === 0) steps.append(node('li', undefined, 'Workflow state is being prepared.'))
	currentWorkflow.replaceChildren(heading, steps)
}

function renderCoverage(values: OperationEvaluation[]) {
	const cards = ecosystemOrder.map(ecosystem => {
		const operations = values.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem && operationIsIndependentlyExecutable(value))
		const eligible = operations.filter(value => value.enabled !== false && value.eligible === true).length
		const card = node('div', 'coverage-card')
		card.append(node('span', undefined, ecosystemLabels.get(ecosystem) ?? ecosystem), node('strong', undefined, `${eligible.toString()}/${operations.length.toString()}`), node('small', undefined, 'eligible operations'))
		return card
	})
	coverageSummary.replaceChildren(...cards)
}

function renderCatalog(values: OperationEvaluation[]) {
	const selectedEcosystem = catalogFilter.value
	const selectedClassification = catalogClassificationFilter.value
	const selectedEligibility = catalogEligibilityFilter.value
	const filtered = values.filter(value => {
		if (selectedEcosystem !== 'all' && normalizeEcosystem(value.ecosystem) !== selectedEcosystem) return false
		if (selectedClassification !== 'all' && value.classification !== selectedClassification) return false
		const independentlyExecutable = operationIsIndependentlyExecutable(value)
		const eligible = independentlyExecutable && value.enabled !== false && value.eligible === true
		let eligibility = 'blocked'
		if (!independentlyExecutable) eligibility = 'not-selectable'
		else if (value.enabled === false) eligibility = 'disabled'
		else if (eligible) eligibility = 'eligible'
		return selectedEligibility === 'all' || selectedEligibility === eligibility
	})
	const candidateTotal = filtered.reduce((total, value) => total + BigInt(publicCandidateCount(value.candidateCount) ?? 0), 0n)
	catalogCaption.textContent = `${filtered.length.toString()} of ${values.length.toString()} classified catalog entr${values.length === 1 ? 'y' : 'ies'} shown · ${candidateTotal.toString()} live candidate${candidateTotal === 1n ? '' : 's'}.`
	const rows = filtered.map(value => {
		const row = document.createElement('tr')
		const nameCell = node('td', 'operation-name')
		nameCell.append(node('strong', undefined, value.label ?? value.id ?? 'Unnamed operation'))
		if (value.id !== undefined) nameCell.append(node('small', 'mono', value.id))
		if (value.description !== undefined) nameCell.append(node('small', undefined, value.description))
		const ecosystemCell = node('td', undefined, ecosystemLabel(value.ecosystem))
		const classificationCell = node('td')
		const classificationBadge = node('span')
		let classificationTone: Parameters<typeof setBadge>[2] = 'success'
		if (value.classification === 'excluded-dangerous') classificationTone = 'error'
		else if (value.classification === 'role-restricted' || value.classification === 'prerequisite') classificationTone = 'neutral'
		else if (value.classification === 'lifecycle-obligation') classificationTone = 'info'
		setBadge(classificationBadge, classificationLabel(value.classification), classificationTone)
		classificationCell.append(classificationBadge)
		const riskCell = node('td')
		const riskBadge = node('span')
		setBadge(riskBadge, statusLabel(value.risk ?? 'standard'), value.risk === 'irreversible' || value.risk === 'high' ? 'warning' : 'neutral')
		riskCell.append(riskBadge)
		const candidatesCell = node('td', 'mono', String(publicCandidateCount(value.candidateCount) ?? 0))
		const eligibilityCell = node('td')
		const enabled = value.enabled !== false
		const independentlyExecutable = operationIsIndependentlyExecutable(value)
		const eligible = independentlyExecutable && enabled && value.eligible === true
		const eligibilityBadge = node('span')
		if (!independentlyExecutable) setBadge(eligibilityBadge, 'Not independently selectable', 'neutral')
		else if (!enabled) setBadge(eligibilityBadge, 'Disabled', 'neutral')
		else if (eligible) setBadge(eligibilityBadge, 'Eligible', 'success')
		else setBadge(eligibilityBadge, 'Blocked', 'warning')
		eligibilityCell.append(eligibilityBadge)
		if (!eligible) {
			let reasons = value.blockers
			if (reasons.length === 0) {
				if (!independentlyExecutable) reasons = ['This surface is classified for coverage but cannot be selected as a standalone operation']
				else if (!enabled) reasons = ['Disabled by operator policy']
				else reasons = ['No eligible candidate in current state']
			}
			const listValue = node('ul', 'blocker-list')
			for (const reason of reasons) listValue.append(node('li', undefined, reason))
			eligibilityCell.append(listValue)
		}
		row.append(nameCell, ecosystemCell, classificationCell, riskCell, candidatesCell, eligibilityCell)
		return row
	})
	if (rows.length === 0) {
		const row = document.createElement('tr')
		const cell = node('td', 'empty-state', 'No operations match this filter.')
		cell.setAttribute('colspan', '6')
		row.append(cell)
		catalogRows.replaceChildren(row)
	} else catalogRows.replaceChildren(...rows)
}

function renderEcosystems(values: OperationEvaluation[]) {
	const cards = ecosystemOrder.map(ecosystem => {
		const operations = values.filter(value => normalizeEcosystem(value.ecosystem) === ecosystem && operationIsIndependentlyExecutable(value))
		const enabled = operations.filter(value => value.enabled !== false)
		const eligible = enabled.filter(value => value.eligible === true)
		const candidates = eligible.reduce((total, value) => total + (parsePositiveNumber(value.candidateCount) ?? 0), 0)
		const card = node('article', 'panel ecosystem-card')
		card.dataset['ecosystem'] = ecosystem
		const heading = node('div', 'panel-heading')
		heading.append(node('h3', undefined, ecosystemLabels.get(ecosystem) ?? ecosystem))
		const readiness = node('span')
		if (eligible.length > 0) setBadge(readiness, 'Ready', 'success')
		else if (operations.length === 0) setBadge(readiness, 'Discovering', 'neutral')
		else setBadge(readiness, 'Blocked', 'warning')
		heading.append(readiness)
		const metrics = node('div', 'ecosystem-metrics')
		for (const [label, amount] of [
			['Catalog', operations.length],
			['Eligible', eligible.length],
			['Candidates', candidates],
		] as const) {
			const metric = node('div')
			metric.append(node('strong', undefined, amount.toString()), node('span', undefined, label))
			metrics.append(metric)
		}
		let summary: HTMLElement
		if (eligible.length > 0) summary = node('p', 'muted', 'At least one exact operation can be simulated now.')
		else if (operations.length === 0) summary = node('p', 'muted', 'Waiting for protocol discovery.')
		else {
			const blockers = [
				...new Set(
					operations.flatMap(value => {
						const operation = value.label ?? value.id ?? 'Unnamed operation'
						let reasons = value.blockers
						if (value.enabled === false) reasons = ['Disabled by operator policy']
						else if (reasons.length === 0) reasons = ['No eligible candidate in current state']
						return reasons.map(reason => `${operation}: ${reason}`)
					}),
				),
			].slice(0, 3)
			summary = node('ul', 'blocker-list')
			for (const blocker of blockers) summary.append(node('li', undefined, blocker))
		}
		card.append(heading, metrics, summary)
		return card
	})
	ecosystemGrid.replaceChildren(...cards)
}

function topologyIdentifier(value: string | undefined, fallback: string, type: string) {
	return value === undefined ? node('span', 'mono muted', fallback) : compactIdentifier(value, type)
}

function topologyIdentifierFact(label: string, value: string | undefined, type: string) {
	const fact = node('span', 'topology-fact topology-identifier-fact')
	fact.append(node('span', undefined, label), topologyIdentifier(value, 'Unavailable', type))
	return fact
}

function renderTopologyGroup(target: HTMLDivElement, values: readonly unknown[], render: (value: Record<string, unknown>) => HTMLElement) {
	if (values.length === 0) {
		target.className = 'topology-list empty-state'
		target.textContent = 'None discovered at this anchor.'
		return
	}
	target.className = 'topology-list'
	target.replaceChildren(
		...values.flatMap(value => {
			const source = record(value)
			return source === undefined ? [] : [render(source)]
		}),
	)
}

function topologyRow(identity: HTMLElement | string, facts: Array<HTMLElement | string>) {
	const row = node('div', 'topology-row')
	const heading = node('strong')
	heading.append(typeof identity === 'string' ? document.createTextNode(identity) : identity)
	const details = node('small', 'topology-facts')
	for (const fact of facts) details.append(typeof fact === 'string' ? node('span', 'topology-fact', fact) : fact)
	row.append(heading, details)
	return row
}

function renderTopology(value: Topology) {
	const visibleTotal = value.universes.length + value.pools.length + value.reports.length + value.auctions.length + value.pairs.length
	const discoveredTotal = value.totalCounts.universes + value.totalCounts.pools + value.totalCounts.reports + value.totalCounts.auctions + value.totalCounts.pairs
	if (value.anchorBlock === undefined) {
		setBadge(topologyAnchor, 'Anchor unavailable', 'warning')
		topologyStatus.textContent = 'Waiting for the first canonical scan to publish its sanitized protocol topology.'
	} else {
		setBadge(topologyAnchor, `Block ${String(value.anchorBlock)}`, value.complete === false || value.truncated === true ? 'warning' : 'success')
		if (value.truncated === true) {
			topologyStatus.textContent = `${visibleTotal.toString()} of ${discoveredTotal.toString()} anchored protocol identities shown · dashboard projection is capped; canonical discovery is ${value.complete === false ? 'incomplete' : 'complete'}.`
		} else {
			topologyStatus.textContent = `${visibleTotal.toString()} anchored protocol identit${visibleTotal === 1 ? 'y' : 'ies'} · ${value.complete === false ? 'discovery is incomplete' : 'sanitized canonical snapshot'}.`
		}
	}
	renderTopologyGroup(topologyUniverses, value.universes, source =>
		topologyRow(`Universe ${String(source['id'] ?? '—')}`, [source['parentUniverseId'] === undefined ? 'genesis' : `parent ${String(source['parentUniverseId'])}`, `${String(source['knownChildOutcomeCount'] ?? 0)} child routes`, topologyIdentifierFact('REP', stringValue(source['repToken']), 'universe REP token')]),
	)
	renderTopologyGroup(topologyPools, value.pools, source =>
		topologyRow(topologyIdentifier(stringValue(source['address']), 'Pool unavailable', 'security pool address'), [
			`universe ${String(source['universeId'] ?? '—')}`,
			`state ${String(source['systemState'] ?? '—')}`,
			`${String(source['vaultCount'] ?? 0)} vaults${source['awaitingForkContinuation'] === true ? ' · fork continuation pending' : ''}`,
		]),
	)
	renderTopologyGroup(topologyReports, value.reports, source =>
		topologyRow(`Report ${String(source['reportId'] ?? '—')}`, [
			topologyIdentifierFact('Token 1', stringValue(source['token1']), 'report token 1'),
			topologyIdentifierFact('Token 2', stringValue(source['token2']), 'report token 2'),
			`settlement ${String(source['settlementTime'] ?? '—')}`,
			`flags ${String(source['flags'] ?? '—')}`,
		]),
	)
	renderTopologyGroup(topologyAuctions, value.auctions, source =>
		topologyRow(topologyIdentifier(stringValue(source['address']), 'Auction unavailable', 'truth auction address'), [topologyIdentifierFact('Pool', stringValue(source['pool']), 'truth auction pool address'), source['finalized'] === true ? 'finalized' : 'active', `${String(source['bidCount'] ?? 0)} indexed bids`]),
	)
	renderTopologyGroup(topologyPairs, value.pairs, source =>
		topologyRow(topologyIdentifier(stringValue(source['address']), 'Pair unavailable', 'trading pair address'), [
			topologyIdentifierFact('Pool', stringValue(source['pool']), 'trading pair pool address'),
			`universe ${String(source['universeId'] ?? '—')}`,
			`status ${String(source['status'] ?? '—')}`,
			`${String(source['feeBps'] ?? '—')} bps`,
		]),
	)
}

function renderRecovery(value: Snapshot) {
	pendingCount.textContent = value.pendingTransactions.length.toString()
	obligationCount.textContent = value.obligations.length.toString()
	obligationFields.disabled = value.paused !== true || value.obligations.length === 0
	workflowFields.disabled = value.paused !== true || value.currentWorkflow?.status !== 'waiting-continuation'
	const selectedObligation = obligationIdInput.value
	obligationIdInput.replaceChildren(
		...value.obligations.map(obligation => {
			const option = document.createElement('option')
			option.value = obligation.id ?? ''
			option.textContent = `${obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'} · ${statusLabel(obligation.status ?? 'pending')}`
			return option
		}),
	)
	if (value.obligations.some(obligation => obligation.id === selectedObligation)) {
		obligationIdInput.value = selectedObligation
	}
	replacementFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.cancellationHash !== undefined
	cancellationFields.disabled = value.paused !== true || value.pendingTransactions.length !== 1 || value.pendingTransactions[0]?.replacementHash !== undefined
	const queuedCandidate = value.pendingTransactions[0]?.replacementHash ?? value.pendingTransactions[0]?.cancellationHash
	candidateFields.disabled = value.paused !== true || queuedCandidate === undefined
	if (value.pendingTransactions.length === 0) {
		pendingTransactions.className = 'stack-list empty-state'
		pendingTransactions.textContent = 'No transaction requires confirmation.'
	} else {
		pendingTransactions.className = 'stack-list'
		pendingTransactions.replaceChildren(
			...value.pendingTransactions.map(transaction => {
				const row = node('div', 'stack-row')
				const copy = node('div')
				copy.append(node('strong', undefined, transaction.label ?? transaction.operationId ?? 'Pending transaction'))
				copy.append(identifierLine(`Nonce ${String(transaction.nonce ?? '—')} ·`, transaction.hash, 'pending transaction hash'))
				if (transaction.replacementHash !== undefined) {
					copy.append(identifierLine('Replacement queued ·', transaction.replacementHash, 'replacement transaction hash'))
				}
				if (transaction.cancellationHash !== undefined) {
					copy.append(identifierLine('Cancellation queued ·', transaction.cancellationHash, 'cancellation transaction hash'))
				}
				if (transaction.recoveryBlocker !== undefined) {
					copy.append(node('small', 'warning-text', transaction.recoveryBlocker))
				}
				const status = node('span')
				setBadge(status, statusLabel(transaction.status ?? 'pending'), statusTone(transaction.status ?? 'pending'))
				row.append(copy, status)
				return row
			}),
		)
	}
	if (value.obligations.length === 0) {
		obligations.className = 'stack-list empty-state'
		obligations.textContent = 'No follow-up obligation is due.'
	} else {
		obligations.className = 'stack-list'
		obligations.replaceChildren(
			...value.obligations.map(obligation => {
				const row = node('div', 'stack-row')
				const copy = node('div')
				copy.append(node('strong', undefined, obligation.label ?? obligation.operationId ?? 'Lifecycle obligation'))
				copy.append(node('small', undefined, `${ecosystemLabel(obligation.ecosystem)} · due ${formatDate(obligation.dueAt)}`))
				const status = node('span')
				setBadge(status, statusLabel(obligation.status ?? 'pending'), statusTone(obligation.status ?? 'pending'))
				row.append(copy, status)
				return row
			}),
		)
	}
	if (value.activities.length === 0) {
		activityList.replaceChildren(node('li', 'empty-state', 'No activity recorded.'))
	} else {
		activityList.replaceChildren(
			...value.activities.map(activity => {
				const row = node('li', 'timeline-item')
				row.append(node('time', 'timeline-time', formatDate(activity.at)))
				const main = node('div', 'timeline-main')
				main.append(node('strong', undefined, activity.label ?? activity.operationId ?? 'Bot activity'))
				if (activity.summary !== undefined) main.append(node('span', 'timeline-detail', activity.summary))
				if (activity.txHash !== undefined) {
					const identifier = node('div', 'activity-identifier')
					identifier.append(compactIdentifier(activity.txHash, 'activity transaction hash'))
					main.append(identifier)
				}
				const status = node('span')
				setBadge(status, statusLabel(activity.status ?? 'info'), statusTone(activity.status))
				row.append(main, status)
				return row
			}),
		)
	}
}

function renderAlerts(value: Snapshot) {
	const messages = value.alerts.flatMap(alert => (alert.message === undefined ? [] : [alert.message]))
	if (messages.length === 0) {
		operatorAlerts.classList.add('hidden')
		operatorAlerts.replaceChildren()
		return
	}
	operatorAlerts.classList.remove('hidden')
	operatorAlerts.replaceChildren(...messages.map(message => node('li', undefined, message)))
}

function renderSnapshot(value: Snapshot) {
	renderHeader(value)
	renderOverview(value)
	renderCatalog(value.operationEvaluations)
	renderEcosystems(value.operationEvaluations)
	renderTopology(value.topology)
	renderRecovery(value)
	renderAlerts(value)
	renderCountdown()
	applyMutationControlLatches()
}

function renderCountdown() {
	const value = snapshot
	if (value === undefined) return
	if (value.paused === true) {
		countdown.textContent = 'Paused'
		countdownProgress.style.width = '0%'
		setBadge(schedulerState, 'Scheduling stopped', 'warning')
		return
	}
	if (value.scheduler.nextRunAt === undefined) {
		countdown.textContent = value.scheduler.due === true ? 'Due now' : 'Waiting'
		countdownProgress.style.width = value.scheduler.due === true ? '100%' : '0%'
		setBadge(schedulerState, value.scheduler.status === undefined ? 'Not scheduled' : statusLabel(value.scheduler.status), value.scheduler.due === true ? 'warning' : 'neutral')
		return
	}
	const nextTimestamp = new Date(value.scheduler.nextRunAt).getTime()
	if (!Number.isFinite(nextTimestamp)) {
		countdown.textContent = '—'
		setBadge(schedulerState, 'Invalid schedule', 'error')
		return
	}
	const remainingSeconds = Math.max(0, Math.ceil((nextTimestamp - Date.now()) / 1_000))
	countdown.textContent = remainingSeconds === 0 ? 'Due now' : formatDuration(remainingSeconds)
	const totalSeconds = parsePositiveNumber(value.scheduler.lastDelaySeconds)
	let elapsedFraction = remainingSeconds === 0 ? 1 : 0
	if (totalSeconds !== undefined && totalSeconds !== 0) elapsedFraction = Math.min(1, Math.max(0, 1 - remainingSeconds / totalSeconds))
	countdownProgress.style.width = `${(elapsedFraction * 100).toFixed(1)}%`
	let schedulerLabel = value.scheduler.status === undefined ? 'Scheduled' : statusLabel(value.scheduler.status)
	if (remainingSeconds === 0) schedulerLabel = 'Selecting operation'
	setBadge(schedulerState, schedulerLabel, remainingSeconds === 0 ? 'warning' : 'success')
}

function renderConfiguration(value: Configuration, force = false) {
	if (value.configurationCommitIndeterminate === true) latchConfigurationCommitIndeterminate()
	const policyEditable = value.paused === true && snapshot?.paused === true && !settingsMutationUnreconciled && !configurationCommitIndeterminate
	settingsFields.disabled = !policyEditable
	settingsPauseNote.classList.toggle('hidden', policyEditable)
	signerFields.disabled = signerMutationUnreconciled || configurationCommitIndeterminate
	const network = value.network ?? snapshot?.network ?? 'Network unknown'
	let networkTone: Parameters<typeof setBadge>[2] = 'success'
	if (value.networkConfigured === false) networkTone = 'warning'
	else if (value.network === undefined) networkTone = 'neutral'
	setBadge(networkBadge, value.chainId === undefined ? network : `${network} · ${String(value.chainId)}`, networkTone)
	settingsScope.textContent = value.chainId === undefined ? network : `${network} · chain ${String(value.chainId)}`
	settingsScope.className = 'badge neutral'
	const wallet = value.wallet ?? snapshot?.wallet
	signerSummary.replaceChildren()
	if (value.hasSigner === true) {
		if (wallet === undefined) signerSummary.append(node('span', undefined, 'Signer configured'))
		else signerSummary.append(compactIdentifier(wallet, 'transaction signer address'))
		signerSummary.append(node('span', 'signer-persistence', ` · ${value.rememberSigner === true ? 'remembered locally' : 'memory only'}`))
	} else signerSummary.textContent = 'No signer configured'
	rememberSignerInput.checked = value.rememberSigner === true
	if (settingsDirty && !force) {
		if (value.revision !== settingsRevision) {
			settingsConflict = true
			saveSettingsButton.disabled = true
			discardSettingsButton.disabled = false
			settingsSaveStatus.textContent = 'Configuration changed elsewhere. Discard these edits and reload before saving.'
		}
		return
	}
	settingsRevision = value.revision
	settingsConflict = false
	saveSettingsButton.disabled = false
	discardSettingsButton.disabled = true
	executeInput.checked = value.execute === true
	highRiskInput.checked = value.allowHighRiskOperations === true
	irreversibleInput.checked = value.allowIrreversibleOperations === true
	minDelayInput.value = String(value.minimumDelaySeconds ?? 60)
	maxDelayInput.value = String(value.maximumDelaySeconds ?? 3_600)
	reserveEthInput.value = String(value.minimumEthReserve ?? '0.05')
	reserveRepInput.value = String(value.minimumRepReserve ?? '10')
	maximumEthOperationInput.value = String(value.maximumEthPerOperation ?? '0.05')
	maximumGasCostInput.value = String(value.maximumGasCostEth ?? '0.02')
	maximumRepOperationInput.value = String(value.maximumRepPerOperation ?? '10')
	workflowValidBlocksInput.value = String(value.workflowValidForBlocks ?? 96)
	for (const toggle of document.querySelectorAll('[data-ecosystem-toggle]')) {
		if (!(toggle instanceof HTMLInputElement)) continue
		toggle.checked = value.enabledEcosystems.includes(toggle.dataset['ecosystemToggle'] ?? '')
	}
	applyMutationControlLatches()
}

function markRecoveryContextRefreshesLoading() {
	for (const context of pendingRecoveryContextRefreshes) {
		context.fields.disabled = true
		context.retryButton.classList.remove('hidden')
		context.retryButton.disabled = true
		context.retryButton.textContent = 'Refreshing…'
		context.status.textContent = `Loading the current ${context.name}…`
	}
}

function settleRecoveryContextRefreshes(value: Snapshot | undefined) {
	for (const context of pendingRecoveryContextRefreshes) {
		if (value === undefined) {
			context.fields.disabled = true
			context.retryButton.classList.remove('hidden')
			context.retryButton.disabled = false
			context.retryButton.textContent = 'Retry'
			context.status.textContent = `The current ${context.name} is unavailable because dashboard state could not be refreshed.`
			continue
		}
		context.retryButton.classList.add('hidden')
		context.retryButton.disabled = false
		context.retryButton.textContent = 'Retry'
		if (context.available(value)) context.status.textContent = context.loadedMessage
		else {
			context.fields.disabled = true
			context.status.textContent = context.missingMessage
		}
		pendingRecoveryContextRefreshes.delete(context)
	}
}

async function requestRecoveryContextRefresh(context: RecoveryContextRefresh) {
	pendingRecoveryContextRefreshes.add(context)
	context.fields.disabled = true
	context.status.textContent = `Loading the current ${context.name}…`
	await refresh()
}

function refresh() {
	if (refreshPromise !== undefined) return refreshPromise
	markRecoveryContextRefreshesLoading()
	refreshButton.disabled = true
	refreshButton.textContent = 'Refreshing…'
	rpcHealthRetryButton.disabled = true
	rpcHealthRetryButton.textContent = 'Refreshing…'
	let stateAvailable = false
	let configurationAvailable = false
	refreshPromise = (async () => {
		const [stateResult, configurationResult] = await Promise.allSettled([requestJson('/api/state', stateRequestTimeoutMilliseconds), requestJson('/api/configuration', configurationRequestTimeoutMilliseconds)])
		if (stateResult.status === 'fulfilled') {
			snapshot = parseSnapshot(stateResult.value)
			renderSnapshot(snapshot)
			stateAvailable = true
			globalError.classList.add('hidden')
			settleRecoveryContextRefreshes(snapshot)
		} else {
			renderUnavailableRpcHealth(snapshot !== undefined)
			globalError.textContent = stateResult.reason instanceof Error ? stateResult.reason.message : 'Dashboard state is unavailable.'
			globalError.classList.remove('hidden')
			settleRecoveryContextRefreshes(undefined)
		}
		if (configurationResult.status === 'fulfilled') {
			configuration = parseConfiguration(configurationResult.value)
			renderConfiguration(configuration)
			configurationAvailable = true
			if (!configurationCommitIndeterminate) configurationStatus.classList.add('hidden')
		} else {
			settingsFields.disabled = true
			configurationStatus.textContent = configurationResult.reason instanceof Error ? configurationResult.reason.message : 'Configuration is unavailable.'
			configurationStatus.className = 'notice error'
		}
		if (stateAvailable && configurationAvailable) {
			resolveMutationReconciliations()
		}
		applyMutationControlLatches()
		return { configurationAvailable, stateAvailable }
	})().finally(() => {
		refreshPromise = undefined
		refreshButton.disabled = false
		refreshButton.textContent = stateAvailable ? 'Refresh' : 'Retry'
		rpcHealthRetryButton.disabled = false
		rpcHealthRetryButton.textContent = 'Retry'
	})
	return refreshPromise
}

async function reconcileUnknownMutation(error: unknown, status: HTMLElement, scope: 'configuration and state' | 'state', target?: MutationReconciliationTarget) {
	if (error instanceof Error && error.name === 'ConfigurationCommitIndeterminate') {
		latchConfigurationCommitIndeterminate(status, error.message)
		return { handled: true, reconciled: false }
	}
	if (!(error instanceof Error) || error.name !== 'MutationOutcomeUnknown') return { handled: false, reconciled: false }
	if (target !== undefined) setMutationReconciliationPending(target)
	status.textContent = `${error.message} Controls remain frozen while the dashboard reloads current ${scope}.`
	const activeRefresh = refreshPromise
	if (activeRefresh !== undefined) await activeRefresh
	const result = await refresh()
	const reconciled = scope === 'state' ? result.stateAvailable : result.configurationAvailable && result.stateAvailable
	const verb = scope === 'configuration and state' ? 'were' : 'was'
	status.textContent = reconciled ? `The request outcome was unknown. Current ${scope} ${verb} reloaded; review it before another mutation.` : `The request outcome is still unknown because current ${scope} could not be reloaded. Controls remain frozen; retry the dashboard refresh.`
	return { handled: true, reconciled }
}

async function put(path: string, value: unknown) {
	const body = JSON.stringify(value)
	if (body === undefined) throw new Error('Dashboard mutation body is not serializable')
	return await requestJson(path, configurationRequestTimeoutMilliseconds, {
		body,
		headers: { 'content-type': 'application/json' },
		method: 'PUT',
	})
}

async function mutatePaused(paused: boolean) {
	pauseMutationPending = true
	pauseStatus.textContent = paused ? 'Pausing…' : 'Resuming…'
	if (snapshot !== undefined) renderHeader(snapshot)
	try {
		await put('/api/paused', { paused, revision: configuration?.revision })
		pauseStatus.textContent = paused ? 'Pause saved.' : 'Resume saved.'
		await refresh()
	} catch (error) {
		const reconciliation = await reconcileUnknownMutation(error, pauseStatus, 'configuration and state', 'pause')
		if (!reconciliation.handled) pauseStatus.textContent = error instanceof Error ? error.message : 'Pause control failed.'
		else pauseMutationUnreconciled = !reconciliation.reconciled
	} finally {
		pauseMutationPending = false
		if (snapshot !== undefined) renderHeader(snapshot)
	}
}

function openResumeDialog() {
	const value = snapshot
	if (value === undefined) return
	const executable = value.operationEvaluations.filter(operationIsIndependentlyExecutable)
	const eligible = executable.filter(operation => operation.enabled !== false && operation.eligible === true).length
	const signerDetail = value.signerReady === true && value.wallet !== undefined ? compactIdentifier(value.wallet, 'recovery signer address') : 'Missing'
	const rows: [string, HTMLElement | string][] = [
		['Mode', value.execute === true ? 'Live execution' : 'Dry run'],
		['Signer', signerDetail],
		['Eligible operations', `${eligible.toString()} of ${executable.length.toString()}`],
		['Recovery items', (value.pendingTransactions.length + value.obligations.length).toString()],
	]
	resumePreflight.replaceChildren(
		...rows.map(([label, detail]) => {
			const row = node('li')
			const detailValue = node('strong')
			detailValue.append(typeof detail === 'string' ? document.createTextNode(detail) : detail)
			row.append(node('span', undefined, label), detailValue)
			return row
		}),
	)
	resumeDialog.showModal()
}

function parseDelay(input: HTMLInputElement, name: string) {
	const value = Number(input.value)
	if (!Number.isInteger(value) || value < 60 || value > 3_600) throw new Error(`${name} must be a whole number from 60 through 3600 seconds.`)
	return value
}

function parseReserve(input: HTMLInputElement, name: string) {
	const value = input.value.trim()
	if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) throw new Error(`${name} must be a non-negative decimal amount.`)
	return value
}

let currentSectionLink: HTMLAnchorElement | undefined
for (const link of document.querySelectorAll('.section-nav a')) {
	if ((link instanceof HTMLAnchorElement && new URL(link.href).pathname === window.location.pathname.replace(/\/$/, '')) || (window.location.pathname === '/' && link instanceof HTMLAnchorElement && new URL(link.href).pathname === '/overview')) {
		link.setAttribute('aria-current', 'page')
		currentSectionLink = link
	}
}

if (currentSectionLink !== undefined) {
	const link = currentSectionLink
	window.requestAnimationFrame(() => {
		const navigation = link.closest('.section-nav')
		if (!(navigation instanceof HTMLElement)) return
		const navigationBounds = navigation.getBoundingClientRect()
		const linkBounds = link.getBoundingClientRect()
		const centeredScrollLeft = navigation.scrollLeft + linkBounds.left - navigationBounds.left - (navigation.clientWidth - linkBounds.width) / 2
		const maximumScrollLeft = Math.max(0, navigation.scrollWidth - navigation.clientWidth)
		navigation.scrollLeft = Math.min(maximumScrollLeft, Math.max(0, centeredScrollLeft))
	})
}

refreshButton.addEventListener('click', () => void refresh())
rpcHealthRetryButton.addEventListener('click', () => void refresh())
for (const context of recoveryContexts) context.retryButton.addEventListener('click', () => void requestRecoveryContextRefresh(context))
catalogFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
catalogClassificationFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
catalogEligibilityFilter.addEventListener('change', () => {
	if (snapshot !== undefined) renderCatalog(snapshot.operationEvaluations)
})
pauseButton.addEventListener('click', () => {
	if (snapshot?.paused === true) openResumeDialog()
	else void mutatePaused(true)
})
cancelResume.addEventListener('click', () => resumeDialog.close())
confirmResume.addEventListener('click', () => {
	resumeDialog.close()
	void mutatePaused(false)
})

replacementForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intentHash = snapshot?.pendingTransactions[0]?.hash
		const replacementHash = replacementHashInput.value.trim()
		if (snapshot?.paused !== true) {
			replacementStatus.textContent = 'Pause the bot before queuing verification.'
			return
		}
		if (intentHash === undefined) {
			await requestRecoveryContextRefresh(replacementRecoveryContext)
			return
		}
		if (!/^0x[0-9a-fA-F]{64}$/.test(replacementHash)) {
			replacementStatus.textContent = 'Enter a 32-byte transaction hash.'
			return
		}
		replacementFields.disabled = true
		replacementStatus.textContent = 'Queuing verification…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/replacement', {
				intentHash,
				replacementHash,
			})
			replacementHashInput.value = ''
			replacementStatus.textContent = 'Replacement verification queued.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, replacementStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) replacementStatus.textContent = error instanceof Error ? error.message : 'Could not queue replacement verification.'
		} finally {
			replacementFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.cancellationHash !== undefined
		}
	})()
})

cancellationForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intentHash = snapshot?.pendingTransactions[0]?.hash
		const cancellationHash = cancellationHashInput.value.trim()
		if (snapshot?.paused !== true) {
			cancellationStatus.textContent = 'Pause the bot before queuing cancellation verification.'
			return
		}
		if (intentHash === undefined) {
			await requestRecoveryContextRefresh(cancellationRecoveryContext)
			return
		}
		if (!/^0x[0-9a-fA-F]{64}$/.test(cancellationHash)) {
			cancellationStatus.textContent = 'Enter a 32-byte transaction hash.'
			return
		}
		const reason = cancellationReasonInput.value.trim()
		if (reason.length < 12) {
			cancellationStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		cancellationFields.disabled = true
		cancellationStatus.textContent = 'Queuing verification…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/cancellation', {
				cancellationHash,
				confirmation: cancellationConfirmationInput.value,
				intentHash,
				reason,
			})
			cancellationHashInput.value = ''
			cancellationReasonInput.value = ''
			cancellationConfirmationInput.value = ''
			cancellationStatus.textContent = 'Nonce cancellation verification queued.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, cancellationStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) cancellationStatus.textContent = error instanceof Error ? error.message : 'Could not queue nonce cancellation verification.'
		} finally {
			cancellationFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.pendingTransactions.length !== 1 || snapshot.pendingTransactions[0]?.replacementHash !== undefined
		}
	})()
})

candidateForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const intent = snapshot?.pendingTransactions[0]
		const expectedCandidateHash = intent?.replacementHash ?? intent?.cancellationHash
		if (snapshot?.paused !== true) {
			candidateStatus.textContent = 'Pause the bot before clearing a recovery candidate.'
			return
		}
		if (intent?.hash === undefined || expectedCandidateHash === undefined) {
			await requestRecoveryContextRefresh(candidateRecoveryContext)
			return
		}
		const reason = candidateReasonInput.value.trim()
		if (reason.length < 12) {
			candidateStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		candidateFields.disabled = true
		candidateStatus.textContent = 'Clearing candidate…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/candidate', {
				confirmation: candidateConfirmationInput.value,
				expectedCandidateHash,
				intentHash: intent.hash,
				reason,
			})
			candidateReasonInput.value = ''
			candidateConfirmationInput.value = ''
			candidateStatus.textContent = 'Recovery candidate cleared.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, candidateStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) candidateStatus.textContent = error instanceof Error ? error.message : 'Could not clear the recovery candidate.'
		} finally {
			const candidate = snapshot?.pendingTransactions[0]?.replacementHash ?? snapshot?.pendingTransactions[0]?.cancellationHash
			candidateFields.disabled = !mutationReconciled || snapshot?.paused !== true || candidate === undefined
		}
	})()
})

workflowForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const workflow = snapshot?.currentWorkflow
		if (snapshot?.paused !== true) {
			workflowStatus.textContent = 'Pause the bot before workflow reconciliation.'
			return
		}
		if (workflow?.status !== 'waiting-continuation' || workflow.id === undefined || workflow.updatedAt === undefined) {
			await requestRecoveryContextRefresh(workflowRecoveryContext)
			return
		}
		const reason = workflowReasonInput.value.trim()
		if (reason.length < 12) {
			workflowStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		workflowFields.disabled = true
		workflowStatus.textContent = 'Saving reconciliation…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/workflow', {
				action: 'abandon',
				confirmation: workflowConfirmationInput.value,
				reason,
				updatedAt: workflow.updatedAt,
				workflowId: workflow.id,
			})
			workflowReasonInput.value = ''
			workflowConfirmationInput.value = ''
			workflowStatus.textContent = 'Partial workflow abandonment saved.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, workflowStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) workflowStatus.textContent = error instanceof Error ? error.message : 'Partial workflow reconciliation failed.'
		} finally {
			workflowFields.disabled = !mutationReconciled || snapshot?.paused !== true || snapshot.currentWorkflow?.status !== 'waiting-continuation'
		}
	})()
})

function renderObligationConfirmationHelp() {
	const confirmation = obligationActionInput.value === 'abandon' ? 'ABANDON OBLIGATION' : 'RETRY VERIFIED SAFE FAILURE'
	obligationConfirmationHelp.textContent = `Type ${confirmation}. ${obligationActionInput.value === 'abandon' ? 'This creates a permanent tombstone and transfers responsibility to the operator.' : 'Retry is limited to unsigned failures, finalized reverts, and verified nonce cancellations; semantic uncertainty still requires manual reconciliation.'}`
}

obligationActionInput.addEventListener('change', renderObligationConfirmationHelp)
renderObligationConfirmationHelp()
obligationForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const obligation = snapshot?.obligations.find(candidate => candidate.id === obligationIdInput.value)
		if (snapshot?.paused !== true) {
			obligationStatus.textContent = 'Pause the bot before lifecycle reconciliation.'
			return
		}
		if (obligation?.id === undefined || obligation.updatedAt === undefined) {
			await requestRecoveryContextRefresh(obligationRecoveryContext)
			return
		}
		const action = obligationActionInput.value
		if (action !== 'retry' && action !== 'abandon') {
			obligationStatus.textContent = 'Choose a valid lifecycle action.'
			return
		}
		const reason = obligationReasonInput.value.trim()
		if (reason.length < 12) {
			obligationStatus.textContent = 'Enter a detailed audit reason (at least 12 characters).'
			return
		}
		obligationFields.disabled = true
		obligationStatus.textContent = 'Saving reconciliation…'
		let mutationReconciled = true
		try {
			await put('/api/reconciliation/obligation', {
				action,
				confirmation: obligationConfirmationInput.value,
				obligationId: obligation.id,
				reason,
				updatedAt: obligation.updatedAt,
			})
			obligationReasonInput.value = ''
			obligationConfirmationInput.value = ''
			obligationStatus.textContent = 'Lifecycle reconciliation saved.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, obligationStatus, 'state')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) obligationStatus.textContent = error instanceof Error ? error.message : 'Lifecycle reconciliation failed.'
		} finally {
			obligationFields.disabled = !mutationReconciled || snapshot?.paused !== true || (snapshot?.obligations.length ?? 0) === 0
		}
	})()
})

settingsFields.addEventListener('input', () => {
	settingsDirty = true
	discardSettingsButton.disabled = false
})
discardSettingsButton.addEventListener('click', () => {
	settingsDirty = false
	settingsConflict = false
	settingsSaveStatus.textContent = 'Local edits discarded. Current configuration loaded.'
	if (configuration !== undefined) renderConfiguration(configuration, true)
})
settingsForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		if (configuration?.paused !== true || snapshot?.paused !== true) {
			settingsSaveStatus.textContent = 'Pause the bot before changing execution policy.'
			settingsFields.disabled = true
			return
		}
		if (settingsConflict) {
			settingsSaveStatus.textContent = 'Discard these edits and review the current configuration before saving.'
			return
		}
		settingsFields.disabled = true
		settingsSaveStatus.textContent = 'Saving…'
		let mutationReconciled = true
		try {
			const minDelaySeconds = parseDelay(minDelayInput, 'Minimum delay')
			const maxDelaySeconds = parseDelay(maxDelayInput, 'Maximum delay')
			if (minDelaySeconds > maxDelaySeconds) throw new Error('Minimum delay cannot be greater than maximum delay.')
			const workflowValidForBlocks = Number(workflowValidBlocksInput.value)
			if (!Number.isSafeInteger(workflowValidForBlocks) || workflowValidForBlocks < 64 || workflowValidForBlocks > 1_000_000) throw new Error('Workflow validity must be a whole number from 64 through 1000000 blocks.')
			const enabledEcosystems = [...document.querySelectorAll('[data-ecosystem-toggle]')].flatMap(toggle => {
				if (!(toggle instanceof HTMLInputElement) || !toggle.checked || toggle.dataset['ecosystemToggle'] === undefined) return []
				return [toggle.dataset['ecosystemToggle']]
			})
			if (enabledEcosystems.length === 0) throw new Error('Enable at least one ecosystem.')
			await put('/api/settings', {
				revision: settingsRevision,
				patch: {
					runtime: { execute: executeInput.checked },
					scheduler: { maximumDelaySeconds: maxDelaySeconds, minimumDelaySeconds: minDelaySeconds },
					strategy: {
						allowHighRiskOperations: highRiskInput.checked,
						allowIrreversibleOperations: irreversibleInput.checked,
						enabledEcosystems,
						maximumEthPerOperation: parseReserve(maximumEthOperationInput, 'Maximum ETH per operation'),
						maximumGasCostEth: parseReserve(maximumGasCostInput, 'Maximum gas cost'),
						maximumRepPerOperation: parseReserve(maximumRepOperationInput, 'Maximum REP per operation'),
						minimumEthReserve: parseReserve(reserveEthInput, 'ETH reserve'),
						minimumRepReserve: parseReserve(reserveRepInput, 'REP reserve'),
						workflowValidForBlocks,
					},
				},
			})
			settingsDirty = false
			settingsConflict = false
			settingsSaveStatus.textContent = 'Execution policy saved.'
			await refresh()
			if (configuration !== undefined) renderConfiguration(configuration, true)
		} catch (error) {
			if (error instanceof Error && error.name === 'ConfigurationRevisionConflict') {
				settingsConflict = true
				saveSettingsButton.disabled = true
				discardSettingsButton.disabled = false
				await refresh()
			}
			const reconciliation = await reconcileUnknownMutation(error, settingsSaveStatus, 'configuration and state', 'settings')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (reconciliation.handled) {
				settingsConflict = true
				saveSettingsButton.disabled = true
				discardSettingsButton.disabled = false
			} else settingsSaveStatus.textContent = error instanceof Error ? error.message : 'Settings could not be saved.'
		} finally {
			settingsFields.disabled = !mutationReconciled || configuration === undefined || configuration.paused !== true || snapshot?.paused !== true
		}
	})()
})

signerForm.addEventListener('submit', event => {
	event.preventDefault()
	void (async () => {
		const privateKey = privateKeyInput.value.trim()
		if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
			signerStatus.textContent = 'Enter a 32-byte 0x-prefixed private key.'
			return
		}
		signerFields.disabled = true
		signerStatus.textContent = 'Updating signer…'
		const remember = rememberSignerInput.checked
		privateKeyInput.value = ''
		let mutationReconciled = true
		try {
			await put('/api/signer', { privateKey, remember, revision: configuration?.revision })
			signerStatus.textContent = 'Signer updated. The input was cleared.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, signerStatus, 'configuration and state', 'signer')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) signerStatus.textContent = error instanceof Error ? error.message : 'Signer could not be updated.'
		} finally {
			privateKeyInput.value = ''
			signerFields.disabled = !mutationReconciled
		}
	})()
})

clearSignerButton.addEventListener('click', () => {
	void (async () => {
		signerFields.disabled = true
		signerStatus.textContent = 'Clearing signer…'
		let mutationReconciled = true
		try {
			await put('/api/signer', { privateKey: null, remember: false, revision: configuration?.revision })
			privateKeyInput.value = ''
			rememberSignerInput.checked = false
			signerStatus.textContent = 'Signer cleared. Execution remains blocked until a signer is configured.'
			await refresh()
		} catch (error) {
			const reconciliation = await reconcileUnknownMutation(error, signerStatus, 'configuration and state', 'signer')
			mutationReconciled = !reconciliation.handled || reconciliation.reconciled
			if (!reconciliation.handled) signerStatus.textContent = error instanceof Error ? error.message : 'Signer could not be cleared.'
		} finally {
			signerFields.disabled = !mutationReconciled
		}
	})()
})

window.setInterval(renderCountdown, 1_000)
window.setInterval(() => void refresh(), stateRefreshMilliseconds)
void refresh()
