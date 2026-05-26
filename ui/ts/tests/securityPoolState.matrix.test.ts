/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	ALL_SECURITY_POOL_ACTIONS,
	DISABLED_REASON_BY_FORK_STAGE,
	DISABLED_REASON_BY_LIFECYCLE,
	DISABLED_REASON_BY_REPORTING_STAGE,
	DISABLED_REASON_BY_UNIVERSE_FORKED,
	ENABLED_ACTIONS_BY_FORK_STAGE,
	ENABLED_ACTIONS_BY_LIFECYCLE,
	ENABLED_ACTIONS_BY_REPORTING_STAGE,
	FORK_ACTIONS,
	LIFECYCLE_ACTIONS,
	REPORTING_ACTIONS,
	UNIVERSE_FORKED_DISABLE,
	UNIVERSE_FORKED_ENABLE,
} from '../lib/securityPoolState/matrix.js'
import { FORK_WORKFLOW_DISABLED_MESSAGE, MARKET_ALREADY_FINALIZED_MESSAGE, WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE } from '../lib/securityPoolState/messages.js'
import type { SecurityPoolActionId } from '../lib/securityPoolState.js'

function expectActionSet(actionIds: readonly SecurityPoolActionId[], expectedActionIds: readonly SecurityPoolActionId[]) {
	expect(new Set(actionIds)).toEqual(new Set(expectedActionIds))
}

describe('security pool action matrix data', () => {
	test('lists the exact lifecycle allowlists', () => {
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.operational, ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'createCompleteSet', 'redeemCompleteSet', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.ended, ['redeemRep', 'redeemFees', 'redeemCompleteSet', 'redeemShares', 'requestPrice'])
		expectActionSet(ENABLED_ACTIONS_BY_LIFECYCLE.forkMigration, ['approveRep', 'depositRep', 'queueWithdrawRep', 'queueSetSecurityBondAllowance', 'redeemFees', 'requestPrice', 'executeStagedOperation', 'queueLiquidation'])
	})

	test('lists the exact reporting, fork, and overlay allowlists', () => {
		expectActionSet(ENABLED_ACTIONS_BY_REPORTING_STAGE.activeWithdrawable, ['reportOutcome', 'withdrawEscalation'])
		expectActionSet(ENABLED_ACTIONS_BY_REPORTING_STAGE.resolved, ['withdrawEscalation'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.initiate, ['forkWithOwnEscalation', 'initiateFork', 'forkUniverse'])
		expectActionSet(ENABLED_ACTIONS_BY_FORK_STAGE.settlement, ['finalizeTruthAuction', 'refundLosingBids', 'claimAuctionProceeds', 'withdrawBids'])
		expectActionSet(UNIVERSE_FORKED_ENABLE, ['migrateShares'])
		expectActionSet(UNIVERSE_FORKED_DISABLE, ['createCompleteSet', 'redeemCompleteSet', 'redeemShares'])
	})

	test('covers every known action and every disabled domain action with a reason', () => {
		expect(new Set(ALL_SECURITY_POOL_ACTIONS)).toEqual(new Set([...LIFECYCLE_ACTIONS, ...REPORTING_ACTIONS, ...FORK_ACTIONS]))

		for (const state of Object.keys(ENABLED_ACTIONS_BY_LIFECYCLE) as Array<keyof typeof ENABLED_ACTIONS_BY_LIFECYCLE>) {
			const enabledActions = ENABLED_ACTIONS_BY_LIFECYCLE[state]
			for (const actionId of LIFECYCLE_ACTIONS) {
				if (enabledActions.includes(actionId)) continue
				expect(DISABLED_REASON_BY_LIFECYCLE[state][actionId]).toBeDefined()
			}
		}

		for (const state of Object.keys(ENABLED_ACTIONS_BY_REPORTING_STAGE) as Array<keyof typeof ENABLED_ACTIONS_BY_REPORTING_STAGE>) {
			const enabledActions = ENABLED_ACTIONS_BY_REPORTING_STAGE[state]
			for (const actionId of REPORTING_ACTIONS) {
				if (enabledActions.includes(actionId)) continue
				expect(DISABLED_REASON_BY_REPORTING_STAGE[state][actionId]).toBeDefined()
			}
		}

		for (const state of Object.keys(ENABLED_ACTIONS_BY_FORK_STAGE) as Array<keyof typeof ENABLED_ACTIONS_BY_FORK_STAGE>) {
			const enabledActions = ENABLED_ACTIONS_BY_FORK_STAGE[state]
			for (const actionId of FORK_ACTIONS) {
				if (enabledActions.includes(actionId)) continue
				expect(DISABLED_REASON_BY_FORK_STAGE[state][actionId]).toBeDefined()
			}
		}
	})

	test('keeps the shared reason maps human-auditable', () => {
		expect(DISABLED_REASON_BY_LIFECYCLE.ended.createCompleteSet).toBe(MARKET_ALREADY_FINALIZED_MESSAGE)
		expect(DISABLED_REASON_BY_REPORTING_STAGE.activeLocked.withdrawEscalation).toBe(WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE)
		expect(DISABLED_REASON_BY_FORK_STAGE.disabled.submitBid).toBe(FORK_WORKFLOW_DISABLED_MESSAGE)
		expect(DISABLED_REASON_BY_UNIVERSE_FORKED.redeemCompleteSet).toBeDefined()
	})
})
