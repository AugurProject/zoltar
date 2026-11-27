import { describe, expect, test } from 'bun:test'
import { buildStatoblastCalendarEvent } from '@zoltar/ui-statoblast-shared/features/reporting/lib/escalationReminder.js'

const input = {
	id: '0x123-deadline',
	startsAt: 1767485880n,
	generatedAt: 1767225600n,
	title: 'Check reporting: Will Yes win?',
	description: 'https://example.com/?pool=0x123',
}

describe('escalation calendar reminder', () => {
	test('a reporting-opening reminder starts exactly at the opening time and has its own identity', () => {
		const startsAt = input.startsAt
		const calendar = buildStatoblastCalendarEvent({ id: `0x123-opens-${startsAt}`, generatedAt: input.generatedAt, startsAt, title: 'Reporting opens', description: input.description })
		expect(calendar).toContain('DTSTART:20260104T001800Z\r\n')
		expect(calendar).toContain('DTEND:20260104T003300Z\r\n')
		expect(calendar).toContain('UID:0x123-opens-1767485880@statoblast\r\n')
	})
	test('uses UTC, uses the supplied start time, lasts 15 minutes and alarms 15 minutes earlier', () => {
		const calendar = buildStatoblastCalendarEvent(input)
		expect(calendar).toContain('DTSTART:20260104T001800Z\r\n')
		expect(calendar).toContain('DTEND:20260104T003300Z\r\n')
		expect(calendar).toContain('DTSTAMP:20260101T000000Z\r\n')
		expect(calendar).toContain('UID:0x123-deadline@statoblast\r\n')
		expect(calendar).toContain('SUMMARY:Check reporting: Will Yes win?\r\n')
		expect(calendar).toContain('BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\n')
		expect(calendar).toEndWith('END:VEVENT\r\nEND:VCALENDAR\r\n')
		expect(calendar.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
	})
	test('escapes backslashes, commas, semicolons and all newline conventions', () => {
		const calendar = buildStatoblastCalendarEvent({ ...input, title: 'Check reporting: A,B;C\\D\r\nE\nF\rG', description: `First\nSecond, third;\n${input.description}` })
		expect(calendar).toContain('SUMMARY:Check reporting: A\\,B\\;C\\\\D\\nE\\nF\\nG\r\n')
		expect(calendar.replaceAll('\r\n ', '')).toContain('DESCRIPTION:First\\nSecond\\, third\\;\\nhttps://example.com/?pool=0x123')
	})
	test('folds every line at 75 UTF-8 octets and unfolds without corrupting characters', () => {
		const title = 'é😀'.repeat(80)
		const calendar = buildStatoblastCalendarEvent({ ...input, title: `Check reporting: ${title}` })
		for (const line of calendar.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
		expect(calendar).toContain('\r\n ')
		expect(calendar.replaceAll('\r\n ', '')).toContain(`SUMMARY:Check reporting: ${title}\r\n`)
	})
})
