import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import type { ChaosProtocolIndex } from '#monitoring/protocol-index'
import type { ChaosEcosystem, EvaluatedOperation, OperationEvidence, OperationPreflightCall, OperationRisk, OperationWalletAssetDebit } from '#operations/types'
import {
	loadPersistedProtocolIndex,
	parseProtocolIndex as parseStoredProtocolIndex,
	parseProtocolIndexReference,
	persistProtocolIndexGeneration,
	pruneProtocolIndexGenerations,
	snapshotProtocolIndex,
	type ProtocolIndexFileHandle,
	type ProtocolIndexFilesystem,
	type ProtocolIndexReference,
} from './protocol-index-store.ts'

export const DURABLE_STATE_VERSION = 2
export const MAXIMUM_ACTIVITY_COUNT = 500
export const MAXIMUM_TERMINAL_OBLIGATION_COUNT = 500
export const MAXIMUM_OBLIGATION_TOMBSTONE_COUNT = 10_000
export const MAXIMUM_TERMINAL_WORKFLOW_COUNT = 500
export const MAXIMUM_STATE_BYTES = 5 * 1024 * 1024

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
	createdAtBlock: string
	createdAt: string
	deadlineTimestamp?: string | undefined
	ecosystem: ChaosEcosystem
	id: string
	label: string
	lastValidBlockNumber?: string | undefined
	semanticDeadlineBlockNumber?: string | undefined
	metadata: DurableMetadata
	operationId: string
	obligation: boolean
	planId: string
	planningSeed: number
	postconditions: string[]
	priority: 'random' | 'urgent'
	risk: OperationRisk
	startedAt?: string | undefined
	status: 'abandoned' | 'blocked' | 'completed' | 'failed' | 'planned' | 'running' | 'waiting-continuation' | 'waiting-obligation' | 'waiting-transaction'
	steps: DurableWorkflowStep[]
	updatedAt: string
}

export type DurableObligation = {
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
	status: 'abandoned' | 'blocked' | 'completed' | 'executing' | 'failed' | 'pending'
	updatedAt: string
	workflowId: string
}

export type DurableObligationTombstone = {
	id: string
	lastSeenBlock?: string | undefined
	resolution: 'abandoned' | 'completed'
	resolvedAt: string
	resolvedAtBlock: string
	resolutionReason?: string | undefined
}

export type TransactionSemanticExpectation = {
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
	activities: Activity[]
	chainId: number
	obligationTombstones: DurableObligationTombstone[]
	obligations: DurableObligation[]
	pendingTransactions: PendingTransactionIntent[]
	profileId: string
	protocolIndex: ChaosProtocolIndex | undefined
	safetyPaused: boolean
	scheduler: SchedulerState
	signerAddress: Address | undefined
	version: 2
	workflows: DurableWorkflow[]
}

export type WalletBalanceState = {
	eth: string
	rep: readonly { balance: string; symbol: string; token: Address; universeId: string }[]
	weth: string
}

export type RuntimeTopologySummary = {
	anchor: { blockNumber: bigint; timestamp: bigint }
	auctions: { address: string; bidCount: number; endTime: string; finalized: boolean; pool: string; startTime: string }[]
	complete: boolean
	pairs: { address: string; feeBps: number; pool: string; status: number; universeId: string }[]
	pools: {
		address: string
		awaitingForkContinuation: boolean
		coordinator: string
		questionId: string
		systemState: number
		universeId: string
		/** Total canonical registry entries, independent of how many vault states this scan inspected. */
		vaultCount: number
	}[]
	reports: { currentReporter: string; flags: number; reportId: string; settlementTime: string; token1: string; token2: string }[]
	universes: { forkQuestionId: string; forkTime: string; id: string; knownChildOutcomeCount: number; parentUniverseId?: string | undefined; repToken: string }[]
}

export type RuntimeState = DurableState & {
	error: string | undefined
	evaluations: EvaluatedOperation[]
	inventory: WalletBalanceState
	lastScanAt: string | undefined
	lastScannedBlock: bigint | undefined
	paused: boolean
	rpcEndpointHealth: readonly unknown[]
	scanning: boolean
	startedAt: string
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	topology: RuntimeTopologySummary | undefined
	wallet: Address | undefined
	warnings: string[]
}

export type StateFilesystem = ProtocolIndexFilesystem

const stateFilesystem: StateFilesystem = {
	mkdir,
	open,
	readFile,
	readdir,
	rename,
	rm,
}

const stateWriteQueues = new Map<string, Promise<void>>()

function emptySchedulerState(paused = true): SchedulerState {
	return {
		lastDelaySeconds: undefined,
		lastRunAt: undefined,
		nextRunAt: undefined,
		selectedOperationId: undefined,
		status: paused ? 'paused' : 'idle',
	}
}

export function initialDurableState(chainId: number, paused = true, profileId = 'profile:unconfigured', signerAddress?: Address | undefined): DurableState {
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('State chain ID must be a positive integer')
	return {
		activities: [],
		chainId,
		obligationTombstones: [],
		obligations: [],
		pendingTransactions: [],
		profileId: identifier(profileId, 'profileId'),
		protocolIndex: undefined,
		safetyPaused: false,
		scheduler: emptySchedulerState(paused),
		signerAddress,
		version: DURABLE_STATE_VERSION,
		workflows: [],
	}
}

export function initialRuntimeState(paused: boolean, wallet: Address | undefined, chainId: number, durableState: DurableState = initialDurableState(chainId, paused)): RuntimeState {
	if (durableState.chainId !== chainId) throw new Error(`Durable state belongs to chain ${durableState.chainId.toString()}, expected chain ${chainId.toString()}`)
	const restoredSchedulerStatus = durableState.scheduler.status
	const effectivePaused = paused || durableState.safetyPaused
	let activeSchedulerStatus = restoredSchedulerStatus
	if (restoredSchedulerStatus === 'running') activeSchedulerStatus = 'running'
	else if (effectivePaused) activeSchedulerStatus = 'paused'
	else if (restoredSchedulerStatus === 'paused') activeSchedulerStatus = 'idle'
	const durableSafetyError = durableState.safetyPaused ? durableState.activities.find(activity => activity.type === 'error' && activity.status === 'failed')?.message : undefined
	return {
		...durableState,
		activities: [...durableState.activities],
		error: durableSafetyError,
		evaluations: [],
		inventory: { eth: '0', rep: [], weth: '0' },
		lastScanAt: undefined,
		lastScannedBlock: undefined,
		obligationTombstones: [...durableState.obligationTombstones],
		obligations: [...durableState.obligations],
		paused: effectivePaused,
		pendingTransactions: [...durableState.pendingTransactions],
		rpcEndpointHealth: [],
		scanning: false,
		scheduler: { ...durableState.scheduler, status: activeSchedulerStatus },
		startedAt: new Date().toISOString(),
		status: effectivePaused ? 'paused' : 'starting',
		topology: undefined,
		wallet: wallet ?? durableState.signerAddress,
		warnings: [],
		workflows: [...durableState.workflows],
	}
}

