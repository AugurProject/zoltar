import { decodeEventLog, parseAbiItem, type Address, type Hash, type Hex } from '@zoltar/bot-shared/ethereum'
import type { OperationEvidence, OperationStep } from '../operations/types.ts'

export type ReceiptLogEvidence = {
	address: Address
	data: Hex
	topics: readonly Hash[]
}

export type SuccessfulReceiptEvidence = {
	blockHash: Hash
	blockNumber: bigint
	logs: readonly ReceiptLogEvidence[]
	status: 'success'
	transactionHash: Hash
}

export type BalanceEvidenceObservation = {
	after: bigint
	before: bigint
	evidence: Extract<OperationEvidence, { kind: 'balance-change' }>
}

export type StorageEvidenceObservation = {
	after: string
	before: string
	evidence: Extract<OperationEvidence, { kind: 'storage-postcondition' }>
}

export type SemanticEvidenceObservations = {
	balances?: readonly BalanceEvidenceObservation[]
	storage?: readonly StorageEvidenceObservation[]
}

function sameAddress(left: string, right: string) {
	return left.toLowerCase() === right.toLowerCase()
}

function matchingBalanceObservation(evidence: Extract<OperationEvidence, { kind: 'balance-change' }>, observations: SemanticEvidenceObservations) {
	return observations.balances?.find(observation => {
		if (!sameAddress(observation.evidence.account, evidence.account)) return false
		if (observation.evidence.asset === 'ETH' || evidence.asset === 'ETH') {
			return observation.evidence.asset === evidence.asset
		}
		return sameAddress(observation.evidence.asset, evidence.asset)
	})
}

function matchingStorageObservation(evidence: Extract<OperationEvidence, { kind: 'storage-postcondition' }>, observations: SemanticEvidenceObservations) {
	return observations.storage?.find(observation => sameAddress(observation.evidence.contract, evidence.contract) && observation.evidence.functionName === evidence.functionName && JSON.stringify(observation.evidence.args) === JSON.stringify(evidence.args))
}

function requireInteger(value: string, label: string) {
	if (!/^-?(?:0|[1-9]\d*)$/.test(value) && !/^0x[0-9a-f]+$/i.test(value)) throw new Error(`${label} is not an integer`)
	return BigInt(value)
}

function canonicalDecodedScalar(value: unknown, label: string) {
	if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'string') return String(value).toLowerCase()
	if (typeof value === 'boolean') return value ? 'true' : 'false'
	throw new Error(`${label} is not a scalar event field`)
}

function decodedEventArguments(evidence: Extract<OperationEvidence, { kind: 'decoded-event-field' }>, receipt: SuccessfulReceiptEvidence) {
	const matchingLogs = receipt.logs.filter(log => sameAddress(log.address, evidence.emitter) && log.topics[0]?.toLowerCase() === evidence.topic0.toLowerCase())
	for (const log of matchingLogs) {
		try {
			const decoded = decodeEventLog({
				abi: [parseAbiItem(evidence.abi)],
				data: log.data,
				topics: log.topics,
			})
			if (typeof decoded.args !== 'object' || decoded.args === null || Array.isArray(decoded.args)) continue
			const argumentsByName = Object.fromEntries(Object.entries(decoded.args))
			const indexedMatches = Object.entries(evidence.indexed).every(([field, expected]) => canonicalDecodedScalar(argumentsByName[field], `${evidence.signature}.${field}`) === canonicalDecodedScalar(expected, `${evidence.signature}.${field} expectation`))
			if (indexedMatches) return argumentsByName
		} catch (error) {
			void error
		}
	}
	throw new Error(`${evidence.signature} did not match the required indexed fields`)
}

function validateDecodedEventEvidence(evidence: Extract<OperationEvidence, { kind: 'decoded-event-field' }>, receipt: SuccessfulReceiptEvidence) {
	const argumentsByName = decodedEventArguments(evidence, receipt)
	const actual = canonicalDecodedScalar(argumentsByName[evidence.field], `${evidence.signature}.${evidence.field}`)
	const expected = canonicalDecodedScalar(evidence.equals, `${evidence.signature}.${evidence.field} expectation`)
	if (actual !== expected) {
		throw new Error(`Expected ${evidence.signature}.${evidence.field} to equal ${String(evidence.equals)}`)
	}
}

