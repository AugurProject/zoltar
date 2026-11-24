/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAppPageTitle } from '../../app/lib/appPageTitle.js'

describe('statoblast document title', () => {
	test('titles the route with its visible heading', () => {
		expect(getAppPageTitle({ activeQuestionLedgersView: 'browse', route: 'pools' })).toBe('Security pool questions')
		expect(getAppPageTitle({ activeQuestionLedgersView: 'browse', route: 'open-oracle' })).toBe('Price reports')
	})

	test('names the security pool route', () => {
		expect(getAppPageTitle({ activeQuestionLedgersView: 'browse', route: 'security-pools' })).toBe('Security pools')
	})
})
