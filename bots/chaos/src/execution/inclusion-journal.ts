import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { confirmCanonicalReceiptFinality } from '@zoltar/bot-shared/execution/canonical-finality'
import { requestTransport } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { isHash32 } from '@zoltar/bot-shared/infrastructure/json-validation'
import type { Hex } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { recordActivity, type PendingTransactionIntent, type RuntimeState } from '../state/operator-state.ts'
import type { IncludedTransaction } from '../state/included-transactions.ts'
import { agreedLatestBlock, executionReadClients, requiredConnectivity, type ExecutionEnvironment } from './transaction-executor.ts'
import { persist } from './recovery-journal.ts'
import { TransactionAwaitingRecovery } from './receipt-validation.ts'

export async function assertReceiptStillCanonical(environment: ExecutionEnvironment, receipt: { blockNumber: bigint; blockHash: Hex }) {
	const anchor = await agreedLatestBlock(environment, 'receipt disposition anchor')
	const readers = executionReadClients(environment).filter(reader => anchor.attestingRpcUrls.has(reader.rpcUrl))
	const canonical = await settledQuorumValue(
		'receipt disposition block identity',
		readers.map(async ({ client, endpoint }) => {
			const before = await client.getBlock({ blockNumber: receipt.blockNumber })
			const after = await client.getBlock({ blockNumber: receipt.blockNumber })
			if (before.number !== receipt.blockNumber || after.number !== receipt.blockNumber || before.hash === undefined || after.hash?.toLowerCase() !== before.hash.toLowerCase()) throw new Error('Receipt block changed during semantic evidence verification')
			return { endpoint, value: before.hash.toLowerCase() }
		}),
		requiredConnectivity(environment.settings).rpcQuorum,
	)
	if (canonical !== receipt.blockHash.toLowerCase()) throw new Error('Receipt is no longer canonical after semantic evidence verification')
}

export function retainIncludedTransaction(state: RuntimeState, intent: PendingTransactionIntent, receipt: { blockHash: Hex; blockNumber: bigint; transactionHash: Hex }) {
	if (state.includedTransactions.length >= 100) throw new Error('Transaction rollback journal is full; wait for earlier inclusions to finalize')
	if (state.includedTransactions.some(record => record.intent.id === intent.id)) throw new Error('Transaction already has an inclusion rollback record')
	const workflow = state.workflows.find(candidate => candidate.id === intent.workflowId)
	if (workflow === undefined) throw new Error('Included transaction workflow is missing')
	state.includedTransactions.push(structuredClone({ blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, receiptHash: receipt.transactionHash, intent, workflow, obligations: state.obligations.filter(obligation => obligation.workflowId === workflow.id), retirement: state.retirement }))
}

function activateNextRollbackIntent(state: RuntimeState) {
	if (state.pendingTransactions.length !== 0 || state.rollbackQueue.length === 0) return false
	state.rollbackQueue.sort((a, b) => (a.intent.nonce < b.intent.nonce ? -1 : 1))
	const queued = state.rollbackQueue[0]
	if (queued === undefined) throw new Error('Rollback queue changed before activation')
	const workflow = state.workflows.find(candidate => candidate.id === queued.intent.workflowId)
	const saved = queued.workflow.steps.find(step => step.id === queued.intent.stepId)
	if (workflow === undefined || saved === undefined) throw new Error('Queued rollback transaction is missing its workflow step')
	const index = workflow.steps.findIndex(step => step.id === saved.id)
	const step = structuredClone(saved)
	step.status = queued.intent.status === 'signed' ? 'signed' : 'submitted'
	if (index < 0) workflow.steps.push(step)
	else workflow.steps[index] = step
	delete workflow.completedAt
	workflow.status = 'waiting-transaction'
	workflow.updatedAt = new Date().toISOString()
	state.pendingTransactions.push(queued.intent)
	state.rollbackQueue.shift()
	return true
}

export async function advanceRollbackQueue(environment: ExecutionEnvironment) {
	if (environment.state.pendingTransactions.length !== 0 || environment.state.rollbackQueue.length === 0) return
	const snapshot = structuredClone(environment.state)
	try {
		activateNextRollbackIntent(environment.state)
		await persist(environment)
	} catch (error) {
		Object.assign(environment.state, snapshot)
		try {
			await persist(environment)
		} catch (restoration) {
			throw new AggregateError([error, restoration], 'Rollback queue could not be durably advanced or restored')
		}
		throw error
	}
}

