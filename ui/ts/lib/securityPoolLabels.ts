import { assertNever } from './assert.js'
import type { SecurityPoolLifecycleState } from './securityPoolState.js'

export function getSecurityPoolLifecycleLabel(state: SecurityPoolLifecycleState | undefined) {
	if (state === undefined) return 'Unknown'

	switch (state) {
		case 'operational':
			return 'Operational'
		case 'ended':
			return 'Ended'
		case 'poolForked':
			return 'Pool Forked'
		case 'forkMigration':
			return 'Fork Migration'
		case 'forkTruthAuction':
			return 'Truth Auction'
		default:
			return assertNever(state)
	}
}

export function getSecurityPoolStatusBadgeLabel({ hasForkActivity, lifecycleState }: { hasForkActivity: boolean; lifecycleState: SecurityPoolLifecycleState | undefined }) {
	if (lifecycleState === undefined) return 'Unknown'
	if (lifecycleState === 'poolForked' || lifecycleState === 'forkMigration') return 'Fork Migration'
	if (lifecycleState === 'forkTruthAuction') return 'Truth Auction'
	if (lifecycleState === 'operational' && hasForkActivity) return 'Fork Finalized'
	return getSecurityPoolLifecycleLabel(lifecycleState)
}
