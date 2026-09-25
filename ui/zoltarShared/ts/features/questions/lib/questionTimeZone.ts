const MILLISECONDS_PER_SECOND = 1000n
const MILLISECONDS_PER_MINUTE = 60_000
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
	if (timestamp < -MAX_DATE_TIMESTAMP_SECONDS || timestamp > MAX_DATE_TIMESTAMP_SECONDS) return undefined
	const date = new Date(Number(timestamp * MILLISECONDS_PER_SECOND))
	return Number.isNaN(date.getTime()) ? undefined : date
}

/** The IANA time zone the browser uses to interpret `datetime-local` inputs. */
export function getBrowserTimeZone() {
	return new Intl.DateTimeFormat().resolvedOptions().timeZone
}

/** Minutes the zone is ahead of UTC at the given instant (negative when behind). */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string) {
	const { day, hour, minute, month, second, year } = getZonedDateTimeParts(date, timeZone)
	const zonedAsUtcMilliseconds = Date.UTC(year, month - 1, day, hour, minute, second)
	const instantMilliseconds = date.getTime() - date.getUTCMilliseconds()
	return Math.round((zonedAsUtcMilliseconds - instantMilliseconds) / MILLISECONDS_PER_MINUTE)
}

function formatUtcOffset(offsetMinutes: number) {
	if (offsetMinutes === 0) return 'UTC'
	const sign = offsetMinutes > 0 ? '+' : '-'
	const absoluteMinutes = Math.abs(offsetMinutes)
	const hours = Math.floor(absoluteMinutes / 60)
	const minutes = absoluteMinutes % 60
	return `UTC${sign}${hours}${minutes === 0 ? '' : `:${pad(minutes)}`}`
}

/** Labels a zone with its offset at the given instant, e.g. `Europe/Helsinki, UTC+3`, or just `UTC`. */
export function formatTimeZoneLabel(timeZone: string, date: Date) {
	const offset = formatUtcOffset(getTimeZoneOffsetMinutes(date, timeZone))
	if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return offset
	return `${timeZone}, ${offset}`
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
