import { assertNever } from '../assert.js'
import type { SecurityPoolLifecycleState } from './types.js'

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
