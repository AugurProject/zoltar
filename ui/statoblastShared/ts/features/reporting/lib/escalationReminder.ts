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

export function buildEscalationReminder({ securityPoolAddress, escalationEndTime, generatedAt, questionTitle, status, pageUrl }: { securityPoolAddress: string; escalationEndTime: bigint; generatedAt: bigint; questionTitle: string; status: string; pageUrl: string }) {
	const summary = escapeCalendarText(copy.reminderSummary(questionTitle))
	return (
		[
			'BEGIN:VCALENDAR',
			'VERSION:2.0',
			'PRODID:-//Statoblast//Escalation reminder//EN',
			'BEGIN:VEVENT',
			`UID:${escapeCalendarText(`${securityPoolAddress}-${escalationEndTime}@statoblast`)}`,
			`DTSTAMP:${calendarTimestamp(generatedAt)}`,
			`DTSTART:${calendarTimestamp(escalationEndTime - 3600n)}`,
			`DTEND:${calendarTimestamp(escalationEndTime - 2700n)}`,
			`SUMMARY:${summary}`,
			`DESCRIPTION:${escapeCalendarText(`${status}\n${pageUrl}`)}`,
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
