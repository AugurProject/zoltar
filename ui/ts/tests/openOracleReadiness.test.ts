/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleReadinessActions } from '../lib/openOracleReadiness.js'

describe('open oracle readiness actions', () => {
	test('blocks initial report until a report is loaded and uses the default title when no report id is present', () => {
		expect(
			getOpenOracleReadinessActions({
				actionMode: 'initial-report',
				disputeMessage: undefined,
				hasReport: false,
				reportId: '',
				settleMessage: undefined,
			}),
		).toEqual([
			{
				actionLabel: 'Initial Report',
				blocker: 'Load a report first.',
				description: 'Provide price, approvals, and submission details for the initial report.',
				key: 'submit-initial-report',
				readiness: 'blocked',
				safetyId: 'open-oracle.submitInitialReport',
				title: 'Submit Initial Report',
			},
		])
	})

	test('builds dispute-mode actions with independent dispute and settle blockers', () => {
		expect(
			getOpenOracleReadinessActions({
				actionMode: 'dispute',
				disputeMessage: undefined,
				hasReport: true,
				reportId: '7',
				settleMessage: 'Wait until the dispute window closes.',
			}),
		).toEqual([
			{
				actionLabel: 'Dispute & Swap',
				description: 'Challenge the current report and provide the replacement swap amounts.',
				key: 'dispute-report',
				readiness: 'ready',
				safetyId: 'open-oracle.dispute',
				title: 'Dispute & Swap',
			},
			{
				actionLabel: 'Settle Report',
				blocker: 'Wait until the dispute window closes.',
				description: 'Review settlement readiness and settle once the dispute window has closed.',
				key: 'settle-report',
				readiness: 'blocked',
				safetyId: 'open-oracle.settle',
				title: 'Settle Report',
			},
		])
	})

	test('uses the base blocker for every dispute-mode action when no report is loaded', () => {
		expect(
			getOpenOracleReadinessActions({
				actionMode: 'dispute',
				disputeMessage: 'Need approval first.',
				hasReport: false,
				reportId: '4',
				settleMessage: 'Still disputable.',
			}),
		).toEqual([
			{
				actionLabel: 'Dispute & Swap',
				blocker: 'Load a report first.',
				description: 'Challenge the current report and provide the replacement swap amounts.',
				key: 'dispute-report',
				readiness: 'blocked',
				safetyId: 'open-oracle.dispute',
				title: 'Dispute & Swap',
			},
			{
				actionLabel: 'Settle Report',
				blocker: 'Load a report first.',
				description: 'Review settlement readiness and settle once the dispute window has closed.',
				key: 'settle-report',
				readiness: 'blocked',
				safetyId: 'open-oracle.settle',
				title: 'Settle Report',
			},
		])
	})

	test('builds settle and read-only readiness actions', () => {
		expect(
			getOpenOracleReadinessActions({
				actionMode: 'settle',
				disputeMessage: undefined,
				hasReport: true,
				reportId: '12',
				settleMessage: undefined,
			}),
		).toEqual([
			{
				actionLabel: 'Settle Report',
				description: 'Confirm settlement once the report is ready.',
				key: 'settle-report',
				readiness: 'ready',
				safetyId: 'open-oracle.settle',
				title: 'Settle Report',
			},
		])

		expect(
			getOpenOracleReadinessActions({
				actionMode: 'read-only',
				disputeMessage: undefined,
				hasReport: true,
				reportId: '12',
				settleMessage: undefined,
			}),
		).toEqual([
			{
				actionLabel: 'No write action',
				description: 'This report has completed its lifecycle.',
				key: 'settled-read-only',
				readiness: 'ready',
				safetyId: 'open-oracle.readOnly',
				title: 'Settled Report',
			},
		])
	})
})
