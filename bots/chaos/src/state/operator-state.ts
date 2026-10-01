import { compactDurableState, MAXIMUM_ACTIVITY_COUNT, MAXIMUM_OBLIGATION_TOMBSTONE_COUNT } from './durable-compaction.ts'
export { MAXIMUM_OBLIGATION_TOMBSTONE_COUNT } from './durable-compaction.ts'
import { assertIncludedTransactionWorkflows, parseRollbackQueue, serializedRollbackQueue, type RollbackQueuedTransaction, parseIncludedTransactions, serializedIncludedTransactions, serializedTransactionIntent, type IncludedTransaction } from './included-transactions.ts'
import type { RuntimeState } from './runtime-state.ts'
export type { RuntimeState, RuntimeTopologySummary, WalletBalanceState } from './runtime-state.ts'
import { link, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseJsonDocument, readOwnerFile, serializeWritesToPath, writeBoundedFileAtomically } from '@zoltar/bot-shared/config/durable-file'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '#monitoring/protocol-index'
import type { ChaosEcosystem, OperationContinuationDisposition, OperationEvidence, OperationPreflightCall, OperationRisk, OperationTerminalSubmission, OperationWalletAssetDebit } from '#operations/types'
import { parseActivity, parseLifecyclePresenceBlocker, parseScheduler } from './durable-record-parsers.ts'
import { parseObligation, parseObligationTombstone, parseWorkflow } from './durable-workflow-parsers.ts'
import { DURABLE_STATE_VERSION, initialDurableState, initialRuntimeState } from './initial-state.ts'
import { parsePendingTransaction } from './pending-transaction-intent.ts'
import { assertSafeRetirementRecipient, initialRetirementState, parseRetirementState, type DurableRetirementState } from './retirement.ts'
import type { PendingTransactionObservation } from './pending-transaction-observation.ts'
import { serializedScheduler } from './state-serialization.ts'
import { assertExactKeys, identifier, nonemptyString, requiredRecord } from './validators.ts'
import { loadPersistedProtocolIndex, parseProtocolIndexReference, persistProtocolIndexGeneration, pruneProtocolIndexGenerations, snapshotProtocolIndex, type ProtocolIndexFilesystem, type ProtocolIndexReference } from './protocol-index-store.ts'

const MAXIMUM_STATE_BYTES = 5 * 1024 * 1024

export type Activity = {
	at: string
	details?: string | undefined
	ecosystem?: ChaosEcosystem | undefined
	hash?: Hex | undefined
	message: string
	operationId?: string | undefined
	status: 'confirmed' | 'dry-run' | 'failed' | 'info' | 'pending' | 'skipped'
	summary?: string | undefined
	type: 'configuration' | 'discovery' | 'error' | 'operation' | 'recovery' | 'scheduler' | 'transaction' | 'wallet'
}

export type SchedulerState = {
	lastDelaySeconds: number | undefined
	lastRunAt: string | undefined
	nextRunAt: string | undefined
	selectedOperationId: string | undefined
	status: 'due' | 'idle' | 'paused' | 'running' | 'scheduled'
}

export type DurableMetadata = Record<string, boolean | number | string>

export type DurableLifecyclePresenceBlocker = {
	/** Retained log boundary for an ordinary-identity blocker observed in partial-history mode. */
	historyStartBlock?: string
	requiresCarryHistory?: true
	count: number
	digest: Hex
	firstDefinitionId: string
	firstEcosystem: ChaosEcosystem
	observedAtBlock: string
	presenceComplete: boolean
	reason: 'completed-identity-returned' | 'unplanned-due-identity'
}

export type DurableWorkflowFailureKind = 'nonce-cancelled' | 'receipt-reverted' | 'semantic-failure'

export type DurableWorkflowStep = {
	confirmedAt?: string | undefined
	data: Hex
	evidence: readonly OperationEvidence[]
	failure?: string | undefined
	failureKind?: DurableWorkflowFailureKind | undefined
	gasLimit: string
	id: string
	label: string
	preflightCalls: OperationPreflightCall[]
	startedAt?: string | undefined
	status: 'blocked' | 'confirmed' | 'failed' | 'planned' | 'signed' | 'submitted'
	to: Address
	transactionHash?: Hex | undefined
	transactionIntentId?: string | undefined
	value: string
	walletAssetDebits: OperationWalletAssetDebit[]
}

