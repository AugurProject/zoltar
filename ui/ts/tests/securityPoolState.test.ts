/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import {
	deriveSecurityPoolCapabilities,
	deriveSecurityPoolForkStage,
	deriveSecurityPoolReportingPhase,
	deriveSecurityPoolUiCapabilities,
	getSecurityPoolDisplayState,
	getSecurityPoolDisplayStateLabel,
	isSecurityPoolEnded,
	LIQUIDATION_ENDED_REASON,
	MARKET_ALREADY_FINALIZED_MESSAGE,
	MARKET_NOT_FINALIZED_MESSAGE,
	POOL_ACTION_LOCK_REASON,
	SHARE_MIGRATION_AFTER_FORK_MESSAGE,
	type SecurityPoolUiActionId,
} from '../lib/securityPoolState.js'
import type { ActiveReportingDetails } from '../types/contracts.js'

function expectActionAllowed(capabilities: ReturnType<typeof deriveSecurityPoolUiCapabilities>, actionId: SecurityPoolUiActionId) {
	expect(capabilities.actions[actionId].lifecycleAllowed).toBe(true)
	expect(capabilities.actions[actionId].lifecycleReason).toBeUndefined()
}

function expectActionBlocked(capabilities: ReturnType<typeof deriveSecurityPoolUiCapabilities>, actionId: SecurityPoolUiActionId, reason?: string) {
	expect(capabilities.actions[actionId].lifecycleAllowed).toBe(false)
	if (reason !== undefined) {
		expect(capabilities.actions[actionId].lifecycleReason).toBe(reason)
	} else {
		expect(capabilities.actions[actionId].lifecycleReason).toBeDefined()
	}
}

function createActiveReportingDetails(overrides: Partial<ActiveReportingDetails> = {}): ActiveReportingDetails {
	return {
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
		activationTime: 120n,
		startBond: 1n,
		status: 'active',
		totalCost: 2n,
		universeId: 1n,
		withdrawalEnabled: false,
		withdrawalState: 'not-finalized',
		viewerVaultAvailableEscalationRep: 10n,
		viewerVaultExists: true,
		viewerVaultLockedRepInEscalationGame: 0n,
		viewerVaultRepDepositShare: 10n,
		...overrides,
	}
}