/** Undo local effects, retaining every signed nonce for ordered receipt reconciliation. */
function rollbackIncludedTransactions(state: RuntimeState, first: IncludedTransaction) {
	const affected = state.includedTransactions.filter(record => record.intent.nonce >= first.intent.nonce).sort((a, b) => (a.intent.nonce < b.intent.nonce ? -1 : 1))
	const currentWorkflows = structuredClone(state.workflows)
	const currentObligations = structuredClone(state.obligations)
	const queued = [
		...affected.map(record => ({ intent: structuredClone(record.intent), workflow: structuredClone(record.workflow) })),
		...structuredClone(state.rollbackQueue),
		...state.pendingTransactions.map(intent => {
			const workflow = currentWorkflows.find(candidate => candidate.id === intent.workflowId)
			if (workflow === undefined) throw new Error('Rollback transaction workflow is missing')
			return { intent: structuredClone(intent), workflow }
		}),
	].sort((a, b) => (a.intent.nonce < b.intent.nonce ? -1 : 1))
	const restored = new Set<string>()
	const obligationIds = new Set<string>()
	for (const record of affected) {
		const id = record.workflow.id
		if (restored.has(id)) continue
		state.workflows = state.workflows.filter(workflow => workflow.id !== id)
		state.workflows.push(structuredClone(record.workflow))
		for (const obligation of state.obligations.filter(obligation => obligation.workflowId === id)) obligationIds.add(obligation.id)
		for (const obligation of record.obligations) obligationIds.add(obligation.id)
		state.obligations = state.obligations.filter(obligation => obligation.workflowId !== id)
		state.obligations.push(...structuredClone(record.obligations).map(obligation => ({ ...obligation, automaticRetryCount: Math.max(obligation.automaticRetryCount, currentObligations.find(current => current.id === obligation.id)?.automaticRetryCount ?? 0) })))
		restored.add(id)
	}
	// Only the earliest nonce owns a live workflow step. Later retries may reuse that same step ID.
	for (const { intent } of queued) {
		const workflow = state.workflows.find(candidate => candidate.id === intent.workflowId)
		if (workflow === undefined) throw new Error('Rollback transaction workflow is missing')
		const step = workflow.steps.find(candidate => candidate.id === intent.stepId)
		if (step !== undefined) {
			step.status = 'planned'
			delete step.transactionHash
			delete step.transactionIntentId
			delete step.confirmedAt
			delete step.failure
			delete step.failureKind
		}
		delete workflow.completedAt
		workflow.status = 'blocked'
		workflow.updatedAt = new Date().toISOString()
		delete intent.observation
		delete intent.recoveryBlocker
	}
	state.rollbackQueue = queued
	state.pendingTransactions = []
	activateNextRollbackIntent(state)
	state.includedTransactions = state.includedTransactions.filter(record => record.intent.nonce < first.intent.nonce)
	state.obligationTombstones = state.obligationTombstones.filter(tombstone => !obligationIds.has(tombstone.id))
	// Keep operator controls, but rewind derived retirement accounting and discard completion proofs.
	if (state.retirement.requestedAt === first.retirement.requestedAt) {
		state.retirement.lastObservedBalances = structuredClone(first.retirement.lastObservedBalances)
		state.retirement.recoveredBalances = structuredClone(first.retirement.recoveredBalances)
		state.retirement.finalSweepStartedAt = first.retirement.finalSweepStartedAt
	}
	state.retirement.positions = [...structuredClone(first.retirement.positions), ...state.retirement.positions.filter(position => position.registeredBy === 'operator' && !first.retirement.positions.some(previous => previous.id === position.id))]
	state.retirement.blockers = []
	delete state.retirement.completionEvidence
	delete state.retirement.profileReplacementOverride
	if (state.retirement.status !== 'inactive') state.retirement.status = 'draining'
	state.protocolIndex = undefined
	state.lifecyclePresenceBlocker = undefined
	state.evaluations = []
	state.inventory = { eth: '0', rep: [], weth: '0' }
	state.inventoryAddress = undefined
	state.topology = undefined
	state.lastScanAt = undefined
	state.lastScannedBlock = undefined
	state.scheduler.status = state.paused ? 'paused' : 'idle'
	state.scheduler.nextRunAt = undefined
	state.scheduler.selectedOperationId = undefined
	recordActivity(state, { type: 'recovery', status: 'info', hash: first.receiptHash, message: `Chain reorganization: rolled back ${affected.length.toString()} transaction outcomes; reconciling retained signed transactions before new work` })
}

