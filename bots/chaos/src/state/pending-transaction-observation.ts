import { timestamp, unsignedIntegerString } from './validators.ts'

type IncludedObservationKind = 'awaiting-finality' | 'evidence-unavailable'
type UnincludedObservationKind = 'in-mempool' | 'manual-reconciliation' | 'not-visible' | 'resubmitted' | 'window-closed'

/** Included kinds carry the block that holds the receipt; the others must not, so the shape enforces the invariant. */
type ObservationInclusion = { includedBlock: bigint; kind: IncludedObservationKind } | { includedBlock?: undefined; kind: UnincludedObservationKind }

/** A single quorum check's outcome, before the journal stamps `checkedAt`; `head` is the shared quorum head when the check ran. */
export type PendingTransactionObservationInput = { head: bigint } & ObservationInclusion

/** What the most recent quorum check learned about a pending intent, so operators can tell inclusion waits from delivery failures. */
export type PendingTransactionObservation = { checkedAt: string } & PendingTransactionObservationInput

export type SerializedPendingTransactionObservation = {
	checkedAt: string
	head: string
	includedBlock?: string | undefined
	kind: PendingTransactionObservation['kind']
}

export function observePendingTransaction(intent: { observation?: PendingTransactionObservation | undefined }, observation: PendingTransactionObservationInput) {
	intent.observation = { checkedAt: new Date().toISOString(), ...observation }
}

export function serializedPendingTransactionObservation(observation: PendingTransactionObservation): SerializedPendingTransactionObservation {
	return {
		checkedAt: observation.checkedAt,
		head: observation.head.toString(),
		includedBlock: observation.includedBlock?.toString(),
		kind: observation.kind,
	}
}

/** Narrows an untrusted value to a journaled observation kind; shared with the dashboard sanitizer so new kinds cannot drift. */
export function pendingTransactionObservationKind(value: unknown): PendingTransactionObservation['kind'] | undefined {
	if (value === 'awaiting-finality' || value === 'evidence-unavailable' || value === 'in-mempool' || value === 'manual-reconciliation' || value === 'not-visible' || value === 'resubmitted' || value === 'window-closed') return value
	return undefined
}

function includedObservationKind(kind: PendingTransactionObservation['kind']): kind is IncludedObservationKind {
	return kind === 'awaiting-finality' || kind === 'evidence-unavailable'
}

export function parsePendingTransactionObservation(value: unknown, label: string): PendingTransactionObservation {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	const observation: Record<string, unknown> = Object.fromEntries(Object.entries(value))
	const unknown = Object.keys(observation).find(key => key !== 'checkedAt' && key !== 'head' && key !== 'includedBlock' && key !== 'kind')
	if (unknown !== undefined) throw new Error(`${label} contains unsupported field ${unknown}`)
	const kind = pendingTransactionObservationKind(observation['kind'])
	if (kind === undefined) throw new Error(`${label}.kind is invalid`)
	const checkedAt = timestamp(observation['checkedAt'], `${label}.checkedAt`)
	const head = BigInt(unsignedIntegerString(observation['head'], `${label}.head`))
	const includedBlock = observation['includedBlock'] === undefined ? undefined : BigInt(unsignedIntegerString(observation['includedBlock'], `${label}.includedBlock`))
	if (includedObservationKind(kind)) {
		if (includedBlock === undefined) throw new Error(`${label}.includedBlock must accompany exactly the included kinds`)
		if (includedBlock > head) throw new Error(`${label}.includedBlock exceeds the observed head`)
		return { checkedAt, head, includedBlock, kind }
	}
	if (includedBlock !== undefined) throw new Error(`${label}.includedBlock must accompany exactly the included kinds`)
	return { checkedAt, head, kind }
}
