import { optionalRecord } from '@zoltar/bot-shared/infrastructure/json-validation'

const activeWorkflowStatuses: ReadonlySet<string> = new Set(['blocked', 'running', 'waiting-continuation', 'waiting-obligation', 'waiting-transaction'])

export function isRecoveryWorkflowStatus(status: unknown) {
	return typeof status === 'string' && activeWorkflowStatuses.has(status)
}

export function obligationRequiresRecovery(value: unknown) {
	const obligation = optionalRecord(value)
	if (obligation === undefined) return false
	const status = obligation['status']
	return status === 'blocked' || status === 'executing' || status === 'failed' || status === 'pending' || (status === 'deferred' && typeof obligation['notBefore'] === 'string')
}