export async function reconcileIncludedTransactions(environment: ExecutionEnvironment) {
	const { state } = environment
	if (state.includedTransactions.length === 0) {
		await advanceRollbackQueue(environment)
		return false
	}
	const anchor = await agreedLatestBlock(environment, 'included transaction reconciliation')
	const readers = executionReadClients(environment).filter(reader => anchor.attestingRpcUrls.has(reader.rpcUrl))
	const quorum = requiredConnectivity(environment.settings).rpcQuorum
	for (const record of [...state.includedTransactions].sort((a, b) => (a.intent.nonce < b.intent.nonce ? -1 : 1))) {
		if (anchor.number < record.blockNumber) throw new Error('RPC head precedes a retained transaction inclusion; retry reconciliation')
		const canonicalHash = await settledQuorumValue(
			'included transaction block identity',
			readers.map(async ({ client, endpoint }) => {
				const before = await client.getBlock({ blockNumber: record.blockNumber })
				const after = await client.getBlock({ blockNumber: record.blockNumber })
				if (before.number !== record.blockNumber || after.number !== record.blockNumber || before.hash === undefined || after.hash?.toLowerCase() !== before.hash.toLowerCase()) throw new Error('Included transaction block changed during reconciliation')
				return { endpoint, value: before.hash.toLowerCase() }
			}),
			quorum,
		)
		if (canonicalHash !== record.blockHash.toLowerCase()) {
			const snapshot = structuredClone(state)
			try {
				rollbackIncludedTransactions(state, record)
				await persist(environment)
			} catch (error) {
				Object.assign(state, snapshot)
				try {
					await persist(environment)
				} catch (restoration) {
					throw new AggregateError([error, restoration], 'Reorganization rollback could not be durably committed or restored')
				}
				throw error
			}
			return true
		}
	}
	// Finality only releases rollback records; it never gates workflow progression.
	const finalizedReaders = readers.map(reader => ({
		getBlock: reader.client.getBlock,
		getBlockNumber: reader.client.getBlockNumber,
		getFinalizedBlock: async () => {
			const result = await requestTransport<unknown>(reader.transport, { method: 'eth_getBlockByNumber', params: ['finalized', false] })
			if (typeof result !== 'object' || result === null) throw new Error('Finalized checkpoint is unavailable')
			const hash = Reflect.get(result, 'hash')
			const number = Reflect.get(result, 'number')
			if (!isHash32(hash) || typeof number !== 'string' || !/^0x[0-9a-f]+$/i.test(number)) throw new Error('Finalized checkpoint has invalid identity')
			return { hash, number: BigInt(number) }
		},
	}))
	const retained: IncludedTransaction[] = []
	for (const record of state.includedTransactions) {
		try {
			if (
				await confirmCanonicalReceiptFinality(
					finalizedReaders,
					readers.map(reader => reader.endpoint),
					'rollback journal finality',
					record,
					{ blockTag: 'finalized' },
					undefined,
					quorum,
				)
			)
				continue
		} catch (error) {
			if (!(error instanceof ConnectivityDegradedError)) throw error
			// Keep rollback evidence when finality is temporarily unavailable.
		}
		retained.push(record)
	}
	if (retained.length !== state.includedTransactions.length) {
		const previous = state.includedTransactions
		state.includedTransactions = retained
		try {
			await persist(environment)
		} catch (error) {
			state.includedTransactions = previous
			try {
				await persist(environment)
			} catch (restoration) {
				throw new AggregateError([error, restoration], 'Finalized rollback journal could not be durably committed or restored')
			}
			throw error
		}
	}
	await advanceRollbackQueue(environment)
	return false
}

export async function assertIncludedTransactionsCanonical(environment: ExecutionEnvironment) {
	if (await reconcileIncludedTransactions(environment)) {
		const first = environment.state.pendingTransactions[0]
		if (first === undefined) throw new Error('Reorganization rollback lost the first signed transaction')
		throw new TransactionAwaitingRecovery(first.label, first.hash, 'chain reorganization rolled back included transactions; reconciling their canonical outcomes', 'pending')
	}
	if (environment.state.includedTransactions.length >= 100) throw new Error('Rollback journal is full; waiting for earlier included transactions to finalize before signing')
}
