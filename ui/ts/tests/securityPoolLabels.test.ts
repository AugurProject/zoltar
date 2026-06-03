/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getSecurityPoolLifecycleLabel, getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'

void describe('security pool lifecycle label', () => {
	void test('maps each known lifecycle state and undefined', () => {
		expect(getSecurityPoolLifecycleLabel(undefined)).toBe('Unknown')
		expect(getSecurityPoolLifecycleLabel('operational')).toBe('Operational')
		expect(getSecurityPoolLifecycleLabel('ended')).toBe('Ended')
		expect(getSecurityPoolLifecycleLabel('poolForked')).toBe('Pool Forked')
		expect(getSecurityPoolLifecycleLabel('forkMigration')).toBe('Fork Migration')
		expect(getSecurityPoolLifecycleLabel('forkTruthAuction')).toBe('Truth Auction')
	})

	void test('derives fork-aware status badge labels', () => {
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: undefined })).toBe('Unknown')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'operational' })).toBe('Operational')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'operational' })).toBe('Fork Finalized')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'poolForked' })).toBe('Fork Migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkMigration' })).toBe('Fork Migration')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: true, lifecycleState: 'forkTruthAuction' })).toBe('Truth Auction')
		expect(getSecurityPoolStatusBadgeLabel({ hasForkActivity: false, lifecycleState: 'ended' })).toBe('Ended')
	})
})