export function bindRuntimeStateToSigner(state: RuntimeState, address: Address) {
	if (state.signerAddress !== undefined && state.signerAddress.toLowerCase() !== address.toLowerCase()) {
		throw new Error(`Durable runtime is scoped to signer ${state.signerAddress}, not ${address}`)
	}
	const firstBinding = state.signerAddress === undefined
	state.signerAddress = address
	state.wallet = address
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
	Object.assign(state, replacement)
	return state
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as Record<string, unknown>
}

function assertExactKeys(record: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string) {
	const allowed = new Set([...required, ...optional])
	const unknown = Object.keys(record).filter(key => !allowed.has(key))
	const missing = required.filter(key => !(key in record))
	if (unknown.length !== 0) throw new Error(`${label} contains unsupported field ${unknown[0] ?? 'unknown'}`)
	if (missing.length !== 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
}

function nonemptyString(value: unknown, label: string, maximumLength = 2_048) {
	if (typeof value !== 'string' || value.trim() === '' || value.length > maximumLength) throw new Error(`${label} must be a non-empty string of at most ${maximumLength.toString()} characters`)
	return value
}

function optionalString(value: unknown, label: string, maximumLength = 2_048) {
	return value === undefined ? undefined : nonemptyString(value, label, maximumLength)
}

function identifier(value: unknown, label: string) {
	const parsed = nonemptyString(value, label, 128)
	if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9._:-]*[a-zA-Z0-9])?$/.test(parsed)) throw new Error(`${label} contains unsupported characters`)
	return parsed
}

function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	return value
}

function positiveIntegerString(value: unknown, label: string) {
	const parsed = unsignedIntegerString(value, label)
	if (parsed === '0') throw new Error(`${label} must be greater than zero`)
	return parsed
}

function timestamp(value: unknown, label: string) {
	if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${label} must be a canonical UTC ISO timestamp`)
	return value
}

function optionalTimestamp(value: unknown, label: string) {
	return value === undefined ? undefined : timestamp(value, label)
}

function hash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be a 32-byte hash`)
	return value as Hex
}

function dataHex(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) throw new Error(`${label} must be even-length 0x-prefixed hex`)
	return value as Hex
}

function serializedTransaction(value: unknown, label: string) {
	const parsed = dataHex(value, label)
	if (parsed === '0x') throw new Error(`${label} cannot be empty`)
	return parsed
}

function ecosystem(value: unknown, label: string): ChaosEcosystem {
	if (value !== 'zoltar' && value !== 'statoblast' && value !== 'open-oracle' && value !== 'trading') throw new Error(`${label} is invalid`)
	return value
}

function stringArray(value: unknown, label: string) {
	if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
	return value.map((candidate, index) => nonemptyString(candidate, `${label}[${index.toString()}]`))
}

function parseMetadata(value: unknown, label: string): DurableMetadata {
	const record = requiredRecord(value, label)
	if (Object.keys(record).length > 100) throw new Error(`${label} contains too many fields`)
	const parsed: DurableMetadata = {}
	for (const [key, candidate] of Object.entries(record)) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(key)) throw new Error(`${label} contains an invalid key`)
		if (typeof candidate === 'string') parsed[key] = nonemptyString(candidate, `${label}.${key}`, 2_048)
		else if (typeof candidate === 'boolean') parsed[key] = candidate
		else if (typeof candidate === 'number' && Number.isSafeInteger(candidate)) parsed[key] = candidate
		else throw new Error(`${label}.${key} must be a string, boolean, or safe integer`)
	}
	return parsed
}

function parseEvidence(value: unknown, label: string): OperationEvidence {
	const evidence = requiredRecord(value, label)
	const kind = evidence['kind']
	if (kind === 'receipt-success') {
		assertExactKeys(evidence, ['kind'], [], label)
		return { kind }
	}
	if (kind === 'event') {
		assertExactKeys(evidence, ['emitter', 'kind', 'signature', 'topic0'], [], label)
		return {
			emitter: getAddress(nonemptyString(evidence['emitter'], `${label}.emitter`)),
			kind,
			signature: nonemptyString(evidence['signature'], `${label}.signature`, 512),
			topic0: hash(evidence['topic0'], `${label}.topic0`),
		}
	}
	if (kind === 'decoded-event-field') {
		assertExactKeys(evidence, ['abi', 'emitter', 'equals', 'field', 'indexed', 'kind', 'signature', 'topic0'], [], label)
		const indexed = requiredRecord(evidence['indexed'], `${label}.indexed`)
		if (Object.keys(indexed).length > 32) throw new Error(`${label}.indexed contains too many fields`)
		const parsedIndexed: Record<string, string> = {}
		for (const [key, candidate] of Object.entries(indexed)) {
			if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(key)) throw new Error(`${label}.indexed contains an invalid field name`)
			parsedIndexed[key] = nonemptyString(candidate, `${label}.indexed.${key}`)
		}
		const equals = evidence['equals']
		if (typeof equals !== 'string' && typeof equals !== 'boolean' && !(typeof equals === 'number' && Number.isSafeInteger(equals))) throw new Error(`${label}.equals must be a string, boolean, or safe integer`)
		return {
			abi: nonemptyString(evidence['abi'], `${label}.abi`, 65_536),
			emitter: getAddress(nonemptyString(evidence['emitter'], `${label}.emitter`)),
			equals,
			field: nonemptyString(evidence['field'], `${label}.field`, 128),
			indexed: parsedIndexed,
			kind,
			signature: nonemptyString(evidence['signature'], `${label}.signature`, 512),
			topic0: hash(evidence['topic0'], `${label}.topic0`),
		}
	}
	if (kind === 'balance-change') {
		assertExactKeys(evidence, ['account', 'asset', 'direction', 'kind'], [], label)
		const direction = evidence['direction']
		if (direction !== 'increase' && direction !== 'decrease' && direction !== 'any') throw new Error(`${label}.direction is invalid`)
		const asset = evidence['asset'] === 'ETH' ? 'ETH' : getAddress(nonemptyString(evidence['asset'], `${label}.asset`))
		return { account: getAddress(nonemptyString(evidence['account'], `${label}.account`)), asset, direction, kind }
	}
	if (kind === 'storage-postcondition') {
		assertExactKeys(evidence, ['abi', 'args', 'contract', 'functionName', 'kind', 'relation'], ['expected'], label)
		const relation = evidence['relation']
		if (relation !== 'changed' && relation !== 'equals' && relation !== 'greater-than' && relation !== 'at-least') throw new Error(`${label}.relation is invalid`)
		const expected = optionalString(evidence['expected'], `${label}.expected`)
		if (relation !== 'changed' && expected === undefined) throw new Error(`${label}.expected is required for ${relation}`)
		return {
			abi: nonemptyString(evidence['abi'], `${label}.abi`, 65_536),
			args: parseStorageArguments(evidence['args'], `${label}.args`),
			contract: getAddress(nonemptyString(evidence['contract'], `${label}.contract`)),
			...(expected === undefined ? {} : { expected }),
			functionName: nonemptyString(evidence['functionName'], `${label}.functionName`, 256),
			kind,
			relation,
		}
	}
	throw new Error(`${label}.kind is invalid`)
}