export type DurableWorkflow = {
	classification: 'lifecycle-obligation' | 'selectable'
	completedAt?: string | undefined
	continuationDisposition?: OperationContinuationDisposition | undefined
	createdAtBlock: string
	createdAt: string
	deadlineTimestamp?: string | undefined
	ecosystem: ChaosEcosystem
	id: string
	label: string
	lastValidBlockNumber?: string | undefined
	maximumCleanupTransactionCount?: number | undefined
	semanticDeadlineBlockNumber?: string | undefined
	metadata: DurableMetadata
	operationId: string
	obligation: boolean
	planId: string
	planningSeed: number
	operationInputs?: Record<string, string>
	inputSources?: Record<string, 'custom' | 'chaosbot'>
	postconditions: string[]
	priority: 'random' | 'urgent'
	risk: OperationRisk
	startedAt?: string | undefined
	status: 'abandoned' | 'blocked' | 'completed' | 'failed' | 'planned' | 'running' | 'waiting-continuation' | 'waiting-obligation' | 'waiting-transaction'
	steps: DurableWorkflowStep[]
	terminalSubmission?: OperationTerminalSubmission | undefined
	updatedAt: string
}

export type DurableObligation = {
	/** Distinct canonically included retryable failures that consumed the bounded automatic retry budget. */
	automaticRetryCount: number
	attemptCount: number
	blockers: string[]
	completedAt?: string | undefined
	createdAt: string
	dueAt?: string | undefined
	ecosystem: ChaosEcosystem
	expiresAt?: string | undefined
	id: string
	label: string
	lastAttemptAt?: string | undefined
	lastError?: string | undefined
	metadata: DurableMetadata
	notBefore?: string | undefined
	operationId: string
	resolvedAt?: string | undefined
	resolutionReason?: string | undefined
	status: 'abandoned' | 'blocked' | 'completed' | 'deferred' | 'executing' | 'failed' | 'pending'
	updatedAt: string
	workflowId: string
}

export type DurableObligationTombstone = {
	id: string
	lastSeenBlock?: string | undefined
	observedAbsentAtBlock?: string | undefined
	resolution: 'abandoned' | 'completed'
	resolvedAt: string
	resolvedAtBlock: string
	resolutionReason?: string | undefined
}

type TransactionSemanticExpectation = {
	balanceBaselines: readonly {
		account: Address
		asset: 'ETH' | Address
		balance: string
	}[]
	evidence: readonly OperationEvidence[]
	postconditions: readonly string[]
	storageBaselines: readonly {
		args: readonly (boolean | string)[]
		contract: Address
		functionName: string
		value: string
	}[]
}

export type PendingTransactionIntent = {
	cancellationHash?: Hex | undefined
	data: Hex
	hash: Hex
	id: string
	label: string
	maxBlockNumber: bigint
	mode: 'private' | 'public'
	nonce: bigint
	observation?: PendingTransactionObservation | undefined
	operationId: string
	recoveryBlocker?: string | undefined
	replacementHash?: Hex | undefined
	semanticExpectation: TransactionSemanticExpectation
	sender: Address
	serializedTransaction: Hex
	signedAt: string
	status: 'confirmation-unknown' | 'signed' | 'submitted'
	stepId: string
	submissionBlock?: bigint | undefined
	submittedAt?: string | undefined
	to: Address
	value: bigint
	workflowId: string
}

export type DurableState = {
	includedTransactions: IncludedTransaction[]
	rollbackQueue: RollbackQueuedTransaction[]
	activities: Activity[]
	chainId: number
	lifecyclePresenceBlocker: DurableLifecyclePresenceBlocker | undefined
	obligationTombstones: DurableObligationTombstone[]
	obligations: DurableObligation[]
	pendingTransactions: PendingTransactionIntent[]
	profileId: string
	uniswapV3Factory?: Address | undefined
	protocolIndex: ChaosProtocolIndex | undefined
	retirement: DurableRetirementState
	safetyPaused: boolean
	scheduler: SchedulerState
	signerAddress: Address | undefined
	version: 4
	workflows: DurableWorkflow[]
}

export type StateFilesystem = ProtocolIndexFilesystem

const stateFilesystem: StateFilesystem = {
	link,
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm,
}