describe('security pool display state helpers', () => {
	test('keeps unresolved operational pools in the operational display state', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'none',
				systemState: 'operational',
			}),
		).toBe('operational')
		expect(
			isSecurityPoolEnded({
				questionOutcome: 'none',
				systemState: 'operational',
			}),
		).toBe(false)
	})

	test('maps resolved operational pools to the ended display state', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe('ended')
		expect(
			isSecurityPoolEnded({
				questionOutcome: 'yes',
				systemState: 'operational',
			}),
		).toBe(true)
		expect(getSecurityPoolDisplayStateLabel('ended')).toBe('Ended')
	})

	test('keeps non-operational raw states unchanged', () => {
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'poolForked',
			}),
		).toBe('poolForked')
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'forkMigration',
			}),
		).toBe('forkMigration')
		expect(
			getSecurityPoolDisplayState({
				questionOutcome: 'yes',
				systemState: 'forkTruthAuction',
			}),
		).toBe('forkTruthAuction')
	})

	test('derives ended-pool capabilities from the shared lifecycle state machine', () => {
		const capabilities = deriveSecurityPoolCapabilities({
			questionOutcome: 'yes',
			systemState: 'operational',
			universeHasForked: false,
		})

		expect(capabilities.displayState).toBe('ended')
		expect(capabilities.isEnded).toBe(true)
		expect(capabilities.repExitMode).toBe('redeem')
		expect(capabilities.vaultCollateralActionsLockReason).toBe(POOL_ACTION_LOCK_REASON)
		expect(capabilities.liquidationDisabledReason).toBe(LIQUIDATION_ENDED_REASON)
		expect(capabilities.trading.mintDisabledReason).toBe(MARKET_ALREADY_FINALIZED_MESSAGE)
		expect(capabilities.trading.redeemResolvedSharesDisabledReason).toBeUndefined()
	})

	test('derives pre-finalization and post-fork trading capabilities from the shared lifecycle state machine', () => {
		const unresolvedCapabilities = deriveSecurityPoolCapabilities({
			questionOutcome: 'none',
			systemState: 'operational',
			universeHasForked: false,
		})
		expect(unresolvedCapabilities.repExitMode).toBe('withdraw')
		expect(unresolvedCapabilities.trading.redeemResolvedSharesDisabledReason).toBe(MARKET_NOT_FINALIZED_MESSAGE)
		expect(unresolvedCapabilities.trading.migrateSharesDisabledReason).toBe(SHARE_MIGRATION_AFTER_FORK_MESSAGE)

		const forkedCapabilities = deriveSecurityPoolCapabilities({
			questionOutcome: 'none',
			systemState: 'operational',
			universeHasForked: true,
		})
		expect(forkedCapabilities.trading.canMigrateShares).toBe(true)
		expect(forkedCapabilities.trading.migrateSharesDisabledReason).toBeUndefined()
		expect(forkedCapabilities.trading.canMintCompleteSets).toBe(false)
	})

	test('derives the canonical base write-action matrix for operational, ended, and forked pools', () => {
		const unresolvedOperational = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionAllowed(unresolvedOperational, 'approveRep')
		expectActionAllowed(unresolvedOperational, 'depositRep')
		expectActionAllowed(unresolvedOperational, 'queueWithdrawRep')
		expectActionAllowed(unresolvedOperational, 'queueSetSecurityBondAllowance')
		expectActionAllowed(unresolvedOperational, 'redeemFees')
		expectActionAllowed(unresolvedOperational, 'createCompleteSet')
		expectActionAllowed(unresolvedOperational, 'redeemCompleteSet')
		expectActionAllowed(unresolvedOperational, 'requestPrice')
		expectActionAllowed(unresolvedOperational, 'executeStagedOperation')
		expectActionAllowed(unresolvedOperational, 'queueLiquidation')
		expectActionBlocked(unresolvedOperational, 'redeemRep', 'REP redemption is only available after this pool has ended.')

		const ended = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'yes',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(ended, 'approveRep', POOL_ACTION_LOCK_REASON)
		expectActionBlocked(ended, 'depositRep', POOL_ACTION_LOCK_REASON)
		expectActionBlocked(ended, 'queueWithdrawRep', POOL_ACTION_LOCK_REASON)
		expectActionBlocked(ended, 'queueSetSecurityBondAllowance', POOL_ACTION_LOCK_REASON)
		expectActionAllowed(ended, 'redeemRep')
		expectActionAllowed(ended, 'redeemFees')
		expectActionAllowed(ended, 'redeemCompleteSet')
		expectActionAllowed(ended, 'redeemShares')
		expectActionAllowed(ended, 'requestPrice')
		expectActionBlocked(ended, 'executeStagedOperation', POOL_ACTION_LOCK_REASON)
		expectActionBlocked(ended, 'queueLiquidation', LIQUIDATION_ENDED_REASON)
		expectActionBlocked(ended, 'createCompleteSet', MARKET_ALREADY_FINALIZED_MESSAGE)

		const forkMigration = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			systemState: 'forkMigration',
			universeHasForked: false,
		})
		expectActionAllowed(forkMigration, 'approveRep')
		expectActionAllowed(forkMigration, 'depositRep')
		expectActionAllowed(forkMigration, 'queueWithdrawRep')
		expectActionAllowed(forkMigration, 'queueSetSecurityBondAllowance')
		expectActionAllowed(forkMigration, 'redeemFees')
		expectActionAllowed(forkMigration, 'requestPrice')
		expectActionAllowed(forkMigration, 'executeStagedOperation')
		expectActionAllowed(forkMigration, 'queueLiquidation')
		expectActionBlocked(forkMigration, 'createCompleteSet')
		expectActionBlocked(forkMigration, 'redeemCompleteSet')
		expectActionBlocked(forkMigration, 'redeemShares')
	})

	test('applies the universe-forked trading overlay through the canonical action matrix', () => {
		const capabilities = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			systemState: 'operational',
			universeHasForked: true,
		})

		expectActionAllowed(capabilities, 'migrateShares')
		expectActionBlocked(capabilities, 'createCompleteSet')
		expectActionBlocked(capabilities, 'redeemCompleteSet')
		expectActionBlocked(capabilities, 'redeemShares')
	})

	test('derives reporting action gating from the shared reporting phases', () => {
		const workflowLocked = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'active',
			reportingWorkflowLockedReason: 'Reporting opens after market end.',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(workflowLocked, 'reportOutcome', 'Reporting opens after market end.')
		expectActionBlocked(workflowLocked, 'withdrawEscalation', 'Reporting opens after market end.')

		const preOpen = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'preOpen',
			reportingPreOpenReason: 'Reporting opens after market end.',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(preOpen, 'reportOutcome', 'Reporting opens after market end.')
		expectActionBlocked(preOpen, 'withdrawEscalation', 'Reporting opens after market end.')

		const notStarted = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'notStarted',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionAllowed(notStarted, 'reportOutcome')
		expectActionBlocked(notStarted, 'withdrawEscalation', 'Withdrawals are unavailable until the first report or contribution deploys the escalation game.')

		const activeWithoutWithdrawals = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'active',
			reportingWithdrawalEnabled: false,
			reportingWithdrawalState: 'not-finalized',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionAllowed(activeWithoutWithdrawals, 'reportOutcome')
		expectActionBlocked(activeWithoutWithdrawals, 'withdrawEscalation', 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')

		const activeWithWithdrawals = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'yes',
			reportingPhase: 'active',
			reportingWithdrawalEnabled: true,
			reportingWithdrawalState: 'resolved',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionAllowed(activeWithWithdrawals, 'reportOutcome')
		expectActionAllowed(activeWithWithdrawals, 'withdrawEscalation')

		const resolved = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'yes',
			reportingPhase: 'resolved',
			reportingWithdrawalEnabled: true,
			reportingWithdrawalState: 'resolved',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(resolved, 'reportOutcome', 'Reporting is closed because escalation has resolved.')
		expectActionAllowed(resolved, 'withdrawEscalation')

		const forkTriggered = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'forkTriggered',
			reportingWithdrawalEnabled: false,
			reportingWithdrawalState: 'not-finalized',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(forkTriggered, 'reportOutcome', 'Reporting is closed because escalation reached non-decision and moved into the fork workflow.')
		expectActionBlocked(forkTriggered, 'withdrawEscalation', 'Escalation deposits move through the Fork workflow after non-decision; they cannot be withdrawn from this panel.')

		const timedOut = deriveSecurityPoolUiCapabilities({
			questionOutcome: 'none',
			reportingPhase: 'timedOut',
			reportingWithdrawalEnabled: false,
			reportingWithdrawalState: 'not-finalized',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(timedOut, 'reportOutcome', 'Reporting is closed because the escalation timeout has been reached.')
		expectActionBlocked(timedOut, 'withdrawEscalation', 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.')
	})

	test('derives fork action visibility and lifecycle gating from the current and selected fork stages', () => {
		const migrationCapabilities = deriveSecurityPoolUiCapabilities({
			forkStage: 'migration',
			questionOutcome: 'none',
			selectedForkStage: 'migration',
			systemState: 'forkMigration',
			universeHasForked: false,
		})
		expect(migrationCapabilities.actions.createChildUniverse.visible).toBe(true)
		expectActionAllowed(migrationCapabilities, 'createChildUniverse')
		expect(migrationCapabilities.actions.initiateFork.visible).toBe(false)
		expectActionBlocked(migrationCapabilities, 'initiateFork')

		const auctionCapabilities = deriveSecurityPoolUiCapabilities({
			forkStage: 'auction',
			questionOutcome: 'none',
			selectedForkStage: 'auction',
			systemState: 'forkTruthAuction',
			universeHasForked: false,
		})
		expect(auctionCapabilities.actions.startTruthAuction.visible).toBe(true)
		expectActionAllowed(auctionCapabilities, 'startTruthAuction')
		expect(auctionCapabilities.actions.claimAuctionProceeds.visible).toBe(false)
		expectActionBlocked(auctionCapabilities, 'claimAuctionProceeds')

		const disabledCapabilities = deriveSecurityPoolUiCapabilities({
			forkStage: 'disabled',
			forkWorkflowDisabledReason: 'This pool is currently operational, so fork and truth auction actions are read only.',
			questionOutcome: 'none',
			selectedForkStage: 'initiate',
			systemState: 'operational',
			universeHasForked: false,
		})
		expectActionBlocked(disabledCapabilities, 'forkWithOwnEscalation', 'This pool is currently operational, so fork and truth auction actions are read only.')
		expectActionBlocked(disabledCapabilities, 'submitBid', 'This pool is currently operational, so fork and truth auction actions are read only.')
	})

	test('maps the reporting and fork phase helpers into the shared action-matrix inputs', () => {
		expect(
			deriveSecurityPoolReportingPhase({
				reportingDetails: undefined,
				reportingReady: false,
			}),
		).toBe('preOpen')
		expect(
			deriveSecurityPoolReportingPhase({
				reportingDetails: undefined,
				reportingReady: true,
			}),
		).toBe('unknown')
		expect(
			deriveSecurityPoolReportingPhase({
				reportingDetails: {
					currentTime: 100n,
					status: 'not-started',
					marketDetails: createActiveReportingDetails().marketDetails,
					forkThreshold: 10n,
					nonDecisionThreshold: 20n,
					questionOutcome: 'none',
					resolution: 'none',
					securityPoolAddress: '0x0000000000000000000000000000000000000000',
					startBond: 1n,
					universeId: 1n,
					withdrawalEnabled: false,
					withdrawalState: 'not-finalized',
					viewerVaultAvailableEscalationRep: 0n,
					viewerVaultExists: false,
					viewerVaultLockedRepInEscalationGame: 0n,
					viewerVaultRepDepositShare: 0n,
					completeSetCollateralAmount: 1n,
				},
				reportingReady: true,
			}),
		).toBe('notStarted')
		expect(
			deriveSecurityPoolReportingPhase({
				reportingDetails: createActiveReportingDetails({
					hasReachedNonDecision: true,
				}),
				reportingReady: true,
			}),
		).toBe('forkTriggered')

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
	})
})
