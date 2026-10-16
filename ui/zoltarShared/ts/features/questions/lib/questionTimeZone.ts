import * as marketCopy from '../../../copy/market.js'

const MILLISECONDS_PER_SECOND = 1000n
// ECMAScript Date supports +/- 8.64e15 ms around the epoch.
const MAX_DATE_TIMESTAMP_SECONDS = 8_640_000_000_000n

export type LocalAndUtcTimestamp = {
	/** Wall-clock time in the given zone, formatted `YYYY-MM-DD HH:MM`. */
	local: string
	/** The same instant in UTC, formatted `YYYY-MM-DD HH:MM UTC`. */
	utc: string
	/** Zone name with its UTC offset at that instant, e.g. `Europe/Helsinki, UTC+3`. */
	zoneLabel: string
}

type DateTimeParts = {
	day: number
	hour: number
	minute: number
	month: number
	year: number
}

function pad(value: number) {
	return value.toString().padStart(2, '0')
}

function formatDateTimeParts({ day, hour, minute, month, year }: DateTimeParts) {
	return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`
}

function getZonedDateTimeParts(date: Date, timeZone: string): DateTimeParts & { second: number } {
	const parts = new Intl.DateTimeFormat('en-US', { day: 'numeric', hour: 'numeric', hourCycle: 'h23', minute: 'numeric', month: 'numeric', second: 'numeric', timeZone, year: 'numeric' }).formatToParts(date)
	const readPart = (type: Intl.DateTimeFormatPartTypes) => {
		const part = parts.find(candidate => candidate.type === type)
		if (part === undefined) throw new Error(`Time zone formatting omitted the ${type} of ${date.toISOString()}`)
		return Number(part.value)
	}
	return { day: readPart('day'), hour: readPart('hour'), minute: readPart('minute'), month: readPart('month'), second: readPart('second'), year: readPart('year') }
}

function toDate(timestamp: bigint) {
	// Question times are Unix timestamps, so instants before the epoch are never valid question times.
	if (timestamp < 0n || timestamp > MAX_DATE_TIMESTAMP_SECONDS) return undefined
	const date = new Date(Number(timestamp * MILLISECONDS_PER_SECOND))
	return Number.isNaN(date.getTime()) ? undefined : date
}

/** The IANA time zone the browser uses to interpret `datetime-local` inputs. */
export function getBrowserTimeZone() {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Minutes the zone is ahead of UTC at the given instant (negative when behind), read from Intl's `GMT+03:00` offset name. */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
	const offsetName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(date).find(part => part.type === 'timeZoneName')?.value
	if (offsetName === undefined) throw new Error(`Time zone formatting omitted the offset of ${timeZone}`)
	if (offsetName === 'GMT') return 0
	const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offsetName)
	if (match === null) throw new Error(`Unrecognized time zone offset ${offsetName}`)
	const minutes = Number(match[2]) * 60 + Number(match[3] ?? '0')
	return match[1] === '-' ? -minutes : minutes
}

function formatUtcOffset(offsetMinutes: number) {
	if (offsetMinutes === 0) return 'UTC'
	const sign = offsetMinutes > 0 ? '+' : '-'
	const absoluteMinutes = Math.abs(offsetMinutes)
	const hours = Math.floor(absoluteMinutes / 60)
	const minutes = absoluteMinutes % 60
	return `UTC${sign}${hours}${minutes === 0 ? '' : `:${pad(minutes)}`}`
}

/**
 * @internal Exported for unit tests; the UI uses `formatQuestionTimeZoneLabel`.
 * Labels a zone with its offset at the given instant, e.g. `Europe/Helsinki, UTC+3`, or just `UTC`.
 */
export function formatTimeZoneLabel(timeZone: string, date: Date) {
	const offset = formatUtcOffset(getTimeZoneOffsetMinutes(date, timeZone))
	if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return offset
	return `${timeZone}, ${offset}`
}

/**
 * Labels the zone the time inputs use with the offset in effect at the chosen times, not today's offset. A blank input
 * falls back to the other one, then to `now`; when the start and end fall on different offsets (across a daylight saving
 * change), both are named.
 */
export function formatQuestionTimeZoneLabel(timeZone: string, { endTimestamp, now, startTimestamp }: { endTimestamp: bigint | undefined; now: Date; startTimestamp: bigint | undefined }) {
	const start = startTimestamp === undefined ? undefined : toDate(startTimestamp)
	const end = endTimestamp === undefined ? undefined : toDate(endTimestamp)
	if (start !== undefined && end !== undefined) {
		const startOffset = formatUtcOffset(getTimeZoneOffsetMinutes(start, timeZone))
		const endOffset = formatUtcOffset(getTimeZoneOffsetMinutes(end, timeZone))
		if (startOffset !== endOffset) return `${timeZone}, ${marketCopy.formatStartAndEndUtcOffsets(startOffset, endOffset)}`
	}
	return formatTimeZoneLabel(timeZone, end ?? start ?? now)
}

/** Formats one instant as wall-clock time in `timeZone` and in UTC, with the zone's label at that instant. */
export function formatLocalAndUtcTimestamp(timestamp: bigint, timeZone: string): LocalAndUtcTimestamp | undefined {
	const date = toDate(timestamp)
	if (date === undefined) return undefined
	return {
		local: formatDateTimeParts(getZonedDateTimeParts(date, timeZone)),
		utc: `${formatDateTimeParts(getZonedDateTimeParts(date, 'UTC'))} UTC`,
		zoneLabel: formatTimeZoneLabel(timeZone, date),
	}
}
