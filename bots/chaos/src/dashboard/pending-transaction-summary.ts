export type PendingTransactionObservationView = {
	checkedAt?: string | undefined
	head?: string | number | undefined
	includedBlock?: string | number | undefined
	kind?: string | undefined
}

export type PendingTransactionView = {
	cancellationHash?: string | undefined
	maxBlockNumber?: string | number | undefined
	observation?: PendingTransactionObservationView | undefined
	recoveryBlocker?: string | undefined
	replacementHash?: string | undefined
	status?: string | undefined
	submittedAt?: string | undefined
}

export type PendingTransactionSummary = {
	detail: string
	headline: string
	tone: 'info' | 'warning'
}

function blockNumber(value: string | number | undefined) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : undefined
	return value !== undefined && /^(?:0|[1-9]\d*)$/.test(value) ? BigInt(value) : undefined
}

function blocks(count: bigint) {
	return `${count.toString()} block${count === 1n ? '' : 's'}`
}

function age(value: string | undefined, now: number) {
	if (value === undefined) return undefined
	const timestamp = Date.parse(value)
	if (!Number.isFinite(timestamp)) return undefined
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
	if (seconds < 60) return `${seconds.toString()}s ago`
	if (seconds < 3_600) return `${Math.floor(seconds / 60).toString()}m ago`
	return `${Math.floor(seconds / 3_600).toString()}h ago`
}

function submissionWindow(head: bigint | undefined, maxBlockNumber: bigint | undefined) {
	if (head === undefined || maxBlockNumber === undefined) return undefined
	return head >= maxBlockNumber ? `resubmission window closed at block ${maxBlockNumber.toString()}` : `resubmission window closes at block ${maxBlockNumber.toString()} (${blocks(maxBlockNumber - head)} left)`
}

function joined(parts: readonly (string | undefined)[]) {
	return parts.filter((part): part is string => part !== undefined).join(' · ')
}

function observedSummary(transaction: PendingTransactionView, observation: PendingTransactionObservationView, now: number): PendingTransactionSummary {
	const checked = `checked ${age(observation.checkedAt, now) ?? 'at an unknown time'}`
	const head = blockNumber(observation.head)
	const headLabel = head === undefined ? undefined : `quorum block ${head.toString()}`
	const maxBlockNumber = blockNumber(transaction.maxBlockNumber)
	const includedBlock = blockNumber(observation.includedBlock)
	const sinceInclusion = includedBlock === undefined || head === undefined ? undefined : `${blocks(head - includedBlock)} after inclusion`
	switch (observation.kind) {
		case 'awaiting-finality':
			return { detail: joined([headLabel, sinceInclusion, checked]), headline: `Included in block ${includedBlock?.toString() ?? '—'}; waiting for finality`, tone: 'info' }
		case 'evidence-unavailable':
			return { detail: joined([headLabel, sinceInclusion, checked]), headline: `Included in block ${includedBlock?.toString() ?? '—'}; confirmation evidence unavailable`, tone: 'warning' }
		case 'in-mempool':
			return { detail: joined([headLabel, submissionWindow(head, maxBlockNumber), checked]), headline: 'Not included yet; the RPC quorum sees it pending', tone: 'info' }
		case 'resubmitted':
			return { detail: joined([headLabel, submissionWindow(head, maxBlockNumber), checked]), headline: 'Not included; identical signed bytes were resubmitted', tone: 'warning' }
		case 'not-visible':
			return { detail: joined([headLabel, submissionWindow(head, maxBlockNumber), checked]), headline: 'Not included and not visible to the RPC quorum', tone: 'warning' }
		case 'window-closed':
			return { detail: joined([headLabel, submissionWindow(head, maxBlockNumber), checked]), headline: 'Not included; the resubmission window closed', tone: 'warning' }
		case 'manual-reconciliation':
			return { detail: joined([headLabel, checked]), headline: 'Not included; the signer nonce no longer matches', tone: 'warning' }
		default:
			return { detail: joined([headLabel, checked]), headline: 'Waiting for the transaction', tone: 'info' }
	}
}

function includedKind(kind: string | undefined) {
	return kind === 'awaiting-finality' || kind === 'evidence-unavailable'
}

/**
 * Explains why a transaction is still waiting, so an operator can tell an inclusion that is
 * waiting for finality apart from bytes the network has not picked up. A recovery blocker
 * already names the required operator action, so while the transaction is not included it
 * becomes the headline instead of a repeat.
 */
export function pendingTransactionSummary(transaction: PendingTransactionView, now = Date.now()): PendingTransactionSummary {
	// Recovery verifies a queued candidate before anything else, so an earlier observation no longer describes the pass.
	if (transaction.replacementHash !== undefined) return { detail: 'Waiting for its finalized receipt before the original intent is closed.', headline: 'Verifying the queued replacement', tone: 'info' }
	if (transaction.cancellationHash !== undefined) return { detail: 'Waiting for its finalized receipt before the original intent is closed.', headline: 'Verifying the queued cancellation', tone: 'info' }
	const observation = transaction.observation
	if (observation === undefined) {
		if (transaction.recoveryBlocker !== undefined) return { detail: '', headline: transaction.recoveryBlocker, tone: 'warning' }
		if (transaction.status === 'signed') return { detail: '', headline: 'Signed; not broadcast yet', tone: 'info' }
		const submitted = age(transaction.submittedAt, now)
		return { detail: submitted === undefined ? '' : `Submitted ${submitted}`, headline: 'Broadcast; not checked yet', tone: 'info' }
	}
	const summary = observedSummary(transaction, observation, now)
	return transaction.recoveryBlocker === undefined || includedKind(observation.kind) ? summary : { detail: summary.detail, headline: transaction.recoveryBlocker, tone: 'warning' }
}
