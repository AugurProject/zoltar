/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { formatSecurityPoolPageSummary, getPoolStateFilter, getPoolStateLabel, getSecurityPoolStatusBadgeLabel } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolLabels.js'

void describe('security pool lifecycle label', () => {
	void test('derives fork-aware status badge labels', () => {
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: undefined })).toBe('Unknown')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'operational' })).toBe('Operational')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'operational' })).toBe('Fork finalized')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'poolForked' })).toBe('Fork migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkMigration' })).toBe('Fork migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkTruthAuction' })).toBe('Truth auction')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'ended', questionOutcome: 'yes' })).toBe('Finalized as Yes')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'ended' })).toBe('Finalized')
	})

	void test('names each browse filter with the word its pools carry on their badge', () => {
		for (const lifecycleState of ['operational', 'ended', 'poolForked', 'forkMigration', 'forkTruthAuction'] as const) expect(getPoolStateLabel(getPoolStateFilter(lifecycleState))).toBe(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState }))
		expect(getPoolStateFilter('poolForked')).toBe('forkMigration')
		expect(getPoolStateLabel('ended')).toBe('Finalized')
	})

	void test('selects count grammar outside the copy layer', () => {
		expect(formatSecurityPoolPageSummary(5, 12)).toBe('5 of 12 pools match.')
		expect(formatSecurityPoolPageSummary(0, 2)).toBe('0 of 2 pools match.')
		expect(formatSecurityPoolPageSummary(1, 2)).toBe('1 of 2 pools matches.')
		expect(formatSecurityPoolPageSummary(2, 2)).toBe('2 of 2 pools match.')
		expect(formatSecurityPoolPageSummary(1, 1)).toBe('1 of 1 pool matches.')
	})
})
