import { expect, test } from 'bun:test'
import { questionAnswerType, questionDateLabel, questionStartLabel, questionStatus } from '../../browser/question-time.ts'

test('formats representable question dates and retains exact out-of-range values', () => {
	expect(questionDateLabel('1767225600')).toBe('2026-01-01 00:00:00 UTC')
	expect(questionDateLabel('8640000000000')).not.toContain('out of range')
	for (const seconds of ['8640000000001', '281474976710655']) expect(questionDateLabel(seconds)).toBe(`Date out of range (${seconds} Unix seconds)`)
})

test('a zero start time means the question started at creation, not the Unix epoch', () => {
	expect(questionStartLabel('0')).toBe('Immediately after creation')
	expect(questionStartLabel('1767225600')).toBe('2026-01-01 00:00:00 UTC')
})

test('classifies answer types like the Zoltar registry', () => {
	expect(questionAnswerType({ outcome_options: ['Yes', 'No'], num_ticks: '0' })).toBe('Binary')
	expect(questionAnswerType({ outcome_options: ['Red', 'Blue'], num_ticks: '0' })).toBe('Categorical')
	expect(questionAnswerType({ outcome_options: ['No', 'Yes'], num_ticks: '0' })).toBe('Categorical')
	expect(questionAnswerType({ outcome_options: [], num_ticks: '24' })).toBe('Scalar')
	expect(questionAnswerType({ outcome_options: [], num_ticks: '0' })).toBe('Categorical')
})

test('compares question status in seconds including exact boundaries and distant dates', () => {
	expect(questionStatus({ start_time: '10', end_time: '20' }, 9999)).toBe('Scheduled')
	expect(questionStatus({ start_time: '10', end_time: '20' }, 10000)).toBe('Open')
	expect(questionStatus({ start_time: '10', end_time: '20' }, 20000)).toBe('Ended')
	expect(questionStatus({ start_time: '281474976710655', end_time: '281474976710655' }, 20000)).toBe('Scheduled')
	expect(questionStatus({ start_time: '0', end_time: '281474976710655' }, 20000)).toBe('Open')
})
