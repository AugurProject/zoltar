import { assertNever } from './assert.js'
import type { ForkAuctionStageView } from './forkAuction.js'
import { getEscalationPhase } from './reportingDomain.js'
import { SELECTED_POOL_VIEWS, type SelectedPoolView } from './securityPoolWorkflow.js'
import type { ListedSecurityPool, ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'

export type SecurityPoolDisplayState = SecurityPoolSystemState | 'ended'
type SecurityPoolRepExitMode = 'withdraw' | 'redeem'
export type SecurityPoolUiActionId =
	| 'approveRep'
	| 'depositRep'
	| 'queueWithdrawRep'
	| 'redeemRep'
	| 'queueSetSecurityBondAllowance'
	| 'redeemFees'
	| 'createCompleteSet'
	| 'redeemCompleteSet'
	| 'migrateShares'
	| 'redeemShares'
	| 'reportOutcome'
	| 'withdrawEscalation'
	| 'requestPrice'
	| 'executeStagedOperation'
	| 'queueLiquidation'
	| 'forkWithOwnEscalation'
	| 'initiateFork'
	| 'forkUniverse'
	| 'createChildUniverse'
	| 'migrateRepToZoltar'
	| 'migrateVault'
	| 'migrateEscalationDeposits'
	| 'startTruthAuction'
	| 'submitBid'
	| 'finalizeTruthAuction'
	| 'refundLosingBids'
	| 'claimAuctionProceeds'
	| 'withdrawBids'

const SECURITY_POOL_UI_ACTION_IDS: readonly SecurityPoolUiActionId[] = [
	'approveRep',
	'depositRep',
	'queueWithdrawRep',
	'redeemRep',
	'queueSetSecurityBondAllowance',
	'redeemFees',
	'createCompleteSet',
	'redeemCompleteSet',
	'migrateShares',
	'redeemShares',
	'reportOutcome',
	'withdrawEscalation',
	'requestPrice',
	'executeStagedOperation',
	'queueLiquidation',
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
]
export type SecurityPoolReportingPhase = 'preOpen' | 'notStarted' | 'active' | 'resolved' | 'forkTriggered' | 'timedOut' | 'unknown'
export type SecurityPoolForkStage = 'disabled' | 'initiate' | 'migration' | 'auction' | 'settlement' | 'unknown'
export type SecurityPoolUiActionCapability = {
	view: SelectedPoolView
	visible: boolean
	lifecycleAllowed: boolean
	lifecycleReason: string | undefined
}
export type SecurityPoolUiCapabilities = {
	lifecycleState: SecurityPoolDisplayState | undefined
	reportingPhase: SecurityPoolReportingPhase
	forkStage: SecurityPoolForkStage
	universeHasForked: boolean
	actions: Record<SecurityPoolUiActionId, SecurityPoolUiActionCapability>
}

export const POOL_ACTION_LOCK_REASON = 'Vault collateral operations are unavailable after this pool has ended.'
export const LIQUIDATION_ENDED_REASON = 'Liquidation is unavailable after this pool has ended.'
export const MARKET_ALREADY_FINALIZED_MESSAGE = 'This market has already finalized.'
export const MARKET_NOT_FINALIZED_MESSAGE = 'This market has not finalized yet.'
export const SHARE_MIGRATION_AFTER_FORK_MESSAGE = 'Share migration is only available after this universe has forked.'
const MINT_AFTER_FORK_MESSAGE = 'Minting is unavailable after this universe has forked.'
const MINT_NON_OPERATIONAL_MESSAGE = 'Minting is only available while the pool is operational.'
const REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE = 'Redeeming complete sets is unavailable after this universe has forked.'
const REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE = 'Redeeming complete sets is only available while the pool is operational.'
const REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE = 'Redeeming shares is unavailable after this universe has forked.'
const REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE = 'Redeeming shares is only available while the pool is operational.'
const REDEEM_REP_NOT_ENDED_MESSAGE = 'REP redemption is only available after this pool has ended.'
const REPORTING_NOT_OPEN_MESSAGE = 'Reporting opens after market end.'
const REPORTING_RESOLVED_MESSAGE = 'Reporting is closed because escalation has resolved.'
const REPORTING_FORK_TRIGGERED_MESSAGE = 'Reporting is closed because escalation reached non-decision and moved into the fork workflow.'
const REPORTING_TIMED_OUT_MESSAGE = 'Reporting is closed because the escalation timeout has been reached.'
const WITHDRAW_ESCALATION_NOT_STARTED_MESSAGE = 'Withdrawals are unavailable until the first report or contribution deploys the escalation game.'
const WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE = 'Escalation deposits move through the Fork workflow after non-decision; they cannot be withdrawn from this panel.'
const WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE = 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.'
const FORK_WORKFLOW_DISABLED_MESSAGE = 'This pool is currently operational, so fork and truth auction actions are read only.'
const FORK_INITIATE_STAGE_MESSAGE = 'This action is only available during the initiate stage.'
const FORK_MIGRATION_STAGE_MESSAGE = 'This action is only available during the migration stage.'
const FORK_AUCTION_STAGE_MESSAGE = 'This action is only available during the auction stage.'
const FORK_SETTLEMENT_STAGE_MESSAGE = 'This action is only available during the settlement stage.'

type SecurityPoolCapabilities = {
	displayState: SecurityPoolDisplayState | undefined
	isEnded: boolean
	isOperational: boolean
	canExecuteStagedOperations: boolean
	canLiquidate: boolean
	canManageVaultCollateral: boolean
	liquidationDisabledReason: string | undefined
	repExitMode: SecurityPoolRepExitMode
	stagedOperationsDisabledReason: string | undefined
	trading: {
		canMigrateShares: boolean
		canMintCompleteSets: boolean
		canRedeemCompleteSets: boolean
		canRedeemResolvedShares: boolean
		migrateSharesDisabledReason: string | undefined
		mintDisabledReason: string | undefined
		redeemCompleteSetsDisabledReason: string | undefined
		redeemResolvedSharesDisabledReason: string | undefined
	}
	vaultCollateralActionsLockReason: string | undefined
}

type DeriveSecurityPoolUiCapabilitiesParameters = {
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked: boolean | undefined
	reportingPhase?: SecurityPoolReportingPhase | undefined
	reportingPreOpenReason?: string | undefined
	reportingWorkflowLockedReason?: string | undefined
	reportingWithdrawalEnabled?: boolean | undefined
	reportingWithdrawalState?: ReportingDetails['withdrawalState'] | undefined
	forkStage?: SecurityPoolForkStage | undefined
	selectedForkStage?: ForkAuctionStageView | undefined
	forkWorkflowDisabledReason?: string | undefined
}

function createActionCapability({ lifecycleReason, view, visible = true }: { lifecycleReason: string | undefined; view: SelectedPoolView; visible?: boolean }): SecurityPoolUiActionCapability {
	return {
		lifecycleAllowed: lifecycleReason === undefined,
		lifecycleReason,
		view,
		visible,
	}
}

function getForkActionVisible(selectedForkStage: ForkAuctionStageView | undefined, expectedStage: ForkAuctionStageView) {
	return selectedForkStage === undefined ? true : selectedForkStage === expectedStage
}

function getForkStageActionReason({ expectedStage, forkStage, forkWorkflowDisabledReason }: { expectedStage: Exclude<SecurityPoolForkStage, 'disabled' | 'unknown'>; forkStage: SecurityPoolForkStage; forkWorkflowDisabledReason: string | undefined }) {
	if (forkWorkflowDisabledReason !== undefined || forkStage === 'disabled') {
		return forkWorkflowDisabledReason ?? FORK_WORKFLOW_DISABLED_MESSAGE
	}
	if (forkStage === 'unknown' || forkStage === expectedStage) return undefined

	switch (expectedStage) {
		case 'initiate':
			return FORK_INITIATE_STAGE_MESSAGE
		case 'migration':
			return FORK_MIGRATION_STAGE_MESSAGE
		case 'auction':
			return FORK_AUCTION_STAGE_MESSAGE
		case 'settlement':
			return FORK_SETTLEMENT_STAGE_MESSAGE
		default:
			return assertNever(expectedStage)
	}
}

function getReportOutcomeLifecycleReason({ reportingPhase, reportingPreOpenReason, reportingWorkflowLockedReason }: { reportingPhase: SecurityPoolReportingPhase; reportingPreOpenReason: string | undefined; reportingWorkflowLockedReason: string | undefined }) {
	if (reportingWorkflowLockedReason !== undefined) return reportingWorkflowLockedReason

	switch (reportingPhase) {
		case 'preOpen':
			return reportingPreOpenReason ?? REPORTING_NOT_OPEN_MESSAGE
		case 'resolved':
			return REPORTING_RESOLVED_MESSAGE
		case 'forkTriggered':
			return REPORTING_FORK_TRIGGERED_MESSAGE
		case 'timedOut':
			return REPORTING_TIMED_OUT_MESSAGE
		case 'notStarted':
		case 'active':
		case 'unknown':
			return undefined
		default:
			return assertNever(reportingPhase)
	}
}

function getWithdrawEscalationLifecycleReason({
	reportingPhase,
	reportingPreOpenReason,
	reportingWorkflowLockedReason,
	reportingWithdrawalEnabled,
	reportingWithdrawalState,
}: {
	reportingPhase: SecurityPoolReportingPhase
	reportingPreOpenReason: string | undefined
	reportingWorkflowLockedReason: string | undefined
	reportingWithdrawalEnabled: boolean | undefined
	reportingWithdrawalState: ReportingDetails['withdrawalState'] | undefined
}) {
	if (reportingWorkflowLockedReason !== undefined) return reportingWorkflowLockedReason

	switch (reportingPhase) {
		case 'preOpen':
			return reportingPreOpenReason ?? REPORTING_NOT_OPEN_MESSAGE
		case 'notStarted':
			return WITHDRAW_ESCALATION_NOT_STARTED_MESSAGE
		case 'resolved':
			return undefined
		case 'forkTriggered':
			return WITHDRAW_ESCALATION_FORK_TRIGGERED_MESSAGE
		case 'timedOut':
			return WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE
		case 'active':
			if (reportingWithdrawalEnabled === true) return undefined
			if (reportingWithdrawalState === 'not-finalized') return WITHDRAW_ESCALATION_NOT_FINALIZED_MESSAGE
			return undefined
		case 'unknown':
			return undefined
		default:
			return assertNever(reportingPhase)
	}
}

function getTradingMintLifecycleReason({ isEnded, isOperational, systemState, universeHasForked }: { isEnded: boolean; isOperational: boolean; systemState: SecurityPoolSystemState | undefined; universeHasForked: boolean }) {
	if (universeHasForked) return MINT_AFTER_FORK_MESSAGE
	if (isEnded) return MARKET_ALREADY_FINALIZED_MESSAGE
	if (systemState !== undefined && !isOperational) return MINT_NON_OPERATIONAL_MESSAGE
	return undefined
}

function getTradingRedeemCompleteSetsLifecycleReason({ isOperational, systemState, universeHasForked }: { isOperational: boolean; systemState: SecurityPoolSystemState | undefined; universeHasForked: boolean }) {
	if (universeHasForked) return REDEEM_COMPLETE_SETS_AFTER_FORK_MESSAGE
	if (systemState !== undefined && !isOperational) return REDEEM_COMPLETE_SETS_NON_OPERATIONAL_MESSAGE
	return undefined
}

function getTradingRedeemResolvedSharesLifecycleReason({ questionOutcome, systemState, universeHasForked }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined; universeHasForked: boolean }) {
	if (universeHasForked) return REDEEM_RESOLVED_SHARES_AFTER_FORK_MESSAGE
	if (systemState !== undefined && systemState !== 'operational') return REDEEM_RESOLVED_SHARES_NON_OPERATIONAL_MESSAGE
	if (questionOutcome === undefined || questionOutcome === 'none') return MARKET_NOT_FINALIZED_MESSAGE
	return undefined
}

