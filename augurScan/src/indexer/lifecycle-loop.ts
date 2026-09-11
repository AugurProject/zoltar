import { IndexerOwnershipStageError } from './ownership-status.ts'
import { rpcIndexerFailureReason, safeIndexerFailure, safeIndexerFailureReason } from './runtime-diagnostics.ts'
import { LeaseLostError, waitForIndexerDelay } from './runtime-rpc.ts'

export type NetworkLifecycle = {
	readonly verify: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly failure: (message: string, nextRetryAt: Date, reason: string) => Promise<void>
	readonly recover?: (error: unknown) => Promise<boolean>
	readonly intervalMs: number
	readonly signal: AbortSignal
	readonly random?: () => number
	readonly shouldRethrow?: (error: unknown) => boolean
}

export const retryDelayMs = (consecutiveFailures: number, intervalMs: number, random = Math.random): number => {
	const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 8)
	const base = Math.min(intervalMs * 2 ** exponent, 300_000)
	return Math.min(Math.round(base * (0.8 + random() * 0.4)), 300_000)
}

export const runNetworkLifecycle = async ({ verify, poll, failure, recover, intervalMs, signal, random, shouldRethrow }: NetworkLifecycle): Promise<void> => {
	let verified = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		const startedAt = Date.now()
		let caughtUp = true
		let delayAfterFailure: number | undefined
		try {
			if (!verified) {
				await verify()
				verified = true
			}
			caughtUp = await poll()
			consecutiveFailures = 0
		} catch (error) {
			if (signal.aborted) return
			if (error instanceof LeaseLostError || shouldRethrow?.(error) === true) throw error
			const recovered = await recover?.(error)
			if (signal.aborted) return
			if (recovered === true) {
				consecutiveFailures = 0
				caughtUp = false
			} else {
				consecutiveFailures++
				delayAfterFailure = retryDelayMs(consecutiveFailures, intervalMs, random)
				try {
					const failureMessage = safeIndexerFailure(error)
					const failureReason = failureMessage === 'RPC request failed; retrying' ? rpcIndexerFailureReason(error) : safeIndexerFailureReason(error)
					await failure(failureMessage, new Date(Date.now() + delayAfterFailure), failureReason)
				} catch (failureError) {
					throw new IndexerOwnershipStageError('record-failure', failureError)
				}
			}
		}
		await waitForIndexerDelay(delayAfterFailure ?? (caughtUp ? Math.max(0, intervalMs - (Date.now() - startedAt)) : 0), signal)
	}
}
