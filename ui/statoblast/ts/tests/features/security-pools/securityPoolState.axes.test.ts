/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getSecurityPoolLifecycleLabel } from '../../../features/security-pools/lib/securityPoolLabels.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, isSecurityPoolEnded } from '../../../features/security-pools/lib/securityPoolState.js'
import type { ActiveReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'

function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
		activationTime: 120n,
		bindingCapital: 10n,
		settlementCollateralAttoEth: 1n,
		currentRequiredBond: 2n,
		currentTime: 150n,
		escalationEndTime: 300n,
		escalationGameAddress: '0x0000000000000000000000000000000000000000',
		forkThresholdAttoRep: 40n,
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
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		securityPoolAddress: '0x0000000000000000000000000000000000000000',
		sides: [
			{ balance: 1n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
			{ balance: 5n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
			{ balance: 2n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
		],
		startBondAttoRep: 1n,
		status: 'active',
		systemState: 'operational',
		totalCostAttoRep: 2n,
		universeId: 1n,
		viewerPoolHeldVaultRepBackingAttoRep: 10n,
		viewerVaultExists: true,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 10n,
		settlementState: 'locked',
		parentWithdrawalEnabled: false,
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
				hasForkActivity: true,
				isChildPool: true,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe('operational')
		expect(
			deriveSecurityPoolLifecycleState({
				hasForkActivity: false,
				isChildPool: false,
				questionOutcome: 'none',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe('poolForked')
		expect(
			deriveSecurityPoolLifecycleState({
				hasForkActivity: true,
				isChildPool: false,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe('poolForked')
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
		expect(
			isSecurityPoolEnded({
				hasForkActivity: true,
				isChildPool: true,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe(false)
		expect(
			isSecurityPoolEnded({
				hasForkActivity: false,
				isChildPool: false,
				questionOutcome: 'yes',
				systemState: 'operational',
				universeHasForked: true,
			}),
		).toBe(false)
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
					settlementCollateralAttoEth: 1n,
					currentTime: 100n,
					forkThresholdAttoRep: 10n,
					marketDetails: createActiveReportingDetails().marketDetails,
					nonDecisionThresholdAttoRep: 20n,
					questionOutcome: 'none',
					securityPoolAddress: '0x0000000000000000000000000000000000000000',
					startBondAttoRep: 1n,
					status: 'not-started',
					systemState: 'operational',
					universeId: 1n,
					viewerPoolHeldVaultRepBackingAttoRep: 0n,
					viewerVaultExists: false,
					viewerVaultDisputeStakedAttoRep: 0n,
					viewerVaultRepBackingAttoRep: 0n,
					settlementState: 'locked',
					parentWithdrawalEnabled: false,
				},
				reportingReady: true,
			}),
		).toBe('notStarted')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: {
					settlementCollateralAttoEth: 1n,
					currentTime: 100n,
					forkThresholdAttoRep: 10n,
					marketDetails: createActiveReportingDetails().marketDetails,
					nonDecisionThresholdAttoRep: 20n,
					questionOutcome: 'yes',
					securityPoolAddress: '0x0000000000000000000000000000000000000000',
					startBondAttoRep: 1n,
					status: 'not-started',
					systemState: 'operational',
					universeId: 1n,
					viewerPoolHeldVaultRepBackingAttoRep: 0n,
					viewerVaultExists: false,
					viewerVaultDisputeStakedAttoRep: 0n,
					viewerVaultRepBackingAttoRep: 0n,
					settlementState: 'resolved',
					parentWithdrawalEnabled: false,
				},
				reportingReady: true,
			}),
		).toBe('resolved')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: {
					settlementCollateralAttoEth: 1n,
					currentTime: 100n,
					forkThresholdAttoRep: 10n,
					marketDetails: createActiveReportingDetails().marketDetails,
					nonDecisionThresholdAttoRep: 20n,
					questionOutcome: 'yes',
					securityPoolAddress: '0x0000000000000000000000000000000000000000',
					startBondAttoRep: 1n,
					status: 'not-started',
					systemState: 'forkMigration',
					universeId: 1n,
					viewerPoolHeldVaultRepBackingAttoRep: 0n,
					viewerVaultExists: false,
					viewerVaultDisputeStakedAttoRep: 0n,
					viewerVaultRepBackingAttoRep: 0n,
					settlementState: 'locked',
					parentWithdrawalEnabled: false,
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
					parentWithdrawalEnabled: true,
				}),
				reportingReady: true,
			}),
		).toBe('activeWithdrawable')
		expect(
			deriveSecurityPoolReportingStage({
				reportingDetails: createActiveReportingDetails({
					questionOutcome: 'yes',
					settlementState: 'resolved',
					parentWithdrawalEnabled: true,
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
