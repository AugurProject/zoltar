import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import type { DurableObligation, DurableWorkflow, PendingTransactionIntent } from './operator-state.ts'
import { parseRetirementState, type DurableRetirementState } from './retirement.ts'
import { assertExactKeys, hash, requiredRecord, unsignedIntegerString } from './validators.ts'
import { serializedPendingTransactionObservation } from './pending-transaction-observation.ts'

export type RollbackQueuedTransaction = {
	intent: PendingTransactionIntent
	workflow: DurableWorkflow
}

export type IncludedTransaction = RollbackQueuedTransaction & {
	blockHash: Hex
	blockNumber: bigint
	receiptHash: Hex
	obligations: DurableObligation[]
	retirement: DurableRetirementState
}

type SnapshotParsers = {
	intent: (value: unknown, index: number) => Promise<PendingTransactionIntent>
	workflow: (value: unknown, index: number) => DurableWorkflow
	obligation: (value: unknown, index: number) => DurableObligation
}

export function serializedTransactionIntent(intent: PendingTransactionIntent) {
	return { ...intent, maxBlockNumber: intent.maxBlockNumber.toString(), nonce: intent.nonce.toString(), observation: intent.observation === undefined ? undefined : serializedPendingTransactionObservation(intent.observation), submissionBlock: intent.submissionBlock?.toString(), value: intent.value.toString() }
}

export function serializedIncludedTransactions(values: readonly IncludedTransaction[]) {
	return values.map(value => ({ ...value, blockNumber: value.blockNumber.toString(), intent: serializedTransactionIntent(value.intent) }))
}

export function serializedRollbackQueue(values: readonly RollbackQueuedTransaction[]) {
	return values.map(value => ({ ...value, intent: serializedTransactionIntent(value.intent) }))
}

async function parseSnapshot(record: Record<string, unknown>, index: number, label: string, signer: Address | undefined, parsers: SnapshotParsers) {
	const intent = await parsers.intent(record['intent'], index)
	const workflow = parsers.workflow(record['workflow'], index)
	const step = workflow.steps.find(candidate => candidate.id === intent.stepId)
	if (
		signer === undefined ||
		intent.sender.toLowerCase() !== signer.toLowerCase() ||
		workflow.id !== intent.workflowId ||
		workflow.operationId !== intent.operationId ||
		step?.transactionIntentId !== intent.id ||
		step.transactionHash?.toLowerCase() !== intent.hash.toLowerCase() ||
		(step.status !== 'signed' && step.status !== 'submitted')
	)
		throw new Error(`${label} rollback journal does not match its signed intent`)
	return { intent, workflow }
}

export async function parseRollbackQueue(value: unknown, signer: Address | undefined, parsers: SnapshotParsers) {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 100) throw new Error('Rollback queue must contain at most 100 records')
	return Promise.all(
		value.map(async (item, index) => {
			const label = `rollbackQueue[${index.toString()}]`
			const record = requiredRecord(item, label)
			assertExactKeys(record, ['intent', 'workflow'], [], label)
			return parseSnapshot(record, index, label, signer, parsers)
		}),
	)
}

export async function parseIncludedTransactions(value: unknown, signer: Address | undefined, parsers: SnapshotParsers) {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.length > 100) throw new Error('Included transaction journal must contain at most 100 records')
	const records = await Promise.all(
		value.map(async (item, index): Promise<IncludedTransaction> => {
			const label = `includedTransactions[${index.toString()}]`
			const record = requiredRecord(item, label)
			assertExactKeys(record, ['blockHash', 'blockNumber', 'receiptHash', 'intent', 'workflow', 'obligations', 'retirement'], [], label)
			const { intent, workflow } = await parseSnapshot(record, index, label, signer, parsers)
			if (!Array.isArray(record['obligations'])) throw new Error(`${label}.obligations must be an array`)
			const obligations = record['obligations'].map(parsers.obligation)
			if (obligations.some(obligation => obligation.workflowId !== workflow.id)) throw new Error(`${label} obligation does not belong to its rollback workflow`)
			const receiptHash = hash(record['receiptHash'], `${label}.receiptHash`)
			if (![intent.hash, intent.replacementHash, intent.cancellationHash].some(candidate => candidate?.toLowerCase() === receiptHash.toLowerCase())) throw new Error(`${label} receipt hash does not belong to its intent`)
			return { blockHash: hash(record['blockHash'], `${label}.blockHash`), blockNumber: BigInt(unsignedIntegerString(record['blockNumber'], `${label}.blockNumber`)), receiptHash, intent, workflow, obligations, retirement: parseRetirementState(record['retirement'], signer) }
		}),
	)
	if (new Set(records.map(record => record.intent.nonce.toString())).size !== records.length) throw new Error('Included transaction journal contains duplicate nonces')
	return records
}
