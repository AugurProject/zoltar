import { DatabaseConsistencyError, databaseConsistencyDiagnosticMessage, type IndexerLease, IndexerLeaseReleaseError } from '../database.ts'
import { databaseFailureMessage, rpcIndexerFailureReason, safeIndexerFailure, safeIndexerFailureReason } from './runtime-diagnostics.ts'
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

class IndexerOwnershipStageError extends Error {
	override name = 'IndexerOwnershipStageError'

	constructor(
		readonly stage: OwnershipStage,
		cause: unknown,
	) {
		super(`Indexer ownership stage failed: ${stage}`, { cause })
	}
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

export type OwnedNetworkLifecycle = Omit<NetworkLifecycle, 'verify' | 'poll'> & {
	readonly reconcile: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly runWithProvider: <T>(operation: () => Promise<T>) => Promise<T>
}

export const runOwnedNetworkLifecycle = async ({ reconcile, poll, runWithProvider, ...lifecycle }: OwnedNetworkLifecycle): Promise<void> =>
	await runNetworkLifecycle({
		...lifecycle,
		verify: () => runWithProvider(reconcile),
		poll: () => runWithProvider(poll),
		shouldRethrow: (error) => error instanceof DatabaseConsistencyError || lifecycle.shouldRethrow?.(error) === true,
	})

export type LeaseControl = Pick<IndexerLease, 'assertHeld' | 'release'> & { readonly backendPid?: number }

export type OwnershipStage = 'acquire' | 'verify' | 'seed' | 'record-ownership' | 'owned-run' | 'record-failure' | 'release'

type IndexerOwnershipEvent =
	| {
			readonly type: 'failure'
			readonly stage: OwnershipStage
			readonly consecutiveFailures: number
			readonly retryDelayMs: number
			readonly backendPid?: number
	  }
	| { readonly type: 'acquired'; readonly backendPid?: number; readonly recoveredAfterFailures: number; readonly acquiredAfterStandby: boolean }
	| { readonly type: 'released'; readonly backendPid?: number }
	| { readonly type: 'release-failed'; readonly backendPid?: number }
	| { readonly type: 'standby' }

type IndexerOwnershipStatus = {
	readonly networkId: string
	readonly active: boolean
	readonly backendPid?: number
	readonly failuresTotal: number
	readonly reacquisitionsTotal: number
	readonly consecutiveFailures: number
	readonly lastFailureAt?: string
	readonly lastFailureStage?: OwnershipStage
}

const ownershipStatuses = new Map<string, IndexerOwnershipStatus>()

export const nextIndexerOwnershipStatus = (
	networkId: string,
	current: IndexerOwnershipStatus | undefined,
	event: IndexerOwnershipEvent,
	now = new Date(),
): IndexerOwnershipStatus => {
	const previous = current ?? {
		networkId,
		active: false,
		failuresTotal: 0,
		reacquisitionsTotal: 0,
		consecutiveFailures: 0,
	}
	if (event.type === 'failure') {
		return {
			...previous,
			active: false,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			failuresTotal: previous.failuresTotal + 1,
			consecutiveFailures: event.consecutiveFailures,
			lastFailureAt: now.toISOString(),
			lastFailureStage: event.stage,
		}
	}
	if (event.type === 'acquired') {
		return {
			...previous,
			active: true,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			reacquisitionsTotal: previous.reacquisitionsTotal + (event.recoveredAfterFailures > 0 || event.acquiredAfterStandby ? 1 : 0),
			consecutiveFailures: 0,
		}
	}
	return event.type === 'release-failed'
		? {
				...previous,
				active: false,
				...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			}
		: {
				...previous,
				active: false,
				backendPid: undefined,
				consecutiveFailures: event.type === 'standby' ? 0 : previous.consecutiveFailures,
			}
}

export const recordOwnershipEvent = (networkId: string, event: IndexerOwnershipEvent): void => {
	ownershipStatuses.set(networkId, nextIndexerOwnershipStatus(networkId, ownershipStatuses.get(networkId), event))
}

const ownershipFailureReason = (error: unknown): string => {
	const reason = safeIndexerFailureReason(error)
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof DatabaseConsistencyError) {
			const detail = databaseConsistencyDiagnosticMessage(current)
			if (detail !== undefined) return `${reason}: ${detail}`
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return reason
}

export const ownershipFailureLogMessage = (
	networkId: string,
	stage: OwnershipStage,
	error: unknown,
	consecutiveFailures: number,
	retryDelay: number,
	backendPid?: number,
): string =>
	`[${networkId}] indexer ownership failed; stage: ${stage}; consecutive failures: ${consecutiveFailures}; retry delay: ${retryDelay}ms; backend PID: ${backendPid ?? 'unavailable'}; reason: ${ownershipFailureReason(error)}`

export type OwnershipLifecycle<TLease extends LeaseControl> = {
	readonly networkId: string
	readonly acquire: () => Promise<TLease | undefined>
	readonly seed: (lease: TLease) => Promise<void>
	readonly runOwned: (lease: TLease) => Promise<void>
	readonly failure: (message: string, lease: TLease | undefined) => Promise<void>
	readonly standby: () => void
	readonly intervalMs: number
	readonly now?: () => number
	readonly onEvent?: (event: IndexerOwnershipEvent) => unknown
	readonly random?: () => number
	readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
	readonly signal: AbortSignal
}

export const runIndexerOwnershipLifecycle = async <TLease extends LeaseControl>({
	networkId,
	acquire,
	seed,
	runOwned,
	failure,
	standby,
	intervalMs,
	now = Date.now,
	onEvent = () => {},
	random,
	wait = waitForIndexerDelay,
	signal,
}: OwnershipLifecycle<TLease>): Promise<void> => {
	let standbyReported = false
	let wasStandby = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		let lease: TLease | undefined
		let ownedRunStartedAt: number | undefined
		let stage: OwnershipStage = 'acquire'
		let retryDelay: number | undefined
		try {
			lease = await acquire()
			if (signal.aborted) continue
			if (lease === undefined) {
				consecutiveFailures = 0
				wasStandby = true
				if (!standbyReported) {
					standby()
					stage = 'record-ownership'
					await onEvent({ type: 'standby' })
					standbyReported = true
				}
			} else {
				standbyReported = false
				stage = 'verify'
				await lease.assertHeld()
				if (signal.aborted) continue
				stage = 'seed'
				await seed(lease)
				if (signal.aborted) continue
				const recoveredAfterFailures = consecutiveFailures
				const acquiredAfterStandby = wasStandby
				stage = 'record-ownership'
				await onEvent({
					type: 'acquired',
					...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					recoveredAfterFailures,
					acquiredAfterStandby,
				})
				if (recoveredAfterFailures > 0 || acquiredAfterStandby) {
					const source = acquiredAfterStandby ? (recoveredAfterFailures > 0 ? 'standby and failures' : 'standby') : 'failures'
					console.info(
						`[${networkId}] indexer ownership reacquired; backend PID: ${lease.backendPid ?? 'unavailable'}; source: ${source}; previous consecutive failures: ${recoveredAfterFailures}`,
					)
				}
				wasStandby = false
				stage = 'owned-run'
				ownedRunStartedAt = now()
				await runOwned(lease)
				if (signal.aborted) continue
				consecutiveFailures = 0
			}
		} catch (error) {
			if (signal.aborted) continue
			const failureStage = error instanceof IndexerOwnershipStageError ? error.stage : stage
			if (failureStage === 'owned-run' && ownedRunStartedAt !== undefined && now() - ownedRunStartedAt >= Math.max(intervalMs * 4, 60_000))
				consecutiveFailures = 0
			consecutiveFailures++
			retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
			await onEvent({
				type: 'failure',
				stage: failureStage,
				consecutiveFailures,
				retryDelayMs: retryDelay,
				...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
			})
			console.error(ownershipFailureLogMessage(networkId, failureStage, error, consecutiveFailures, retryDelay, lease?.backendPid))
			try {
				await failure(databaseFailureMessage, lease)
			} catch (error) {
				console.error(ownershipFailureLogMessage(networkId, 'record-failure', error, consecutiveFailures, retryDelay, lease?.backendPid))
				// A database outage can prevent status recording too; retry ownership regardless.
			}
		} finally {
			let released = lease === undefined
			try {
				await lease?.release()
				released = true
			} catch (error) {
				if (error instanceof IndexerLeaseReleaseError && error.releaseConfirmed) released = true
				if (retryDelay === undefined) {
					consecutiveFailures++
					retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
					await onEvent({
						type: 'failure',
						stage: 'release',
						consecutiveFailures,
						retryDelayMs: retryDelay,
						...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					})
				}
				console.error(ownershipFailureLogMessage(networkId, 'release', error, consecutiveFailures, retryDelay, lease?.backendPid))
				if (lease !== undefined && !released)
					await onEvent({ type: 'release-failed', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
			}
			if (lease !== undefined && released) await onEvent({ type: 'released', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
		}
		if (!signal.aborted) await wait(retryDelay ?? intervalMs, signal)
	}
}
