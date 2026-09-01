/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import {
	getCurrentForkWorkflowSelectionStage,
	getCurrentSelectedPoolForkAuctionDetails,
	getCurrentSelectedPoolReportingDetails,
	getCurrentSelectedPoolForkStage,
	getCurrentPoolOracleManagerDetails,
	getSelectedPoolCardTitle,
	getSelectedPoolForkWorkflowView,
	getForkWorkflowStageSelection,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolViewForForkWorkflowSelectionStage,
	getSelectedPoolViewForForkStage,
	getSelectedPoolWorkflowGuardMessage,
	getSelectedPoolWorkflowLockedPresentation,
	isSelectedPoolForkWorkflowView,
	normalizeForkWorkflowSelectionStage,
	resolveForkWorkflowSelectionStage,
	isForkWorkflowDisabled,
	isSupportedSelectedPoolView,
	resolveSelectedPoolView,
	shouldShowSelectedPoolWorkflowDetails,
} from '../../../features/security-pools/lib/securityPoolWorkflow.js'
import { getOracleLastPriceDisplay, getOraclePriceValidityPresentation } from '@zoltar/ui-zoltar/features/open-oracle/lib/openOracle.js'
import { ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '../../../features/security-pools/lib/securityVault.js'

void describe('selected pool workflow lookup state', () => {
	void test('uses a single stable operate header title', () => {
		expect(getSelectedPoolCardTitle('Will the event happen?')).toBe('Will the event happen?')

		expect(getSelectedPoolCardTitle()).toBe('Manage Pool')

		expect(getSelectedPoolCardTitle()).toBe('Manage Pool')
	})

	void test('maps the legacy resolution view alias to the reporting tab', () => {
		expect(resolveSelectedPoolView(undefined)).toBe('vaults')
		expect(resolveSelectedPoolView('resolution')).toBe('reporting')
		expect(resolveSelectedPoolView('reporting')).toBe('reporting')
		expect(resolveSelectedPoolView('fork')).toBe('vaults')
		expect(resolveSelectedPoolView('fork-workflow')).toBe('fork-workflow')
		expect(resolveSelectedPoolView('fork-auction')).toBe('fork-workflow')
		expect(resolveSelectedPoolView('oracle')).toBe('staged-operations')
		expect(resolveSelectedPoolView('price-oracle')).toBe('price-oracle')
	})

	void test('accepts only supported selected-pool view query values', () => {
		expect(isSupportedSelectedPoolView(undefined)).toBe(true)
		expect(isSupportedSelectedPoolView('')).toBe(true)
		expect(isSupportedSelectedPoolView('vaults')).toBe(true)
		expect(isSupportedSelectedPoolView('resolution')).toBe(true)
		expect(isSupportedSelectedPoolView('fork-auction')).toBe(true)
		expect(isSupportedSelectedPoolView('invalid')).toBe(false)
	})

	void test('maps fork workflow routing and legacy stage aliases', () => {
		expect(isSelectedPoolForkWorkflowView('vaults')).toBe(false)
		expect(isSelectedPoolForkWorkflowView('fork-workflow')).toBe(true)
		expect(getSelectedPoolViewForForkStage('initiate')).toBe('fork-workflow')
		expect(getSelectedPoolViewForForkStage('migration')).toBe('fork-workflow')
		expect(getSelectedPoolViewForForkStage('auction')).toBe('fork-workflow')
		expect(getSelectedPoolViewForForkStage('settlement')).toBe('fork-workflow')
		expect(resolveForkWorkflowSelectionStage('fork-migration')).toBe('migration')
		expect(resolveForkWorkflowSelectionStage('fork-auction')).toBe('auction')
		expect(resolveForkWorkflowSelectionStage('fork-settlement')).toBe('settlement')
		expect(getSelectedPoolViewForForkWorkflowSelectionStage('fork-triggered')).toBe('fork-workflow')
		expect(getSelectedPoolViewForForkWorkflowSelectionStage('migration')).toBe('fork-migration')
		expect(getSelectedPoolViewForForkWorkflowSelectionStage('auction')).toBe('fork-auction')
		expect(getSelectedPoolViewForForkWorkflowSelectionStage('settlement')).toBe('fork-settlement')
		expect(normalizeForkWorkflowSelectionStage('initiate')).toBe('fork-triggered')
	})

	void test('derives the best fork workflow stage from pool and fork-auction state', () => {
		expect(
			getSelectedPoolForkWorkflowView({
				forkAuctionDetails: undefined,
				selectedPool: undefined,
			}),
		).toBe('fork-workflow')

		expect(
			getSelectedPoolForkWorkflowView({
				forkAuctionDetails: undefined,
				selectedPool: {
					forkOutcome: 'yes',
					migratedAttoRep: 1n,
					systemState: 'forkMigration',
					truthAuctionStartedAt: 0n,
				},
			}),
		).toBe('fork-workflow')

		expect(
			getSelectedPoolForkWorkflowView({
				forkAuctionDetails: {
					claimingAvailable: false,
					forkOutcome: 'yes',
					migratedAttoRep: 1n,
					systemState: 'forkTruthAuction',
					truthAuction: undefined,
					truthAuctionStartedAt: 10n,
				},
				selectedPool: undefined,
			}),
		).toBe('fork-workflow')

		expect(
			getSelectedPoolForkWorkflowView({
				forkAuctionDetails: {
					claimingAvailable: true,
					forkOutcome: 'yes',
					migratedAttoRep: 1n,
					systemState: 'operational',
					truthAuction: {
						finalized: true,
					},
					truthAuctionStartedAt: 10n,
				},
				selectedPool: undefined,
			}),
		).toBe('fork-workflow')
		expect(
			getCurrentSelectedPoolForkStage({
				forkAuctionDetails: {
					claimingAvailable: false,
					forkOutcome: 'yes',
					migratedAttoRep: 1n,
					systemState: 'forkTruthAuction',
					truthAuction: undefined,
					truthAuctionStartedAt: 10n,
				},
				selectedPool: undefined,
			}),
		).toBe('auction')
		expect(
			getCurrentForkWorkflowSelectionStage({
				currentForkStage: 'initiate',
				hasForkActivity: false,
				systemState: 'poolForked',
			}),
		).toBe('migration')
		expect(
			getCurrentForkWorkflowSelectionStage({
				currentForkStage: 'settlement',
				hasForkActivity: true,
				systemState: 'operational',
				truthAuctionFinalized: true,
			}),
		).toBe('settlement')
		expect(
			getCurrentForkWorkflowSelectionStage({
				claimingAvailable: true,
				currentForkStage: 'settlement',
				hasForkActivity: true,
				systemState: 'operational',
				truthAuctionFinalized: true,
			}),
		).toBe('settlement')
		expect(
			getCurrentForkWorkflowSelectionStage({
				currentForkStage: 'settlement',
				hasForkActivity: true,
				systemState: 'operational',
				truthAuctionFinalized: false,
			}),
		).toBe('settlement')
		expect(
			getCurrentForkWorkflowSelectionStage({
				currentForkStage: 'settlement',
				hasForkActivity: true,
				systemState: 'operational',
			}),
		).toBe('settlement')
	})

	void test('derives current and selected fork workflow stages together', () => {
		expect(
			getForkWorkflowStageSelection({
				currentStageView: undefined,
				forkAuctionDetails: undefined,
				forkOutcome: 'none',
				previewPool: undefined,
				selectedStageView: undefined,
				stageView: undefined,
				systemState: undefined,
			}),
		).toEqual({
			currentStage: 'initiate',
			currentWorkflowStage: 'fork-triggered',
			selectedStage: 'fork-triggered',
		})

		expect(
			getForkWorkflowStageSelection({
				currentStageView: undefined,
				forkAuctionDetails: {
					claimingAvailable: false,
					hasForkActivity: true,
					migratedAttoRep: 5n,
					truthAuction: {
						finalized: false,
					},
					truthAuctionStartedAt: 10n,
				},
				forkOutcome: 'yes',
				previewPool: undefined,
				selectedStageView: 'settlement',
				stageView: undefined,
				systemState: 'forkTruthAuction',
			}),
		).toEqual({
			currentStage: 'auction',
			currentWorkflowStage: 'auction',
			selectedStage: 'settlement',
		})

		expect(
			getForkWorkflowStageSelection({
				currentStageView: 'migration',
				forkAuctionDetails: undefined,
				forkOutcome: 'none',
				previewPool: undefined,
				selectedStageView: undefined,
				stageView: 'initiate',
				systemState: 'poolForked',
			}).selectedStage,
		).toBe('fork-triggered')
	})

	void test('ignores stale non-operational fork-auction details once the selected pool is operational again', () => {
		expect(
			getCurrentSelectedPoolForkStage({
				forkAuctionDetails: {
					claimingAvailable: false,
					forkOutcome: 'yes',
					migratedAttoRep: 5n,
					systemState: 'forkTruthAuction',
					truthAuction: undefined,
					truthAuctionStartedAt: 10n,
				},
				selectedPool: {
					forkOutcome: 'yes',
					hasForkActivity: true,
					migratedAttoRep: 5n,
					systemState: 'operational',
					truthAuctionStartedAt: 10n,
				},
			}),
		).toBe('settlement')
	})

	void test('ignores stale operational fork-auction details once the selected pool enters fork mode', () => {
		expect(
			getCurrentSelectedPoolForkAuctionDetails({
				forkAuctionDetails: {
					claimingAvailable: false,
					forkOutcome: 'none',
					migratedAttoRep: 0n,
					systemState: 'operational',
					truthAuction: undefined,
					truthAuctionStartedAt: 0n,
				},
				selectedPool: {
					hasForkActivity: true,
					systemState: 'forkTruthAuction',
				},
			}),
		).toBeUndefined()
	})

	void test('ignores stale non-operational reporting details once the selected pool is operational again', () => {
		expect(
			getCurrentSelectedPoolReportingDetails({
				reportingDetails: {
					settlementCollateralAttoEth: 1n,
					currentTime: 5n,
					forkThresholdAttoRep: 100n,
					marketDetails: {
						answerUnit: '',
						createdAt: 1n,
						description: 'Question description',
						displayValueMax: 100n,
						displayValueMin: 0n,
						endTime: 2n,
						exists: true,
						marketType: 'binary',
						numTicks: 2n,
						outcomeLabels: ['Yes', 'No'],
						questionId: '0x01',
						startTime: 1n,
						title: 'Will this resolve?',
					},
					nonDecisionThresholdAttoRep: 50n,
					parentWithdrawalEnabled: false,
					questionOutcome: 'none',
					securityPoolAddress: zeroAddress,
					settlementState: 'locked',
					startBondAttoRep: 1n,
					status: 'active',
					systemState: 'forkTruthAuction',
					universeId: 1n,
					viewerPoolHeldVaultRepBackingAttoRep: 0n,
					viewerVaultExists: false,
					viewerVaultDisputeStakedAttoRep: 0n,
					viewerVaultRepBackingAttoRep: 0n,
					activationTime: 1n,
					bindingCapital: 1n,
					currentRequiredBond: 1n,
					escalationEndTime: 10n,
					escalationGameAddress: zeroAddress,
					hasReachedNonDecision: false,
					sides: [
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
					],
					totalCostAttoRep: 1n,
				},
				selectedPool: {
					hasForkActivity: true,
					questionOutcome: 'yes',
					systemState: 'operational',
				},
			}),
		).toBeUndefined()
	})

	void test('ignores stale operational reporting details once the selected pool enters fork mode', () => {
		expect(
			getCurrentSelectedPoolReportingDetails({
				reportingDetails: {
					settlementCollateralAttoEth: 1n,
					currentTime: 5n,
					forkThresholdAttoRep: 100n,
					marketDetails: {
						answerUnit: '',
						createdAt: 1n,
						description: 'Question description',
						displayValueMax: 100n,
						displayValueMin: 0n,
						endTime: 2n,
						exists: true,
						marketType: 'binary',
						numTicks: 2n,
						outcomeLabels: ['Yes', 'No'],
						questionId: '0x01',
						startTime: 1n,
						title: 'Will this resolve?',
					},
					nonDecisionThresholdAttoRep: 50n,
					parentWithdrawalEnabled: true,
					questionOutcome: 'yes',
					securityPoolAddress: zeroAddress,
					settlementState: 'resolved',
					startBondAttoRep: 1n,
					status: 'active',
					systemState: 'operational',
					universeId: 1n,
					viewerPoolHeldVaultRepBackingAttoRep: 0n,
					viewerVaultExists: false,
					viewerVaultDisputeStakedAttoRep: 0n,
					viewerVaultRepBackingAttoRep: 0n,
					activationTime: 1n,
					bindingCapital: 1n,
					currentRequiredBond: 1n,
					escalationEndTime: 10n,
					escalationGameAddress: zeroAddress,
					hasReachedNonDecision: false,
					sides: [
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'invalid', label: 'Invalid', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'yes', label: 'Yes', userDeposits: [] },
						{ balance: 0n, deposits: [], importedUserDeposits: [], key: 'no', label: 'No', userDeposits: [] },
					],
					totalCostAttoRep: 1n,
				},
				selectedPool: {
					hasForkActivity: true,
					questionOutcome: 'yes',
					systemState: 'forkMigration',
				},
			}),
		).toBeUndefined()
	})
})

