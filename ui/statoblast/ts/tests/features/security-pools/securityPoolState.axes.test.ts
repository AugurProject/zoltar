/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { ActiveReportingDetails, ReportingDetails } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/securityPoolState.js'
import { createActiveReportingDetails as createWorkflowActiveReportingDetails, createEscalationSides, createMarketDetails } from './workflow/builders.js'

function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return createWorkflowActiveReportingDetails({
		marketDetails: createMarketDetails({ endTime: 100n }),
		sides: createEscalationSides([1n, 5n, 2n]),
		totalCostAttoRep: 2n,
		viewerPoolHeldVaultRepBackingAttoRep: 10n,
		viewerVaultDisputeStakedAttoRep: 0n,
		viewerVaultRepBackingAttoRep: 10n,
		...overrides,
	})
}

function createNotStartedReportingDetails(overrides: Partial<Extract<ReportingDetails, { status: 'not-started' }>> = {}): ReportingDetails {
	return {
		settlementCollateralAttoEth: 1n,
		currentTime: 100n,
		forkThresholdAttoRep: 10n,
		marketDetails: createMarketDetails({ endTime: 100n }),
		nonDecisionThresholdAttoRep: 20n,
		questionOutcome: 'none',
		securityPoolAddress: zeroAddress,
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
		...overrides,
	}
}

describe('security pool state axes', () => {
	test.each<[Parameters<typeof deriveSecurityPoolLifecycleState>[0], ReturnType<typeof deriveSecurityPoolLifecycleState>]>([
		[{ questionOutcome: 'none', systemState: 'operational' }, 'operational'],
		[{ questionOutcome: 'yes', systemState: 'operational' }, 'ended'],
		[{ hasForkActivity: true, isChildPool: true, questionOutcome: 'yes', systemState: 'operational', universeHasForked: true }, 'operational'],
		[{ hasForkActivity: false, isChildPool: false, questionOutcome: 'none', systemState: 'operational', universeHasForked: true }, 'poolForked'],
		[{ hasForkActivity: true, isChildPool: false, questionOutcome: 'yes', systemState: 'operational', universeHasForked: true }, 'poolForked'],
		[{ hasForkActivity: false, isChildPool: false, questionOutcome: 'yes', systemState: 'operational', universeHasForked: true }, 'poolForked'],
		[{ questionOutcome: 'yes', systemState: 'forkMigration' }, 'forkMigration'],
		[{ questionOutcome: 'none', systemState: undefined }, undefined],
	])('derives lifecycle state from %o', (input, expected) => {
		expect(deriveSecurityPoolLifecycleState(input)).toBe(expected)
	})

	test.each<[string, Parameters<typeof deriveSecurityPoolReportingStage>[0], ReturnType<typeof deriveSecurityPoolReportingStage>]>([
		['unready missing details', { reportingDetails: undefined, reportingReady: false }, 'preOpen'],
		['ready missing details', { reportingDetails: undefined, reportingReady: true }, undefined],
		['not-started operational details', { reportingDetails: createNotStartedReportingDetails(), reportingReady: true }, 'notStarted'],
		['not-started resolved details', { reportingDetails: createNotStartedReportingDetails({ questionOutcome: 'yes', settlementState: 'resolved' }), reportingReady: true }, 'resolved'],
		['not-started fork-migration details', { reportingDetails: createNotStartedReportingDetails({ questionOutcome: 'yes', systemState: 'forkMigration' }), reportingReady: true }, 'notStarted'],
		['active locked details', { reportingDetails: createActiveReportingDetails(), reportingReady: true }, 'activeLocked'],
		['active withdrawable details', { reportingDetails: createActiveReportingDetails({ parentWithdrawalEnabled: true }), reportingReady: true }, 'activeWithdrawable'],
		['active resolved details', { reportingDetails: createActiveReportingDetails({ questionOutcome: 'yes', settlementState: 'resolved', parentWithdrawalEnabled: true }), reportingReady: true }, 'resolved'],
		['active non-decision details', { reportingDetails: createActiveReportingDetails({ hasReachedNonDecision: true }), reportingReady: true }, 'forkTriggered'],
		['active details after escalation end', { reportingDetails: createActiveReportingDetails({ currentTime: 350n }), reportingReady: true }, 'timedOut'],
	])('derives the reporting stage from %s', (_name, input, expected) => {
		expect(deriveSecurityPoolReportingStage(input)).toBe(expected)
	})

	test.each<[Parameters<typeof deriveSecurityPoolForkStage>[0], ReturnType<typeof deriveSecurityPoolForkStage>]>([
		[{ currentStage: 'migration', workflowDisabled: false }, 'migration'],
		[{ currentStage: 'auction', workflowDisabled: true }, 'disabled'],
		[{ currentStage: undefined, workflowDisabled: false }, undefined],
	])('derives fork stage from %o', (input, expected) => {
		expect(deriveSecurityPoolForkStage(input)).toBe(expected)
	})
})
