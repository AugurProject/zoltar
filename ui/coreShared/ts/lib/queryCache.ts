/**
 * A small stale-while-revalidate cache. Each store holds one kind of query result keyed by a query id. A refetch
 * keeps the last data visible, concurrent requests for one key share a single read, and invalidation (a new block
 * or a finished transaction) marks entries stale and tells subscribers to refetch in place.
 */

export type QueryState<T> = {
	data: T | undefined
	error: unknown
	/** Wall-clock milliseconds of the last successful read. */
	updatedAt: number | undefined
	fetching: boolean
	stale: boolean
}

type QueryEntry<T> = QueryState<T> & { generation: number; promise: Promise<T> | undefined }

type StoreControl = { clear: () => void; invalidate: () => void }

export type QueryStore<T> = ReturnType<typeof createStoreFor<T>>['store']

const EMPTY_STATE: QueryState<never> = { data: undefined, error: undefined, updatedAt: undefined, fetching: false, stale: false }

function createStoreFor<T>(now: () => number) {
	const entries = new Map<string, QueryEntry<T>>()
	const listeners = new Map<string, Set<() => void>>()
	let generation = 0

	const notify = (key: string) => {
		for (const listener of [...(listeners.get(key) ?? [])]) listener()
	}
	const update = (key: string, entry: QueryEntry<T>) => {
		entries.set(key, entry)
		notify(key)
	}
	const read = (key: string): QueryEntry<T> => entries.get(key) ?? { ...EMPTY_STATE, generation, promise: undefined }

	const store = {
		get(key: string): QueryState<T> {
			const { data, error, updatedAt, fetching, stale } = read(key)
			return { data, error, updatedAt, fetching, stale }
		},
		/**
		 * Reads through the cache: a request already in flight for the key is shared instead of repeated, unless an
		 * invalidation arrived after it began. Then a new read starts and only the newest read may settle.
		 */
		fetch(key: string, loader: () => Promise<T>): Promise<T> {
			const current = read(key)
			if (current.promise !== undefined && current.generation === generation && !current.stale) return current.promise
			const requestGeneration = generation
			const promise = loader()
			update(key, { ...current, fetching: true, stale: false, generation: requestGeneration, promise })
			const settle = (next: Partial<QueryState<T>>) => {
				const latest = entries.get(key)
				// A clear() since the request began retires it; its answer describes a replaced environment.
				if (latest?.promise !== promise || generation !== requestGeneration) return
				update(key, { ...latest, ...next, fetching: false, promise: undefined })
			}
			promise.then(
				data => settle({ data, error: undefined, updatedAt: now() }),
				(error: unknown) => settle({ error }),
			)
			return promise
		},
		/** Stores a result read elsewhere, such as a foreground load; an older read still in flight can no longer overwrite it. */
		set(key: string, data: T) {
			update(key, { ...read(key), data, error: undefined, updatedAt: now(), stale: false, fetching: false, promise: undefined })
		},
		/** Marks one key, or every key, stale and notifies subscribers so the visible ones refetch. */
		invalidate(key?: string) {
			const keys = key === undefined ? [...entries.keys()] : [key]
			for (const target of keys) {
				const entry = entries.get(target)
				if (entry !== undefined) update(target, { ...entry, stale: true })
			}
		},
		subscribe(key: string, listener: () => void) {
			const keyListeners = listeners.get(key) ?? new Set()
			keyListeners.add(listener)
			listeners.set(key, keyListeners)
			return () => {
				keyListeners.delete(listener)
				if (keyListeners.size === 0) listeners.delete(key)
			}
		},
	}
	const control: StoreControl = {
		clear: () => {
			generation += 1
			const keys = [...entries.keys()]
			entries.clear()
			for (const key of keys) notify(key)
		},
		invalidate: () => store.invalidate(),
	}
	return { store, control }
}

export function createQueryCache({ now = () => Date.now() }: { now?: () => number } = {}) {
	const stores = new Set<StoreControl>()
	return {
		createStore<T>() {
			const { store, control } = createStoreFor<T>(now)
			stores.add(control)
			return store
		},
		/** Marks every cached query stale, for example after a new block or a simulation control. */
		invalidateAll() {
			for (const store of stores) store.invalidate()
		},
		/** Drops every cached result, for example when the environment or network is replaced. */
		clear() {
			for (const store of stores) store.clear()
		},
	}
}
