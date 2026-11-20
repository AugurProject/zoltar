/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { formatLocalDateTimeInput, parseTimestampInput, tryParseTimestampInput } from '../forms/formInputs.js'

describe('timestamp form inputs', () => {
	let originalTimeZone: string | undefined
	beforeEach(() => {
		originalTimeZone = process.env['TZ']
		// Bun applies a TZ change at runtime; datetime-local values are read in this zone.
		process.env['TZ'] = 'America/New_York'
	})
	afterEach(() => {
		if (originalTimeZone === undefined) delete process.env['TZ']
		else process.env['TZ'] = originalTimeZone
	})

	test('rejects a local time skipped by the spring daylight saving change (#1386)', () => {
		expect(new Date('2027-03-14T01:30').getTimezoneOffset()).toBe(300)
		expect(tryParseTimestampInput('2027-03-14T01:30')).toBe(1_805_005_800n)
		expect(tryParseTimestampInput('2027-03-14T02:30')).toBeUndefined()
		expect(tryParseTimestampInput('2027-03-14T03:30')).toBe(1_805_009_400n)
		expect(() => parseTimestampInput('2027-03-14T02:30', 'Start time')).toThrow('Start time is invalid')
	})

	test('formats an instant as the datetime-local value that parses back to it', () => {
		expect(formatLocalDateTimeInput(1_805_009_400n)).toBe('2027-03-14T03:30')
		expect(formatLocalDateTimeInput(1_805_009_415n)).toBe('2027-03-14T03:30:15')
		for (const value of ['2027-06-02T12:00', '2027-11-07T01:30', '2027-03-14T03:30:15']) {
			const timestamp = tryParseTimestampInput(value)
			expect(timestamp === undefined ? undefined : formatLocalDateTimeInput(timestamp)).toBe(value)
		}
	})

	test('keeps the repeated autumn hour, seconds, raw Unix timestamps and absolute instants', () => {
		// 01:30 occurs twice on 2027-11-07; Date picks the first (EDT, 05:30 UTC) occurrence, which exists.
		expect(tryParseTimestampInput('2027-11-07T01:30')).toBe(1_825_565_400n)
		expect(tryParseTimestampInput('2027-03-14T03:30:15')).toBe(1_805_009_415n)
		expect(tryParseTimestampInput('1805009400')).toBe(1_805_009_400n)
		expect(tryParseTimestampInput('2027-03-14T07:30:00Z')).toBe(1_805_009_400n)
		expect(tryParseTimestampInput('not a date')).toBeUndefined()
	})
})
