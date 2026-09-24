import { describe, expect, test } from 'bun:test'
import { buildEscalationReminder } from '@zoltar/ui-statoblast-shared/features/reporting/lib/escalationReminder.js'

const input = {
	securityPoolAddress: '0x123',
	escalationEndTime: 1767485880n,
	generatedAt: 1767225600n,
	questionTitle: 'Will Yes win?',
	status: "You're winning on Yes.",
	pageUrl: 'https://example.com/?pool=0x123',
}

describe('escalation calendar reminder', () => {
	test('uses UTC, starts one hour before the deadline, lasts 15 minutes and alarms 15 minutes earlier', () => {
		const calendar = buildEscalationReminder(input)
		expect(calendar).toContain('DTSTART:20260103T231800Z\r\n')
		expect(calendar).toContain('DTEND:20260103T233300Z\r\n')
		expect(calendar).toContain('DTSTAMP:20260101T000000Z\r\n')
		expect(calendar).toContain('UID:0x123-1767485880@statoblast\r\n')
		expect(calendar).toContain('SUMMARY:Check escalation: Will Yes win?\r\n')
		expect(calendar).toContain('BEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\n')
		expect(calendar).toEndWith('END:VEVENT\r\nEND:VCALENDAR\r\n')
		expect(calendar.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
	})
	test('escapes backslashes, commas, semicolons and all newline conventions', () => {
		const calendar = buildEscalationReminder({ ...input, questionTitle: 'A,B;C\\D\r\nE\nF\rG', status: 'First\nSecond, third;' })
		expect(calendar).toContain('SUMMARY:Check escalation: A\\,B\\;C\\\\D\\nE\\nF\\nG\r\n')
		expect(calendar.replaceAll('\r\n ', '')).toContain('DESCRIPTION:First\\nSecond\\, third\\;\\nhttps://example.com/?pool=0x123')
	})
	test('folds every line at 75 UTF-8 octets and unfolds without corrupting characters', () => {
		const title = 'é😀'.repeat(80)
		const calendar = buildEscalationReminder({ ...input, questionTitle: title })
		for (const line of calendar.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
		expect(calendar).toContain('\r\n ')
		expect(calendar.replaceAll('\r\n ', '')).toContain(`SUMMARY:Check escalation: ${title}\r\n`)
	})
})
