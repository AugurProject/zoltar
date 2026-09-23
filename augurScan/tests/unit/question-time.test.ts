import { expect, test } from 'bun:test'
import { questionDateLabel, questionStatus } from '../../browser/question-time.ts'

test('formats representable question dates and retains exact out-of-range values', () => {
	expect(questionDateLabel('1767225600')).toBe(new Date(1767225600000).toLocaleDateString('en-GB'))
	expect(questionDateLabel('8640000000000')).not.toContain('out of range')
	for (const seconds of ['8640000000001', '281474976710655']) expect(questionDateLabel(seconds)).toBe(`Date out of range (${seconds} Unix seconds)`)
})

test('compares question status in seconds including exact boundaries and distant dates', () => {
	expect(questionStatus({ start_time: '10', end_time: '20' }, 9999)).toBe('Scheduled')
	expect(questionStatus({ start_time: '10', end_time: '20' }, 10000)).toBe('Open')
	expect(questionStatus({ start_time: '10', end_time: '20' }, 20000)).toBe('Ended')
	expect(questionStatus({ start_time: '281474976710655', end_time: '281474976710655' }, 20000)).toBe('Scheduled')
	expect(questionStatus({ start_time: '0', end_time: '281474976710655' }, 20000)).toBe('Open')
})