function parseStorageArguments(value: unknown, label: string) {
	if (!Array.isArray(value) || value.length > 64) throw new Error(`${label} must be an array with at most 64 entries`)
	return value.map((candidate, index) => {
		if (typeof candidate === 'boolean') return candidate
		return nonemptyString(candidate, `${label}[${index.toString()}]`)
	})
}

function storageBaselineKey(value: { args: readonly (boolean | string)[]; contract: Address; functionName: string }) {
	return `${value.contract.toLowerCase()}:${value.functionName}:${JSON.stringify(value.args)}`
}

function parseEvidenceArray(value: unknown, label: string) {
	if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
	return value.map((candidate, index) => parseEvidence(candidate, `${label}[${index.toString()}]`))
}

function parseWalletAssetDebits(value: unknown, label: string): OperationWalletAssetDebit[] {
	if (!Array.isArray(value) || value.length > 256) {
		throw new Error(`${label} must be an array with at most 256 entries`)
	}
	return value.map((candidate, index) => {
		const debitLabel = `${label}[${index.toString()}]`
		const debit = requiredRecord(candidate, debitLabel)
		if (debit['kind'] === 'native') {
			assertExactKeys(debit, ['amount', 'asset', 'kind'], [], debitLabel)
			if (debit['asset'] !== 'ETH') throw new Error(`${debitLabel}.asset must be ETH`)
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: 'ETH' as const,
				kind: 'native' as const,
			}
		}
		if (debit['kind'] === 'erc20') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind'], [], debitLabel)
			const category = debit['category']
			if (category !== 'rep' && category !== 'weth' && category !== 'lp-token' && category !== 'other') {
				throw new Error(`${debitLabel}.category is invalid`)
			}
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: getAddress(nonemptyString(debit['asset'], `${debitLabel}.asset`)),
				category,
				kind: 'erc20' as const,
			}
		}
		if (debit['kind'] === 'open-oracle-credit') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind', 'openOracle'], [], debitLabel)
			const category = debit['category']
			if (category !== 'rep' && category !== 'weth' && category !== 'other') {
				throw new Error(`${debitLabel}.category is invalid`)
			}
			const rawAsset = nonemptyString(debit['asset'], `${debitLabel}.asset`)
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: rawAsset === 'ETH' ? ('ETH' as const) : getAddress(rawAsset),
				category,
				kind: 'open-oracle-credit' as const,
				openOracle: getAddress(nonemptyString(debit['openOracle'], `${debitLabel}.openOracle`)),
			}
		}
		if (debit['kind'] === 'erc1155') {
			assertExactKeys(debit, ['amount', 'asset', 'category', 'kind', 'tokenId'], [], debitLabel)
			if (debit['category'] !== 'outcome-share') {
				throw new Error(`${debitLabel}.category must be outcome-share`)
			}
			return {
				amount: positiveIntegerString(debit['amount'], `${debitLabel}.amount`),
				asset: getAddress(nonemptyString(debit['asset'], `${debitLabel}.asset`)),
				category: 'outcome-share' as const,
				kind: 'erc1155' as const,
				tokenId: unsignedIntegerString(debit['tokenId'], `${debitLabel}.tokenId`),
			}
		}
		throw new Error(`${debitLabel}.kind is invalid`)
	})
}

function parseActivity(value: unknown, index: number): Activity {
	const label = `activities[${index.toString()}]`
	const activity = requiredRecord(value, label)
	assertExactKeys(activity, ['at', 'message', 'status', 'type'], ['details', 'ecosystem', 'hash', 'operationId', 'summary'], label)
	const type = activity['type']
	if (!['configuration', 'discovery', 'error', 'operation', 'recovery', 'scheduler', 'transaction', 'wallet'].includes(String(type))) throw new Error(`${label}.type is invalid`)
	const status = activity['status']
	if (!['confirmed', 'dry-run', 'failed', 'info', 'pending', 'skipped'].includes(String(status))) throw new Error(`${label}.status is invalid`)
	const details = optionalString(activity['details'], `${label}.details`, 8_192)
	const activityEcosystem = activity['ecosystem'] === undefined ? undefined : ecosystem(activity['ecosystem'], `${label}.ecosystem`)
	const activityHash = activity['hash'] === undefined ? undefined : hash(activity['hash'], `${label}.hash`)
	const operationId = activity['operationId'] === undefined ? undefined : identifier(activity['operationId'], `${label}.operationId`)
	const summary = optionalString(activity['summary'], `${label}.summary`)
	return {
		at: timestamp(activity['at'], `${label}.at`),
		...(details === undefined ? {} : { details }),
		...(activityEcosystem === undefined ? {} : { ecosystem: activityEcosystem }),
		...(activityHash === undefined ? {} : { hash: activityHash }),
		message: nonemptyString(activity['message'], `${label}.message`),
		...(operationId === undefined ? {} : { operationId }),
		status: status as Activity['status'],
		...(summary === undefined ? {} : { summary }),
		type: type as Activity['type'],
	}
}

function parseScheduler(value: unknown): SchedulerState {
	const scheduler = requiredRecord(value, 'scheduler')
	assertExactKeys(scheduler, ['lastDelaySeconds', 'lastRunAt', 'nextRunAt', 'selectedOperationId', 'status'], [], 'scheduler')
	const lastDelaySeconds = scheduler['lastDelaySeconds']
	if (lastDelaySeconds !== null && (typeof lastDelaySeconds !== 'number' || !Number.isSafeInteger(lastDelaySeconds) || lastDelaySeconds < 60 || lastDelaySeconds > 3_600)) throw new Error('scheduler.lastDelaySeconds is invalid')
	const status = scheduler['status']
	if (status !== 'due' && status !== 'idle' && status !== 'paused' && status !== 'running' && status !== 'scheduled') throw new Error('scheduler.status is invalid')
	const parsed: SchedulerState = {
		lastDelaySeconds: lastDelaySeconds === null ? undefined : lastDelaySeconds,
		lastRunAt: scheduler['lastRunAt'] === null ? undefined : timestamp(scheduler['lastRunAt'], 'scheduler.lastRunAt'),
		nextRunAt: scheduler['nextRunAt'] === null ? undefined : timestamp(scheduler['nextRunAt'], 'scheduler.nextRunAt'),
		selectedOperationId: scheduler['selectedOperationId'] === null ? undefined : identifier(scheduler['selectedOperationId'], 'scheduler.selectedOperationId'),
		status,
	}
	if ((parsed.status === 'due' || parsed.status === 'running' || parsed.status === 'scheduled') && parsed.nextRunAt === undefined) throw new Error(`scheduler.nextRunAt is required while ${parsed.status}`)
	if (parsed.status === 'running' && parsed.selectedOperationId === undefined) throw new Error('scheduler.selectedOperationId is required while running')
	return parsed
}