void describe('selected pool workflow visibility', () => {
	void test('shows workflow details only for a resolved pool in the active universe', () => {
		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: false,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: false,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: true,
			}),
		).toBe(false)

		expect(
			shouldShowSelectedPoolWorkflowDetails({
				hasSelectedPoolAddress: true,
				selectedPoolExists: true,
				selectedPoolUniverseMismatch: false,
			}),
		).toBe(true)
	})

	void test('disables the fork workflow only while the selected pool remains operational', () => {
		expect(isForkWorkflowDisabled(undefined)).toBe(true)
		expect(isForkWorkflowDisabled('operational')).toBe(true)
		expect(isForkWorkflowDisabled('operational', true)).toBe(false)
		expect(isForkWorkflowDisabled('poolForked')).toBe(false)
		expect(isForkWorkflowDisabled('forkMigration')).toBe(false)
		expect(isForkWorkflowDisabled('forkTruthAuction')).toBe(false)
	})

	void test('uses state-specific reasons before unlocking pool actions', () => {
		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Select a pool before using pool actions.')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Loading pool…')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'missing',
				selectedPoolUniverseMismatch: false,
			}),
		).toBe('Select a valid pool before using pool actions.')

		expect(
			getSelectedPoolWorkflowGuardMessage({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'ready',
				selectedPoolUniverseMismatch: true,
			}),
		).toBeUndefined()
	})

	void test('keeps a stable locked-workflow presentation before a pool resolves', () => {
		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: false,
				selectedPoolLookupState: 'unknown',
				selectedPoolUniverseMismatch: false,
			}),
		).toEqual({
			badgeLabel: 'No pool selected',
			badgeTone: 'muted',
			detail: 'No pool selected.',
			key: 'action_needed',
		})

		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'unknown',
				selectedPoolUniverseMismatch: false,
			}),
		).toEqual({
			badgeLabel: 'Not found',
			badgeTone: 'blocked',
			detail: 'Pool not found.',
			key: 'not_found',
		})

		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'loading',
				selectedPoolUniverseMismatch: false,
			}),
		).toEqual({
			detail: 'Loading…',
			detailIsLoading: true,
			key: 'loading',
		})

		expect(
			getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress: true,
				selectedPoolLookupState: 'ready',
				selectedPoolUniverseMismatch: true,
			}),
		).toEqual({
			badgeLabel: 'Unavailable',
			badgeTone: 'blocked',
			detail: 'This pool does not exist.',
			key: 'unavailable',
		})
	})
})

