import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { MAXIMUM_PUBLIC_FIELD_LENGTH } from '../dashboard/public-fields.ts'
import type { OperationPlan } from '../operations/types.ts'
import { recordActivity, type RuntimeState } from '../state/operator-state.ts'

const truncation = '… (truncated)'

function bounded(value: string) {
	return value.length <= MAXIMUM_PUBLIC_FIELD_LENGTH ? value : `${value.slice(0, MAXIMUM_PUBLIC_FIELD_LENGTH - truncation.length)}${truncation}`
}

export function publicFailureReason(error: unknown) {
	// Replace only sensitive fragments, before truncation, so surrounding RPC and revert
	// diagnostics remain useful and a credential crossing the length limit cannot leak.
	// Mask quoted credentials before URL/path replacement can alter their escape sequences.
	const message = errorMessage(error)
		.replace(
			/(["']?(?:authorization|bearer|password|private[_-]?key|secret|token|api[_-]?key|rpc[_-]?(?:url|endpoint)|calldata|raw[_-]?(?:transaction|tx)|signed[_-]?(?:transaction|tx))["']?\s*[=:]\s*)(?:\[redacted(?: endpoint| path| payload| authorization)?\]|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|(?:(?:Bearer|Basic)\s+)?[^\s,;}]+)/gi,
			'$1[redacted]',
		)
		.replace(/https?:\/\/[^\s<>"']+/gi, '[redacted endpoint]')
		.replace(/(?:[a-z]:\\|\/(?:etc|home|root|tmp|var|workspace)\/)[^\s<>"']+/gi, '[redacted path]')
		.replace(/\bBearer\s+[^\s,;}]+/gi, '[redacted authorization]')
		.replace(/0x[0-9a-f]{130,}/gi, '[redacted payload]')
	return bounded(message.trim() || 'No error message was provided.')
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
	// Show the deepest cause first so a verbose RPC wrapper cannot truncate the revert reason.
	return { summary, ...(causes.length === 0 ? {} : { details: bounded(causes.reverse().join('\nWrapped by: ')) }) }
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
