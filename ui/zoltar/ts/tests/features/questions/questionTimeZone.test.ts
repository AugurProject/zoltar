/// <reference types="bun-types" />

import { formatLocalAndUtcTimestamp, formatQuestionTimeZoneLabel, formatTimeZoneLabel } from '@zoltar/ui-zoltar-shared/features/questions/lib/questionTimeZone.js'
import { describe, expect, test } from 'bun:test'

// 2026-10-01 06:00:00 UTC (Helsinki summer time) and 2026-12-31 21:30:00 UTC (Helsinki winter time).
const SUMMER_TIMESTAMP = 1_790_834_400n
const WINTER_TIMESTAMP = 1_798_752_600n

describe('questionTimeZone', () => {
	test('labels a zone with the offset in effect at the instant, including daylight saving and partial hours', () => {
		const summer = new Date(Number(SUMMER_TIMESTAMP) * 1000)
		const winter = new Date(Number(WINTER_TIMESTAMP) * 1000)
		expect(formatTimeZoneLabel('Europe/Helsinki', summer)).toBe('Europe/Helsinki, UTC+3')
		expect(formatTimeZoneLabel('Europe/Helsinki', winter)).toBe('Europe/Helsinki, UTC+2')
		expect(formatTimeZoneLabel('America/New_York', winter)).toBe('America/New_York, UTC-5')
		expect(formatTimeZoneLabel('Asia/Kolkata', winter)).toBe('Asia/Kolkata, UTC+5:30')
		expect(formatTimeZoneLabel('America/St_Johns', winter)).toBe('America/St_Johns, UTC-3:30')
	})

	test('labels UTC zones without repeating the name', () => {
		const date = new Date(Number(SUMMER_TIMESTAMP) * 1000)
		expect(formatTimeZoneLabel('UTC', date)).toBe('UTC')
		expect(formatTimeZoneLabel('Etc/UTC', date)).toBe('UTC')
	})

	test('labels the time inputs with the offset at the chosen times instead of today', () => {
		const summerNow = new Date(Number(SUMMER_TIMESTAMP) * 1000)
		// A winter end time chosen in summer uses the winter offset.
		expect(formatQuestionTimeZoneLabel('Europe/Helsinki', { endTimestamp: WINTER_TIMESTAMP, now: summerNow, startTimestamp: undefined })).toBe('Europe/Helsinki, UTC+2')
		expect(formatQuestionTimeZoneLabel('Europe/Helsinki', { endTimestamp: undefined, now: summerNow, startTimestamp: WINTER_TIMESTAMP })).toBe('Europe/Helsinki, UTC+2')
		expect(formatQuestionTimeZoneLabel('Europe/Helsinki', { endTimestamp: undefined, now: summerNow, startTimestamp: undefined })).toBe('Europe/Helsinki, UTC+3')
		// A start and end across a daylight saving change name both offsets.
		expect(formatQuestionTimeZoneLabel('Europe/Helsinki', { endTimestamp: WINTER_TIMESTAMP, now: summerNow, startTimestamp: SUMMER_TIMESTAMP })).toBe('Europe/Helsinki, UTC+3 at start, UTC+2 at end')
		expect(formatQuestionTimeZoneLabel('UTC', { endTimestamp: WINTER_TIMESTAMP, now: summerNow, startTimestamp: SUMMER_TIMESTAMP })).toBe('UTC')
	})

	test('formats one instant in the local zone and in UTC', () => {
		expect(formatLocalAndUtcTimestamp(SUMMER_TIMESTAMP, 'Europe/Helsinki')).toEqual({ local: '2026-10-01 09:00', utc: '2026-10-01 06:00 UTC', zoneLabel: 'Europe/Helsinki, UTC+3' })
		expect(formatLocalAndUtcTimestamp(WINTER_TIMESTAMP, 'Europe/Helsinki')).toEqual({ local: '2026-12-31 23:30', utc: '2026-12-31 21:30 UTC', zoneLabel: 'Europe/Helsinki, UTC+2' })
		expect(formatLocalAndUtcTimestamp(WINTER_TIMESTAMP, 'America/New_York')).toEqual({ local: '2026-12-31 16:30', utc: '2026-12-31 21:30 UTC', zoneLabel: 'America/New_York, UTC-5' })
		expect(formatLocalAndUtcTimestamp(WINTER_TIMESTAMP, 'UTC')).toEqual({ local: '2026-12-31 21:30', utc: '2026-12-31 21:30 UTC', zoneLabel: 'UTC' })
	})

	test('keeps far-future years and their offsets well formed', () => {
		// 9999-12-31 23:00:00 UTC
		expect(formatLocalAndUtcTimestamp(253_402_297_200n, 'Europe/Helsinki')).toEqual({ local: '10000-01-01 01:00', utc: '9999-12-31 23:00 UTC', zoneLabel: 'Europe/Helsinki, UTC+2' })
	})

	test('rejects timestamps before the epoch or outside the supported date range', () => {
		expect(formatLocalAndUtcTimestamp(8_640_000_000_001n, 'UTC')).toBeUndefined()
		expect(formatLocalAndUtcTimestamp(-1n, 'Europe/Helsinki')).toBeUndefined()
		expect(formatLocalAndUtcTimestamp(-60_589_000_000n, 'Europe/Helsinki')).toBeUndefined()
	})
})
