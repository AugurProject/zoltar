/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleReadinessActions } from '../../../features/open-oracle/lib/openOracleReadiness.js'

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
				key: 'submit-initial-report',
				readiness: 'blocked',
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
				title: 'Dispute & Swap',
			},
			{
				actionLabel: 'Settle Report',
				blocker: 'Wait until the dispute window closes.',
				key: 'settle-report',
				readiness: 'blocked',
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
				title: 'Dispute & Swap',
			},
			{
				actionLabel: 'Settle Report',
				blocker: 'Load a report first.',
				key: 'settle-report',
				readiness: 'blocked',
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
				key: 'settle-report',
				readiness: 'ready',
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
		).toEqual([])
	})
})