function validateBalanceEvidence(evidence: Extract<OperationEvidence, { kind: 'balance-change' }>, observations: SemanticEvidenceObservations) {
	const observation = matchingBalanceObservation(evidence, observations)
	if (observation === undefined) throw new Error(`Missing balance observation for ${evidence.account}`)
	if (evidence.direction === 'increase' && observation.after <= observation.before) {
		throw new Error(`Expected ${evidence.asset} balance to increase for ${evidence.account}`)
	}
	if (evidence.direction === 'decrease' && observation.after >= observation.before) {
		throw new Error(`Expected ${evidence.asset} balance to decrease for ${evidence.account}`)
	}
	if (evidence.direction === 'any' && observation.after === observation.before) {
		throw new Error(`Expected ${evidence.asset} balance to change for ${evidence.account}`)
	}
}

function validateStorageEvidence(evidence: Extract<OperationEvidence, { kind: 'storage-postcondition' }>, observations: SemanticEvidenceObservations) {
	const observation = matchingStorageObservation(evidence, observations)
	if (observation === undefined) {
		throw new Error(`Missing storage observation for ${evidence.contract}.${evidence.functionName}`)
	}
	if (evidence.relation === 'changed') {
		if (observation.after === observation.before) {
			throw new Error(`Expected ${evidence.contract}.${evidence.functionName} to change`)
		}
		return
	}
	if (evidence.expected === undefined) {
		throw new Error(`Storage evidence ${evidence.contract}.${evidence.functionName} is missing an expected value`)
	}
	if (evidence.relation === 'equals') {
		if (observation.after !== evidence.expected) {
			throw new Error(`Expected ${evidence.contract}.${evidence.functionName} to equal ${evidence.expected}`)
		}
		return
	}
	const actual = requireInteger(observation.after, `${evidence.contract}.${evidence.functionName}`)
	const expected = requireInteger(evidence.expected, `${evidence.contract}.${evidence.functionName} expectation`)
	if (evidence.relation === 'greater-than' && actual <= expected) {
		throw new Error(`Expected ${evidence.contract}.${evidence.functionName} to be greater than ${evidence.expected}`)
	}
	if (evidence.relation === 'at-least' && actual < expected) {
		throw new Error(`Expected ${evidence.contract}.${evidence.functionName} to be at least ${evidence.expected}`)
	}
}

export function validateStepReceiptEvidence(step: { evidence: readonly OperationEvidence[]; label: OperationStep['label'] }, receipt: SuccessfulReceiptEvidence, observations: SemanticEvidenceObservations = {}) {
	if (step.evidence.length === 0) throw new Error(`${step.label} does not declare semantic receipt evidence`)
	for (const evidence of step.evidence) {
		if (evidence.kind === 'receipt-success') continue
		if (evidence.kind === 'event') {
			const observed = receipt.logs.some(log => sameAddress(log.address, evidence.emitter) && log.topics[0]?.toLowerCase() === evidence.topic0.toLowerCase())
			if (!observed) throw new Error(`${step.label} did not emit ${evidence.signature}`)
			continue
		}
		if (evidence.kind === 'decoded-event-field') {
			validateDecodedEventEvidence(evidence, receipt)
			continue
		}
		if (evidence.kind === 'balance-change') {
			validateBalanceEvidence(evidence, observations)
			continue
		}
		validateStorageEvidence(evidence, observations)
	}
	return receipt
}

export function requireSuccessfulReceipt(label: string, receipt: Omit<SuccessfulReceiptEvidence, 'status'> & { status: 'reverted' | 'success' }) {
	if (receipt.status !== 'success') throw new Error(`${label} reverted in transaction ${receipt.transactionHash}`)
	return { ...receipt, status: 'success' as const }
}