export function setRuntimeExecutionAddress(state: RuntimeState, address: Address | undefined) {
	if (state.wallet?.toLowerCase() !== address?.toLowerCase() || (state.inventoryAddress !== undefined && state.inventoryAddress.toLowerCase() !== address?.toLowerCase())) {
		state.inventory = { eth: '0', rep: [], weth: '0' }
		state.inventoryAddress = undefined
		state.evaluations = []
	}
	state.wallet = address
}

export function bindRuntimeStateToSigner(state: RuntimeState, address: Address) {
	if (state.retirement.recipient !== undefined) assertSafeRetirementRecipient(state.retirement.recipient, address)
	if (state.signerAddress !== undefined && state.signerAddress.toLowerCase() !== address.toLowerCase()) {
		throw new Error(`Durable runtime is scoped to signer ${state.signerAddress}, not ${address}`)
	}
	const firstBinding = state.signerAddress === undefined
	if (firstBinding) {
		state.evaluations = []
		state.inventory = { eth: '0', rep: [], weth: '0' }
		state.inventoryAddress = undefined
		state.lastScanAt = undefined
		state.lastScannedBlock = undefined
		state.topology = undefined
		state.warnings = []
	}
	state.signerAddress = address
	setRuntimeExecutionAddress(state, address)
	const indexInvalidated = state.protocolIndex !== undefined && state.protocolIndex.wallet.toLowerCase() !== address.toLowerCase()
	if (indexInvalidated) state.protocolIndex = undefined
	return { firstBinding, indexInvalidated }
}

export async function loadRuntimeState(path: string, paused: boolean, wallet: Address | undefined, chainId: number, filesystem: StateFilesystem = stateFilesystem) {
	return initialRuntimeState(paused, wallet, chainId, await loadDurableState(path, chainId, filesystem))
}

export function resetRuntimeStateForProfile(state: RuntimeState, profileId: string, paused: boolean, wallet: Address | undefined) {
	const safetyPaused = state.safetyPaused
	const replacement = initialRuntimeState(paused || safetyPaused, wallet, state.chainId, initialDurableState(state.chainId, paused, profileId, wallet))
	replacement.safetyPaused = safetyPaused
	replacement.uniswapV3Factory = undefined
	Object.assign(state, replacement)
	return state
}

type PrevalidatedProtocolIndex = {
	index: ChaosProtocolIndex | undefined
	reference: ProtocolIndexReference | undefined
}

async function durableProtocolIndex(value: unknown, statePath: string, expectedChainId: number, filesystem: StateFilesystem, prevalidated: PrevalidatedProtocolIndex | undefined) {
	if (prevalidated === undefined) return loadPersistedProtocolIndex(value, statePath, expectedChainId, filesystem)
	if (prevalidated.reference === undefined) {
		if (value !== null || prevalidated.index !== undefined) throw new Error('Validated protocol index does not match the absent main-state reference')
		return undefined
	}
	if (prevalidated.index === undefined) throw new Error('Validated protocol index reference is missing its in-memory index')
	const reference = parseProtocolIndexReference(value)
	if (reference.manifestDigest !== prevalidated.reference.manifestDigest) throw new Error('Validated protocol index does not match the main-state reference')
	if (prevalidated.index.chainId !== expectedChainId) throw new Error(`Validated protocol index belongs to chain ${prevalidated.index.chainId.toString()}, expected chain ${expectedChainId.toString()}`)
	return prevalidated.index
}

