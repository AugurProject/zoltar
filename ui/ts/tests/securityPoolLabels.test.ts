/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { getSecurityPoolLifecycleLabel } from '../lib/securityPoolLabels.js'

void describe('security pool lifecycle label', () => {
	void test('maps each known lifecycle state and undefined', () => {
		expect(getSecurityPoolLifecycleLabel(undefined)).toBe('Unknown')
		expect(getSecurityPoolLifecycleLabel('operational')).toBe('Operational')
		expect(getSecurityPoolLifecycleLabel('ended')).toBe('Ended')
		expect(getSecurityPoolLifecycleLabel('poolForked')).toBe('Pool Forked')
		expect(getSecurityPoolLifecycleLabel('forkMigration')).toBe('Fork Migration')
		expect(getSecurityPoolLifecycleLabel('forkTruthAuction')).toBe('Truth Auction')
	})
})
