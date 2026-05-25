/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSecurityPoolDisplayState, getSecurityPoolDisplayStateLabel, isSecurityPoolEnded } from '../lib/securityPoolState.js'

describe('security pool display state helpers', () => {
	test('keeps unresolved operational pools in the operational display state', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'none',
				systemState: 'operational',
			}),
		).toBe('operational')
		expect(
			isSecurityPoolEnded({
				questionOutcome: 'none',
				systemState: 'operational',
			}),
		).toBe(false)
	})

	test('maps resolved operational pools to the ended display state', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe('ended')
		expect(
			isSecurityPoolEnded({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe(true)
		expect(getSecurityPoolDisplayStateLabel('ended')).toBe('Ended')
	})

	test('keeps non-operational raw states unchanged', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'poolForked',
			}),
		).toBe('poolForked')
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'forkMigration',
			}),
		).toBe('forkMigration')
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'forkTruthAuction',
			}),
		).toBe('forkTruthAuction')
	})
})
