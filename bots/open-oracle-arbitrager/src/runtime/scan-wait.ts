import { retryDelayMilliseconds } from '@zoltar/bot-shared/monitoring/resilience'
import type { OperatorContext, OperatorRuntime } from './operator-runtime.ts'

/** A failing scan retries within this bound (or the poll interval when that is longer) so a transient fault never leaves the operator blind for minutes. */
const MAXIMUM_SCAN_RETRY_DELAY_MILLISECONDS = 30_000

/** Resolves when a network profile switch is requested, immediately when one is already pending. */
function profileSwitchWake(runtime: OperatorRuntime, pending: OperatorContext['pending']) {
	return new Promise<void>((resolve: () => void) => {
		runtime.wakeProfileSwitchWait = resolve
		if (pending.profileSwitch) resolve()
	})
}

/**
 * Waits for the next scan trigger: a new head from the watcher wakes the scan immediately, while the
 * configured poll interval still bounds how long queued settings or lifecycle work can wait on an idle chain.
 */
async function waitForProfileSwitchOrDelay(runtime: OperatorRuntime, context: OperatorContext, milliseconds: number, afterFailure: boolean) {
	const { pending, shutdown } = context
	if (context.stopping()) return
	const headWake = context.scanWakeGate.wait(milliseconds, afterFailure)
	await Promise.race([shutdown?.wait(milliseconds) ?? Bun.sleep(milliseconds), ...(headWake === undefined ? [] : [headWake]), profileSwitchWake(runtime, pending)])
	runtime.wakeProfileSwitchWait = undefined
}

/** Waits one poll interval after a success, or a jittered backoff after consecutive failures. */
export function waitBeforeNextScan(runtime: OperatorRuntime, context: OperatorContext, consecutiveFailures: number) {
	const { config, state } = context
	state.consecutivePollFailures = consecutiveFailures
	state.retryInProgress = false
	if (consecutiveFailures === 0) return waitForProfileSwitchOrDelay(runtime, context, config.pollMilliseconds, false)
	const delayMilliseconds = retryDelayMilliseconds(config.pollMilliseconds, consecutiveFailures, Math.random, MAXIMUM_SCAN_RETRY_DELAY_MILLISECONDS)
	state.nextRetryAt = new Date(Date.now() + delayMilliseconds).toISOString()
	return waitForProfileSwitchOrDelay(runtime, context, delayMilliseconds, true)
}
