/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { ALL_SECURITY_POOL_ACTIONS } from '../lib/securityPoolState/matrix.js'
import type { SecurityPoolActionId, SecurityPoolStateModel } from '../lib/securityPoolState.js'

function getEnabledActionIds(model: SecurityPoolStateModel) {
	return ALL_SECURITY_POOL_ACTIONS.filter(actionId => model.actions[actionId].enabled)
}

function expectActionEnabled(model: SecurityPoolStateModel, actionId: SecurityPoolActionId) {
	expect(model.actions[actionId].enabled).toBe(true)
}

function expectActionBlocked(model: SecurityPoolStateModel, actionId: SecurityPoolActionId) {
	expect(model.actions[actionId].enabled).toBe(false)
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
		expectActionBlocked(model, 'depositRep')
		expectActionBlocked(model, 'executeStagedOperation')
	})

	test('applies the universe-forked overlay with higher precedence than lifecycle rules', () => {
		const model = evaluateSecurityPoolState({
			lifecycleState: 'ended',
			universeHasForked: true,
		})

		expectActionEnabled(model, 'migrateShares')
		expectActionBlocked(model, 'createCompleteSet')
		expectActionBlocked(model, 'redeemCompleteSet')
		expectActionBlocked(model, 'redeemShares')
	})

	test('evaluates reporting stages through the shared model', () => {
		const activeLocked = evaluateSecurityPoolState({
			lifecycleState: 'operational',
			reportingStage: 'activeLocked',
			universeHasForked: false,
		})
		expect(activeLocked.reportingStage).toBe('activeLocked')
		expectActionEnabled(activeLocked, 'reportOutcome')
		expectActionBlocked(activeLocked, 'withdrawEscalation')

		const resolved = evaluateSecurityPoolState({
			lifecycleState: 'ended',
			reportingStage: 'resolved',
			universeHasForked: false,
		})
		expect(resolved.reportingStage).toBe('resolved')
		expectActionBlocked(resolved, 'reportOutcome')
		expectActionEnabled(resolved, 'withdrawEscalation')

		const forkTriggered = evaluateSecurityPoolState({
			lifecycleState: 'operational',
			reportingStage: 'forkTriggered',
			universeHasForked: false,
		})
		expect(forkTriggered.reportingStage).toBe('forkTriggered')
		expectActionBlocked(forkTriggered, 'reportOutcome')
		expectActionBlocked(forkTriggered, 'withdrawEscalation')
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

	test('returns a pure enabled-map for every action', () => {
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
				expect(typeof model.actions[actionId].enabled).toBe('boolean')
			}
		}
	})
})