function parseWorkflowStep(value: unknown, workflowIndex: number, stepIndex: number): DurableWorkflowStep {
	const label = `workflows[${workflowIndex.toString()}].steps[${stepIndex.toString()}]`
	const step = requiredRecord(value, label)
	assertExactKeys(step, ['data', 'evidence', 'gasLimit', 'id', 'label', 'status', 'to', 'value', 'walletAssetDebits'], ['confirmedAt', 'failure', 'failureKind', 'preflightCalls', 'startedAt', 'transactionHash', 'transactionIntentId'], label)
	const status = step['status']
	if (status !== 'blocked' && status !== 'confirmed' && status !== 'failed' && status !== 'planned' && status !== 'signed' && status !== 'submitted') throw new Error(`${label}.status is invalid`)
	const confirmedAt = optionalTimestamp(step['confirmedAt'], `${label}.confirmedAt`)
	const failure = optionalString(step['failure'], `${label}.failure`, 8_192)
	const failureKind = step['failureKind']
	if (failureKind !== undefined && failureKind !== 'nonce-cancelled' && failureKind !== 'receipt-reverted' && failureKind !== 'semantic-failure') {
		throw new Error(`${label}.failureKind is invalid`)
	}
	const startedAt = optionalTimestamp(step['startedAt'], `${label}.startedAt`)
	const transactionHash = step['transactionHash'] === undefined ? undefined : hash(step['transactionHash'], `${label}.transactionHash`)
	const transactionIntentId = step['transactionIntentId'] === undefined ? undefined : identifier(step['transactionIntentId'], `${label}.transactionIntentId`)
	const rawPreflightCalls = step['preflightCalls'] ?? []
	if (!Array.isArray(rawPreflightCalls) || rawPreflightCalls.length > 16) {
		throw new Error(`${label}.preflightCalls must be an array with at most 16 entries`)
	}
	const preflightCalls = rawPreflightCalls.map((candidate, index): OperationPreflightCall => {
		const callLabel = `${label}.preflightCalls[${index.toString()}]`
		const call = requiredRecord(candidate, callLabel)
		assertExactKeys(call, ['caller', 'data', 'expectedResult', 'label', 'to'], ['value'], callLabel)
		const expectedResult = dataHex(call['expectedResult'], `${callLabel}.expectedResult`)
		const value = call['value'] === undefined ? undefined : unsignedIntegerString(call['value'], `${callLabel}.value`)
		return {
			caller: getAddress(nonemptyString(call['caller'], `${callLabel}.caller`)),
			data: dataHex(call['data'], `${callLabel}.data`),
			expectedResult,
			label: nonemptyString(call['label'], `${callLabel}.label`, 512),
			to: getAddress(nonemptyString(call['to'], `${callLabel}.to`)),
			...(value === undefined ? {} : { value }),
		}
	})
	return {
		...(confirmedAt === undefined ? {} : { confirmedAt }),
		data: dataHex(step['data'], `${label}.data`),
		evidence: parseEvidenceArray(step['evidence'], `${label}.evidence`),
		...(failure === undefined ? {} : { failure }),
		...(failureKind === undefined ? {} : { failureKind }),
		gasLimit: positiveIntegerString(step['gasLimit'], `${label}.gasLimit`),
		id: identifier(step['id'], `${label}.id`),
		label: nonemptyString(step['label'], `${label}.label`),
		preflightCalls,
		...(startedAt === undefined ? {} : { startedAt }),
		status,
		to: getAddress(nonemptyString(step['to'], `${label}.to`)),
		...(transactionHash === undefined ? {} : { transactionHash }),
		...(transactionIntentId === undefined ? {} : { transactionIntentId }),
		value: unsignedIntegerString(step['value'], `${label}.value`),
		walletAssetDebits: parseWalletAssetDebits(step['walletAssetDebits'], `${label}.walletAssetDebits`),
	}
}

function parseWorkflow(value: unknown, index: number): DurableWorkflow {
	const label = `workflows[${index.toString()}]`
	const workflow = requiredRecord(value, label)
	assertExactKeys(
		workflow,
		['classification', 'createdAt', 'createdAtBlock', 'ecosystem', 'id', 'label', 'metadata', 'obligation', 'operationId', 'planId', 'planningSeed', 'postconditions', 'priority', 'risk', 'status', 'steps', 'updatedAt'],
		['completedAt', 'deadlineTimestamp', 'lastValidBlockNumber', 'semanticDeadlineBlockNumber', 'startedAt'],
		label,
	)
	const status = workflow['status']
	if (status !== 'abandoned' && status !== 'blocked' && status !== 'completed' && status !== 'failed' && status !== 'planned' && status !== 'running' && status !== 'waiting-continuation' && status !== 'waiting-obligation' && status !== 'waiting-transaction') throw new Error(`${label}.status is invalid`)
	if (!Array.isArray(workflow['steps']) || workflow['steps'].length === 0) throw new Error(`${label}.steps must be a non-empty array`)
	const completedAt = optionalTimestamp(workflow['completedAt'], `${label}.completedAt`)
	const startedAt = optionalTimestamp(workflow['startedAt'], `${label}.startedAt`)
	const classification = workflow['classification']
	if (classification !== 'lifecycle-obligation' && classification !== 'selectable') {
		throw new Error(`${label}.classification is invalid`)
	}
	const priority = workflow['priority']
	if (priority !== 'random' && priority !== 'urgent') {
		throw new Error(`${label}.priority is invalid`)
	}
	const risk = workflow['risk']
	if (risk !== 'low' && risk !== 'medium' && risk !== 'high' && risk !== 'irreversible') {
		throw new Error(`${label}.risk is invalid`)
	}
	if (typeof workflow['obligation'] !== 'boolean') {
		throw new Error(`${label}.obligation must be a boolean`)
	}
	const planningSeed = workflow['planningSeed']
	if (typeof planningSeed !== 'number' || !Number.isSafeInteger(planningSeed) || planningSeed < 0 || planningSeed > 0xffff_ffff) {
		throw new Error(`${label}.planningSeed must be an unsigned 32-bit integer`)
	}
	const steps = workflow['steps'].map((step, stepIndex) => parseWorkflowStep(step, index, stepIndex))
	if (new Set(steps.map(step => step.id)).size !== steps.length) throw new Error(`${label}.steps contains duplicate IDs`)
	return {
		classification,
		...(completedAt === undefined ? {} : { completedAt }),
		createdAtBlock: unsignedIntegerString(workflow['createdAtBlock'], `${label}.createdAtBlock`),
		createdAt: timestamp(workflow['createdAt'], `${label}.createdAt`),
		...(workflow['deadlineTimestamp'] === undefined
			? {}
			: {
					deadlineTimestamp: unsignedIntegerString(workflow['deadlineTimestamp'], `${label}.deadlineTimestamp`),
				}),
		ecosystem: ecosystem(workflow['ecosystem'], `${label}.ecosystem`),
		id: identifier(workflow['id'], `${label}.id`),
		label: nonemptyString(workflow['label'], `${label}.label`),
		...(workflow['lastValidBlockNumber'] === undefined
			? {}
			: {
					lastValidBlockNumber: unsignedIntegerString(workflow['lastValidBlockNumber'], `${label}.lastValidBlockNumber`),
				}),
		...(workflow['semanticDeadlineBlockNumber'] === undefined
			? {}
			: {
					semanticDeadlineBlockNumber: unsignedIntegerString(workflow['semanticDeadlineBlockNumber'], `${label}.semanticDeadlineBlockNumber`),
				}),
		metadata: parseMetadata(workflow['metadata'], `${label}.metadata`),
		obligation: workflow['obligation'],
		operationId: identifier(workflow['operationId'], `${label}.operationId`),
		planId: identifier(workflow['planId'], `${label}.planId`),
		planningSeed,
		postconditions: stringArray(workflow['postconditions'], `${label}.postconditions`),
		priority,
		risk,
		...(startedAt === undefined ? {} : { startedAt }),
		status,
		steps,
		updatedAt: timestamp(workflow['updatedAt'], `${label}.updatedAt`),
	}
}

