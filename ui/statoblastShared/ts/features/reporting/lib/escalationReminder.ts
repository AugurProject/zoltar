import * as copy from '../../../copy/reporting.js'

function escapeCalendarText(value: string) {
	return value
		.replace(/\\/g, '\\\\')
		.replace(/\r\n|\r|\n/g, '\\n')
		.replace(/,/g, '\\,')
		.replace(/;/g, '\\;')
}

// RFC 5545 folds at 75 octets, without splitting a UTF-8 character.
function foldLine(value: string) {
	const encoder = new TextEncoder()
	let line = ''
	let length = 0
	const lines: string[] = []
	for (const character of value) {
		const size = encoder.encode(character).length
		if (length + size > 75) {
			lines.push(line)
			line = ' '
			length = 1
		}
		line += character
		length += size
	}
	lines.push(line)
	return lines.join('\r\n')
}

function calendarTimestamp(seconds: bigint) {
	return new Date(Number(seconds * 1000n))
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}Z$/, 'Z')
}

export function buildEscalationReminder({ questionLedgerAddress, escalationEndTime, generatedAt, questionTitle, status, pageUrl }: { questionLedgerAddress: string; escalationEndTime: bigint; generatedAt: bigint; questionTitle: string; status: string; pageUrl: string }) {
	return buildStatoblastCalendarEvent({ id: questionLedgerAddress.toLowerCase(), generatedAt, startsAt: escalationEndTime - 3600n, title: copy.reminderSummary(questionTitle), description: `${status}\n${pageUrl}` })
}

export const LAST_CALENDAR_START = 253_402_299_899n

export function buildStatoblastCalendarEvent({ id, generatedAt, startsAt, title, description }: { id: string; generatedAt: bigint; startsAt: bigint; title: string; description: string }) {
	const summary = escapeCalendarText(title)
	return (
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Statoblast//Escalation reminder//EN',
			'BEGIN:VEVENT',
			`UID:${escapeCalendarText(`${id}@statoblast`)}`,
			`DTSTAMP:${calendarTimestamp(generatedAt)}`,
			`DTSTART:${calendarTimestamp(startsAt)}`,
			`DTEND:${calendarTimestamp(startsAt + 900n)}`,
			`SUMMARY:${summary}`,
			`DESCRIPTION:${escapeCalendarText(description)}`,
			'BEGIN:VALARM',
			'TRIGGER:-PT15M',
			'ACTION:DISPLAY',
			`DESCRIPTION:${summary}`,
			'END:VALARM',
			'END:VEVENT',
			'END:VCALENDAR',
		]
			.map(foldLine)
			.join('\r\n') + '\r\n'
	)
}

export function downloadStatoblastCalendarEvent(calendar: string, filename: string) {
	const url = URL.createObjectURL(new Blob([calendar], { type: 'text/calendar;charset=utf-8' }))
	const link = document.createElement('a')
	link.href = url
	link.download = filename
	link.click()
	setTimeout(() => URL.revokeObjectURL(url), 1000)
}
