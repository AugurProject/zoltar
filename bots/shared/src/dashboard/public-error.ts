import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { logEvent, type BotName } from '../infrastructure/log-event.ts'
import { publicOperatorFailure } from './public-failures.ts'
import { dashboardJson } from './security.ts'

/** The status and JSON body a failed dashboard request answers with. */
export type PublicDashboardFailure = { body: Readonly<Record<string, unknown>>; status: number }

/** Writes a failed dashboard request's raw error to the protected process log and returns that raw message. */
export function logDashboardFailure(bot: BotName, operation: string, error: unknown) {
	const message = errorMessage(error)
	logEvent(bot, 'dashboardOperationFailed', { operation, error: message }, 'error')
	return message
}

/**
 * The JSON error response for a failed dashboard request whose error may belong to a known failure category. The raw
 * error only reaches the protected log. An `Error` whose `name` keys `categories` answers with that category's status
 * and body, such as a busy signer (423) or a configuration revision conflict (409); every other error answers with
 * `uncategorized(error)`.
 */
export function categorizedDashboardError(bot: BotName, operation: string, error: unknown, categories: Readonly<Record<string, PublicDashboardFailure>>, uncategorized: (error: unknown) => PublicDashboardFailure) {
	logDashboardFailure(bot, operation, error)
	const category = error instanceof Error && Object.hasOwn(categories, error.name) ? categories[error.name] : undefined
	const { body, status } = category ?? uncategorized(error)
	return dashboardJson(body, status)
}

/**
 * The JSON error response for a failed dashboard request. The raw error only reaches the protected log; the browser gets
 * `fallback`, or with `categorize` a redacted description of what the bot was attempting when the error names one.
 */
export function publicDashboardError(bot: BotName, error: unknown, status: number, operation: string, fallback: string, categorize = false) {
	return categorizedDashboardError(bot, operation, error, {}, () => ({ body: { error: categorize ? publicOperatorFailure(errorMessage(error), fallback) : fallback }, status }))
}
