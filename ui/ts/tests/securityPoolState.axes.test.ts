/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSecurityPoolLifecycleLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, isSecurityPoolEnded } from '../lib/securityPoolState.js'
import type { ActiveReportingDetails } from '../types/contracts.js'

function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		activationTime: 120n,
		bindingCapital: 10n,
		completeSetCollateralAmount: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: '0x0000000000000000000000000000000000000000',
		forkThreshold: 40n,
		hasReachedNonDecision: false,
		marketDetails: {
			answerUnit: '',
			createdAt: 1n,
			description: 'Question description',
			displayValueMax: 100n,
			displayValueMin: 0n,
			endTime: 100n,
			exists: true,
			marketType: 'binary',
			numTicks: 2n,
			outcomeLabels: ['Yes', 'No'],
			questionId: '0x01',
			startTime: 1n,
			title: 'Will this resolve?',
		},
		nonDecisionThreshold: 20n,
		questionOutcome: 'none',
		resolution: 'none',
		securityPoolAddress: '0x0000000000000000000000000000000000000000',
		sides: [
			{ balance: 1n, deposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: 5n, deposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 2n, deposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBond: 1n,
		status: 'active',
		totalCost: 2n,
		universeId: 1n,
		viewerVaultAvailableEscalationRep: 10n,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 0n,
		viewerVaultRepDepositShare: 10n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		...overrides,
	}
}

describe('security pool state axes', () => {
	test('derives lifecycle states from the protocol state and outcome', () => {
		expect(
			deriveSecurityPoolLifecycleState({
				questionOutcome: 'none',
				systemState: 'operational',
			}),
		).toBe('operational')
		expect(
			deriveSecurityPoolLifecycleState({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe('ended')
		expect(
			deriveSecurityPoolLifecycleState({
				questionOutcome: 'yes',
				systemState: 'forkMigration',
			}),
		).toBe('forkMigration')
		expect(
			deriveSecurityPoolLifecycleState({
				questionOutcome: 'none',
				systemState: undefined,
			}),
		).toBeUndefined()
		expect(
			isSecurityPoolEnded({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe(true)
		expect(getSecurityPoolLifecycleLabel('ended')).toBe('Ended')
		expect(getSecurityPoolLifecycleLabel(undefined)).toBe('Unknown')
	})

	test('derives reporting stages from reporting details and readiness', () => {
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: undefined,
				reportingReady: false,
			}),
		).toBe('preOpen')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: undefined,
				reportingReady: true,
			}),
		).toBeUndefined()
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: {
					completeSetCollateralAmount: 1n,
					currentTime: 100n,
					forkThreshold: 10n,
					marketDetails: createActiveReportingDetails().marketDetails,
					nonDecisionThreshold: 20n,
					questionOutcome: 'none',
					resolution: 'none',
					securityPoolAddress: '0x0000000000000000000000000000000000000000',
					startBond: 1n,
					status: 'not-started',
					universeId: 1n,
					viewerVaultAvailableEscalationRep: 0n,
					viewerVaultExists: false,
					viewerVaultLockedRepInEscalationGame: 0n,
					viewerVaultRepDepositShare: 0n,
					withdrawalEnabled: false,
					withdrawalState: 'not-finalized',
				},
				reportingReady: true,
			}),
		).toBe('notStarted')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails(),
				reportingReady: true,
			}),
		).toBe('activeLocked')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails({
					withdrawalEnabled: true,
				}),
				reportingReady: true,
			}),
		).toBe('activeWithdrawable')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails({
					questionOutcome: 'yes',
					resolution: 'yes',
					withdrawalEnabled: true,
					withdrawalState: 'resolved',
				}),
				reportingReady: true,
			}),
		).toBe('resolved')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails({
					hasReachedNonDecision: true,
				}),
				reportingReady: true,
			}),
		).toBe('forkTriggered')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails({
					currentTime: 350n,
				}),
				reportingReady: true,
			}),
		).toBe('timedOut')
	})

	test('derives fork stages from the current stage and workflow lock', () => {
		expect(
			deriveSecurityPoolForkStage({
				currentStage: 'migration',
				workflowDisabled: false,
			}),
		).toBe('migration')
		expect(
			deriveSecurityPoolForkStage({
				currentStage: 'auction',
				workflowDisabled: true,
			}),
		).toBe('disabled')
		expect(
			deriveSecurityPoolForkStage({
				currentStage: undefined,
				workflowDisabled: false,
			}),
		).toBeUndefined()
	})
})
