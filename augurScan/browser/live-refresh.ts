export type LiveRecord = { key: string; signature: string }
export type ClassifiedLiveRecord = LiveRecord & { state: 'added' | 'changed' | 'unchanged' }

export type RefreshOperation<T> = () => T | Promise<T>

export interface RefreshGate {
	runBackground<T>(operation: RefreshOperation<T>): Promise<T>
	runForeground<T>(operation: RefreshOperation<T>): Promise<T>
	reserve(): { ready: Promise<void>; release: () => void; completed: Promise<void> }
}

const liveRecordState = (previousSignature: string | undefined, signature: string): ClassifiedLiveRecord['state'] => {
	if (previousSignature === undefined) return 'added'
	return previousSignature === signature ? 'unchanged' : 'changed'
}

export const classifyLiveRecords = (previous: ReadonlyMap<string, string>, current: readonly LiveRecord[]): ClassifiedLiveRecord[] =>
	current.map(record => ({
		...record,
		state: liveRecordState(previous.get(record.key), record.signature),
	}))

/** True when two ordered record lists carry the same keys and signatures, so a re-render would change nothing. */
export const liveRecordsMatch = (previous: readonly LiveRecord[], current: readonly LiveRecord[]): boolean => previous.length === current.length && previous.every((record, index) => record.key === current[index]?.key && record.signature === current[index]?.signature)

const operationsLoadDisposition = (activeContext: string, requestedContext: string, live: boolean, hasPaginationTarget: boolean): 'join' | 'queue' | 'supersede' => {
	if (activeContext !== requestedContext) return 'supersede'
	return live || hasPaginationTarget ? 'queue' : 'join'
}

export type OperationsLoadState = { promise?: Promise<boolean> | undefined; context?: string | undefined }

export const runSerializedOperationsLoad = async (state: OperationsLoadState, requestedContext: string, live: boolean, hasPaginationTarget: boolean, currentContext: () => string, supersede: () => void, run: () => Promise<boolean>): Promise<boolean> => {
	while (state.promise !== undefined) {
		const active = state.promise
		const disposition = operationsLoadDisposition(state.context ?? '', requestedContext, live, hasPaginationTarget)
		if (disposition === 'supersede') {
			supersede()
			state.context = requestedContext
		}
		const activeResult = await active
		if (disposition === 'join') return activeResult
		if (currentContext() !== requestedContext) return false
	}
	const promise = run().finally(() => {
		if (state.promise === promise) {
			state.promise = undefined
			state.context = undefined
		}
	})
	state.promise = promise
	state.context = requestedContext
	return await promise
}

export const createForegroundRefreshGate = (): RefreshGate => {
	let active: Promise<unknown> | undefined
	const run = <T>(operation: RefreshOperation<T>): Promise<T> => {
		let request: Promise<T>
		if (active === undefined) {
			try {
				request = Promise.resolve(operation())
			} catch (error) {
				request = Promise.reject(error)
			}
		} else {
			request = active.then(
				() => operation(),
				() => operation(),
			)
		}
		active = request
		const clear = () => {
			if (active === request) active = undefined
		}
		void request.then(clear, clear)
		return request
	}
	const reserve = () => {
		let markReady: () => void = () => {
			throw new Error('Foreground reservation became ready before initialization')
		}
		let releaseOperation: () => void = () => {
			throw new Error('Foreground reservation released before initialization')
		}
		const ready = new Promise<void>(resolve => {
			markReady = resolve
		})
		const completed = run(
			() =>
				new Promise<void>(resolve => {
					releaseOperation = resolve
					markReady()
				}),
		)
		return { ready, release: () => releaseOperation(), completed }
	}
	return { runBackground: run, runForeground: run, reserve }
}

export const runWithForegroundReservation = async <T>(gate: RefreshGate, operation: RefreshOperation<T>): Promise<T> => {
	const reservation = gate.reserve()
	try {
		await reservation.ready
		return await operation()
	} finally {
		reservation.release()
		await reservation.completed
	}
}

export const isCurrentLiveRequest = (requestVersion: number, currentVersion: number, responseChainId: string | number, selectedChainId: string | number) => requestVersion === currentVersion && String(responseChainId) === String(selectedChainId)

export const isCurrentContextRequest = (requestContext: number, currentContext: number, requestVersion: number, currentVersion: number) => requestContext === currentContext && requestVersion === currentVersion

export const isCurrentCanonicalGeneration = (requestGeneration: number, currentGeneration: number): boolean => requestGeneration === currentGeneration

const createLatestRefreshCoordinator = <T>(refresh: (count: number, force: boolean) => Promise<T>) => {
	let inFlight: Promise<T> | undefined
	let pendingCount = 0
	let pendingForce = false
	return (count = 1, force = false) => {
		pendingCount += count
		pendingForce ||= force
		if (inFlight !== undefined) return inFlight
		inFlight = (async () => {
			let result: { value: T } | undefined
			let failure: unknown
			let failed = false
			do {
				const nextCount = pendingCount
				const nextForce = pendingForce
				pendingCount = 0
				pendingForce = false
				try {
					result = { value: await refresh(nextCount, nextForce) }
					failure = undefined
					failed = false
				} catch (error) {
					failure = error
					failed = true
				}
			} while (pendingCount > 0)
			if (failed) throw failure
			if (result === undefined) throw new Error('Refresh coordinator completed without running a refresh')
			return result.value
		})().finally(() => {
			inFlight = undefined
		})
		return inFlight
	}
}

export const createLiveRouteRefreshCoordinator = <T, R>(refresh: (count: number, force: boolean, recovery: R) => Promise<T>, currentRecovery: () => R) => createLatestRefreshCoordinator((count, force) => refresh(count, force, currentRecovery()))

const streamReconnectBaseDelayMs = 1_000
const streamReconnectMaxDelayMs = 30_000

/** Delay before reopening a permanently closed event stream; doubles per consecutive failure up to a ceiling. */
export const streamReconnectDelay = (attempt: number): number => Math.min(streamReconnectMaxDelayMs, streamReconnectBaseDelayMs * 2 ** Math.min(Math.max(0, attempt), 10))

/** The periodic poll refreshes the route only when the open event stream has not already done so within one poll interval. */
export const shouldPollRouteRefresh = (streamOpen: boolean, lastStreamRefreshAt: number | undefined, now: number, pollIntervalMs: number): boolean => !streamOpen || lastStreamRefreshAt === undefined || now - lastStreamRefreshAt >= pollIntervalMs