export function isSecurityPoolEnded({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }) {
	return systemState === 'operational' && questionOutcome !== undefined && questionOutcome !== 'none'
}

export function getSecurityPoolDisplayState({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }): SecurityPoolDisplayState | undefined {
	if (systemState === undefined) return undefined
	if (isSecurityPoolEnded({ questionOutcome, systemState })) return 'ended'
	return systemState
}

export function deriveSecurityPoolReportingPhase({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): SecurityPoolReportingPhase {
	if (reportingReady === false) return 'preOpen'
	if (reportingDetails === undefined) return 'unknown'
	if (reportingDetails.status === 'not-started') return 'notStarted'

	const escalationPhase = getEscalationPhase(reportingDetails)
	switch (escalationPhase) {
		case 'Resolved':
			return 'resolved'
		case 'Fork Triggered':
			return 'forkTriggered'
		case 'Timed Out':
			return 'timedOut'
		case 'Pending Start':
		case 'Active':
			return 'active'
		default:
			return assertNever(escalationPhase)
	}
}

export function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }: { currentStage: ForkAuctionStageView | undefined; workflowDisabled: boolean | undefined }): SecurityPoolForkStage {
	if (workflowDisabled === true) return 'disabled'
	if (currentStage === undefined) return 'unknown'

	switch (currentStage) {
		case 'initiate':
			return 'initiate'
		case 'migration':
			return 'migration'
		case 'auction':
			return 'auction'
		case 'settlement':
			return 'settlement'
		default:
			return assertNever(currentStage)
	}
}