async function loadDurableStateFile(path: string, expectedChainId: number, filesystem: StateFilesystem, protocolIndexStatePath: string, prevalidatedProtocolIndex: PrevalidatedProtocolIndex | undefined): Promise<DurableState> {
	if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new Error('Expected state chain ID must be a positive integer')
	let contents: string
	try {
		contents = await readOwnerFile(path, filesystem, 'Chaos-bot state', MAXIMUM_STATE_BYTES)
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) return initialDurableState(expectedChainId)
		throw error
	}
	const value = parseJsonDocument(contents, 'Chaos-bot state')
	const state = requiredRecord(value, 'chaos-bot state')
	const storedVersion = state['version']
	if (storedVersion !== 3 && storedVersion !== DURABLE_STATE_VERSION) throw new Error('Chaos-bot state version is unsupported')
	assertExactKeys(
		state,
		['activities', 'chainId', 'lifecyclePresenceBlocker', 'obligationTombstones', 'obligations', 'pendingTransactions', 'profileId', 'protocolIndex', ...(storedVersion === 3 ? [] : ['retirement']), 'safetyPaused', 'scheduler', 'signerAddress', 'version', 'workflows'],
		['includedTransactions', 'rollbackQueue', 'uniswapV3Factory'],
		'chaos-bot state',
	)
	if (state['chainId'] !== expectedChainId) throw new Error(`Chaos-bot state belongs to chain ${String(state['chainId'])}, expected chain ${expectedChainId.toString()}`)
	if (typeof state['safetyPaused'] !== 'boolean') {
		throw new Error('chaos-bot state.safetyPaused must be a boolean')
	}
	if (!Array.isArray(state['activities']) || !Array.isArray(state['obligationTombstones']) || !Array.isArray(state['obligations']) || !Array.isArray(state['pendingTransactions']) || !Array.isArray(state['workflows'])) throw new Error('Chaos-bot state collections must be arrays')
	if (state['activities'].length > MAXIMUM_ACTIVITY_COUNT) throw new Error(`Chaos-bot state contains more than ${MAXIMUM_ACTIVITY_COUNT.toString()} activities`)
	if (state['obligationTombstones'].length > MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) throw new Error(`Chaos-bot state contains more than ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} obligation tombstones`)
	const lifecyclePresenceBlocker = state['lifecyclePresenceBlocker'] === null ? undefined : parseLifecyclePresenceBlocker(state['lifecyclePresenceBlocker'])
	const workflows = state['workflows'].map(parseWorkflow)
	const workflowById = new Map(workflows.map(workflow => [workflow.id, workflow]))
	if (workflowById.size !== workflows.length) throw new Error('Chaos-bot state contains duplicate workflow IDs')
	const obligations = state['obligations'].map(parseObligation)
	if (new Set(obligations.map(obligation => obligation.id)).size !== obligations.length) throw new Error('Chaos-bot state contains duplicate obligation IDs')
	const obligationTombstones = state['obligationTombstones'].map(parseObligationTombstone)
	if (new Set(obligationTombstones.map(tombstone => tombstone.id)).size !== obligationTombstones.length) {
		throw new Error('Chaos-bot state contains duplicate obligation tombstones')
	}
	for (const tombstone of obligationTombstones) {
		const obligation = obligations.find(candidate => candidate.id === tombstone.id)
		if (obligation !== undefined && obligation.status !== tombstone.resolution) {
			throw new Error(`Obligation tombstone ${tombstone.id} does not match its retained obligation`)
		}
	}
	for (const obligation of obligations) {
		const workflow = workflowById.get(obligation.workflowId)
		if (workflow === undefined) throw new Error(`Obligation ${obligation.id} references unknown workflow ${obligation.workflowId}`)
		if (workflow.operationId !== obligation.operationId || workflow.ecosystem !== obligation.ecosystem) throw new Error(`Obligation ${obligation.id} does not match its workflow operation and ecosystem`)
	}
	const pendingTransactions = await Promise.all(state['pendingTransactions'].map((intent, index) => parsePendingTransaction(intent, index, expectedChainId)))
	const signerAddress = state['signerAddress'] === null ? undefined : getAddress(nonemptyString(state['signerAddress'], 'chaos-bot state.signerAddress'))
	const includedTransactions = await parseIncludedTransactions(state['includedTransactions'], signerAddress, { intent: (value, index) => parsePendingTransaction(value, index, expectedChainId), workflow: parseWorkflow, obligation: parseObligation })
	const rollbackQueue = await parseRollbackQueue(state['rollbackQueue'], signerAddress, { intent: (value, index) => parsePendingTransaction(value, index, expectedChainId), workflow: parseWorkflow, obligation: parseObligation })
	if (rollbackQueue.some(record => pendingTransactions.some(intent => record.intent.nonce < intent.nonce))) throw new Error('Rollback queue precedes the active pending nonce')
	const retainedNonces = [...includedTransactions, ...rollbackQueue].map(record => record.intent.nonce.toString())
	if (new Set([...retainedNonces, ...pendingTransactions.map(intent => intent.nonce.toString())]).size !== retainedNonces.length + pendingTransactions.length || rollbackQueue.some(record => !workflowById.has(record.workflow.id))) throw new Error('Rollback queue conflicts with retained nonces or workflows')
	assertIncludedTransactionWorkflows(includedTransactions, workflowById)
	if (new Set(pendingTransactions.map(intent => intent.id)).size !== pendingTransactions.length) throw new Error('Chaos-bot state contains duplicate transaction intent IDs')
	if (new Set(pendingTransactions.map(intent => intent.nonce.toString())).size !== pendingTransactions.length) throw new Error('Chaos-bot state contains duplicate pending transaction nonces')
	for (const intent of pendingTransactions) {
		if (signerAddress === undefined || intent.sender.toLowerCase() !== signerAddress.toLowerCase()) {
			throw new Error(`Transaction intent ${intent.id} does not match the durable signer scope`)
		}
		const workflow = workflowById.get(intent.workflowId)
		if (workflow === undefined) throw new Error(`Transaction intent ${intent.id} references unknown workflow ${intent.workflowId}`)
		if (workflow.terminalSubmission !== undefined && intent.mode !== 'private') {
			throw new Error(`Transaction intent ${intent.id} belongs to a terminal private-submission workflow but is not private`)
		}
		const step = workflow.steps.find(candidate => candidate.id === intent.stepId)
		if (workflow.operationId !== intent.operationId || step === undefined) throw new Error(`Transaction intent ${intent.id} does not match its workflow operation and step`)
		if (step.transactionIntentId !== intent.id || step.transactionHash?.toLowerCase() !== intent.hash.toLowerCase()) throw new Error(`Transaction intent ${intent.id} does not match its workflow step journal`)
		const expectedStepStatus = intent.status === 'signed' ? 'signed' : 'submitted'
		if (step.status !== expectedStepStatus) throw new Error(`Transaction intent ${intent.id} status does not match its workflow step`)
	}
	const pendingIntentIds = new Set(pendingTransactions.map(intent => intent.id))
	for (const workflow of workflows) {
		for (const step of workflow.steps) {
			if (step.status === 'signed' || step.status === 'submitted') {
				if (step.transactionIntentId === undefined || !pendingIntentIds.has(step.transactionIntentId)) {
					throw new Error(`Workflow step ${workflow.id}/${step.id} has an unresolved signed transaction without a pending intent`)
				}
			}
			const retainsFinalizedFailure = step.status === 'blocked' && workflow.continuationDisposition === 'cleanup-only' && (step.failureKind === 'receipt-reverted' || step.failureKind === 'nonce-cancelled') && step.transactionHash !== undefined
			if ((step.status === 'planned' || (step.status === 'blocked' && !retainsFinalizedFailure)) && (step.transactionHash !== undefined || step.transactionIntentId !== undefined)) {
				throw new Error(`Workflow step ${workflow.id}/${step.id} cannot discard a recorded transaction while ${step.status}`)
			}
		}
	}
	const protocolIndex = await durableProtocolIndex(state['protocolIndex'], protocolIndexStatePath, expectedChainId, filesystem, prevalidatedProtocolIndex)
	if (protocolIndex !== undefined && signerAddress !== undefined && protocolIndex.wallet.toLowerCase() !== signerAddress.toLowerCase()) {
		throw new Error('Protocol index wallet does not match the durable signer scope')
	}
	return {
		includedTransactions,
		rollbackQueue,
		activities: state['activities'].map(parseActivity),
		chainId: expectedChainId,
		lifecyclePresenceBlocker,
		obligationTombstones,
		obligations,
		pendingTransactions,
		profileId: identifier(state['profileId'], 'profileId'),
		uniswapV3Factory: state['uniswapV3Factory'] === undefined ? undefined : getAddress(nonemptyString(state['uniswapV3Factory'], 'chaos-bot state.uniswapV3Factory')),
		protocolIndex,
		retirement: storedVersion === 3 || state['retirement'] === undefined ? initialRetirementState() : parseRetirementState(state['retirement'], signerAddress),
		safetyPaused: state['safetyPaused'],
		scheduler: parseScheduler(state['scheduler']),
		signerAddress,
		version: DURABLE_STATE_VERSION,
		workflows,
	}
}

