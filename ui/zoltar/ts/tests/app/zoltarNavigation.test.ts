/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { isUniverseForkedNoticeVisible } from '../../app/lib/zoltarNavigation.js'

describe('isUniverseForkedNoticeVisible', () => {
	test('leaves the fork to the Overview status instead of repeating it in the app-wide notice', () => {
		expect(isUniverseForkedNoticeVisible({ route: 'zoltar', universeHasForked: true, zoltarView: 'overview' })).toBe(false)
	})

	test('shows the notice on every other page of a forked universe', () => {
		expect(isUniverseForkedNoticeVisible({ route: 'zoltar', universeHasForked: true, zoltarView: 'questions' })).toBe(true)
		expect(isUniverseForkedNoticeVisible({ route: 'zoltar', universeHasForked: true, zoltarView: 'migrate' })).toBe(true)
		expect(isUniverseForkedNoticeVisible({ route: 'deploy', universeHasForked: true, zoltarView: 'overview' })).toBe(true)
	})

	test('never shows the notice for a universe that has not forked', () => {
		expect(isUniverseForkedNoticeVisible({ route: 'zoltar', universeHasForked: false, zoltarView: 'questions' })).toBe(false)
	})
})
