import { formatAtomicAmount } from '@zoltar/bot-shared/dashboard/amount'
import { formatDate, fullIdentifier, node, transactionExplorerUrl } from './dom.js'
import type { Obligation, OperationEvaluation, Snapshot } from './dashboard-data.ts'

// Pure labels and formatting shared by the dashboard views; none of these read page state.

export const ecosystemOrder = ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const
export const ecosystemLabels = new Map<string, string>([
	['zoltar', 'Zoltar'],
	['statoblast', 'Statoblast'],
	['open-oracle', 'OpenOracle'],
	['trading', 'Trading'],
])

export function transactionIdentifier(explorerUrl: string | undefined, hash: string, type: string) {
	return fullIdentifier(hash, type, { explorerUrl: transactionExplorerUrl(explorerUrl, hash) })
}

export function transactionLine(explorerUrl: string | undefined, prefix: string, hash: string | undefined, type: string) {
	const line = node('small', 'identifier-line')
	line.append(node('span', undefined, prefix))
	if (hash === undefined) line.append(node('span', 'mono muted', 'Unavailable'))
	else line.append(transactionIdentifier(explorerUrl, hash, type))
	return line
}

export function normalizeEcosystem(value: string | undefined): string {
	const normalized = value?.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
	if (normalized === 'openoracle' || normalized === 'oracle') return 'open-oracle'
	const candidate = normalized ?? 'zoltar'
	return ecosystemOrder.some(ecosystem => ecosystem === candidate) ? candidate : 'zoltar'
}

export function ecosystemLabel(value: string | undefined) {
	return ecosystemLabels.get(normalizeEcosystem(value)) ?? 'Zoltar'
}

export function operationIsIndependentlyExecutable(value: OperationEvaluation) {
	return value.independentlyExecutable ?? (value.classification === 'selectable' || value.classification === 'lifecycle-obligation')
}

export function operationIsSelectedForRandomWork(value: OperationEvaluation) {
	return value.classification === 'selectable' && operationIsIndependentlyExecutable(value) && value.randomAllowed === true
}

export function displayedClassification(value: OperationEvaluation) {
	if (value.classification === 'selectable' && !operationIsIndependentlyExecutable(value)) return 'coverage-alias'
	return value.classification
}

export function classificationLabel(value: string | undefined) {
	if (value === 'lifecycle-obligation') return 'Lifecycle obligation'
	if (value === 'excluded-dangerous') return 'Excluded: dangerous'
	if (value === 'role-restricted') return 'Role restricted'
	if (value === 'prerequisite') return 'Workflow prerequisite'
	if (value === 'selectable') return 'Randomly selectable'
	if (value === 'coverage-alias') return 'Coverage alias'
	return 'Classification unavailable'
}

export function parsePositiveNumber(value: string | number | undefined) {
	let parsed = Number.NaN
	if (typeof value === 'number') parsed = value
	else if (value !== undefined) parsed = Number(value)
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

export function publicCandidateCount(value: string | number | undefined) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined
	const count = BigInt(value)
	return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString()
}

export function formatClockDuration(totalSeconds: number) {
	const seconds = Math.max(0, Math.floor(totalSeconds))
	const hours = Math.floor(seconds / 3_600)
	const minutes = Math.floor((seconds % 3_600) / 60)
	const remainingSeconds = seconds % 60
	return hours > 0 ? `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}` : `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

export function formatRelative(value: string | undefined, now = Date.now()) {
	if (value === undefined) return 'Waiting for first scan'
	const timestamp = new Date(value).getTime()
	if (!Number.isFinite(timestamp)) return 'Scan time unavailable'
	const seconds = Math.max(0, Math.floor((now - timestamp) / 1_000))
	if (seconds < 60) return `Scanned ${seconds.toString()}s ago`
	if (seconds < 3_600) return `Scanned ${Math.floor(seconds / 60).toString()}m ago`
	if (seconds < 86_400) return `Scanned ${Math.floor(seconds / 3_600).toString()}h ago`
	return `Scanned ${Math.floor(seconds / 86_400).toString()}d ago`
}

export function obligationDetail(obligation: Obligation) {
	if (obligation.status === 'deferred' && obligation.notBefore !== undefined && obligation.automaticRetryCount !== undefined && obligation.automaticRetryLimit !== undefined) {
		return `${ecosystemLabel(obligation.ecosystem)} · ${obligation.automaticRetryCount.toString()} of ${obligation.automaticRetryLimit.toString()} included attempts failed · next attempt ${formatDate(obligation.notBefore)}`
	}
	if (obligation.status === 'deferred') return `${ecosystemLabel(obligation.ecosystem)} · tracked, not currently actionable`
	return `${ecosystemLabel(obligation.ecosystem)} · due ${formatDate(obligation.dueAt)}`
}

export function recoveryItemCount(value: Snapshot) {
	const selectableContinuation = value.currentWorkflow?.classification === 'selectable' && value.currentWorkflow.status === 'waiting-continuation' ? 1 : 0
	return value.pendingTransactions.length + value.obligations.length + selectableContinuation
}

/** The ETH a step sends, in ETH; a value the planner did not report as a base-unit integer is shown as it arrived. */
export function stepValueLabel(value: string) {
	const formatted = formatAtomicAmount(value, 'ETH')
	return formatted === 'Unavailable' ? value : formatted
}