function parseObligation(value: unknown, index: number): DurableObligation {
	const label = `obligations[${index.toString()}]`
	const obligation = requiredRecord(value, label)
	assertExactKeys(obligation, ['attemptCount', 'blockers', 'createdAt', 'ecosystem', 'id', 'label', 'metadata', 'operationId', 'status', 'updatedAt', 'workflowId'], ['completedAt', 'dueAt', 'expiresAt', 'lastAttemptAt', 'lastError', 'notBefore', 'resolvedAt', 'resolutionReason'], label)
	const attemptCount = obligation['attemptCount']
	if (typeof attemptCount !== 'number' || !Number.isSafeInteger(attemptCount) || attemptCount < 0) throw new Error(`${label}.attemptCount is invalid`)
	const status = obligation['status']
	if (status !== 'abandoned' && status !== 'blocked' && status !== 'completed' && status !== 'executing' && status !== 'failed' && status !== 'pending') throw new Error(`${label}.status is invalid`)
	const completedAt = optionalTimestamp(obligation['completedAt'], `${label}.completedAt`)
	const dueAt = optionalTimestamp(obligation['dueAt'], `${label}.dueAt`)
	const expiresAt = optionalTimestamp(obligation['expiresAt'], `${label}.expiresAt`)
	const lastAttemptAt = optionalTimestamp(obligation['lastAttemptAt'], `${label}.lastAttemptAt`)
	const lastError = optionalString(obligation['lastError'], `${label}.lastError`, 8_192)
	const notBefore = optionalTimestamp(obligation['notBefore'], `${label}.notBefore`)
	const resolvedAt = optionalTimestamp(obligation['resolvedAt'], `${label}.resolvedAt`)
	const resolutionReason = optionalString(obligation['resolutionReason'], `${label}.resolutionReason`, 2_048)
	if (status === 'abandoned' && (resolvedAt === undefined || resolutionReason === undefined)) {
		throw new Error(`${label} requires resolution metadata while abandoned`)
	}
	if (status !== 'abandoned' && (resolvedAt !== undefined || resolutionReason !== undefined)) {
		throw new Error(`${label} has resolution metadata without abandonment`)
	}
	return {
		attemptCount,
		blockers: stringArray(obligation['blockers'], `${label}.blockers`),
		...(completedAt === undefined ? {} : { completedAt }),
		createdAt: timestamp(obligation['createdAt'], `${label}.createdAt`),
		...(dueAt === undefined ? {} : { dueAt }),
		ecosystem: ecosystem(obligation['ecosystem'], `${label}.ecosystem`),
		...(expiresAt === undefined ? {} : { expiresAt }),
		id: identifier(obligation['id'], `${label}.id`),
		label: nonemptyString(obligation['label'], `${label}.label`),
		...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
		...(lastError === undefined ? {} : { lastError }),
		metadata: parseMetadata(obligation['metadata'], `${label}.metadata`),
		...(notBefore === undefined ? {} : { notBefore }),
		operationId: identifier(obligation['operationId'], `${label}.operationId`),
		...(resolvedAt === undefined ? {} : { resolvedAt }),
		...(resolutionReason === undefined ? {} : { resolutionReason }),
		status,
		updatedAt: timestamp(obligation['updatedAt'], `${label}.updatedAt`),
		workflowId: identifier(obligation['workflowId'], `${label}.workflowId`),
	}
}

function parseObligationTombstone(value: unknown, index: number): DurableObligationTombstone {
	const label = `obligationTombstones[${index.toString()}]`
	const tombstone = requiredRecord(value, label)
	assertExactKeys(tombstone, ['id', 'resolution', 'resolvedAt', 'resolvedAtBlock'], ['lastSeenBlock', 'resolutionReason'], label)
	const resolution = tombstone['resolution']
	if (resolution !== 'abandoned' && resolution !== 'completed') {
		throw new Error(`${label}.resolution is invalid`)
	}
	const resolutionReason = optionalString(tombstone['resolutionReason'], `${label}.resolutionReason`, 2_048)
	if (resolution === 'abandoned' && resolutionReason === undefined) {
		throw new Error(`${label}.resolutionReason is required for abandonment`)
	}
	if (resolution === 'completed' && resolutionReason !== undefined) {
		throw new Error(`${label}.resolutionReason is only valid for abandonment`)
	}
	const resolvedAtBlock = unsignedIntegerString(tombstone['resolvedAtBlock'], `${label}.resolvedAtBlock`)
	const lastSeenBlock = tombstone['lastSeenBlock'] === undefined ? undefined : unsignedIntegerString(tombstone['lastSeenBlock'], `${label}.lastSeenBlock`)
	if (lastSeenBlock !== undefined && BigInt(lastSeenBlock) < BigInt(resolvedAtBlock)) {
		throw new Error(`${label}.lastSeenBlock precedes its resolution block`)
	}
	return {
		id: identifier(tombstone['id'], `${label}.id`),
		...(lastSeenBlock === undefined ? {} : { lastSeenBlock }),
		resolution,
		resolvedAt: timestamp(tombstone['resolvedAt'], `${label}.resolvedAt`),
		resolvedAtBlock,
		...(resolutionReason === undefined ? {} : { resolutionReason }),
	}
}

