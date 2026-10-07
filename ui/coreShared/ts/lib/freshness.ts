import * as commonCopy from '../copy/common.js'

/** The age of a list's data and whether an in-place refresh is in flight. */
export type DataFreshness = { refreshing: boolean; updatedAt: number | undefined }

/** Below this age a read counts as current, so a refresh on every block does not make the label flicker. */
const JUST_NOW_SECONDS = 5

/** Reads refresh on every block (about 12 s), so data this old has missed several refreshes. */
const STALE_AFTER_MILLISECONDS = 120_000

export function isUpdatedAgoStale(updatedAtMilliseconds: number, nowMilliseconds: number) {
	return nowMilliseconds - updatedAtMilliseconds >= STALE_AFTER_MILLISECONDS
}

export function formatUpdatedAgo(updatedAtMilliseconds: number, nowMilliseconds: number) {
	const seconds = Math.max(0, Math.floor((nowMilliseconds - updatedAtMilliseconds) / 1000))
	if (seconds < JUST_NOW_SECONDS) return commonCopy.updatedJustNow
	if (seconds < 60) return commonCopy.formatUpdatedSecondsAgo(seconds)
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return commonCopy.formatUpdatedMinutesAgo(minutes)
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return commonCopy.formatUpdatedHoursAgo(hours)
	return commonCopy.formatUpdatedDaysAgo(Math.floor(hours / 24))
}

/** How often the label must re-render to stay accurate: every second during the first minute, then twice a minute. */
export function updatedAgoTickMilliseconds(updatedAtMilliseconds: number, nowMilliseconds: number) {
	return nowMilliseconds - updatedAtMilliseconds < 60_000 ? 1_000 : 30_000
}
