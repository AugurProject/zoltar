import { MAXIMUM_PUBLIC_FIELD_LENGTH, safeString } from '../dashboard/public-fields.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, type RuntimeState } from '../state/operator-state.ts'

const withheld = 'Error detail withheld because it may contain sensitive data.'
const truncation = '… (truncated)'

function bounded(value: string) {
	return value.length <= MAXIMUM_PUBLIC_FIELD_LENGTH ? value : `${value.slice(0, MAXIMUM_PUBLIC_FIELD_LENGTH - truncation.length)}${truncation}`
}

export function publicFailureReason(error: unknown) {
	const message = error instanceof Error ? error.message : String(error)
	// Check the full message before truncating so a sensitive suffix cannot escape filtering.
	return safeString(message) === undefined ? withheld : bounded(message.trim() || 'No error message was provided.')
}

/** Preserve the reason and nested RPC/revert causes without publishing raw sensitive errors. */
function preflightFailureActivity(error: unknown) {
	const summary = publicFailureReason(error)
	const causes: string[] = []
	const seen = new Set<unknown>([error])
	let current = error
	while (current instanceof Error && current.cause !== undefined && causes.length < 5) {
		current = current.cause
		if (seen.has(current)) break
		seen.add(current)
		causes.push(publicFailureReason(current))
	}
	return { summary, ...(causes.length === 0 ? {} : { details: bounded(causes.join('\nCaused by: ')) }) }
}

export function recordPreflightFailure(state: Pick<RuntimeState, 'activities'>, plan: Pick<OperationPlan, 'definitionId' | 'ecosystem'>, error: unknown, message: string, type: 'operation' | 'recovery' = 'operation') {
	recordActivity(state, {
		...preflightFailureActivity(error),
		ecosystem: plan.ecosystem,
		message,
		operationId: plan.definitionId,
		status: 'skipped',
		type,
	})
}