export async function loadDurableState(path: string, expectedChainId: number, filesystem: StateFilesystem = stateFilesystem) {
	return loadDurableStateFile(path, expectedChainId, filesystem, path, undefined)
}

function serializedDurableState(
	state: Pick<
		DurableState,
		'rollbackQueue' | 'includedTransactions' | 'activities' | 'chainId' | 'lifecyclePresenceBlocker' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'profileId' | 'protocolIndex' | 'retirement' | 'safetyPaused' | 'scheduler' | 'signerAddress' | 'uniswapV3Factory' | 'workflows'
	>,
	persistedProtocolIndex: ChaosProtocolIndex | ProtocolIndexReference | null = state.protocolIndex ?? null,
) {
	return {
		activities: state.activities,
		chainId: state.chainId,
		lifecyclePresenceBlocker: state.lifecyclePresenceBlocker ?? null,
		obligationTombstones: state.obligationTombstones,
		obligations: state.obligations,
		includedTransactions: serializedIncludedTransactions(state.includedTransactions),
		rollbackQueue: serializedRollbackQueue(state.rollbackQueue),
		pendingTransactions: state.pendingTransactions.map(serializedTransactionIntent),
		profileId: state.profileId,
		...(state.uniswapV3Factory === undefined ? {} : { uniswapV3Factory: state.uniswapV3Factory }),
		protocolIndex: persistedProtocolIndex,
		retirement: state.retirement,
		safetyPaused: state.safetyPaused,
		scheduler: serializedScheduler(state.scheduler),
		signerAddress: state.signerAddress ?? null,
		version: DURABLE_STATE_VERSION,
		workflows: state.workflows,
	}
}