export function getSecurityPoolUiViews(uiCapabilities: SecurityPoolUiCapabilities): SelectedPoolView[] {
	const actionViews = new Set(SECURITY_POOL_UI_ACTION_IDS.map(actionId => uiCapabilities.actions[actionId].view))
	return SELECTED_POOL_VIEWS.filter(view => actionViews.has(view))
}

export function deriveSecurityPoolUiCapabilities({
	forkStage = 'unknown',
	forkWorkflowDisabledReason,
	questionOutcome,
	reportingPhase = 'unknown',
	reportingPreOpenReason,
	reportingWorkflowLockedReason,
	reportingWithdrawalEnabled,
	reportingWithdrawalState,
	selectedForkStage,
	systemState,
	universeHasForked,
}: DeriveSecurityPoolUiCapabilitiesParameters): SecurityPoolUiCapabilities {
	const displayState = getSecurityPoolDisplayState({ questionOutcome, systemState })
	const isEnded = isSecurityPoolEnded({ questionOutcome, systemState })
	const isOperational = systemState === 'operational'
	const hasUniverseForked = universeHasForked === true
	const vaultCollateralActionsLockReason = isEnded ? POOL_ACTION_LOCK_REASON : undefined
	const liquidationDisabledReason = isEnded ? LIQUIDATION_ENDED_REASON : undefined
	const mintDisabledReason = getTradingMintLifecycleReason({
		isEnded,
		isOperational,
		systemState,
		universeHasForked: hasUniverseForked,
	})
	const redeemCompleteSetsDisabledReason = getTradingRedeemCompleteSetsLifecycleReason({
		isOperational,
		systemState,
		universeHasForked: hasUniverseForked,
	})
	const migrateSharesDisabledReason = hasUniverseForked ? undefined : SHARE_MIGRATION_AFTER_FORK_MESSAGE
	const redeemResolvedSharesDisabledReason = getTradingRedeemResolvedSharesLifecycleReason({
		questionOutcome,
		systemState,
		universeHasForked: hasUniverseForked,
	})
	const reportOutcomeLifecycleReason = getReportOutcomeLifecycleReason({
		reportingPhase,
		reportingPreOpenReason,
		reportingWorkflowLockedReason,
	})
	const withdrawEscalationLifecycleReason = getWithdrawEscalationLifecycleReason({
		reportingPhase,
		reportingPreOpenReason,
		reportingWorkflowLockedReason,
		reportingWithdrawalEnabled,
		reportingWithdrawalState,
	})
	const actions: Record<SecurityPoolUiActionId, SecurityPoolUiActionCapability> = {
		approveRep: createActionCapability({ lifecycleReason: vaultCollateralActionsLockReason, view: 'vaults' }),
		depositRep: createActionCapability({ lifecycleReason: vaultCollateralActionsLockReason, view: 'vaults' }),
		queueWithdrawRep: createActionCapability({ lifecycleReason: vaultCollateralActionsLockReason, view: 'vaults' }),
		redeemRep: createActionCapability({ lifecycleReason: isEnded ? undefined : REDEEM_REP_NOT_ENDED_MESSAGE, view: 'vaults' }),
		queueSetSecurityBondAllowance: createActionCapability({ lifecycleReason: vaultCollateralActionsLockReason, view: 'vaults' }),
		redeemFees: createActionCapability({ lifecycleReason: undefined, view: 'vaults' }),
		createCompleteSet: createActionCapability({ lifecycleReason: mintDisabledReason, view: 'trading' }),
		redeemCompleteSet: createActionCapability({ lifecycleReason: redeemCompleteSetsDisabledReason, view: 'trading' }),
		migrateShares: createActionCapability({ lifecycleReason: migrateSharesDisabledReason, view: 'trading' }),
		redeemShares: createActionCapability({ lifecycleReason: redeemResolvedSharesDisabledReason, view: 'trading' }),
		reportOutcome: createActionCapability({ lifecycleReason: reportOutcomeLifecycleReason, view: 'reporting' }),
		withdrawEscalation: createActionCapability({ lifecycleReason: withdrawEscalationLifecycleReason, view: 'withdraw-escalation-deposits' }),
		requestPrice: createActionCapability({ lifecycleReason: undefined, view: 'price-oracle' }),
		executeStagedOperation: createActionCapability({ lifecycleReason: vaultCollateralActionsLockReason, view: 'staged-operations' }),
		queueLiquidation: createActionCapability({ lifecycleReason: liquidationDisabledReason, view: 'vaults' }),
		forkWithOwnEscalation: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'initiate', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'initiate'),
		}),
		initiateFork: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'initiate', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'initiate'),
		}),
		forkUniverse: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'initiate', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'initiate'),
		}),
		createChildUniverse: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'migration', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'migration'),
		}),
		migrateRepToZoltar: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'migration', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'migration'),
		}),
		migrateVault: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'migration', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'migration'),
		}),
		migrateEscalationDeposits: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'migration', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'migration'),
		}),
		startTruthAuction: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'auction', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'auction'),
		}),
		submitBid: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'auction', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'auction'),
		}),
		finalizeTruthAuction: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'settlement', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'settlement'),
		}),
		refundLosingBids: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'settlement', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'settlement'),
		}),
		claimAuctionProceeds: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'settlement', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'settlement'),
		}),
		withdrawBids: createActionCapability({
			lifecycleReason: getForkStageActionReason({ expectedStage: 'settlement', forkStage, forkWorkflowDisabledReason }),
			view: 'fork',
			visible: getForkActionVisible(selectedForkStage, 'settlement'),
		}),
	}

	return {
		actions,
		forkStage,
		lifecycleState: displayState,
		reportingPhase,
		universeHasForked: hasUniverseForked,
	}
}

