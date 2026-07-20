/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { ALL_SECURITY_POOL_ACTIONS, ENABLED_ACTIONS_BY_FORK_STAGE, ENABLED_ACTIONS_BY_LIFECYCLE, ENABLED_ACTIONS_BY_REPORTING_STAGE, FORK_ACTIONS, LIFECYCLE_ACTIONS, REPORTING_ACTIONS, UNIVERSE_FORKED_DISABLE, UNIVERSE_FORKED_ENABLE } from '../../../features/security-pools/lib/securityPoolState/matrix.js'
import type { SecurityPoolActionId } from '../../../features/security-pools/lib/securityPoolState.js'

function expectActionSet(actionIds: readonly SecurityPoolActionId[], expectedActionIds: readonly SecurityPoolActionId[]) {
	expect(new Set(actionIds)).toEqual(new Set(expectedActionIds))
}

describe('security pool action matrix data', () => {
	test('lists the exact lifecycle allowlists', () => {
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.operational, ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.ended, ['redeemRep', 'redeemFees', 'redeemCompleteSet', 'redeemShares', 'requestPrice'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.poolForked, ['redeemFees'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.forkMigration, ['redeemFees'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.forkTruthAuction, ['redeemFees'])
	})

	test('lists the exact reporting, fork, and overlay allowlists', () => {
		expectActionSet(ENABLED_ACTIONS_BY_REPORTING_STAGE.activeWithdrawable, ['reportOutcome', 'withdrawEscalation'])
		expectActionSet(ENABLED_ACTIONS_BY_REPORTING_STAGE.resolved, ['withdrawEscalation'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.initiate, ['forkWithOwnEscalation', 'initiateFork', 'forkUniverse'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.migration, ['createChildUniverse', 'migrateRepToZoltar', 'migrateVault', 'claimParentEscalationDeposits', 'migrateUnresolvedEscalation', 'startTruthAuction'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.auction, ['submitBid', 'finalizeTruthAuction', 'refundLosingBids'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.settlement, ['claimAuctionProceeds', 'settleForkedEscalation'])
		expectActionSet(UNIVERSE_FORKED_ENABLE, ['migrateShares'])
		expectActionSet(UNIVERSE_FORKED_DISABLE, ['createCompleteSet', 'redeemCompleteSet', 'redeemShares'])
	})

	test('covers every known action and keeps domain action sets aligned', () => {
		expect(new Set(ALL_SECURITY_POOL_ACTIONS)).toEqual(new Set([...LIFECYCLE_ACTIONS, ...REPORTING_ACTIONS, ...FORK_ACTIONS]))

		for (const state of Object.keys(ENABLED_ACTIONS_BY_LIFECYCLE) as Array<keyof typeof ENABLED_ACTIONS_BY_LIFECYCLE>) {
			const enabledActions = ENABLED_ACTIONS_BY_LIFECYCLE[state]
			for (const actionId of LIFECYCLE_ACTIONS) {
				expect(typeof enabledActions.includes(actionId)).toBe('boolean')
			}
		}

		for (const state of Object.keys(ENABLED_ACTIONS_BY_REPORTING_STAGE) as Array<keyof typeof ENABLED_ACTIONS_BY_REPORTING_STAGE>) {
			const enabledActions = ENABLED_ACTIONS_BY_REPORTING_STAGE[state]
			for (const actionId of REPORTING_ACTIONS) {
				expect(typeof enabledActions.includes(actionId)).toBe('boolean')
			}
		}

		for (const state of Object.keys(ENABLED_ACTIONS_BY_FORK_STAGE) as Array<keyof typeof ENABLED_ACTIONS_BY_FORK_STAGE>) {
			const enabledActions = ENABLED_ACTIONS_BY_FORK_STAGE[state]
			for (const actionId of FORK_ACTIONS) {
				expect(typeof enabledActions.includes(actionId)).toBe('boolean')
			}
		}
	})
})
