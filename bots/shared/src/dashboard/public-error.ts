import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '../execution/process-lock.ts'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { logEvent, type BotName } from '../infrastructure/log-event.ts'
import { publicOperatorFailure } from './public-failures.ts'
import { dashboardJson } from './security.ts'

/** Writes a failed dashboard request's raw error to the protected process log and returns that raw message. */
export function logDashboardFailure(bot: BotName, operation: string, error: unknown) {
	const message = errorMessage(error)
	logEvent(bot, 'dashboardOperationFailed', { operation, error: message }, 'error')
	return message
}

/**
 * The JSON error response for a failed dashboard request. The raw error only reaches the protected log; the browser gets
 * `fallback`, or with `categorize` a redacted description of what the bot was attempting when the error names one.
 */
export function publicDashboardError(bot: BotName, error: unknown, status: number, operation: string, fallback: string, categorize = false) {
	const message = logDashboardFailure(bot, operation, error)
	if (error instanceof ExecutionSignerLockHeldError) return dashboardJson({ error: signerLockConflictMessage(error) }, status)
	return dashboardJson({ error: categorize ? publicOperatorFailure(message, fallback) : fallback }, status)
}