export function deriveSecurityPoolCapabilities({ questionOutcome, systemState, universeHasForked }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined; universeHasForked: boolean | undefined }): SecurityPoolCapabilities {
	const uiCapabilities = deriveSecurityPoolUiCapabilities({
		questionOutcome,
		systemState,
		universeHasForked,
	})
	const isEnded = isSecurityPoolEnded({ questionOutcome, systemState })

	return {
		displayState: uiCapabilities.lifecycleState,
		isEnded,
		isOperational: systemState === 'operational',
		canExecuteStagedOperations: uiCapabilities.actions.executeStagedOperation.lifecycleAllowed,
		canLiquidate: uiCapabilities.actions.queueLiquidation.lifecycleAllowed,
		canManageVaultCollateral: uiCapabilities.actions.depositRep.lifecycleAllowed,
		liquidationDisabledReason: uiCapabilities.actions.queueLiquidation.lifecycleReason,
		repExitMode: isEnded ? 'redeem' : 'withdraw',
		stagedOperationsDisabledReason: uiCapabilities.actions.executeStagedOperation.lifecycleReason,
		trading: {
			canMigrateShares: uiCapabilities.actions.migrateShares.lifecycleAllowed,
			canMintCompleteSets: uiCapabilities.actions.createCompleteSet.lifecycleAllowed,
			canRedeemCompleteSets: uiCapabilities.actions.redeemCompleteSet.lifecycleAllowed,
			canRedeemResolvedShares: uiCapabilities.actions.redeemShares.lifecycleAllowed,
			migrateSharesDisabledReason: uiCapabilities.actions.migrateShares.lifecycleReason,
			mintDisabledReason: uiCapabilities.actions.createCompleteSet.lifecycleReason,
			redeemCompleteSetsDisabledReason: uiCapabilities.actions.redeemCompleteSet.lifecycleReason,
			redeemResolvedSharesDisabledReason: uiCapabilities.actions.redeemShares.lifecycleReason,
		},
		vaultCollateralActionsLockReason: uiCapabilities.actions.depositRep.lifecycleReason,
	}
}

export function applySecurityPoolWorkflowState(pool: ListedSecurityPool | undefined, { questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }) {
	if (pool === undefined) return undefined
	if (questionOutcome === undefined && systemState === undefined) return pool
	return {
		...pool,
		...(questionOutcome === undefined ? {} : { questionOutcome }),
		...(systemState === undefined ? {} : { systemState }),
	}
}

export function getSecurityPoolDisplayStateLabel(state: SecurityPoolDisplayState) {
	switch (state) {
		case 'operational':
			return 'Operational'
		case 'ended':
			return 'Ended'
		case 'poolForked':
			return 'Pool Forked'
		case 'forkMigration':
			return 'Fork Migration'
		case 'forkTruthAuction':
			return 'Truth Auction'
		default:
			return assertNever(state)
	}
}
