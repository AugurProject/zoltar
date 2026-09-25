import * as commonCopy from '../copy/common.js'

/** The age of a list's data and whether an in-place refresh is in flight. */
export type DataFreshness = { refreshing: boolean; updatedAt: number | undefined }

/** Below this age a read counts as current, so a refresh on every block does not make the label flicker. */
const JUST_NOW_SECONDS = 5

export function formatUpdatedAgo(updatedAtMilliseconds: number, nowMilliseconds: number) {
	const seconds = Math.max(0, Math.floor((nowMilliseconds - updatedAtMilliseconds) / 1000))
	if (seconds < JUST_NOW_SECONDS) return commonCopy.updatedJustNow
	if (seconds < 60) return commonCopy.formatUpdatedSecondsAgo(seconds)
	const minutes = Math.floor(seconds / 60)
	if (minutes < 60) return commonCopy.formatUpdatedMinutesAgo(minutes)
	return commonCopy.formatUpdatedHoursAgo(Math.floor(minutes / 60))
}

/** How often the label must re-render to stay accurate: every second during the first minute, then twice a minute. */
export function updatedAgoTickMilliseconds(updatedAtMilliseconds: number, nowMilliseconds: number) {
	return nowMilliseconds - updatedAtMilliseconds < 60_000 ? 1_000 : 30_000
}
