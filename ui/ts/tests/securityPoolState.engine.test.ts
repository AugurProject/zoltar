/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { ALL_SECURITY_POOL_ACTIONS } from '../lib/securityPoolState/matrix.js'
import {
	MINT_AFTER_FORK_MESSAGE,
	POOL_ACTION_LOCK_REASON,
	REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE,
	REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE,
	REPORTING_FORK_TRIGGERED_MESSAGE,
	REPORTING_RESOLVED_MESSAGE,
	WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE,
	WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE,
} from '../lib/securityPoolState/messages.js'
import type { SecurityPoolActionId, SecurityPoolStateModel } from '../lib/securityPoolState.js'

function getEnabledActionIds(model: SecurityPoolStateModel) {
	return ALL_SECURITY_POOL_ACTIONS.filter(actionId => model.actions[actionId].enabled)
}

function expectActionEnabled(model: SecurityPoolStateModel, actionId: SecurityPoolActionId) {
	expect(model.actions[actionId].enabled).toBe(true)
	expect(model.actions[actionId].reason).toBeUndefined()
}

function expectActionBlocked(model: SecurityPoolStateModel, actionId: SecurityPoolActionId, reason?: string) {
	expect(model.actions[actionId].enabled).toBe(false)
	if (reason === undefined) {
		expect(model.actions[actionId].reason).toBeDefined()
		return
	}

	expect(model.actions[actionId].reason).toBe(reason)
}

describe('security pool state engine', () => {
	test('evaluates the operational lifecycle action set', () => {
		const model = evaluateSecurityPoolState({
			lifecycleState: 'operational',
			universeHasForked: false,
		})

		expect(model.lifecycleState).toBe('operational')
		expect(new Set(getEnabledActionIds(model))).toEqual(
			new Set([
				'approveRep',
				'depositRep',
				'queueWithdrawRep',
				'queueSetSecurityBondAllowance',
				'redeemFees',
				'createCompleteSet',
				'redeemCompleteSet',
				'requestPrice',
				'executeStagedOperation',
				'queueLiquidation',
				'reportOutcome',
				'withdrawEscalation',
				'forkWithOwnEscalation',
				'initiateFork',
				'forkUniverse',
				'createChildUniverse',
				'migrateRepToZoltar',
				'migrateVault',
				'migrateEscalationDeposits',
				'startTruthAuction',
				'submitBid',
				'finalizeTruthAuction',
				'refundLosingBids',
				'claimAuctionProceeds',
				'withdrawBids',
			]),
		)
		expectActionBlocked(model, 'redeemRep')
		expectActionBlocked(model, 'migrateShares')
		expectActionBlocked(model, 'redeemShares')
	})

	test('evaluates ended-pool lifecycle gating', () => {
		const model = evaluateSecurityPoolState({
			lifecycleState: 'ended',
			universeHasForked: false,
		})

		expect(model.lifecycleState).toBe('ended')
		expectActionEnabled(model, 'redeemRep')
		expectActionEnabled(model, 'redeemFees')
		expectActionEnabled(model, 'redeemCompleteSet')
		expectActionEnabled(model, 'redeemShares')
		expectActionBlocked(model, 'depositRep', POOL_ACTION_LOCK_REASON)
		expectActionBlocked(model, 'executeStagedOperation', POOL_ACTION_LOCK_REASON)
	})

	test('applies the universe-forked overlay with higher precedence than lifecycle rules', () => {
		const model = evaluateSecurityPoolState({
			lifecycleState: 'ended',
			universeHasForked: true,
		})

		expectActionEnabled(model, 'migrateShares')
		expectActionBlocked(model, 'createCompleteSet', MINT_AFTER_FORK_MESSAGE)
		expectActionBlocked(model, 'redeemCompleteSet', REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE)
		expectActionBlocked(model, 'redeemShares', REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE)
	})

	test('evaluates reporting stages through the shared model', () => {
		const activeLocked = evaluateSecurityPoolState({
			lifecycleState: 'operational',
			reportingStage: 'activeLocked',
			universeHasForked: false,
		})
		expect(activeLocked.reportingStage).toBe('activeLocked')
		expectActionEnabled(activeLocked, 'reportOutcome')
		expectActionBlocked(activeLocked, 'withdrawEscalation', WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE)

		const resolved = evaluateSecurityPoolState({
			lifecycleState: 'ended',
			reportingStage: 'resolved',
			universeHasForked: false,
		})
		expect(resolved.reportingStage).toBe('resolved')
		expectActionBlocked(resolved, 'reportOutcome', REPORTING_RESOLVED_MESSAGE)
		expectActionEnabled(resolved, 'withdrawEscalation')

		const forkTriggered = evaluateSecurityPoolState({
			lifecycleState: 'operational',
			reportingStage: 'forkTriggered',
			universeHasForked: false,
		})
		expect(forkTriggered.reportingStage).toBe('forkTriggered')
		expectActionBlocked(forkTriggered, 'reportOutcome', REPORTING_FORK_TRIGGERED_MESSAGE)
		expectActionBlocked(forkTriggered, 'withdrawEscalation', WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE)
	})

	test('evaluates fork-stage gating through the shared model', () => {
		const migration = evaluateSecurityPoolState({
			forkStage: 'migration',
			lifecycleState: 'forkMigration',
			universeHasForked: false,
		})
		expect(migration.forkStage).toBe('migration')
		expectActionEnabled(migration, 'createChildUniverse')
		expectActionBlocked(migration, 'initiateFork')

		const disabled = evaluateSecurityPoolState({
			forkStage: 'disabled',
			lifecycleState: 'operational',
			universeHasForked: false,
		})
		expect(disabled.forkStage).toBe('disabled')
		expectActionBlocked(disabled, 'submitBid')
		expectActionBlocked(disabled, 'forkWithOwnEscalation')
	})

	test('treats omitted axes as not-applicable instead of as synthetic unknown states', () => {
		const model = evaluateSecurityPoolState({
			universeHasForked: false,
		})

		expect(model.lifecycleState).toBeUndefined()
		expect(model.reportingStage).toBeUndefined()
		expect(model.forkStage).toBeUndefined()
		expectActionEnabled(model, 'createCompleteSet')
		expectActionEnabled(model, 'reportOutcome')
		expectActionEnabled(model, 'submitBid')
	})

	test('keeps enabled actions reason-free and disabled actions explained', () => {
		const scenarios = [
			evaluateSecurityPoolState({
				lifecycleState: 'operational',
				universeHasForked: false,
			}),
			evaluateSecurityPoolState({
				lifecycleState: 'ended',
				universeHasForked: true,
			}),
			evaluateSecurityPoolState({
				forkStage: 'settlement',
				lifecycleState: 'forkTruthAuction',
				reportingStage: 'timedOut',
				universeHasForked: false,
			}),
		]

		for (const model of scenarios) {
			for (const actionId of ALL_SECURITY_POOL_ACTIONS) {
				if (model.actions[actionId].enabled) {
					expect(model.actions[actionId].reason).toBeUndefined()
					continue
				}

				expect(model.actions[actionId].reason).toBeDefined()
			}
		}
	})
})
