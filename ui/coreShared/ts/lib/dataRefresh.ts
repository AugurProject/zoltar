import { createBlockWatcher, createDocumentBlockWatcherEnvironment } from './blockWatcher.js'
import { createQueryCache } from './queryCache.js'

/** Mainnet produces a block about every 12 seconds, so polling faster only repeats the same answer. */
const LIVE_BLOCK_POLL_INTERVAL_MILLISECONDS = 12_000
/** The browser simulation announces its own blocks; the poll is only a fallback. */
const SIMULATION_BLOCK_POLL_INTERVAL_MILLISECONDS = 30_000

/** The application's single block watcher. Each app page loads one application, so one module instance suffices. */
export const appBlockWatcher = createBlockWatcher(createDocumentBlockWatcherEnvironment())

/** The application's query cache; every entry turns stale on a new block or an explicit invalidation. */
export const appQueryCache = createQueryCache()

appBlockWatcher.subscribe(event => appQueryCache.invalidateAll(event.reason))

export function blockPollIntervalMilliseconds(simulation: boolean) {
	return simulation ? SIMULATION_BLOCK_POLL_INTERVAL_MILLISECONDS : LIVE_BLOCK_POLL_INTERVAL_MILLISECONDS
}

/** Refreshes every visible query in place, for example after a transaction or a simulation control changed the chain. */
export function invalidateAppData() {
	appBlockWatcher.invalidate()
}

/**
 * Whether two read results carry the same data. A background refresh that finds nothing new keeps the current
 * objects, so components and effects keyed on them do not re-run on every block.
 */
export function isSameQueryData(left: unknown, right: unknown) {
	if (left === right) return true
	const serialize = (value: unknown) => JSON.stringify(value, (_key, entry: unknown) => (typeof entry === 'bigint' ? `${entry.toString()}n` : entry))
	return serialize(left) === serialize(right)
}