type PersistableDurableState = Pick<
	DurableState,
	'rollbackQueue' | 'includedTransactions' | 'activities' | 'chainId' | 'lifecyclePresenceBlocker' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'profileId' | 'protocolIndex' | 'retirement' | 'safetyPaused' | 'scheduler' | 'signerAddress' | 'uniswapV3Factory' | 'workflows'
>

function snapshotDurableState(state: PersistableDurableState) {
	compactDurableState(state)
	const protocolIndex = state.protocolIndex === undefined ? undefined : snapshotProtocolIndex(state.protocolIndex, state.chainId)
	state.protocolIndex = protocolIndex
	const snapshot: PersistableDurableState = {
		includedTransactions: structuredClone(state.includedTransactions),
		rollbackQueue: structuredClone(state.rollbackQueue),
		activities: [...state.activities],
		chainId: state.chainId,
		lifecyclePresenceBlocker: state.lifecyclePresenceBlocker === undefined ? undefined : { ...state.lifecyclePresenceBlocker },
		obligationTombstones: [...state.obligationTombstones],
		obligations: [...state.obligations],
		pendingTransactions: [...state.pendingTransactions],
		profileId: state.profileId,
		uniswapV3Factory: state.uniswapV3Factory,
		protocolIndex: undefined,
		retirement: structuredClone(state.retirement),
		safetyPaused: state.safetyPaused,
		scheduler: { ...state.scheduler },
		signerAddress: state.signerAddress,
		workflows: [...state.workflows],
	}
	const serializedState = structuredClone(serializedDurableState(snapshot, null))
	return { protocolIndex, serializedState }
}

async function persistDurableStateSnapshot(path: string, chainId: number, contents: string, filesystem: StateFilesystem, protocolIndex: PrevalidatedProtocolIndex) {
	await writeBoundedFileAtomically(path, contents, {
		beforeCommit: temporaryPath => loadDurableStateFile(temporaryPath, chainId, filesystem, path, protocolIndex),
		filesystem,
		label: 'Chaos-bot state',
		maximumBytes: MAXIMUM_STATE_BYTES,
	})
}

export async function saveDurableState(path: string, state: PersistableDurableState, filesystem: StateFilesystem = stateFilesystem) {
	const resolvedPath = resolve(path)
	const chainId = state.chainId
	const snapshot = snapshotDurableState(state)
	await serializeWritesToPath(resolvedPath, async () => {
		const reference = snapshot.protocolIndex === undefined ? undefined : await persistProtocolIndexGeneration(resolvedPath, snapshot.protocolIndex, filesystem)
		const contents = `${JSON.stringify({ ...snapshot.serializedState, protocolIndex: reference ?? null }, undefined, 2)}\n`
		await persistDurableStateSnapshot(resolvedPath, chainId, contents, filesystem, { index: snapshot.protocolIndex, reference })
		await pruneProtocolIndexGenerations(resolvedPath, reference, filesystem).catch(() => undefined)
	})
}

export function recordActivity(state: Pick<RuntimeState, 'activities'>, activity: Omit<Activity, 'at'> & { at?: string | undefined }) {
	state.activities.unshift({
		...activity,
		at: activity.at ?? new Date().toISOString(),
	})
	state.activities = state.activities.slice(0, MAXIMUM_ACTIVITY_COUNT)
}
