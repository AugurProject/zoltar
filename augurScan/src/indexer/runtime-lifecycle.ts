import { DatabaseConsistencyError, type IndexerLease, IndexerLeaseReleaseError } from '../database.ts'
import { type NetworkLifecycle, retryDelayMs, runNetworkLifecycle } from './lifecycle-loop.ts'
import { type IndexerOwnershipEvent, IndexerOwnershipStageError, type OwnershipStage, ownershipFailureLogMessage, ownershipFailureReason } from './ownership-status.ts'
import { databaseFailureMessage } from './runtime-diagnostics.ts'
import { waitForIndexerDelay } from './runtime-rpc.ts'

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
		shouldRethrow: error => error instanceof DatabaseConsistencyError || lifecycle.shouldRethrow?.(error) === true,
	})

export type LeaseControl = Pick<IndexerLease, 'assertHeld' | 'release'> & { readonly backendPid?: number }

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

export const runIndexerOwnershipLifecycle = async <TLease extends LeaseControl>({ networkId, acquire, seed, runOwned, failure, standby, intervalMs, now = Date.now, onEvent = () => {}, random, wait = waitForIndexerDelay, signal }: OwnershipLifecycle<TLease>): Promise<void> => {
	let standbyReported = false
	let wasStandby = false
	let consecutiveFailures = 0
	const emitOwnershipEvent = async (event: IndexerOwnershipEvent): Promise<void> => {
		try {
			await onEvent(event)
		} catch (error) {
			console.error(`[${networkId}] indexer ownership diagnostics failed; event: ${event.type}; backend PID: ${'backendPid' in event ? (event.backendPid ?? 'unavailable') : 'unavailable'}; reason: ${ownershipFailureReason(error)}`)
		}
	}
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
					await emitOwnershipEvent({ type: 'standby' })
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
				await emitOwnershipEvent({
					type: 'acquired',
					...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					recoveredAfterFailures,
					acquiredAfterStandby,
				})
				if (recoveredAfterFailures > 0 || acquiredAfterStandby) {
					const source = acquiredAfterStandby ? (recoveredAfterFailures > 0 ? 'standby and failures' : 'standby') : 'failures'
					console.info(`[${networkId}] indexer ownership reacquired; backend PID: ${lease.backendPid ?? 'unavailable'}; source: ${source}; previous consecutive failures: ${recoveredAfterFailures}`)
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
			if (failureStage === 'owned-run' && ownedRunStartedAt !== undefined && now() - ownedRunStartedAt >= Math.max(intervalMs * 4, 60_000)) consecutiveFailures = 0
			consecutiveFailures++
			retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
			await emitOwnershipEvent({
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
					await emitOwnershipEvent({
						type: 'failure',
						stage: 'release',
						consecutiveFailures,
						retryDelayMs: retryDelay,
						...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					})
				}
				console.error(ownershipFailureLogMessage(networkId, 'release', error, consecutiveFailures, retryDelay, lease?.backendPid))
				if (lease !== undefined && !released) await emitOwnershipEvent({ type: 'release-failed', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
			}
			if (lease !== undefined && released) await emitOwnershipEvent({ type: 'released', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
		}
		if (!signal.aborted) await wait(retryDelay ?? intervalMs, signal)
	}
}