void describe('selected pool oracle price display', () => {
	void test('uses oracle manager details only when they match the selected pool manager', () => {
		const poolOracleManagerDetails = {
			callbackStateHash: undefined,
			exactToken1Report: undefined,
			isPriceValid: true,
			lastPrice: 42n,
			lastSettlementTimestamp: 1n,
			managerAddress: zeroAddress,
			openOracleAddress: zeroAddress,
			pendingOperation: undefined,
			pendingOperationSlotId: 0n,
			pendingSettlementOperationIds: [],
			pendingSettlementQueueCapacity: 4n,
			pendingReportId: 0n,
			priceValidUntilTimestamp: 2n,
			queuedOperationCostAttoEth: 1n,
			requestPriceCostAttoEth: 3n,
			token1: undefined,
			token2: undefined,
		}

		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails,
				selectedPoolManagerAddress: zeroAddress,
			}),
		).toBe(poolOracleManagerDetails)

		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails,
				selectedPoolManagerAddress: '0x0000000000000000000000000000000000000001',
			}),
		).toBe(undefined)
	})

	void test('hides stale oracle manager details from a previously opened pool', () => {
		expect(
			getCurrentPoolOracleManagerDetails({
				poolOracleManagerDetails: {
					callbackStateHash: undefined,
					exactToken1Report: undefined,
					isPriceValid: false,
					lastPrice: 0n,
					lastSettlementTimestamp: 0n,
					managerAddress: getAddress('0x0000000000000000000000000000000000000002'),
					openOracleAddress: zeroAddress,
					pendingOperation: undefined,
					pendingOperationSlotId: 0n,
					pendingSettlementOperationIds: [],
					pendingSettlementQueueCapacity: 4n,
					pendingReportId: 0n,
					priceValidUntilTimestamp: undefined,
					queuedOperationCostAttoEth: 0n,
					requestPriceCostAttoEth: 0n,
					token1: undefined,
					token2: undefined,
				},
				selectedPoolManagerAddress: '0x0000000000000000000000000000000000000003',
			}),
		).toBe(undefined)
	})

	void test('shows a dash when the oracle price has never been settled', () => {
		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: undefined,
					lastOracleSettlementTimestamp: 0n,
				}),
			),
		).toBe('-')
	})

	void test('keeps settled prices numeric, including zero', () => {
		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: 0n,
					lastOracleSettlementTimestamp: 1n,
				}),
			),
		).toBe('≈ 0.00\u00a0REP / ETH')

		expect(
			getOracleLastPriceDisplay(
				getSelectedPoolOracleMetricValues({
					lastOraclePrice: 42n * 10n ** 18n,
					lastOracleSettlementTimestamp: 1n,
				}),
			),
		).toBe('≈ 42.00\u00a0REP / ETH')
	})

	void test('derives validity copy from the last settlement when manager details are not loaded', () => {
		expect(
			getOraclePriceValidityPresentation({
				currentTimestamp: 31n,
				lastSettlementTimestamp: 1n,
				priceValidUntilTimestamp: undefined,
			}),
		).toEqual({ text: '(Valid for 4m)', tone: 'success' })
	})

	void test('omits validity before settlement and reports expiry after the window closes', () => {
		expect(
			getOraclePriceValidityPresentation({
				currentTimestamp: 100n,
				lastSettlementTimestamp: 0n,
				priceValidUntilTimestamp: undefined,
			}),
		).toBe(undefined)

		expect(
			getOraclePriceValidityPresentation({
				currentTimestamp: 100n + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
				lastSettlementTimestamp: 100n,
				priceValidUntilTimestamp: 100n + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS,
			}),
		).toEqual({ text: '(expired less than a minute ago)', tone: 'danger' })
	})
})