async function parsePendingTransaction(value: unknown, index: number, expectedChainId: number): Promise<PendingTransactionIntent> {
	const label = `pendingTransactions[${index.toString()}]`
	const intent = requiredRecord(value, label)
	assertExactKeys(
		intent,
		['data', 'hash', 'id', 'label', 'maxBlockNumber', 'mode', 'nonce', 'operationId', 'semanticExpectation', 'sender', 'serializedTransaction', 'signedAt', 'status', 'stepId', 'to', 'value', 'workflowId'],
		['cancellationHash', 'recoveryBlocker', 'replacementHash', 'submissionBlock', 'submittedAt'],
		label,
	)
	const rawTransaction = serializedTransaction(intent['serializedTransaction'], `${label}.serializedTransaction`)
	const transactionHash = hash(intent['hash'], `${label}.hash`)
	if (keccak256(rawTransaction).toLowerCase() !== transactionHash.toLowerCase()) throw new Error(`${label}.hash does not match its serialized transaction`)
	const parsedTransaction = parseTransaction(rawTransaction)
	if (parsedTransaction.chainId !== BigInt(expectedChainId)) throw new Error(`${label} belongs to chain ${parsedTransaction.chainId?.toString() ?? 'unknown'}, expected chain ${expectedChainId.toString()}`)
	const nonce = BigInt(unsignedIntegerString(intent['nonce'], `${label}.nonce`))
	if (parsedTransaction.nonce !== nonce) throw new Error(`${label}.nonce does not match its serialized transaction`)
	const sender = getAddress(nonemptyString(intent['sender'], `${label}.sender`))
	const recoveredSender = await recoverTransactionAddress({ serializedTransaction: rawTransaction })
	if (recoveredSender.toLowerCase() !== sender.toLowerCase()) throw new Error(`${label}.sender does not match its serialized transaction`)
	const to = getAddress(nonemptyString(intent['to'], `${label}.to`))
	if (parsedTransaction.to === null || parsedTransaction.to === undefined || parsedTransaction.to.toLowerCase() !== to.toLowerCase()) throw new Error(`${label}.to does not match its serialized transaction`)
	const data = dataHex(intent['data'], `${label}.data`)
	if ((parsedTransaction.data ?? '0x').toLowerCase() !== data.toLowerCase()) throw new Error(`${label}.data does not match its serialized transaction`)
	const transactionValue = BigInt(unsignedIntegerString(intent['value'], `${label}.value`))
	if ((parsedTransaction.value ?? 0n) !== transactionValue) throw new Error(`${label}.value does not match its serialized transaction`)
	const mode = intent['mode']
	if (mode !== 'private' && mode !== 'public') throw new Error(`${label}.mode is invalid`)
	const status = intent['status']
	if (status !== 'confirmation-unknown' && status !== 'signed' && status !== 'submitted') {
		throw new Error(`${label}.status is invalid`)
	}
	const submissionBlock = intent['submissionBlock'] === undefined ? undefined : BigInt(unsignedIntegerString(intent['submissionBlock'], `${label}.submissionBlock`))
	const submittedAt = optionalTimestamp(intent['submittedAt'], `${label}.submittedAt`)
	const replacementHash = intent['replacementHash'] === undefined ? undefined : hash(intent['replacementHash'], `${label}.replacementHash`)
	if (replacementHash?.toLowerCase() === transactionHash.toLowerCase()) {
		throw new Error(`${label}.replacementHash must differ from the original transaction hash`)
	}
	const cancellationHash = intent['cancellationHash'] === undefined ? undefined : hash(intent['cancellationHash'], `${label}.cancellationHash`)
	if (cancellationHash?.toLowerCase() === transactionHash.toLowerCase()) {
		throw new Error(`${label}.cancellationHash must differ from the original transaction hash`)
	}
	if (cancellationHash !== undefined && replacementHash !== undefined) {
		throw new Error(`${label} cannot queue both replacement and cancellation verification`)
	}
	const recoveryBlocker = optionalString(intent['recoveryBlocker'], `${label}.recoveryBlocker`, 2_048)
	if (status === 'signed' && (submissionBlock !== undefined || submittedAt !== undefined)) throw new Error(`${label} has submission metadata before broadcast`)
	if (status !== 'signed' && (submissionBlock === undefined || submittedAt === undefined)) throw new Error(`${label} is missing submission metadata`)
	const expectation = requiredRecord(intent['semanticExpectation'], `${label}.semanticExpectation`)
	assertExactKeys(expectation, ['balanceBaselines', 'evidence', 'postconditions', 'storageBaselines'], [], `${label}.semanticExpectation`)
	if (!Array.isArray(expectation['balanceBaselines']) || expectation['balanceBaselines'].length > 256) throw new Error(`${label}.semanticExpectation.balanceBaselines must be an array with at most 256 entries`)
	const balanceBaselines = expectation['balanceBaselines'].map((candidate, baselineIndex) => {
		const baselineLabel = `${label}.semanticExpectation.balanceBaselines[${baselineIndex.toString()}]`
		const baseline = requiredRecord(candidate, baselineLabel)
		assertExactKeys(baseline, ['account', 'asset', 'balance'], [], baselineLabel)
		return {
			account: getAddress(nonemptyString(baseline['account'], `${baselineLabel}.account`)),
			asset: baseline['asset'] === 'ETH' ? ('ETH' as const) : getAddress(nonemptyString(baseline['asset'], `${baselineLabel}.asset`)),
			balance: unsignedIntegerString(baseline['balance'], `${baselineLabel}.balance`),
		}
	})
	const baselineKeys = balanceBaselines.map(baseline => `${baseline.account.toLowerCase()}:${baseline.asset === 'ETH' ? 'eth' : baseline.asset.toLowerCase()}`)
	if (new Set(baselineKeys).size !== baselineKeys.length) throw new Error(`${label}.semanticExpectation.balanceBaselines contains duplicates`)
	if (!Array.isArray(expectation['storageBaselines']) || expectation['storageBaselines'].length > 256) throw new Error(`${label}.semanticExpectation.storageBaselines must be an array with at most 256 entries`)
	const storageBaselines = expectation['storageBaselines'].map((candidate, storageIndex) => {
		const storageLabel = `${label}.semanticExpectation.storageBaselines[${storageIndex.toString()}]`
		const baseline = requiredRecord(candidate, storageLabel)
		assertExactKeys(baseline, ['args', 'contract', 'functionName', 'value'], [], storageLabel)
		return {
			args: parseStorageArguments(baseline['args'], `${storageLabel}.args`),
			contract: getAddress(nonemptyString(baseline['contract'], `${storageLabel}.contract`)),
			functionName: nonemptyString(baseline['functionName'], `${storageLabel}.functionName`, 256),
			value: nonemptyString(baseline['value'], `${storageLabel}.value`, 8_192),
		}
	})
	const storageBaselineKeys = storageBaselines.map(storageBaselineKey)
	if (new Set(storageBaselineKeys).size !== storageBaselineKeys.length) throw new Error(`${label}.semanticExpectation.storageBaselines contains duplicates`)
	const parsedEvidence = parseEvidenceArray(expectation['evidence'], `${label}.semanticExpectation.evidence`)
	for (const item of parsedEvidence) {
		if (item.kind === 'balance-change') {
			const expectedKey = `${item.account.toLowerCase()}:${item.asset === 'ETH' ? 'eth' : item.asset.toLowerCase()}`
			if (!baselineKeys.includes(expectedKey)) throw new Error(`${label}.semanticExpectation is missing a baseline for balance-change evidence ${expectedKey}`)
		}
		if (item.kind === 'storage-postcondition' && item.relation === 'changed') {
			if (item.args === undefined) throw new Error(`${label}.semanticExpectation contains changed storage evidence without arguments`)
			const expectedKey = storageBaselineKey({ args: item.args, contract: item.contract, functionName: item.functionName })
			if (!storageBaselineKeys.includes(expectedKey)) throw new Error(`${label}.semanticExpectation is missing a baseline for changed storage evidence ${expectedKey}`)
		}
	}
	const maxBlockNumber = BigInt(unsignedIntegerString(intent['maxBlockNumber'], `${label}.maxBlockNumber`))
	if (mode === 'private' && submissionBlock !== undefined && maxBlockNumber < submissionBlock) throw new Error(`${label}.maxBlockNumber precedes its submission block`)
	return {
		...(cancellationHash === undefined ? {} : { cancellationHash }),
		data,
		hash: transactionHash,
		id: identifier(intent['id'], `${label}.id`),
		label: nonemptyString(intent['label'], `${label}.label`),
		maxBlockNumber,
		mode,
		nonce,
		operationId: identifier(intent['operationId'], `${label}.operationId`),
		...(recoveryBlocker === undefined ? {} : { recoveryBlocker }),
		...(replacementHash === undefined ? {} : { replacementHash }),
		semanticExpectation: {
			balanceBaselines,
			evidence: parsedEvidence,
			postconditions: stringArray(expectation['postconditions'], `${label}.semanticExpectation.postconditions`),
			storageBaselines,
		},
		sender,
		serializedTransaction: rawTransaction,
		signedAt: timestamp(intent['signedAt'], `${label}.signedAt`),
		status,
		stepId: identifier(intent['stepId'], `${label}.stepId`),
		...(submissionBlock === undefined ? {} : { submissionBlock }),
		...(submittedAt === undefined ? {} : { submittedAt }),
		to,
		value: transactionValue,
		workflowId: identifier(intent['workflowId'], `${label}.workflowId`),
	}
}

export function parseProtocolIndex(value: unknown, expectedChainId: number) {
	return parseStoredProtocolIndex(value, expectedChainId)
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
	let handle: ProtocolIndexFileHandle | undefined
	try {
		handle = await filesystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) {
			throw new Error(`Chaos-bot state ${path} must be a regular file`)
		}
		if ((metadata.mode & 0o777) !== 0o600) {
			throw new Error(`Chaos-bot state ${path} must have owner-only mode 0600`)
		}
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
			throw new Error(`Chaos-bot state ${path} must be owned by the bot process user`)
		}
		if (!Number.isSafeInteger(metadata.size) || metadata.size < 0 || metadata.size > MAXIMUM_STATE_BYTES) {
			throw new Error(`Chaos-bot state exceeds the ${MAXIMUM_STATE_BYTES.toString()}-byte safety limit`)
		}
		contents = await handle.readFile({ encoding: 'utf8' })
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return initialDurableState(expectedChainId)
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOOP') {
			throw new Error(`Chaos-bot state ${path} must not be a symbolic link`)
		}
		throw error
	} finally {
		await handle?.close()
	}
	if (Buffer.byteLength(contents, 'utf8') > MAXIMUM_STATE_BYTES) throw new Error(`Chaos-bot state exceeds the ${MAXIMUM_STATE_BYTES.toString()}-byte safety limit`)
	let value: unknown
	try {
		value = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Chaos-bot state is not valid JSON: ${error.message}`)
		throw error
	}
	const state = requiredRecord(value, 'chaos-bot state')
	assertExactKeys(state, ['activities', 'chainId', 'obligationTombstones', 'obligations', 'pendingTransactions', 'profileId', 'protocolIndex', 'safetyPaused', 'scheduler', 'signerAddress', 'version', 'workflows'], [], 'chaos-bot state')
	if (state['version'] !== DURABLE_STATE_VERSION) throw new Error('Chaos-bot state version is unsupported')
	if (state['chainId'] !== expectedChainId) throw new Error(`Chaos-bot state belongs to chain ${String(state['chainId'])}, expected chain ${expectedChainId.toString()}`)
	if (typeof state['safetyPaused'] !== 'boolean') {
		throw new Error('chaos-bot state.safetyPaused must be a boolean')
	}
	if (!Array.isArray(state['activities']) || !Array.isArray(state['obligationTombstones']) || !Array.isArray(state['obligations']) || !Array.isArray(state['pendingTransactions']) || !Array.isArray(state['workflows'])) throw new Error('Chaos-bot state collections must be arrays')
	if (state['activities'].length > MAXIMUM_ACTIVITY_COUNT) throw new Error(`Chaos-bot state contains more than ${MAXIMUM_ACTIVITY_COUNT.toString()} activities`)
	if (state['obligationTombstones'].length > MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) throw new Error(`Chaos-bot state contains more than ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} obligation tombstones`)
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
	if (new Set(pendingTransactions.map(intent => intent.id)).size !== pendingTransactions.length) throw new Error('Chaos-bot state contains duplicate transaction intent IDs')
	if (new Set(pendingTransactions.map(intent => intent.nonce.toString())).size !== pendingTransactions.length) throw new Error('Chaos-bot state contains duplicate pending transaction nonces')
	for (const intent of pendingTransactions) {
		if (signerAddress === undefined || intent.sender.toLowerCase() !== signerAddress.toLowerCase()) {
			throw new Error(`Transaction intent ${intent.id} does not match the durable signer scope`)
		}
		const workflow = workflowById.get(intent.workflowId)
		if (workflow === undefined) throw new Error(`Transaction intent ${intent.id} references unknown workflow ${intent.workflowId}`)
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
			if ((step.status === 'planned' || step.status === 'blocked') && (step.transactionHash !== undefined || step.transactionIntentId !== undefined)) {
				throw new Error(`Workflow step ${workflow.id}/${step.id} cannot discard a recorded transaction while ${step.status}`)
			}
		}
	}
	const protocolIndex = await durableProtocolIndex(state['protocolIndex'], protocolIndexStatePath, expectedChainId, filesystem, prevalidatedProtocolIndex)
	if (protocolIndex !== undefined && signerAddress !== undefined && protocolIndex.wallet.toLowerCase() !== signerAddress.toLowerCase()) {
		throw new Error('Protocol index wallet does not match the durable signer scope')
	}
	return {
		activities: state['activities'].map(parseActivity),
		chainId: expectedChainId,
		obligationTombstones,
		obligations,
		pendingTransactions,
		profileId: identifier(state['profileId'], 'profileId'),
		protocolIndex,
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

function serializedScheduler(scheduler: SchedulerState) {
	return {
		lastDelaySeconds: scheduler.lastDelaySeconds ?? null,
		lastRunAt: scheduler.lastRunAt ?? null,
		nextRunAt: scheduler.nextRunAt ?? null,
		selectedOperationId: scheduler.selectedOperationId ?? null,
		status: scheduler.status,
	}
}

export function serializedDurableState(
	state: Pick<DurableState, 'activities' | 'chainId' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'profileId' | 'protocolIndex' | 'safetyPaused' | 'scheduler' | 'signerAddress' | 'workflows'>,
	persistedProtocolIndex: ChaosProtocolIndex | ProtocolIndexReference | null = state.protocolIndex ?? null,
) {
	return {
		activities: state.activities,
		chainId: state.chainId,
		obligationTombstones: state.obligationTombstones,
		obligations: state.obligations,
		pendingTransactions: state.pendingTransactions.map(intent => ({
			...intent,
			maxBlockNumber: intent.maxBlockNumber.toString(),
			nonce: intent.nonce.toString(),
			submissionBlock: intent.submissionBlock?.toString(),
			value: intent.value.toString(),
		})),
		profileId: state.profileId,
		protocolIndex: persistedProtocolIndex,
		safetyPaused: state.safetyPaused,
		scheduler: serializedScheduler(state.scheduler),
		signerAddress: state.signerAddress ?? null,
		version: DURABLE_STATE_VERSION,
		workflows: state.workflows,
	}
}

function newestIds<T extends { id: string; updatedAt: string }>(values: readonly T[], limit: number) {
	return new Set(
		[...values]
			.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
			.slice(0, limit)
			.map(value => value.id),
	)
}

function replaceArrayContents<T>(target: T[], retained: readonly T[]) {
	target.splice(0, target.length, ...retained)
}

export function compactDurableState(state: Pick<DurableState, 'activities' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'workflows'>) {
	if (state.activities.length > MAXIMUM_ACTIVITY_COUNT) state.activities.splice(MAXIMUM_ACTIVITY_COUNT)
	const tombstones = new Map(state.obligationTombstones.map(tombstone => [tombstone.id, tombstone]))
	for (const obligation of state.obligations) {
		if (obligation.status !== 'completed' && obligation.status !== 'abandoned') continue
		if (tombstones.has(obligation.id)) continue
		const workflow = state.workflows.find(candidate => candidate.id === obligation.workflowId)
		tombstones.set(obligation.id, {
			id: obligation.id,
			resolution: obligation.status,
			resolvedAt: obligation.status === 'completed' ? (obligation.completedAt ?? obligation.updatedAt) : (obligation.resolvedAt ?? obligation.updatedAt),
			resolvedAtBlock: workflow?.createdAtBlock ?? '0',
			...(obligation.status === 'abandoned'
				? {
						resolutionReason: obligation.resolutionReason ?? 'Manually abandoned by the operator',
					}
				: {}),
		})
	}
	if (tombstones.size > MAXIMUM_OBLIGATION_TOMBSTONE_COUNT) {
		throw new Error(`Chaos-bot state contains more than ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} obligation tombstones`)
	}
	replaceArrayContents(state.obligationTombstones, [...tombstones.values()])
	const terminalObligations = state.obligations.filter(obligation => obligation.status === 'abandoned' || obligation.status === 'completed' || obligation.status === 'failed')
	const retainedTerminalObligationIds = newestIds(terminalObligations, MAXIMUM_TERMINAL_OBLIGATION_COUNT)
	const retainedObligations = state.obligations.filter(obligation => (obligation.status !== 'abandoned' && obligation.status !== 'completed' && obligation.status !== 'failed' ? true : retainedTerminalObligationIds.has(obligation.id)))
	replaceArrayContents(state.obligations, retainedObligations)
	const protectedWorkflowIds = new Set([...state.pendingTransactions.map(intent => intent.workflowId), ...state.obligations.map(obligation => obligation.workflowId)])
	const terminalWorkflows = state.workflows.filter(workflow => workflow.status === 'abandoned' || workflow.status === 'completed' || workflow.status === 'failed')
	const retainedTerminalWorkflowIds = newestIds(terminalWorkflows, MAXIMUM_TERMINAL_WORKFLOW_COUNT)
	const retainedWorkflows = state.workflows.filter(workflow => {
		if (workflow.status !== 'abandoned' && workflow.status !== 'completed' && workflow.status !== 'failed') return true
		return protectedWorkflowIds.has(workflow.id) || retainedTerminalWorkflowIds.has(workflow.id)
	})
	replaceArrayContents(state.workflows, retainedWorkflows)
	return state
}

type PersistableDurableState = Pick<DurableState, 'activities' | 'chainId' | 'obligationTombstones' | 'obligations' | 'pendingTransactions' | 'profileId' | 'protocolIndex' | 'safetyPaused' | 'scheduler' | 'signerAddress' | 'workflows'>

function snapshotDurableState(state: PersistableDurableState) {
	compactDurableState(state)
	const protocolIndex = state.protocolIndex === undefined ? undefined : snapshotProtocolIndex(state.protocolIndex, state.chainId)
	state.protocolIndex = protocolIndex
	const snapshot: PersistableDurableState = {
		activities: [...state.activities],
		chainId: state.chainId,
		obligationTombstones: [...state.obligationTombstones],
		obligations: [...state.obligations],
		pendingTransactions: [...state.pendingTransactions],
		profileId: state.profileId,
		protocolIndex: undefined,
		safetyPaused: state.safetyPaused,
		scheduler: { ...state.scheduler },
		signerAddress: state.signerAddress,
		workflows: [...state.workflows],
	}
	const serializedState = structuredClone(serializedDurableState(snapshot, null))
	return { protocolIndex, serializedState }
}

async function persistDurableStateSnapshot(path: string, chainId: number, contents: string, filesystem: StateFilesystem, protocolIndex: PrevalidatedProtocolIndex) {
	if (Buffer.byteLength(contents, 'utf8') > MAXIMUM_STATE_BYTES) throw new Error(`Chaos-bot state exceeds the ${MAXIMUM_STATE_BYTES.toString()}-byte safety limit`)
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const handle = await filesystem.open(temporaryPath, 'wx', 0o600)
		try {
			await handle.writeFile(contents, { encoding: 'utf8' })
			await handle.chmod(0o600)
			await handle.sync()
		} finally {
			await handle.close()
		}
		await loadDurableStateFile(temporaryPath, chainId, filesystem, path, protocolIndex)
		await filesystem.rename(temporaryPath, path)
		const directoryHandle = await filesystem.open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
}

export async function saveDurableState(path: string, state: PersistableDurableState, filesystem: StateFilesystem = stateFilesystem) {
	const resolvedPath = resolve(path)
	const chainId = state.chainId
	const snapshot = snapshotDurableState(state)
	const previous = stateWriteQueues.get(resolvedPath)
	const write = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined)).then(async () => {
		const reference = snapshot.protocolIndex === undefined ? undefined : await persistProtocolIndexGeneration(resolvedPath, snapshot.protocolIndex, filesystem)
		const contents = `${JSON.stringify({ ...snapshot.serializedState, protocolIndex: reference ?? null }, undefined, 2)}\n`
		await persistDurableStateSnapshot(resolvedPath, chainId, contents, filesystem, { index: snapshot.protocolIndex, reference })
		await pruneProtocolIndexGenerations(resolvedPath, reference, filesystem).catch(() => undefined)
	})
	const tracked = write.finally(() => {
		if (stateWriteQueues.get(resolvedPath) === tracked) stateWriteQueues.delete(resolvedPath)
	})
	stateWriteQueues.set(resolvedPath, tracked)
	await tracked
}

export function recordActivity(state: Pick<RuntimeState, 'activities'>, activity: Omit<Activity, 'at'> & { at?: string | undefined }) {
	state.activities.unshift({
		...activity,
		at: activity.at ?? new Date().toISOString(),
	})
	state.activities = state.activities.slice(0, MAXIMUM_ACTIVITY_COUNT)
}
