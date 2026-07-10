import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { EscalationDepositSelectionList } from './EscalationDepositSelectionList.js'
import { EnumDropdown } from './EnumDropdown.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ImportedForkSettlementSection } from './ImportedForkSettlementSection.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SectionBlock } from './SectionBlock.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { TimestampValue } from './TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { WarningSurface } from './WarningSurface.js'
import { createActionAvailability } from '../lib/actionAvailability.js'
import { sameAddress } from '../lib/address.js'
import { assertNever } from '../lib/assert.js'
import { AUCTIONED_BOND_ALLOWANCE_LABEL, AUCTION_TIME_SECONDS, getForkAuctionStageLabel, getForkAuctionStageView, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, estimateRepPurchased, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatCurrencyInputBalance, formatDuration, formatRoundedCurrencyBalance } from '../lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '../lib/marketForm.js'
import { isMainnetChain } from '../lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '../lib/reporting.js'
import { buildRouteHref, SECURITY_POOLS_ROUTE } from '../lib/routing.js'
import { getEscalationDepositClaimAmount, isPoolQuestionFinalized } from '../lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection, type ForkWorkflowSelectionStage } from '../lib/securityPoolWorkflow.js'
import {
	UI_STRING_ADVANCED_DIAGNOSTICS,
	UI_STRING_ALREADY_MIGRATED_STATUS,
	UI_STRING_TRUTH_AUCTION_FINALIZATION_REQUIRED_DETAIL,
	UI_STRING_BID_AMOUNT_ETH,
	UI_STRING_BID_ESTIMATED_REP_DETAIL_INTRO,
	UI_STRING_BID_ESTIMATED_REP_DETAIL_OUTRO,
	UI_STRING_BID_PRICE_ETH_REP,
	UI_STRING_BYPASSING_AUCTION_TRUNCATED,
	UI_STRING_BYPASS_TRUTH_AUCTION,
	UI_STRING_CHECKING_WHETHER_POOL_REP_IS_ALREADY_READY_FOR_SELECTED_CHILD_UNIVERSE,
	UI_STRING_CHILD_POOL,
	UI_STRING_CHILD_SECURITY_POOLS,
	UI_STRING_CHOOSE_DEPOSITS_TO_MIGRATE,
	UI_STRING_UNDERFUNDED_WINNING_BID_CLAIM_PREVIEW_UNAVAILABLE_DETAIL,
	UI_STRING_CLEARING,
	UI_STRING_CLEARING_PRICE,
	UI_STRING_CLOSED,
	UI_STRING_COLLATERAL,
	UI_STRING_CONNECT_A_WALLET_BEFORE_USING_FORK_AND_AUCTION_ACTIONS,
	UI_STRING_CONNECT_WALLET_TO_INSPECT_YOUR_PARENT_POOL_BALANCES,
	UI_STRING_CURRENT_PATH_ELIGIBLE_FOR_CHILD_POOL_MIGRATION,
	UI_STRING_CURRENT_PATH_MUST_MIGRATE_INTO_THE_SELECTED_CHILD_UNIVERSE,
	UI_STRING_ENDED_AT,
	UI_STRING_ENDS,
	UI_STRING_ENTRY_DEPTH_PREFIX,
	UI_STRING_ESCALATION_DEPOSITS_ARE_CURRENTLY_AVAILABLE_TO_MIGRATE_FOR_THIS_WALLET,
	UI_STRING_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL,
	UI_STRING_ESCROWED_REP,
	UI_STRING_ESCROW_SOURCE_REP_AT_FORK,
	UI_STRING_ESTIMATED_ETH_REFUNDED,
	UI_STRING_TRUTH_AUCTION_REFUND_ESTIMATE_DETAIL,
	UI_STRING_ESTIMATED_REP_CLAIMED,
	UI_STRING_ETH,
	UI_STRING_ETH_RAISED_PER_CAP,
	UI_STRING_ETH_REP,
	UI_STRING_FINALIZE_TRUTH_AUCTION,
	UI_STRING_FINALIZING_TRUTH_AUCTION_TRUNCATED,
	UI_STRING_FORK_LIFECYCLE_STAGES,
	UI_STRING_FORK_TRIGGERED,
	UI_STRING_FORK_TRUTH_AUCTION,
	UI_STRING_FORK_TYPE,
	UI_STRING_HEX_VALUE_PLACEHOLDER,
	UI_STRING_INACTIVE,
	UI_STRING_INITIALLY_DEPOSITED_PREFIX,
	UI_STRING_LOADING_CURRENT_CHAIN_TIME,
	UI_STRING_LOADING_ELIGIBLE_ESCALATION_DEPOSITS,
	UI_STRING_LOADING_ESCALATION_DEPOSITS_FOR_THE_SELECTED_WALLET,
	UI_STRING_LOADING_UNRESOLVED_ESCALATION_DEPOSITS,
	UI_STRING_LOADING_UNRESOLVED_ESCALATION_DEPOSITS_FOR_THE_CONNECTED_WALLET,
	UI_STRING_LOAD_A_POOL_TO_INSPECT_FORK_PROGRESS_MIGRATION_AND_THE_TRUTH_AUCTION,
	UI_STRING_LOAD_THE_TRUTH_AUCTION_BEFORE_FINALIZING,
	UI_STRING_MAX_REP_BEING_SOLD,
	UI_STRING_MIGRATED_BALANCES_FOR_THIS_OUTCOME,
	UI_STRING_MIGRATED_REP,
	UI_STRING_MIGRATE_POOL_TO_UNIVERSE,
	UI_STRING_MIGRATE_RESOLVED_ESCALATION_DEPOSITS,
	UI_STRING_MIGRATE_UNRESOLVED_ESCALATION_LOCKS,
	UI_STRING_MIGRATE_VAULT,
	UI_STRING_MIGRATING_ESCALATION_DEPOSITS_TRUNCATED,
	UI_STRING_MIGRATING_POOL_TO_UNIVERSE_TRUNCATED,
	UI_STRING_MIGRATING_UNRESOLVED_ESCALATION_TRUNCATED,
	UI_STRING_MIGRATING_VAULT,
	UI_STRING_MIGRATION_ENDS,
	UI_STRING_MIGRATION_IS_STILL_ACTIVE_TRUTH_AUCTION_CAN_START_ONCE_MIGRATION_ENDS,
	UI_STRING_MIGRATION,
	UI_STRING_MIGRATION_STARTED,
	UI_STRING_MIGRATION_STATUS,
	UI_STRING_MIGRATION_TIMING_IS_UNAVAILABLE,
	UI_STRING_MIGRATION_WINDOW_HAS_CLOSED_FOR_THIS_PARENT_POOL,
	UI_STRING_MIN_BID_SIZE,
	UI_STRING_NO,
	UI_STRING_NOT_STARTED,
	UI_STRING_NOT_STARTED_BADGE_LABEL,
	UI_STRING_ESCALATION_MIGRATION_EMPTY_ESCROW_DETAIL,
	UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER,
	UI_STRING_NOT_CHOSEN,
	UI_STRING_NO_ESCROWED_REP_REMAINS_TO_MIGRATE_FOR_THE_CONNECTED_WALLET,
	UI_STRING_NO_PARENT_COLLATERAL_REMAINS_TO_AUCTION_SO_THIS_STEP_IMMEDIATELY_BYPASSES_BIDDING,
	UI_STRING_NO_PREFIX,
	UI_STRING_NO_REP_COLLATERAL_OR_SECURITY_BOND_ALLOWANCE_REMAINS,
	UI_STRING_NO_REP_WAS_PRESENT_AT_FORK_SO_NO_TRUTH_AUCTION_IS_NEEDED,
	UI_STRING_NO_UNRESOLVED_PARENT_ESCALATION_DEPOSITS_REMAIN_FOR_CONNECTED_WALLET,
	UI_STRING_OPEN,
	UI_STRING_OPEN_SECURITY_POOL,
	UI_STRING_OPERATIONAL,
	UI_STRING_OUTCOME,
	UI_STRING_OWN_ESCALATION_FORK,
	UI_STRING_PARENT_POOL_VAULT_BALANCES_UNAVAILABLE_MIGRATION_DETAIL,
	UI_STRING_PARENT_ZOLTAR_FORK,
	UI_STRING_PENDING,
	UI_STRING_PENDING_CONFIRMATION,
	UI_STRING_PENDING_OUTCOME,
	UI_STRING_POOL_REP_AT_FORK,
	UI_STRING_POOL_REP_STAGED_FOR_VAULT_MIGRATION_DETAIL,
	UI_STRING_POOL_REP_HAS_ALREADY_BEEN_MIGRATED_TO_THE_SELECTED_CHILD_UNIVERSE,
	UI_STRING_REFUND_ONLY_SETTLEMENT_RETURNS_LOCKED_ETH,
	UI_STRING_REP,
	UI_STRING_REP_AT_FORK,
	UI_STRING_REP_COLLATERAL,
	UI_STRING_REP_PURCHASED,
	UI_STRING_SECURITY_BOND_ALLOWANCE,
	UI_STRING_SECURITY_POOL_ADDRESS,
	UI_STRING_SELECTED_BIDS,
	UI_STRING_SELECTED_BID_SETTLEMENT_PREVIEW,
	UI_STRING_SELECTED_DEPOSITS_LEAVE_THE_PARENT_POOL_AND_REAPPEAR_ON_THE_CHOSEN_CHILD,
	UI_STRING_SELECTED_LADDER_PRICE,
	UI_STRING_SELECTED_OUTCOME_REP_COLLATERAL,
	UI_STRING_SELECTED_OUTCOME_SECURITY_BOND_ALLOWANCE,
	UI_STRING_SELECTED_REFUND_ROWS,
	UI_STRING_SELECTED_WINNING_BIDS,
	UI_STRING_SELECT_AT_LEAST_ONE_DEPOSIT_TO_MIGRATE,
	UI_STRING_SETTLED,
	UI_STRING_SETTLEMENT_AVAILABLE,
	UI_STRING_SETTLEMENT,
	UI_STRING_SETTLEMENT_STATUS,
	UI_STRING_SETTLE_SELECTED_BIDS,
	UI_STRING_SETTLING_FORK_CARRIED_DEPOSITS_TRUNCATED,
	UI_STRING_SHORTFALL,
	UI_STRING_STARTED,
	UI_STRING_STARTING_TRUNCATED,
	UI_STRING_STARTING_TRUTH_AUCTION,
	UI_STRING_START_TRUTH_AUCTION,
	UI_STRING_STATUS,
	UI_STRING_SUBMITTING_A_BID_LOCKS_ETH_UNTIL_SETTLEMENT_LOSING,
	UI_STRING_SUBMITTING_BID_TRUNCATED,
	UI_STRING_SUBMITTING_SETTLEMENT_TRANSACTION_TRUNCATED,
	UI_STRING_SUBMIT_BID,
	UI_STRING_SYSTEM_IS_FORKING,
	UI_STRING_SETTLEMENT_ROUNDING_NOTICE,
	UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WINDOW_CLOSED_DETAIL,
	UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WINDOW_CLOSED_REASON,
	UI_STRING_FORK_INACTIVE_DETAIL,
	UI_STRING_CHILD_UNIVERSE_FULLY_MIGRATED_DETAIL,
	UI_STRING_VAULT_MIGRATION_DETAIL,
	UI_STRING_POOL_REP_MIGRATION_DETAIL,
	UI_STRING_TRIGGERED_AT,
	UI_STRING_TRUTH_AUCTION_ADDRESS,
	UI_STRING_TRUTH_AUCTION,
	UI_STRING_TRUTH_AUCTION_ALREADY_STARTED,
	UI_STRING_TRUTH_AUCTION_END_TIME_IS_UNAVAILABLE,
	UI_STRING_TRUTH_AUCTION_HAS_ENDED,
	UI_STRING_TRUTH_AUCTION_IS_ALREADY_FINALIZED,
	UI_STRING_TRUTH_AUCTION_IS_STILL_ONGOING,
	UI_STRING_TRUTH_AUCTION_STATUS,
	UI_STRING_UNALLOCATED_ESCROW_CHILD_REP,
	UI_STRING_UNFILLED,
	UI_STRING_UNRESOLVED_DEPOSITS_REMAIN_FOR_THIS_WALLET,
	UI_STRING_UNRESOLVED_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL_RIGHT_NOW,
	UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_IS_UNAVAILABLE_FOR_THIS_POOL,
	UI_STRING_USE_UNRESOLVED_ESCALATION_MIGRATION_FOR_THIS_PARENT_POOL,
	UI_STRING_USE_UNRESOLVED_ESCALATION_MIGRATION_TO_MOVE_LOCKED_POSITIONS_AND_VAULT_BALANCES_TOGETHER,
	UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WITH_VAULT_DETAIL,
	UI_STRING_UNRESOLVED_ESCALATION_SINGLE_CHILD_DETAIL,
	UI_STRING_FORK_UNAVAILABLE_PLACEHOLDER,
	UI_STRING_VAULT_MIGRATION_IS_ALREADY_COMPLETE_FOR_THIS_WALLET,
	UI_STRING_VIEWING,
	UI_STRING_WALLET_LEVEL_BALANCES_IN_THE_PARENT_POOL_THAT_MAY_STILL_NEED_MIGRATION,
	UI_TEMPLATE_FINALIZED_REFUND_ONLY_SETTLEMENT_NOTICE,
	UI_TEMPLATE_LOADING_CHILD_AUCTION_DETAILS,
	UI_TEMPLATE_START_TRUTH_AUCTION_DETAIL,
	UI_TEMPLATE_WINNING_CLAIM_ALLOWANCE_HEADLINE,
	UI_TEMPLATE_WINNING_BID_ALLOWANCE_NOTICE,
	UI_TEMPLATE_WINNING_CLAIM_SETTLEMENT_NOTICE,
	UI_STRING_WINNING_BIDS_BUY_MORE_THAN_REP,
	UI_STRING_WORTH_NOW_PENDING_MIGRATION_FINALIZATION,
	UI_STRING_WORTH_NOW_PREFIX,
	UI_STRING_YES,
	UI_STRING_YOUR_MIGRATION_BALANCES,
	UI_TEMPLATE_CHILD_UNIVERSE_NOT_CREATED_FOR_OUTCOME_DETAIL,
	UI_TEMPLATE_FINALIZED_TRUTH_AUCTION_SETTLEMENT_STATUS_DETAIL,
	UI_TEMPLATE_CHECKING_POOL_REP_MIGRATED_TO_CHILD_UNIVERSE,
	UI_TEMPLATE_ESTIMATED_VALUE,
	UI_TEMPLATE_ETH_PER_REP_VALUE,
	UI_TEMPLATE_MIGRATE_POOL_TO_THE_VALUE_UNIVERSE_BEFORE_MOVING_VAULT_BALANCES,
	UI_TEMPLATE_MIGRATE_POOL_TO_VALUE_UNIVERSE,
	UI_TEMPLATE_MIGRATE_SELECTED_VALUE_DEPOSITS,
	UI_TEMPLATE_MIGRATE_UNRESOLVED_ESCALATION_TO_VALUE,
	UI_TEMPLATE_MIGRATE_VAULT_TO_VALUE,
	UI_TEMPLATE_NO_VALUE_ESCALATION_DEPOSITS_ARE_CURRENTLY_AVAILABLE_TO_MIGRATE_FOR_THIS_WALLET,
	UI_TEMPLATE_POOL_REP_HAS_ALREADY_BEEN_MIGRATED_TO_THE_VALUE_UNIVERSE,
	UI_TEMPLATE_REFUND_ONLY_SETTLEMENT_RETURNS_LOCKED_ETH_AND_DOES_NOT_ASSIGN_VALUE,
	UI_TEMPLATE_SECURITY_POOL_FOR_VALUE_UNIVERSE_DOES_NOT_EXIST,
	UI_TEMPLATE_FINALIZED_REFUND_BATCH_SETTLEMENT_DETAIL,
	UI_TEMPLATE_MIXED_BID_BATCH_SETTLEMENT_DETAIL,
	UI_TEMPLATE_REFUNDABLE_BID_BATCH_SETTLEMENT_DETAIL,
	UI_TEMPLATE_WINNING_BID_BATCH_SETTLEMENT_DETAIL,
	UI_TEMPLATE_SETTLE_SELECTED_VALUE_FORK_CARRIED_DEPOSITS,
	UI_TEMPLATE_STARTS_IN_VALUE,
	UI_TEMPLATE_TRUTH_AUCTION_CAN_BE_STARTED_IN_VALUE_ONCE_MIGRATION_ENDS,
	UI_TEMPLATE_WINNING_ROWS_RECEIVE_ESTIMATED_CHILD_POOL_REP_PLUS_ESTIMATED_VALUE,
	UI_TEMPLATE_WINNING_ROWS_RECEIVE_ESTIMATED_CHILD_POOL_REP_PLUS_ESTIMATED_VALUE_WHILE_REFUND,
} from '../lib/uiStrings.js'
import { writeSecurityPoolQueryParam, writeUniverseQueryParam } from '../lib/urlParams.js'
import { getVisualRatio } from '../lib/visualMetrics.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ListedSecurityPool, ReadClient, ReportingOutcomeKey, TruthAuctionMetrics } from '../types/contracts.js'
import type { ForkAuctionSectionProps } from '../types/components.js'

function sameBigIntArray(left: bigint[], right: bigint[]) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameBigIntRecord(left: Record<ReportingOutcomeKey, bigint[]>, right: Record<ReportingOutcomeKey, bigint[]>) {
	return sameBigIntArray(left.invalid, right.invalid) && sameBigIntArray(left.yes, right.yes) && sameBigIntArray(left.no, right.no)
}

type DisplayMetric = {
	label: string
	value: ComponentChildren
}
type TruthAuctionStateBadge = {
	label: string
	tone: 'blocked' | 'muted' | 'ok' | 'pending'
}

type MigrationStateBadge = {
	label: string
	tone: 'muted' | 'ok' | 'pending'
}

const FORK_MIGRATION_DURATION = 4_838_400n
const FORK_WORKFLOW_NAV_STAGES: readonly ForkWorkflowSelectionStage[] = ['fork-triggered', 'migration', 'auction', 'settlement']
function getForkWorkflowStageLabel(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return UI_STRING_FORK_TRIGGERED
		case 'migration':
			return UI_STRING_MIGRATION
		case 'auction':
			return UI_STRING_TRUTH_AUCTION
		case 'settlement':
			return UI_STRING_SETTLEMENT
		default:
			return assertNever(stage)
	}
}

function getForkWorkflowStageOrder(stage: ForkWorkflowSelectionStage) {
	return FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
}

function getForkWorkflowStageIcon(stage: ForkWorkflowSelectionStage) {
	switch (stage) {
		case 'fork-triggered':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-triggered' />
		case 'migration':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-migration' />
		case 'auction':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-auction' />
		case 'settlement':
			return <span aria-hidden='true' className='fork-workflow-stage-icon fork-workflow-stage-icon-settlement' />
		default:
			return assertNever(stage)
	}
}

function getTruthAuctionWindow(startedAt: bigint | undefined) {
	if (startedAt === undefined || startedAt === 0n) return undefined
	return {
		startedAt,
		endsAt: startedAt + AUCTION_TIME_SECONDS,
	}
}
function renderMetricValue(value: bigint | undefined, suffix: string, fallbackText: string) {
	if (value === undefined) return fallbackText
	return <CurrencyValue value={value} suffix={suffix} />
}

function renderTruthAuctionPriceValue(value: bigint | undefined, fallbackText: string = UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER) {
	if (value === undefined) return fallbackText
	const formattedPrice = formatRoundedCurrencyBalance(value, 18, 4)
	const exactPrice = formatCurrencyInputBalance(value)
	return (
		<span className='truth-auction-price-value' title={UI_TEMPLATE_ETH_PER_REP_VALUE(exactPrice)}>
			{formattedPrice} {UI_STRING_ETH_REP}
		</span>
	)
}
function renderAddress(address: string | undefined) {
	if (address === undefined) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
	return <AddressValue address={address} />
}
function renderTimestamp({ displayTimestamp, fallbackText }: { displayTimestamp: bigint | undefined; fallbackText: string }) {
	if (displayTimestamp === undefined) return fallbackText
	return <TimestampValue timestamp={displayTimestamp} />
}
function renderTruthAuctionDebtNotice(mode: 'bid' | 'settlement', showRefundOnlySettlementCopy = false) {
	if (mode === 'bid') {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>{UI_STRING_WINNING_BIDS_BUY_MORE_THAN_REP}</strong> {UI_TEMPLATE_WINNING_BID_ALLOWANCE_NOTICE(AUCTIONED_BOND_ALLOWANCE_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	if (showRefundOnlySettlementCopy) {
		return (
			<WarningSurface as='section' variant='compact'>
				<p className='detail'>
					<strong>{UI_STRING_REFUND_ONLY_SETTLEMENT_RETURNS_LOCKED_ETH}</strong> {UI_TEMPLATE_FINALIZED_REFUND_ONLY_SETTLEMENT_NOTICE(AUCTIONED_BOND_ALLOWANCE_LABEL)}
				</p>
			</WarningSurface>
		)
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>{UI_TEMPLATE_WINNING_CLAIM_ALLOWANCE_HEADLINE(AUCTIONED_BOND_ALLOWANCE_LABEL)}</strong> {UI_TEMPLATE_WINNING_CLAIM_SETTLEMENT_NOTICE(AUCTIONED_BOND_ALLOWANCE_LABEL)}
			</p>
		</WarningSurface>
	)
}

function renderTruthAuctionSettlementSelectionSummary({
	estimatedAssignedBondAllowance,
	estimatedEthRefunded,
	estimatedRepClaimed,
	selectedClaimCount,
	selectedRefundCount,
	selectedRowCount,
}: {
	estimatedAssignedBondAllowance: bigint | undefined
	estimatedEthRefunded: bigint
	estimatedRepClaimed: bigint | undefined
	selectedClaimCount: number
	selectedRefundCount: number
	selectedRowCount: number
}) {
	if (selectedRowCount === 0) return undefined

	const summaryDescription = (() => {
		if (selectedClaimCount > 0 && selectedRefundCount > 0) {
			return UI_TEMPLATE_WINNING_ROWS_RECEIVE_ESTIMATED_CHILD_POOL_REP_PLUS_ESTIMATED_VALUE_WHILE_REFUND(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		if (selectedClaimCount > 0) {
			return UI_TEMPLATE_WINNING_ROWS_RECEIVE_ESTIMATED_CHILD_POOL_REP_PLUS_ESTIMATED_VALUE(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return UI_TEMPLATE_REFUND_ONLY_SETTLEMENT_RETURNS_LOCKED_ETH_AND_DOES_NOT_ASSIGN_VALUE(AUCTIONED_BOND_ALLOWANCE_LABEL)
	})()

	const refundDescription = estimatedEthRefunded > 0n ? UI_STRING_TRUTH_AUCTION_REFUND_ESTIMATE_DETAIL : undefined
	let roundingDescription: string | undefined
	if (selectedClaimCount > 0) {
		if (estimatedRepClaimed === undefined) {
			roundingDescription = UI_STRING_UNDERFUNDED_WINNING_BID_CLAIM_PREVIEW_UNAVAILABLE_DETAIL
		} else {
			roundingDescription = UI_STRING_SETTLEMENT_ROUNDING_NOTICE
		}
	}

	return (
		<WarningSurface as='section' variant='compact'>
			<p className='detail'>
				<strong>{UI_STRING_SELECTED_BID_SETTLEMENT_PREVIEW}</strong> {summaryDescription}
			</p>
			{renderWorkflowMetricGrid([
				{ label: UI_STRING_SELECTED_BIDS, value: selectedRowCount.toString() },
				{ label: UI_STRING_SELECTED_WINNING_BIDS, value: selectedClaimCount.toString() },
				{ label: UI_STRING_SELECTED_REFUND_ROWS, value: selectedRefundCount.toString() },
				{ label: UI_STRING_ESTIMATED_REP_CLAIMED, value: estimatedRepClaimed === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : <CurrencyValue value={estimatedRepClaimed} suffix={UI_STRING_REP} /> },
				{ label: UI_TEMPLATE_ESTIMATED_VALUE(AUCTIONED_BOND_ALLOWANCE_LABEL), value: estimatedAssignedBondAllowance === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : <CurrencyValue value={estimatedAssignedBondAllowance} suffix={UI_STRING_ETH} /> },
				{ label: UI_STRING_ESTIMATED_ETH_REFUNDED, value: <CurrencyValue value={estimatedEthRefunded} suffix={UI_STRING_ETH} /> },
			])}
			{roundingDescription === undefined ? undefined : <p className='detail'>{roundingDescription}</p>}
			{refundDescription === undefined ? undefined : <p className='detail'>{refundDescription}</p>}
		</WarningSurface>
	)
}

function getForkOnlyFallbackText(hasPreviewForkActivity: boolean) {
	return hasPreviewForkActivity ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : UI_STRING_FORK_UNAVAILABLE_PLACEHOLDER
}

function getForkTypeLabel(forkOwnSecurityPool: boolean) {
	return forkOwnSecurityPool ? UI_STRING_OWN_ESCALATION_FORK : UI_STRING_PARENT_ZOLTAR_FORK
}

function getPreviewForkTypeLabel({ hasPreviewForkActivity, isSyntheticForkTriggerPreview, previewPool }: { hasPreviewForkActivity: boolean; isSyntheticForkTriggerPreview: boolean; previewPool: ListedSecurityPool | undefined }) {
	if (previewPool === undefined) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
	if (!hasPreviewForkActivity) return UI_STRING_FORK_UNAVAILABLE_PLACEHOLDER
	if (isSyntheticForkTriggerPreview) return UI_STRING_NOT_CHOSEN
	return getForkTypeLabel(previewPool.forkOwnSecurityPool)
}
function getPreviewMigrationSummary(previewPool: ListedSecurityPool | undefined, hasPreviewForkActivity: boolean) {
	if (previewPool === undefined) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
	if (!hasPreviewForkActivity) return UI_STRING_FORK_UNAVAILABLE_PLACEHOLDER
	if (previewPool.truthAuctionStartedAt > 0n) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
	return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
}
function getForkWorkflowStageAheadMessage(stage: ForkWorkflowSelectionStage, currentStage: ForkWorkflowSelectionStage) {
	if (getForkWorkflowStageOrder(stage) <= getForkWorkflowStageOrder(currentStage)) return undefined
	return undefined
}

function getForkWorkflowStageClassName({ currentStage, selectedStage, stage }: { currentStage: ForkWorkflowSelectionStage; selectedStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage']
	if (currentStage === stage) classNames.push('is-current')
	if (selectedStage === stage) classNames.push('is-selected')
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) > getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}

function getForkWorkflowSeparatorClassName({ currentStage, stage }: { currentStage: ForkWorkflowSelectionStage; stage: ForkWorkflowSelectionStage }) {
	const classNames = ['fork-workflow-stage-separator']
	if (getForkWorkflowStageOrder(stage) < getForkWorkflowStageOrder(currentStage)) classNames.push('is-complete')
	if (getForkWorkflowStageOrder(stage) >= getForkWorkflowStageOrder(currentStage)) classNames.push('is-upcoming')
	return classNames.join(' ')
}
function renderWorkflowMetricGrid(metrics: DisplayMetric[]) {
	return (
		<MetricGrid>
			{metrics.map(metric => (
				<MetricField key={metric.label} label={metric.label}>
					{metric.value}
				</MetricField>
			))}
		</MetricGrid>
	)
}

function renderChildSecurityPoolsSection({ auctionOutcomeSelector, childSecurityPools, renderSelectedOutcomeChildPoolNotice }: { auctionOutcomeSelector: ComponentChildren; childSecurityPools: ListedSecurityPool[]; renderSelectedOutcomeChildPoolNotice: () => ComponentChildren }) {
	return (
		<SectionBlock density='compact' headingLevel={4} title={UI_STRING_CHILD_SECURITY_POOLS} variant='embedded'>
			{auctionOutcomeSelector}
			{renderSelectedOutcomeChildPoolNotice()}
			{childSecurityPools.length === 0 ? null : (
				<div className='fork-workflow-child-pool-list'>
					{childSecurityPools.map(pool => {
						const childPoolHref = buildRouteHref(SECURITY_POOLS_ROUTE, writeUniverseQueryParam(writeSecurityPoolQueryParam('', pool.securityPoolAddress), pool.universeId))
						return (
							<article className='fork-workflow-child-pool-card' key={pool.securityPoolAddress}>
								<div className='fork-workflow-child-pool-card-copy'>
									<strong>{pool.questionOutcome === 'none' ? UI_STRING_PENDING_OUTCOME : getReportingOutcomeLabel(pool.questionOutcome)}</strong>
									<span>{pool.systemState === 'operational' ? UI_STRING_OPERATIONAL : getForkAuctionStageLabel(getForkAuctionStageView({ forkOutcome: pool.forkOutcome, migratedRep: pool.migratedRep, systemState: pool.systemState, truthAuctionStartedAt: pool.truthAuctionStartedAt }))}</span>
								</div>
								<div className='fork-workflow-child-pool-card-meta'>
									<span>
										<AddressValue address={pool.securityPoolAddress} />
									</span>
									<a href={childPoolHref}>{UI_STRING_OPEN_SECURITY_POOL}</a>
								</div>
							</article>
						)
					})}
				</div>
			)}
		</SectionBlock>
	)
}

function estimateBidRep(bidAmount: string, bidPrice: bigint | undefined) {
	if (bidPrice === undefined) return undefined
	const parsedBidAmount = bidAmount.trim() === '' ? 0n : tryParseTruthAuctionAmountInput(bidAmount)
	if (parsedBidAmount === undefined) return undefined
	return estimateRepPurchased(parsedBidAmount, bidPrice)
}
function getStartTruthAuctionGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return UI_STRING_MIGRATION_TIMING_IS_UNAVAILABLE
	if (currentTimestamp === undefined) return UI_STRING_LOADING_CURRENT_CHAIN_TIME
	if (currentTimestamp <= migrationEndsAt) return UI_STRING_MIGRATION_IS_STILL_ACTIVE_TRUTH_AUCTION_CAN_START_ONCE_MIGRATION_ENDS
	return undefined
}

function getMigrationWindowClosedGuardMessage({ currentTimestamp, migrationEndsAt }: { currentTimestamp: bigint | undefined; migrationEndsAt: bigint | undefined }) {
	if (migrationEndsAt === undefined) return UI_STRING_MIGRATION_TIMING_IS_UNAVAILABLE
	if (currentTimestamp === undefined) return UI_STRING_LOADING_CURRENT_CHAIN_TIME
	if (currentTimestamp > migrationEndsAt) return UI_STRING_MIGRATION_WINDOW_HAS_CLOSED_FOR_THIS_PARENT_POOL
	return undefined
}

function getTruthAuctionBypassReason({ migratedRep, parentCollateralAmount, auctionableRepAtFork }: { migratedRep: bigint; parentCollateralAmount: bigint | undefined; auctionableRepAtFork: bigint | undefined }) {
	if (parentCollateralAmount === 0n) return UI_STRING_NO_PARENT_COLLATERAL_REMAINS_TO_AUCTION_SO_THIS_STEP_IMMEDIATELY_BYPASSES_BIDDING
	if (auctionableRepAtFork === undefined) return undefined
	if (auctionableRepAtFork === 0n) return UI_STRING_NO_REP_WAS_PRESENT_AT_FORK_SO_NO_TRUTH_AUCTION_IS_NEEDED
	if (migratedRep >= auctionableRepAtFork) return UI_STRING_CHILD_UNIVERSE_FULLY_MIGRATED_DETAIL
	return undefined
}

function getFinalizeTruthAuctionGuardMessage({ currentTimestamp, truthAuction, truthAuctionEndsAt }: { currentTimestamp: bigint | undefined; truthAuction: TruthAuctionMetrics | undefined; truthAuctionEndsAt: bigint | undefined }) {
	if (truthAuction === undefined) return UI_STRING_LOAD_THE_TRUTH_AUCTION_BEFORE_FINALIZING
	if (truthAuction.finalized) return UI_STRING_TRUTH_AUCTION_IS_ALREADY_FINALIZED
	if (truthAuctionEndsAt === undefined) return UI_STRING_TRUTH_AUCTION_END_TIME_IS_UNAVAILABLE
	if (currentTimestamp === undefined) return UI_STRING_LOADING_CURRENT_CHAIN_TIME
	if (currentTimestamp <= truthAuctionEndsAt) return UI_STRING_TRUTH_AUCTION_IS_STILL_ONGOING
	return undefined
}

function clampPercentage(value: bigint, maxValue: bigint) {
	return (getVisualRatio({ value, maxValue }) ?? 0) * 100
}

function getTruthAuctionStateBadge({
	hasSelectedAuctionChildPool,
	isStartTruthAuctionInProgress,
	startTruthAuctionCountdown,
	truthAuction,
	truthAuctionStartedAt,
}: {
	hasSelectedAuctionChildPool: boolean
	isStartTruthAuctionInProgress: boolean
	startTruthAuctionCountdown: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
	truthAuctionStartedAt: bigint
}): TruthAuctionStateBadge {
	if (truthAuction === undefined) {
		if (isStartTruthAuctionInProgress || (hasSelectedAuctionChildPool && truthAuctionStartedAt === 0n && startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n)) {
			return { label: UI_STRING_PENDING, tone: 'pending' }
		}
		return { label: UI_STRING_INACTIVE, tone: 'muted' }
	}
	if (!truthAuction.finalized) {
		if (truthAuction.hitCap && truthAuction.clearingTick !== undefined && truthAuction.clearingPrice !== undefined) {
			return { label: UI_STRING_CLEARING, tone: 'pending' }
		}
		return { label: UI_STRING_OPEN, tone: 'pending' }
	}
	if (truthAuction.underfunded) return { label: UI_STRING_SHORTFALL, tone: 'blocked' }
	if (truthAuction.hitCap) return { label: UI_STRING_SETTLED, tone: 'ok' }
	return { label: UI_STRING_UNFILLED, tone: 'muted' }
}

function getMigrationStateBadge({ currentTimestamp, effectiveTruthAuctionStartedAt, migrationEndsAt }: { currentTimestamp: bigint | undefined; effectiveTruthAuctionStartedAt: bigint | undefined; migrationEndsAt: bigint | undefined }): MigrationStateBadge {
	if (migrationEndsAt === undefined) return { label: UI_STRING_NOT_STARTED_BADGE_LABEL, tone: 'muted' }
	if (effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) return { label: UI_STRING_CLOSED, tone: 'ok' }
	if (currentTimestamp !== undefined && currentTimestamp >= migrationEndsAt) return { label: UI_STRING_CLOSED, tone: 'ok' }
	return { label: UI_STRING_OPEN, tone: 'pending' }
}

function isFullReadClient(client: Pick<ReadClient, 'readContract'> | ReadClient | undefined): client is ReadClient {
	return client !== undefined && 'getBlock' in client && 'multicall' in client
}

export function ForkAuctionSection({
	accountState,
	auctionDetailsOverride,
	currentStageView,
	currentTimestamp,
	disabled = false,
	embedInCard = false,
	forkAuctionDetails,
	forkAuctionActiveAction,
	forkAuctionError,
	forkAuctionForm,
	forkAuctionResult,
	forkMigrationReadClient,
	lifecycleStateOverride,
	loadingReportingDetails = false,
	onClaimAuctionProceeds,
	onFinalizeTruthAuction,
	onForkAuctionFormChange,
	onMigrateRepToZoltar,
	onMigrateEscalationDeposits,
	onMigrateUnresolvedEscalation,
	onMigrateVault,
	onRefundLosingBids,
	onReportingFormChange,
	onStartTruthAuction,
	onSubmitBid,
	onWithdrawForkedEscalation,
	previewPool,
	reportingDetails,
	reportingForm,
	selectedStageView,
	selectedPoolRefreshNonce = 0,
	securityPools = [],
	universeForkTime,
	stageView,
	onSelectedStageViewChange,
	showHeader = true,
	showSecurityPoolAddressInput = true,
	truthAuctionReadClient,
}: ForkAuctionSectionProps) {
	const isMainnet = isMainnetChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const hasTriggeredFork = universeForkTime !== undefined && universeForkTime > 0n
	const forkOutcome = forkAuctionDetails?.forkOutcome ?? previewPool?.forkOutcome
	const questionOutcome = forkAuctionDetails?.questionOutcome ?? previewPool?.questionOutcome
	const previewPoolHasActualForkActivity = previewPool?.hasForkActivity === true
	const isSyntheticForkTriggerPreview = lifecycleStateOverride === 'poolForked' && !previewPoolHasActualForkActivity
	const hasPreviewForkActivity = previewPoolHasActualForkActivity || lifecycleStateOverride === 'poolForked'
	const previewForkTypeLabel = getPreviewForkTypeLabel({
		hasPreviewForkActivity,
		isSyntheticForkTriggerPreview,
		previewPool,
	})
	const resolvedForkTypeLabel = forkAuctionDetails === undefined ? previewForkTypeLabel : getForkTypeLabel(forkAuctionDetails.forkOwnSecurityPool)
	const forkOnlyFallbackText = getForkOnlyFallbackText(hasPreviewForkActivity)
	const migrationSummaryText = forkAuctionDetails === undefined ? getPreviewMigrationSummary(previewPool, hasPreviewForkActivity) : undefined
	const hasLoadedPoolContext = securityPoolAddress !== undefined && systemState !== undefined
	const selectedOutcomeLabel = getReportingOutcomeLabel(forkAuctionForm.selectedOutcome)
	const selectedAuctionLabel = selectedOutcomeLabel
	const { currentStage, currentWorkflowStage, selectedStage } = getForkWorkflowStageSelection({
		currentStageView,
		forkAuctionDetails,
		forkOutcome,
		previewPool,
		selectedStageView,
		stageView,
		systemState,
	})
	const selectedStageAheadMessage = getForkWorkflowStageAheadMessage(selectedStage, currentWorkflowStage)
	const currentSelectedOutcomePool = previewPool !== undefined && previewPool.questionOutcome === forkAuctionForm.selectedOutcome ? previewPool : undefined
	const connectedWalletVaultSummary = accountState.address === undefined || previewPool === undefined ? undefined : previewPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const selectedOutcomeMigrationChildPool = securityPoolAddress === undefined ? undefined : securityPools.find(pool => sameAddress(pool.parent, securityPoolAddress) && pool.questionOutcome === forkAuctionForm.selectedOutcome)
	const selectedOutcomeMigrationChildVault = selectedOutcomeMigrationChildPool === undefined || accountState.address === undefined ? undefined : selectedOutcomeMigrationChildPool.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const fullTruthAuctionReadClient = isFullReadClient(truthAuctionReadClient) ? truthAuctionReadClient : undefined
	const { loadingSelectedAuctionDetails, loadingSelectedOutcomeMigrationSeedStatus, selectedAuctionChildPool, selectedAuctionDetails, selectedAuctionError, selectedOutcomeMigrationSeedStatus, selectedOutcomeMigrationSeedStatusError } = useSelectedAuctionReadState({
		accountAddress: accountState.address,
		currentSelectedOutcomePool,
		forkAuctionResultHash: forkAuctionResult?.hash,
		forkMigrationReadClient,
		fullTruthAuctionReadClient,
		securityPoolAddress,
		selectedAuctionLabel,
		selectedOutcome: forkAuctionForm.selectedOutcome,
		selectedOutcomeMigrationChildPool,
		selectedPoolRefreshNonce,
		selectedStage,
		universeId,
	})
	const selectedAuctionPoolAddress = selectedAuctionChildPool?.securityPoolAddress
	const currentRootAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: forkAuctionDetails?.securityPoolAddress !== undefined && selectedAuctionPoolAddress !== undefined && sameAddress(forkAuctionDetails.securityPoolAddress, selectedAuctionPoolAddress) ? forkAuctionDetails : undefined,
		selectedPool: selectedAuctionChildPool,
	})
	const currentSelectedAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: selectedAuctionDetails,
		selectedPool: selectedAuctionChildPool,
	})
	const selectedAuctionContext = (() => {
		if (auctionDetailsOverride !== undefined) return auctionDetailsOverride
		if (currentRootAuctionDetails !== undefined) return currentRootAuctionDetails
		if (currentSelectedAuctionDetails !== undefined) return currentSelectedAuctionDetails

		return undefined
	})()
	const auctionSecurityPoolAddress = selectedAuctionContext?.securityPoolAddress ?? selectedAuctionChildPool?.securityPoolAddress
	const auctionTruthAuctionAddress = selectedAuctionContext?.truthAuctionAddress ?? selectedAuctionChildPool?.truthAuctionAddress
	const auctionTruthAuctionStatus = selectedAuctionContext?.truthAuction
	const auctionHasStartedAtValue = selectedAuctionContext?.truthAuctionStartedAt ?? selectedAuctionChildPool?.truthAuctionStartedAt ?? 0n
	const hasSelectedAuctionChildPool = selectedAuctionChildPool !== undefined
	const selectedAuctionContextError = selectedAuctionError
	const optimisticTruthAuctionStartedAt =
		forkAuctionResult?.action === 'startTruthAuction' && auctionSecurityPoolAddress !== undefined && sameAddress(forkAuctionResult.securityPoolAddress, auctionSecurityPoolAddress) ? (effectiveCurrentTimestamp ?? forkAuctionDetails?.migrationEndsAt ?? selectedAuctionContext?.currentTime ?? 1n) : undefined
	let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt
	if (auctionHasStartedAtValue > 0n) effectiveTruthAuctionStartedAt = auctionHasStartedAtValue
	const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n
	const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticMigratedEscalationRep, setPendingEscalationMigrationSelection } = useForkAuctionInteractionState({
		accountAddress: accountState.address,
		connectedWalletEscrowedRep: connectedWalletVaultSummary?.escalationEscrowedRep,
		forkAuctionActiveAction,
		forkAuctionError,
		forkAuctionResult,
		hasStartedTruthAuction,
		reportingDetails,
		securityPoolAddress,
	})
	const effectiveEscrowedRepInEscalationGame = (() => {
		if (connectedWalletVaultSummary === undefined) return undefined
		if (connectedWalletVaultSummary.escalationEscrowedRep > optimisticMigratedEscalationRep) {
			return connectedWalletVaultSummary.escalationEscrowedRep - optimisticMigratedEscalationRep
		}
		return 0n
	})()
	const activeReportingDetails = reportingDetails?.status === 'active' ? reportingDetails : undefined
	const isMigrationRequired = activeReportingDetails?.settlementState === 'migration-required'
	const isMigrationExpired = activeReportingDetails?.settlementState === 'migration-expired'
	const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired
	const selectedEscalationMigrationSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedEscalationMigrationDeposits = selectedEscalationMigrationSide?.userDeposits ?? []
	const selectedEscalationMigrationDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const showSelectedEscalationMigrationDeposits = !loadingReportingDetails && reportingDetails?.status === 'active'
	const hasSelectedEscalationMigrationDeposits = selectedEscalationMigrationDeposits.length > 0
	const unresolvedMigrationSides = activeReportingDetails?.sides ?? []
	const [selectedImportedForkDepositIndexesByOutcome, setSelectedImportedForkDepositIndexesByOutcome] = useState<Record<ReportingOutcomeKey, bigint[]>>({
		invalid: [],
		yes: [],
		no: [],
	})
	function renderSelectedOutcomeChildPoolLink() {
		if (selectedAuctionChildPool === undefined) return undefined

		const securityPoolSearch = writeSecurityPoolQueryParam('', selectedAuctionChildPool.securityPoolAddress)
		const securityPoolHref = buildRouteHref(SECURITY_POOLS_ROUTE, writeUniverseQueryParam(securityPoolSearch, selectedAuctionChildPool.universeId))
		return (
			<a className='fork-workflow-outcome-link' href={securityPoolHref}>
				{UI_STRING_CHILD_POOL}
			</a>
		)
	}

	const migrationBalancesContent = (() => {
		if (accountState.address === undefined) return <p className='detail'>{UI_STRING_CONNECT_WALLET_TO_INSPECT_YOUR_PARENT_POOL_BALANCES}</p>
		if (connectedWalletVaultSummary === undefined) return <p className='detail'>{UI_STRING_PARENT_POOL_VAULT_BALANCES_UNAVAILABLE_MIGRATION_DETAIL}</p>
		const selectedOutcomeMigrationVaultBalanceContent = (() => {
			if (selectedOutcomeMigrationChildPool === undefined) return undefined

			return (
				<>
					<p className='detail'>{UI_STRING_MIGRATED_BALANCES_FOR_THIS_OUTCOME}</p>
					{renderWorkflowMetricGrid([
						{ label: UI_STRING_SELECTED_OUTCOME_REP_COLLATERAL, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.repDepositShare ?? 0n} suffix={UI_STRING_REP} /> },
						{ label: UI_STRING_SELECTED_OUTCOME_SECURITY_BOND_ALLOWANCE, value: <CurrencyValue value={selectedOutcomeMigrationChildVault?.securityBondAllowance ?? 0n} suffix={UI_STRING_ETH} /> },
					])}
				</>
			)
		})()

		return (
			<>
				{renderWorkflowMetricGrid([
					{ label: UI_STRING_REP_COLLATERAL, value: <CurrencyValue value={connectedWalletVaultSummary.repDepositShare} suffix={UI_STRING_REP} /> },
					{ label: UI_STRING_SECURITY_BOND_ALLOWANCE, value: <CurrencyValue value={connectedWalletVaultSummary.securityBondAllowance} suffix={UI_STRING_ETH} /> },
					{ label: UI_STRING_ESCROWED_REP, value: <CurrencyValue value={effectiveEscrowedRepInEscalationGame ?? 0n} suffix={UI_STRING_REP} /> },
				])}
				<div className='form-grid fork-workflow-outcome-selector'>
					<label className='field'>
						<span>{UI_STRING_OUTCOME}</span>
						<div className='fork-workflow-outcome-selector-row'>
							<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
							{renderSelectedOutcomeChildPoolLink()}
						</div>
					</label>
				</div>
				{renderSelectedOutcomeChildPoolNotice()}
				{selectedOutcomeMigrationVaultBalanceContent}
			</>
		)
	})()
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.repDepositShare > 0n || connectedWalletVaultSummary.securityBondAllowance > 0n)
	const hasWalletEscalationMigrationBalance = effectiveEscrowedRepInEscalationGame !== undefined && effectiveEscrowedRepInEscalationGame > 0n
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? UI_STRING_NO_REP_COLLATERAL_OR_SECURITY_BOND_ALLOWANCE_REMAINS : undefined
	const migrateEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? UI_STRING_NO_ESCROWED_REP_REMAINS_TO_MIGRATE_FOR_THE_CONNECTED_WALLET : undefined
	const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0)
	const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0
	const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? []
	const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0
	const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails)
	const childSecurityPools = securityPoolAddress === undefined ? [] : securityPools.filter(pool => sameAddress(pool.parent, securityPoolAddress))
	const enteredBidPreview = getTruthAuctionBidPreview(forkAuctionForm.submitBidPrice)
	const enteredBidPrice = enteredBidPreview?.price
	const enteredBidTick = enteredBidPreview?.tick
	const estimatedRep = estimateBidRep(forkAuctionForm.submitBidAmount, enteredBidPrice)
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
		if (hasSelectedAuctionChildPool) return UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER
		return forkOnlyFallbackText
	})()
	const truthAuctionStatus = auctionTruthAuctionStatus
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress
	const {
		aggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids,
		loadingTruthAuctionBook,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData,
		truthAuctionBookError,
	} = useTruthAuctionBookData({
		accountAddress: accountState.address,
		enteredBidTick,
		forkAuctionResultHash: forkAuctionResult?.hash,
		selectedStage,
		shouldShowTruthAuctionVisualization,
		truthAuctionAddress: auctionTruthAuctionAddress,
		truthAuctionClearingTick: truthAuctionStatus?.clearingTick,
		truthAuctionReadClient,
	})
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus)
	const startTruthAuctionCountdown = forkAuctionDetails?.migrationEndsAt === undefined || effectiveCurrentTimestamp === undefined ? undefined : getTimeRemaining(forkAuctionDetails.migrationEndsAt, effectiveCurrentTimestamp)
	const isStartTruthAuctionInProgress = (() => {
		if (hasStartedTruthAuction) return false
		if (isStartTruthAuctionInProgressState) return true
		if (forkAuctionActiveAction === 'startTruthAuction') return true

		return false
	})()
	const truthAuctionStateBadge = getTruthAuctionStateBadge({
		hasSelectedAuctionChildPool,
		isStartTruthAuctionInProgress,
		startTruthAuctionCountdown,
		truthAuction: truthAuctionStatus,
		truthAuctionStartedAt: auctionHasStartedAtValue,
	})
	const startedDisplay = (() => {
		if (hasStartedTruthAuction) {
			return renderTimestamp({
				displayTimestamp: effectiveTruthAuctionStartedAt,
				fallbackText: UI_STRING_NOT_STARTED,
			})
		}
		if (isStartTruthAuctionInProgress) return UI_STRING_STARTING_TRUNCATED
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return UI_TEMPLATE_STARTS_IN_VALUE(formatDuration(startTruthAuctionCountdown))
			return UI_STRING_NOT_STARTED
		}
		return UI_STRING_NOT_STARTED
	})()
	const endsDisplay = (() => {
		if (auctionWindow === undefined) return isStartTruthAuctionInProgress ? UI_STRING_PENDING_CONFIRMATION : UI_STRING_NOT_STARTED
		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={auctionWindow.endsAt} />
	})()
	const hasStartedSelectedTruthAuctionTimeline = hasStartedTruthAuction || truthAuctionStatus !== undefined || selectedStage === 'auction' || selectedStage === 'settlement' || currentWorkflowStage === 'auction' || currentWorkflowStage === 'settlement'
	const activeTickSummaries = truthAuctionBookData.tickSummaries
	const truthAuctionOverviewProgress = getTruthAuctionOverviewProgress(truthAuctionStatus, activeTickSummaries)
	const displayedEthRaised = truthAuctionOverviewProgress?.ethRaised ?? truthAuctionStatus?.ethRaised ?? 0n
	const displayedRepSold = truthAuctionOverviewProgress?.repSold ?? truthAuctionStatus?.totalRepPurchased ?? 0n
	const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedEthRaised, truthAuctionStatus.ethRaiseCap)
	const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedRepSold, truthAuctionStatus.maxRepBeingSold)
	const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
		enteredBidTick,
		selectedBookTick,
		tickSummaries: activeTickSummaries,
		truthAuction: truthAuctionStatus,
	})
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined)
	const maxTickEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalEth > maximumEth ? point.currentTotalEth : maximumEth), 0n)
	const ethRaisedCapDisplay =
		truthAuctionStatus === undefined ? (
			truthAuctionFallback
		) : (
			<Fragment>
				<CurrencyValue value={displayedEthRaised} suffix={UI_STRING_ETH} /> / <CurrencyValue value={truthAuctionStatus.ethRaiseCap} suffix={UI_STRING_ETH} />
			</Fragment>
		)
	const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)
	const settlementAvailableDisplay = (() => {
		if (!hasSelectedAuctionChildPool) return UI_STRING_FORK_UNAVAILABLE_PLACEHOLDER
		if (selectedAuctionContext?.claimingAvailable) return UI_STRING_YES

		return UI_STRING_NO
	})()
	const settlementBidRows = getTruthAuctionSettlementBidRows({
		accountAddress: accountState.address,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const { isSettleSelectedBidsInProgress, selectedSettlementBidKeys, setSelectedSettlementBidKeys, settlementBidResultByKey, settlementSelectionState, submitClaimBidsByKeys, submitRefundBidsByKeys, submitSelectedSettlementBids } = useTruthAuctionSettlementActionState({
		accountAddress: accountState.address,
		forkAuctionError,
		forkAuctionResult,
		onClaimAuctionProceeds,
		onRefundLosingBids,
		selectedAuctionPoolAddress,
		selectedStage,
		settlementBidRows,
		truthAuctionFinalized: truthAuctionStatus?.finalized === true,
	})
	const selectedSettlementBidRows = settlementSelectionState.selectedRows
	const selectedRefundSettlementBidRows = settlementSelectionState.selectedRefundRows
	const selectedClaimSettlementBidRows = settlementSelectionState.selectedClaimRows
	const selectedClaimSettlementBidKeys = settlementSelectionState.selectedClaimKeys
	const selectedRefundSettlementBidKeys = settlementSelectionState.selectedRefundKeys
	const settlementSelectionMode = settlementSelectionState.selectionMode
	const settlementSelectionHasClaims = settlementSelectionState.selectionHasClaims
	const settlementSelectionHasRefunds = settlementSelectionState.selectionHasRefunds
	const settlementSelectionEstimate = getTruthAuctionSettlementSelectionEstimate({
		auctionedSecurityBondAllowance: selectedAuctionContext?.auctionedSecurityBondAllowance,
		selectedRows: selectedSettlementBidRows,
		truthAuction: truthAuctionStatus,
	})
	const settlementAction =
		getTruthAuctionSettlementAction({
			selectionHasClaims: settlementSelectionHasClaims,
			selectionHasRefunds: settlementSelectionHasRefunds,
			truthAuctionFinalized: truthAuctionStatus?.finalized === true,
		}) ?? 'refundLosingBids'
	const showRefundOnlySettlementDebtNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0
	const settlementActionLabel = UI_STRING_SETTLE_SELECTED_BIDS
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return UI_TEMPLATE_WINNING_BID_BATCH_SETTLEMENT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return UI_TEMPLATE_FINALIZED_REFUND_BATCH_SETTLEMENT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
			return UI_TEMPLATE_REFUNDABLE_BID_BATCH_SETTLEMENT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
		}
		return UI_TEMPLATE_MIXED_BID_BATCH_SETTLEMENT_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)
	})()
	const settlementActionPendingLabel = UI_STRING_SUBMITTING_SETTLEMENT_TRANSACTION_TRUNCATED
	const auctionBidRows = buildTruthAuctionBidRows({
		bids: aggregatedAuctionBids,
		truthAuction: truthAuctionStatus,
	})
	const viewerBidRowsViewModel = buildViewerTruthAuctionBidRows({
		accountAddress: accountState.address,
		isSettlementInProgress: isSettleSelectedBidsInProgress,
		selectedBidKeys: selectedSettlementBidKeys,
		selectedStage,
		settlementResultByKey: settlementBidResultByKey,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const viewerBidRows = viewerBidRowsViewModel.rows
	const showViewerSettlementActionColumn = viewerBidRowsViewModel.showSettlementActionColumn
	const onSettlementBidSelectionChange = (bidKey: string, checked: boolean) => {
		setSelectedSettlementBidKeys(currentKeys => updateTruthAuctionSettlementBidSelection(currentKeys, bidKey, checked))
	}
	const interactionDisabledReason = (() => {
		if (accountState.address === undefined) return UI_STRING_CONNECT_A_WALLET_BEFORE_USING_FORK_AND_AUCTION_ACTIONS
		if (!isMainnet) return undefined

		return undefined
	})()
	const forkPoolState = evaluateSecurityPoolState({
		forkStage: deriveSecurityPoolForkStage({
			currentStage,
			workflowDisabled: disabled,
		}),
		lifecycleState:
			lifecycleStateOverride ??
			deriveSecurityPoolLifecycleState({
				hasForkActivity: forkAuctionDetails?.hasForkActivity ?? previewPool?.hasForkActivity,
				isChildPool: (forkAuctionDetails?.parentSecurityPoolAddress ?? previewPool?.parent) !== zeroAddress,
				questionOutcome,
				systemState,
				universeHasForked: previewPool?.universeHasForked,
			}),
		universeHasForked: previewPool?.universeHasForked === true,
	})
	const truthAuctionBidGuardMessage = getTruthAuctionBidGuardMessage({
		accountAddress: accountState.address,
		currentTimestamp: effectiveCurrentTimestamp,
		isMainnet,
		submitBidAmountInput: forkAuctionForm.submitBidAmount,
		truthAuction: truthAuctionStatus,
		walletEthBalance: accountState.ethBalance,
	})
	const startTruthAuctionGuardMessage = getStartTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const finalizeTruthAuctionGuardMessage = getFinalizeTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		truthAuction: truthAuctionStatus,
		truthAuctionEndsAt,
	})
	const truthAuctionEndedNotice = (() => {
		if (truthAuctionStatus === undefined) return undefined
		const hasEndedByTime = truthAuctionEndsAt !== undefined && effectiveCurrentTimestamp !== undefined && effectiveCurrentTimestamp >= truthAuctionEndsAt
		if (!truthAuctionStatus.finalized && !hasEndedByTime) return undefined
		return (
			<div className='notice success'>
				<p>
					<strong>{UI_STRING_TRUTH_AUCTION_HAS_ENDED}</strong> {truthAuctionStatus.finalized ? UI_TEMPLATE_FINALIZED_TRUTH_AUCTION_SETTLEMENT_STATUS_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL) : UI_STRING_TRUTH_AUCTION_FINALIZATION_REQUIRED_DETAIL}{' '}
					{truthAuctionEndsAt === undefined ? undefined : (
						<Fragment>
							{UI_STRING_ENDED_AT}
							<TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={truthAuctionEndsAt} />
						</Fragment>
					)}
				</p>
				{truthAuctionStatus.finalized ? undefined : (
					<div className='actions'>
						{renderStageActionButton({
							action: 'finalizeTruthAuction',
							availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
							forceEnabled: hasSelectedAuctionChildPool,
							idleLabel: UI_STRING_FINALIZE_TRUTH_AUCTION,
							onClick: onFinalizeTruthAuctionForSelectedAuction,
							pendingLabel: UI_STRING_FINALIZING_TRUTH_AUCTION_TRUNCATED,
						})}
					</div>
				)}
			</div>
		)
	})()
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return UI_TEMPLATE_TRUTH_AUCTION_CAN_BE_STARTED_IN_VALUE_ONCE_MIGRATION_ENDS(formatDuration(startTruthAuctionCountdown))
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedRep: selectedAuctionContext?.migratedRep ?? selectedAuctionChildPool?.migratedRep ?? 0n,
		parentCollateralAmount: forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount,
		auctionableRepAtFork: forkAuctionDetails?.auctionableRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (hasStartedTruthAuction) return UI_STRING_TRUTH_AUCTION_ALREADY_STARTED
		if (isStartTruthAuctionInProgress) return UI_STRING_STARTING_TRUTH_AUCTION
		return startTruthAuctionGuardMessage
	})()
	const setSelectedEscalationMigrationDepositIndexes = (nextSelectedDepositIndexes: bigint[]) => {
		if (onReportingFormChange === undefined || reportingForm === undefined) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: {
				...reportingForm.selectedWithdrawDepositIndexesByOutcome,
				[forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
			},
		})
	}
	const migrateSelectedEscalationDepositsGuardMessage = (() => {
		if (migrateEscalationBalanceGuardMessage !== undefined) return migrateEscalationBalanceGuardMessage
		if (loadingReportingDetails) return UI_STRING_LOADING_ELIGIBLE_ESCALATION_DEPOSITS
		if (reportingDetails?.status !== 'active') return UI_STRING_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL
		if (isMigrationRequired) return UI_STRING_USE_UNRESOLVED_ESCALATION_MIGRATION_FOR_THIS_PARENT_POOL
		if (isMigrationExpired) return UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WINDOW_CLOSED_REASON
		if (selectedEscalationMigrationDeposits.length === 0) return UI_TEMPLATE_NO_VALUE_ESCALATION_DEPOSITS_ARE_CURRENTLY_AVAILABLE_TO_MIGRATE_FOR_THIS_WALLET(selectedOutcomeLabel)
		if (selectedEscalationMigrationDepositIndexes.length > 0) return undefined
		return UI_STRING_SELECT_AT_LEAST_ONE_DEPOSIT_TO_MIGRATE
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (!isMigrationRequired) return UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_IS_UNAVAILABLE_FOR_THIS_POOL
		if (loadingReportingDetails) return UI_STRING_LOADING_UNRESOLVED_ESCALATION_DEPOSITS
		if (activeReportingDetails === undefined) return UI_STRING_UNRESOLVED_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL_RIGHT_NOW
		if (!hasUnresolvedMigrationDeposits) return UI_STRING_NO_UNRESOLVED_PARENT_ESCALATION_DEPOSITS_REMAIN_FOR_CONNECTED_WALLET
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (loadingSelectedOutcomeMigrationSeedStatus) return UI_TEMPLATE_CHECKING_POOL_REP_MIGRATED_TO_CHILD_UNIVERSE(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus?.seeded) return UI_TEMPLATE_POOL_REP_HAS_ALREADY_BEEN_MIGRATED_TO_THE_VALUE_UNIVERSE(selectedOutcomeLabel)
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return UI_TEMPLATE_CHECKING_POOL_REP_MIGRATED_TO_CHILD_UNIVERSE(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return UI_TEMPLATE_MIGRATE_POOL_TO_THE_VALUE_UNIVERSE_BEFORE_MOVING_VAULT_BALANCES(selectedOutcomeLabel)
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? UI_STRING_VAULT_MIGRATION_IS_ALREADY_COMPLETE_FOR_THIS_WALLET : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? UI_STRING_MIGRATING_VAULT : undefined
	const migrateVaultGuardMessage = isMigrationRequired
		? UI_STRING_USE_UNRESOLVED_ESCALATION_MIGRATION_TO_MOVE_LOCKED_POSITIONS_AND_VAULT_BALANCES_TOGETHER
		: (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
	const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage
	const migrationStateBadge = getMigrationStateBadge({
		currentTimestamp: effectiveCurrentTimestamp,
		effectiveTruthAuctionStartedAt,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrationStatusBadge = <Badge tone={migrationStateBadge.tone}>{migrationStateBadge.label}</Badge>
	const onStartTruthAuctionSubmit = () => {
		beginStartTruthAuctionProgress()
		onStartTruthAuction(selectedAuctionPoolAddress)
	}
	const onSubmitBidForSelectedAuction = () => {
		onSubmitBid(selectedAuctionPoolAddress)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		onFinalizeTruthAuction(selectedAuctionPoolAddress)
	}
	const settlementActionAvailabilityMessage = getTruthAuctionSettlementActionAvailabilityMessage({
		claimingAvailable: selectedAuctionContext?.claimingAvailable,
		selectedClaimRows: selectedClaimSettlementBidRows,
		selectedRows: selectedSettlementBidRows,
		selectionHasClaims: settlementSelectionHasClaims,
		selectionHasRefunds: settlementSelectionHasRefunds,
		truthAuction: truthAuctionStatus,
	})
	const onRefundLosingBidsForSelectedAuction = () => {
		if (selectedRefundSettlementBidRows.length === 0) return
		submitRefundBidsByKeys(selectedRefundSettlementBidKeys)
	}
	const onSettleSelectedBidsForSelectedAuction = () => {
		submitSelectedSettlementBids()
	}
	const onClaimAuctionProceedsForSelectedAuction = () => {
		if (selectedClaimSettlementBidRows.length === 0) return
		submitClaimBidsByKeys(selectedClaimSettlementBidKeys)
	}
	const onMigrateVaultSubmit = () => {
		beginVaultMigrationProgress()
		onMigrateVault()
	}
	const onMigrateSelectedOutcomeRepToZoltar = () => {
		onMigrateRepToZoltar([forkAuctionForm.selectedOutcome])
	}
	const onMigrateSelectedEscalationDeposits = () => {
		setPendingEscalationMigrationSelection({
			depositIndexes: selectedEscalationMigrationDepositIndexes,
			outcome: forkAuctionForm.selectedOutcome,
		})
		onMigrateEscalationDeposits(forkAuctionForm.selectedOutcome, selectedEscalationMigrationDepositIndexes)
	}
	const onMigrateUnresolvedEscalationSubmit = () => {
		setPendingEscalationMigrationSelection(undefined)
		beginVaultMigrationProgress()
		onMigrateUnresolvedEscalation(forkAuctionForm.selectedOutcome)
	}
	const onWithdrawForkedEscalationSubmit = (outcome: ReportingOutcomeKey) => {
		const selectedDepositIndexes = selectedImportedForkDepositIndexesByOutcome[outcome]
		if (selectedDepositIndexes.length === 0) return
		onWithdrawForkedEscalation(outcome, selectedDepositIndexes)
	}
	function renderStageActionButton({
		action,
		availability,
		forceEnabled,
		idleLabel,
		onClick,
		pendingLabel,
		pending,
		tone = 'secondary',
	}: {
		action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
		availability?: {
			disabled: boolean
			reason: string | undefined
		}
		forceEnabled?: boolean
		idleLabel: string
		onClick: () => void
		pendingLabel: string
		pending?: boolean
		tone?: 'primary' | 'secondary'
	}) {
		const resolvedAvailability = availability ?? { disabled: false, reason: undefined }
		const actionEnabled = forceEnabled ?? forkPoolState.actions[action].enabled
		const disabledReason = !isMainnet ? undefined : (interactionDisabledReason ?? resolvedAvailability.reason)
		const isPending = pending ?? forkAuctionActiveAction === action
		return (
			<TransactionActionButton
				idleLabel={idleLabel}
				pendingLabel={pendingLabel}
				onClick={onClick}
				pending={isPending}
				tone={tone}
				availability={{
					disabled: !isMainnet || !actionEnabled || interactionDisabledReason !== undefined || resolvedAvailability.disabled,
					reason: disabledReason,
				}}
			/>
		)
	}
	function renderSelectedOutcomeChildPoolNotice() {
		if (selectedAuctionChildPool !== undefined) return undefined
		return (
			<div className='fork-workflow-outcome-notice'>
				<p className='detail'>{UI_TEMPLATE_SECURITY_POOL_FOR_VALUE_UNIVERSE_DOES_NOT_EXIST(selectedOutcomeLabel)}</p>
			</div>
		)
	}
	const renderSubmitBidSection = ({ description, density = 'balanced', headingLevel = 3, title = UI_STRING_SUBMIT_BID, variant = 'embedded' }: { description?: ComponentChildren; density?: 'balanced' | 'compact'; headingLevel?: 3 | 4; title?: ComponentChildren; variant?: 'default' | 'embedded' }) => (
		<SectionBlock {...(description === undefined ? {} : { description })} density={density} headingLevel={headingLevel} title={title} variant={variant}>
			<div className='form-grid'>
				{submitBidPreviewTickSummary === undefined ? undefined : (
					<p className='detail'>
						{UI_STRING_SELECTED_LADDER_PRICE}
						{renderTruthAuctionPriceValue(submitBidPreviewTickSummary.price)}
					</p>
				)}
				<div className='field-row'>
					<label className='field'>
						<span>{UI_STRING_BID_PRICE_ETH_REP}</span>
						<FormInput value={forkAuctionForm.submitBidPrice} onInput={event => onForkAuctionFormChange({ submitBidPrice: event.currentTarget.value })} />
					</label>
					<label className='field'>
						<span>{UI_STRING_BID_AMOUNT_ETH}</span>
						<FormInput value={forkAuctionForm.submitBidAmount} onInput={event => onForkAuctionFormChange({ submitBidAmount: event.currentTarget.value })} />
					</label>
				</div>
				{enteredBidPrice === undefined ? undefined : (
					<p className='detail'>
						{UI_STRING_BID_ESTIMATED_REP_DETAIL_INTRO}
						{estimatedRep === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : <CurrencyValue value={estimatedRep} suffix={UI_STRING_REP} />} {UI_STRING_BID_ESTIMATED_REP_DETAIL_OUTRO}
					</p>
				)}
				{renderTruthAuctionDebtNotice('bid')}
				<div className='actions'>
					{renderStageActionButton({
						action: 'submitBid',
						availability: createActionAvailability(submitBidGuardMessage),
						forceEnabled: hasSelectedAuctionChildPool,
						idleLabel: UI_STRING_SUBMIT_BID,
						onClick: onSubmitBidForSelectedAuction,
						pendingLabel: UI_STRING_SUBMITTING_BID_TRUNCATED,
					})}
				</div>
			</div>
		</SectionBlock>
	)
	const renderSettlementActionSection = ({
		action,
		description,
		idleLabel,
		pendingLabel,
		pending = false,
		selectionSummary,
		title,
		availabilityMessage,
		onClick,
		tone = 'primary',
	}: {
		action: NonNullable<ForkAuctionSectionProps['forkAuctionActiveAction']>
		description?: ComponentChildren
		idleLabel: string
		pendingLabel: string
		pending?: boolean
		selectionSummary?: ComponentChildren
		title?: ComponentChildren
		availabilityMessage: string | undefined
		onClick?: () => void
		tone?: 'primary' | 'secondary'
	}) => (
		<SectionBlock density='compact' title={title} headingLevel={4} variant='embedded'>
			{description === undefined ? undefined : <p className='detail'>{description}</p>}
			{selectionSummary}
			{renderTruthAuctionDebtNotice('settlement', showRefundOnlySettlementDebtNotice)}
			<div className='actions'>
				{renderStageActionButton({
					action,
					availability: createActionAvailability(availabilityMessage),
					forceEnabled: hasSelectedAuctionChildPool,
					idleLabel,
					onClick: onClick ?? (action === 'refundLosingBids' ? onRefundLosingBidsForSelectedAuction : onClaimAuctionProceedsForSelectedAuction),
					pendingLabel,
					pending,
					tone,
				})}
			</div>
		</SectionBlock>
	)
	useEffect(() => {
		if (!isMigrationRequired || onReportingFormChange === undefined || reportingForm === undefined || activeReportingDetails === undefined) return
		const nextSelectedDepositIndexesByOutcome = {
			invalid: activeReportingDetails.sides.find(side => side.key === 'invalid')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			yes: activeReportingDetails.sides.find(side => side.key === 'yes')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
			no: activeReportingDetails.sides.find(side => side.key === 'no')?.userDeposits.map(deposit => deposit.depositIndex) ?? [],
		}
		if (sameBigIntRecord(nextSelectedDepositIndexesByOutcome, reportingForm.selectedWithdrawDepositIndexesByOutcome)) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: nextSelectedDepositIndexesByOutcome,
		})
	}, [activeReportingDetails, isMigrationRequired, onReportingFormChange, reportingForm])
	useEffect(() => {
		const nextSelectedImportedDepositIndexesByOutcome = {
			invalid: importedForkSettlementSides.find(side => side.key === 'invalid')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			yes: importedForkSettlementSides.find(side => side.key === 'yes')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
			no: importedForkSettlementSides.find(side => side.key === 'no')?.importedUserDeposits.map(deposit => deposit.parentDepositIndex) ?? [],
		}
		setSelectedImportedForkDepositIndexesByOutcome(currentSelections => {
			const prunedSelections = {
				invalid: currentSelections.invalid.filter(index => nextSelectedImportedDepositIndexesByOutcome.invalid.includes(index)),
				yes: currentSelections.yes.filter(index => nextSelectedImportedDepositIndexesByOutcome.yes.includes(index)),
				no: currentSelections.no.filter(index => nextSelectedImportedDepositIndexesByOutcome.no.includes(index)),
			}
			if (sameBigIntRecord(prunedSelections, currentSelections)) return currentSelections
			return prunedSelections
		})
	}, [importedForkSettlementSides])
	const migrationStartedAt = (() => {
		if (universeForkTime !== undefined && universeForkTime > 0n) return universeForkTime
		if (forkAuctionDetails?.migrationEndsAt !== undefined) return forkAuctionDetails.migrationEndsAt - FORK_MIGRATION_DURATION
		return undefined
	})()
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableRepAtFork} suffix={UI_STRING_REP} />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedRep ?? previewPool?.migratedRep, UI_STRING_REP, UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER)
	const migrationCollateralDisplay = renderMetricValue(forkAuctionDetails?.completeSetCollateralAmount ?? previewPool?.completeSetCollateralAmount, UI_STRING_ETH, UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? UI_STRING_NOT_STARTED : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (forkAuctionDetails === undefined) return migrationSummaryText
		if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={effectiveTruthAuctionStartedAt} />
		}
		if (forkAuctionDetails.migrationEndsAt === undefined) return UI_STRING_NOT_STARTED

		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={truthAuctionStateBadge.tone}>{truthAuctionStateBadge.label}</Badge>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: UI_STRING_TRUTH_AUCTION_ADDRESS, value: renderAddress(auctionTruthAuctionAddress) },
		{ label: UI_STRING_STARTED, value: startedDisplay },
		{ label: UI_STRING_ENDS, value: endsDisplay },
		{ label: UI_STRING_ETH_RAISED_PER_CAP, value: ethRaisedCapDisplay },
		{ label: UI_STRING_REP_PURCHASED, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={UI_STRING_REP} /> },
		{ label: UI_STRING_CLEARING_PRICE, value: clearingPriceDisplay },
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={UI_STRING_ETH} /> },
		{ label: UI_STRING_MIN_BID_SIZE, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSize} suffix={UI_STRING_ETH} /> },
		{ label: UI_STRING_MAX_REP_BEING_SOLD, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxRepBeingSold} suffix={UI_STRING_REP} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_BOND_ALLOWANCE_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={UI_STRING_ETH} /> },
		{ label: UI_STRING_SETTLEMENT_AVAILABLE, value: settlementAvailableDisplay },
		{ label: UI_STRING_ETH_RAISED_PER_CAP, value: ethRaisedCapDisplay },
		{ label: UI_STRING_REP_PURCHASED, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSold} suffix={UI_STRING_REP} /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>{UI_STRING_OUTCOME}</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					{renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const selectedAuctionDetailsNotice = (() => {
		if (!hasSelectedAuctionChildPool || selectedStage === 'migration') return undefined
		if (loadingSelectedAuctionDetails) return <p className='detail'>{UI_TEMPLATE_LOADING_CHILD_AUCTION_DETAILS(selectedAuctionLabel)}</p>
		if (selectedAuctionContextError === undefined) return undefined
		return <p className='detail'>{selectedAuctionContextError}</p>
	})()
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedBondAllowanceDisplay={selectedAuctionContext === undefined ? UI_STRING_METRIC_UNAVAILABLE_PLACEHOLDER : <CurrencyValue value={selectedAuctionContext.auctionedSecurityBondAllowance} suffix={UI_STRING_ETH} />}
				badge={truthAuctionStateBadgeElement}
				clearingPriceDisplay={renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)}
				displayedEthRaised={displayedEthRaised}
				displayedRepSold={displayedRepSold}
				endsDisplay={endsDisplay}
				ethRaiseCap={truthAuctionStatus.ethRaiseCap}
				ethRaisedProgress={ethRaisedProgress}
				maxRepBeingSold={truthAuctionStatus.maxRepBeingSold}
				minBidSize={truthAuctionStatus.minBidSize}
				repSoldProgress={repSoldProgress}
				startedDisplay={startedDisplay}
				winningThresholdPriceDisplay={winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(winningThresholdPrice)}
			/>
		)
	})()
	const migrationSummaryCard = (
		<SectionBlock badge={migrationStatusBadge} className='fork-workflow-summary-card migration-summary-card' title={UI_STRING_MIGRATION_STATUS}>
			<div className='fork-workflow-summary'>
				<div className='fork-workflow-summary-primary migration-summary-primary'>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{UI_STRING_REP_AT_FORK}</span>
							<strong>{migrationRepAtForkDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{UI_STRING_MIGRATED_REP}</span>
							<strong>{migrationRepDisplay}</strong>
						</div>
					</div>
					<div className='fork-workflow-summary-stat-group'>
						<div className='fork-workflow-summary-stat-copy'>
							<span>{UI_STRING_COLLATERAL}</span>
							<strong>{migrationCollateralDisplay}</strong>
						</div>
					</div>
				</div>
				<div className='fork-workflow-summary-metrics'>
					<MetricField label={UI_STRING_MIGRATION_STARTED}>{migrationStartedDisplay}</MetricField>
					<MetricField label={UI_STRING_MIGRATION_ENDS}>{migrationEndsDisplay}</MetricField>
					<MetricField label={UI_STRING_FORK_TYPE}>{resolvedForkTypeLabel}</MetricField>
				</div>
			</div>
			{forkAuctionDetails?.ownForkRepBuckets === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={UI_STRING_ADVANCED_DIAGNOSTICS}>
					<div className='fork-workflow-summary-metrics'>
						<MetricField label={UI_STRING_POOL_REP_AT_FORK}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.vaultRepAtFork} suffix={UI_STRING_REP} />
						</MetricField>
						<MetricField label={UI_STRING_UNALLOCATED_ESCROW_CHILD_REP}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.unallocatedEscrowChildRep} suffix={UI_STRING_REP} />
						</MetricField>
						<MetricField label={UI_STRING_ESCROW_SOURCE_REP_AT_FORK}>
							<CurrencyValue value={forkAuctionDetails.ownForkRepBuckets.escrowSourceRepAtFork} suffix={UI_STRING_REP} />
						</MetricField>
					</div>
				</ReadOnlyDetailAccordion>
			)}
		</SectionBlock>
	)
	const truthAuctionMarketViewSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionMarketViewSection
				clearingTick={truthAuctionStatus.clearingTick}
				hasMoreTickSummaries={hasMoreTickSummaries}
				loadingTruthAuctionBook={loadingTruthAuctionBook}
				maxTickEth={maxTickEth}
				onLoadNextTickPage={loadNextTickPage}
				onSelectTick={selectTruthAuctionTick}
				renderPriceValue={renderTruthAuctionPriceValue}
				showDepthClearingTick={truthAuctionStatus.hitCap && truthAuctionStatus.clearingTick !== undefined}
				truthAuctionBookError={truthAuctionBookError}
				truthAuctionDepthPoints={truthAuctionDepthPoints}
			/>
		)
	})()
	const auctionWideBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<TruthAuctionBidsSection
				aggregatedAuctionBidCountForLoadedTicks={aggregatedAuctionBidCountForLoadedTicks}
				hasMoreAggregatedAuctionBids={hasMoreAggregatedAuctionBids}
				loadedTickCount={truthAuctionBookData.tickSummaries.length}
				loadingAggregatedAuctionBids={loadingAggregatedAuctionBids}
				onLoadNextAuctionBidPage={loadNextAuctionBidPage}
				renderPriceValue={renderTruthAuctionPriceValue}
				rows={auctionBidRows}
			/>
		)
	})()
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<ViewerTruthAuctionBidsSection
				accountAddress={accountState.address}
				hasMoreViewerBids={hasMoreViewerBids}
				loadingTruthAuctionBook={loadingTruthAuctionBook}
				onLoadNextViewerBidPage={loadNextViewerBidPage}
				onSettlementBidSelectionChange={onSettlementBidSelectionChange}
				renderPriceValue={renderTruthAuctionPriceValue}
				rows={viewerBidRows}
				showSettlementActionColumn={showViewerSettlementActionColumn}
			/>
		)
	})()
	const truthAuctionSettlementSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return renderSettlementActionSection({
			action: settlementAction,
			pending: isSettleSelectedBidsInProgress,
			availabilityMessage: settlementActionAvailabilityMessage,
			description: settlementActionDescription,
			idleLabel: settlementActionLabel,
			pendingLabel: settlementActionPendingLabel,
			selectionSummary: renderTruthAuctionSettlementSelectionSummary({
				estimatedAssignedBondAllowance: settlementSelectionEstimate.estimatedAssignedBondAllowance,
				estimatedEthRefunded: settlementSelectionEstimate.estimatedEthRefunded,
				estimatedRepClaimed: settlementSelectionEstimate.estimatedRepClaimed,
				selectedClaimCount: selectedClaimSettlementBidRows.length,
				selectedRefundCount: selectedRefundSettlementBidRows.length,
				selectedRowCount: selectedSettlementBidRows.length,
			}),
			title: settlementActionLabel,
			onClick: onSettleSelectedBidsForSelectedAuction,
			tone: 'primary',
		})
	})()
	const importedForkSettlementSection = (() => {
		if (!hasImportedForkSettlementDeposits) return undefined
		return (
			<ImportedForkSettlementSection
				activeReportingDetails={activeReportingDetails}
				disabled={forkAuctionActiveAction === 'settleForkedEscalation'}
				onDepositSelectionChange={(outcome, depositIndex, checked) => {
					setSelectedImportedForkDepositIndexesByOutcome(currentSelections => ({
						...currentSelections,
						[outcome]: checked ? [...currentSelections[outcome], depositIndex] : currentSelections[outcome].filter(index => index !== depositIndex),
					}))
				}}
				renderSettlementAction={({ guardMessage, outcome, sideLabel }) =>
					renderStageActionButton({
						action: 'settleForkedEscalation',
						availability: createActionAvailability(guardMessage),
						idleLabel: UI_TEMPLATE_SETTLE_SELECTED_VALUE_FORK_CARRIED_DEPOSITS(sideLabel),
						onClick: () => onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: UI_STRING_SETTLING_FORK_CARRIED_DEPOSITS_TRUNCATED,
						tone: 'secondary',
					})
				}
				resolved={importedForkSettlementResolved}
				selectedDepositIndexesByOutcome={selectedImportedForkDepositIndexesByOutcome}
				sides={importedForkSettlementSides}
			/>
		)
	})()
	const handleForkWorkflowStageKeyDown = (stage: ForkWorkflowSelectionStage, event: KeyboardEvent) => {
		const currentStageIndex = FORK_WORKFLOW_NAV_STAGES.indexOf(stage)
		if (currentStageIndex === -1) return
		const nextStage = (() => {
			if (event.key === 'ArrowRight') return FORK_WORKFLOW_NAV_STAGES[Math.min(currentStageIndex + 1, FORK_WORKFLOW_NAV_STAGES.length - 1)]
			if (event.key === 'ArrowLeft') return FORK_WORKFLOW_NAV_STAGES[Math.max(currentStageIndex - 1, 0)]
			if (event.key === 'Home') return FORK_WORKFLOW_NAV_STAGES[0]
			if (event.key === 'End') return FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1]
			return undefined
		})()
		if (nextStage === undefined) return
		event.preventDefault()
		onSelectedStageViewChange?.(nextStage)
		const nextTab = document.getElementById(`fork-workflow-stage-${nextStage}`)
		if (nextTab instanceof HTMLElement) nextTab.focus()
	}
	const forkWorkflowStageNavigator = !hasLoadedPoolContext ? undefined : (
		<div className='fork-workflow-stage-nav-shell'>
			<div aria-label={UI_STRING_FORK_LIFECYCLE_STAGES} className='fork-workflow-stage-nav' role='tablist'>
				{FORK_WORKFLOW_NAV_STAGES.map(stage => {
					const stageLabel = getForkWorkflowStageLabel(stage)
					return (
						<Fragment key={stage}>
							<button
								aria-controls={`fork-workflow-stage-panel-${stage}`}
								aria-current={currentWorkflowStage === stage ? 'step' : undefined}
								aria-label={stageLabel}
								aria-selected={selectedStage === stage}
								className={getForkWorkflowStageClassName({
									currentStage: currentWorkflowStage,
									selectedStage,
									stage,
								})}
								id={`fork-workflow-stage-${stage}`}
								onClick={() => onSelectedStageViewChange?.(stage)}
								onKeyDown={event => handleForkWorkflowStageKeyDown(stage, event)}
								role='tab'
								tabIndex={selectedStage === stage ? 0 : -1}
								type='button'
							>
								{getForkWorkflowStageIcon(stage)}
								<span className='fork-workflow-stage-copy'>
									<strong>{stageLabel}</strong>
									{selectedStage === stage ? <span className='fork-workflow-stage-indicator'>{UI_STRING_VIEWING}</span> : undefined}
								</span>
							</button>
							{stage === FORK_WORKFLOW_NAV_STAGES[FORK_WORKFLOW_NAV_STAGES.length - 1] ? undefined : (
								<span
									aria-hidden='true'
									className={getForkWorkflowSeparatorClassName({
										currentStage: currentWorkflowStage,
										stage,
									})}
								>
									→
								</span>
							)}
						</Fragment>
					)
				})}
			</div>
		</div>
	)
	const stagePanel = (() => {
		if (selectedStage === 'fork-triggered')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-fork-triggered' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-fork-triggered' role='tabpanel'>
					<SectionBlock title={UI_STRING_FORK_TRIGGERED} variant='embedded'>
						{hasTriggeredFork ? (
							renderWorkflowMetricGrid([
								{
									label: UI_STRING_STATUS,
									value: UI_STRING_SYSTEM_IS_FORKING,
								},
								{
									label: UI_STRING_TRIGGERED_AT,
									value: <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={universeForkTime} />,
								},
							])
						) : (
							<p className='detail'>{UI_STRING_FORK_INACTIVE_DETAIL}</p>
						)}
					</SectionBlock>
				</fieldset>
			)
		if (selectedStage === 'migration')
			return (
				<fieldset aria-labelledby='fork-workflow-stage-migration' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-migration' role='tabpanel'>
					{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
					{migrationSummaryCard}

					<SectionBlock title={UI_STRING_YOUR_MIGRATION_BALANCES} variant='embedded' description={UI_STRING_WALLET_LEVEL_BALANCES_IN_THE_PARENT_POOL_THAT_MAY_STILL_NEED_MIGRATION}>
						{migrationBalancesContent}
						{accountState.address === undefined ? undefined : (
							<>
								{hasUnresolvedMigrationState ? (
									<SectionBlock density='compact' headingLevel={4} title={UI_STRING_MIGRATE_UNRESOLVED_ESCALATION_LOCKS} variant='embedded'>
										<p className='detail'>{isMigrationExpired ? UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WINDOW_CLOSED_DETAIL : UI_STRING_UNRESOLVED_ESCALATION_MIGRATION_WITH_VAULT_DETAIL}</p>
										{loadingReportingDetails ? <p className='detail'>{UI_STRING_LOADING_UNRESOLVED_ESCALATION_DEPOSITS_FOR_THE_CONNECTED_WALLET}</p> : undefined}
										{loadingReportingDetails || activeReportingDetails !== undefined ? undefined : <p className='detail'>{UI_STRING_UNRESOLVED_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL_RIGHT_NOW}</p>}
										{activeReportingDetails !== undefined && !hasUnresolvedMigrationDeposits ? <p className='detail'>{UI_STRING_NO_UNRESOLVED_PARENT_ESCALATION_DEPOSITS_REMAIN_FOR_CONNECTED_WALLET}</p> : undefined}
										<p className='detail'>{UI_STRING_UNRESOLVED_ESCALATION_SINGLE_CHILD_DETAIL}</p>
										{activeReportingDetails === undefined
											? undefined
											: unresolvedMigrationSides.map(side => (
													<div className='field' key={side.key}>
														<span>{side.label}</span>
														{side.userDeposits.length === 0 ? (
															<p className='detail'>
																{UI_STRING_NO_PREFIX}
																{side.label.toLowerCase()} {UI_STRING_UNRESOLVED_DEPOSITS_REMAIN_FOR_THIS_WALLET}
															</p>
														) : (
															<EscalationDepositSelectionList
																disabled
																items={side.userDeposits.map(deposit => ({
																	deposit,
																	details: [
																		<>
																			{UI_STRING_INITIALLY_DEPOSITED_PREFIX}
																			<CurrencyValue value={deposit.amount} suffix={UI_STRING_REP} />
																		</>,
																		UI_STRING_CURRENT_PATH_MUST_MIGRATE_INTO_THE_SELECTED_CHILD_UNIVERSE,
																		<>
																			{UI_STRING_ENTRY_DEPTH_PREFIX}
																			<CurrencyValue value={deposit.cumulativeAmount} suffix={UI_STRING_REP} />
																		</>,
																	],
																}))}
																onSelectionChange={() => undefined}
																selectedDepositIndexes={side.userDeposits.map(deposit => deposit.depositIndex)}
															/>
														)}
													</div>
												))}
										{isMigrationExpired ? undefined : (
											<div className='actions'>
												{renderStageActionButton({
													action: 'migrateUnresolvedEscalation',
													availability: createActionAvailability(migrateUnresolvedEscalationGuardMessage),
													idleLabel: UI_TEMPLATE_MIGRATE_UNRESOLVED_ESCALATION_TO_VALUE(selectedOutcomeLabel),
													onClick: onMigrateUnresolvedEscalationSubmit,
													pendingLabel: UI_STRING_MIGRATING_UNRESOLVED_ESCALATION_TRUNCATED,
													tone: 'primary',
												})}
											</div>
										)}
									</SectionBlock>
								) : (
									<SectionBlock density='compact' headingLevel={4} title={UI_STRING_MIGRATE_RESOLVED_ESCALATION_DEPOSITS} variant='embedded'>
										<p className='detail'>{UI_STRING_SELECTED_DEPOSITS_LEAVE_THE_PARENT_POOL_AND_REAPPEAR_ON_THE_CHOSEN_CHILD}</p>
										{connectedWalletVaultSummary !== undefined && !hasWalletEscalationMigrationBalance ? <p className='detail'>{UI_STRING_ESCALATION_MIGRATION_EMPTY_ESCROW_DETAIL}</p> : undefined}
										{loadingReportingDetails ? <p className='detail'>{UI_STRING_LOADING_ESCALATION_DEPOSITS_FOR_THE_SELECTED_WALLET}</p> : undefined}
										{loadingReportingDetails || reportingDetails?.status === 'active' ? undefined : <p className='detail'>{UI_STRING_ESCALATION_DEPOSIT_DETAILS_ARE_UNAVAILABLE_FOR_THIS_POOL}</p>}
										{showSelectedEscalationMigrationDeposits && !hasSelectedEscalationMigrationDeposits ? (
											<p className='detail'>
												{UI_STRING_NO_PREFIX}
												{selectedOutcomeLabel} {UI_STRING_ESCALATION_DEPOSITS_ARE_CURRENTLY_AVAILABLE_TO_MIGRATE_FOR_THIS_WALLET}
											</p>
										) : undefined}
										{showSelectedEscalationMigrationDeposits && hasSelectedEscalationMigrationDeposits ? (
											<div className='field'>
												<span>{UI_STRING_CHOOSE_DEPOSITS_TO_MIGRATE}</span>
												<EscalationDepositSelectionList
													disabled={forkAuctionActiveAction === 'migrateEscalationDeposits'}
													items={selectedEscalationMigrationDeposits.map(deposit => {
														const claimAmount = getEscalationDepositClaimAmount(reportingDetails, forkAuctionForm.selectedOutcome, deposit)
														return {
															deposit,
															details: [
																<>
																	{UI_STRING_INITIALLY_DEPOSITED_PREFIX}
																	<CurrencyValue value={deposit.amount} suffix={UI_STRING_REP} />
																</>,
																claimAmount === undefined ? (
																	UI_STRING_WORTH_NOW_PENDING_MIGRATION_FINALIZATION
																) : (
																	<>
																		{UI_STRING_WORTH_NOW_PREFIX}
																		<CurrencyValue value={claimAmount} suffix={UI_STRING_REP} />
																	</>
																),
																UI_STRING_CURRENT_PATH_ELIGIBLE_FOR_CHILD_POOL_MIGRATION,
																<>
																	{UI_STRING_ENTRY_DEPTH_PREFIX}
																	<CurrencyValue value={deposit.cumulativeAmount} suffix={UI_STRING_REP} />
																</>,
															],
														}
													})}
													onSelectionChange={setSelectedEscalationMigrationDepositIndexes}
													selectedDepositIndexes={selectedEscalationMigrationDepositIndexes}
												/>
											</div>
										) : undefined}
										<div className='actions'>
											{renderStageActionButton({
												action: 'migrateEscalationDeposits',
												availability: createActionAvailability(migrateSelectedEscalationDepositsGuardMessage),
												idleLabel: UI_TEMPLATE_MIGRATE_SELECTED_VALUE_DEPOSITS(selectedOutcomeLabel),
												onClick: onMigrateSelectedEscalationDeposits,
												pendingLabel: UI_STRING_MIGRATING_ESCALATION_DEPOSITS_TRUNCATED,
											})}
										</div>
									</SectionBlock>
								)}
								<SectionBlock density='compact' headingLevel={4} title={UI_STRING_MIGRATE_POOL_TO_UNIVERSE} variant='embedded'>
									<p className='detail'>{UI_STRING_POOL_REP_MIGRATION_DETAIL}</p>
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{UI_STRING_CHECKING_WHETHER_POOL_REP_IS_ALREADY_READY_FOR_SELECTED_CHILD_UNIVERSE}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									{loadingSelectedOutcomeMigrationSeedStatus || selectedOutcomeMigrationSeedStatusError !== undefined || selectedOutcomeMigrationSeedStatus === undefined || !selectedOutcomeMigrationSeedStatus.seeded ? undefined : (
										<p className='detail'>{selectedOutcomeMigrationSeedStatus.childPoolRepBalance > 0n ? UI_STRING_POOL_REP_HAS_ALREADY_BEEN_MIGRATED_TO_THE_SELECTED_CHILD_UNIVERSE : UI_STRING_POOL_REP_STAGED_FOR_VAULT_MIGRATION_DETAIL}</p>
									)}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateRepToZoltar',
											availability: createActionAvailability(migratePoolToUniverseGuardMessage),
											idleLabel: UI_TEMPLATE_MIGRATE_POOL_TO_VALUE_UNIVERSE(selectedOutcomeLabel),
											onClick: onMigrateSelectedOutcomeRepToZoltar,
											pendingLabel: UI_STRING_MIGRATING_POOL_TO_UNIVERSE_TRUNCATED,
										})}
									</div>
								</SectionBlock>
								<SectionBlock density='compact' headingLevel={4} title={UI_STRING_MIGRATE_VAULT} variant='embedded'>
									<p className='detail'>{UI_STRING_VAULT_MIGRATION_DETAIL}</p>
									{connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? <p className='detail'>{UI_STRING_NO_REP_COLLATERAL_OR_SECURITY_BOND_ALLOWANCE_REMAINS}</p> : undefined}
									{loadingSelectedOutcomeMigrationSeedStatus ? <p className='detail'>{UI_STRING_CHECKING_WHETHER_POOL_REP_IS_ALREADY_READY_FOR_SELECTED_CHILD_UNIVERSE}</p> : undefined}
									{selectedOutcomeMigrationSeedStatusError === undefined || loadingSelectedOutcomeMigrationSeedStatus ? undefined : <p className='detail'>{selectedOutcomeMigrationSeedStatusError}</p>}
									<div className='actions'>
										{renderStageActionButton({
											action: 'migrateVault',
											availability: createActionAvailability(migrateVaultGuardMessage),
											idleLabel: UI_TEMPLATE_MIGRATE_VAULT_TO_VALUE(selectedOutcomeLabel),
											onClick: onMigrateVaultSubmit,
											pendingLabel: UI_STRING_MIGRATING_VAULT,
											tone: 'primary',
										})}
									</div>
									{isVaultMigrationComplete ? <p className='detail'>{UI_STRING_ALREADY_MIGRATED_STATUS}</p> : undefined}
								</SectionBlock>
							</>
						)}
					</SectionBlock>
				</fieldset>
			)

		return (() => {
			if (selectedStage === 'auction') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{auctionOutcomeSelector}
							{renderSelectedOutcomeChildPoolNotice()}
							{selectedAuctionDetailsNotice}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							{truthAuctionMarketViewSection}
							{auctionWideBidsSection}
							{renderSubmitBidSection({
								description: UI_STRING_SUBMITTING_A_BID_LOCKS_ETH_UNTIL_SETTLEMENT_LOSING,
							})}
							{viewerTruthAuctionBidsSection}
						</fieldset>
					)
				return (
					<fieldset aria-labelledby='fork-workflow-stage-auction' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-auction' role='tabpanel'>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{auctionOutcomeSelector}
						{renderSelectedOutcomeChildPoolNotice()}
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={UI_STRING_TRUTH_AUCTION_STATUS} variant='embedded'>
							{renderWorkflowMetricGrid(auctionStatusMetrics)}
						</SectionBlock>

						<SectionBlock title={UI_STRING_START_TRUTH_AUCTION} variant='embedded'>
							<p className='detail'>{UI_TEMPLATE_START_TRUTH_AUCTION_DETAIL(AUCTIONED_BOND_ALLOWANCE_LABEL)}</p>
							{startTruthAuctionReadyInText === undefined ? undefined : <p className='detail'>{startTruthAuctionReadyInText}</p>}
							{truthAuctionBypassReason === undefined ? undefined : <p className='detail'>{truthAuctionBypassReason}</p>}
							<div className='actions'>
								{renderStageActionButton({
									action: 'startTruthAuction',
									availability: createActionAvailability(!hasSelectedAuctionChildPool ? UI_TEMPLATE_CHILD_UNIVERSE_NOT_CREATED_FOR_OUTCOME_DETAIL(selectedAuctionLabel) : startTruthAuctionAvailabilityMessage),
									forceEnabled: hasSelectedAuctionChildPool,
									idleLabel: truthAuctionBypassReason === undefined ? UI_STRING_START_TRUTH_AUCTION : UI_STRING_BYPASS_TRUTH_AUCTION,
									onClick: onStartTruthAuctionSubmit,
									pendingLabel: truthAuctionBypassReason === undefined ? UI_STRING_STARTING_TRUTH_AUCTION : UI_STRING_BYPASSING_AUCTION_TRUNCATED,
									tone: 'primary',
								})}
							</div>
						</SectionBlock>

						{renderSubmitBidSection({ description: UI_STRING_SUBMITTING_A_BID_LOCKS_ETH_UNTIL_SETTLEMENT_LOSING })}
					</fieldset>
				)
			}
			if (selectedStage === 'settlement') {
				if (shouldShowTruthAuctionVisualization)
					return (
						<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
							{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
							{selectedAuctionDetailsNotice}
							{truthAuctionEndedNotice}
							{truthAuctionHero}
							{viewerTruthAuctionBidsSection}
							{truthAuctionSettlementSection}
							{importedForkSettlementSection}
							{renderChildSecurityPoolsSection({
								auctionOutcomeSelector,
								childSecurityPools,
								renderSelectedOutcomeChildPoolNotice,
							})}
						</fieldset>
					)
				return (
					<fieldset aria-labelledby='fork-workflow-stage-settlement' className='fork-stage-panel' disabled={disabled} id='fork-workflow-stage-panel-settlement' role='tabpanel'>
						{selectedStageAheadMessage === undefined ? undefined : <p className='detail'>{selectedStageAheadMessage}</p>}
						{selectedAuctionDetailsNotice}
						{truthAuctionEndedNotice}
						<SectionBlock badge={truthAuctionStateBadgeElement} title={UI_STRING_SETTLEMENT_STATUS} variant='embedded'>
							{renderWorkflowMetricGrid(settlementStatusMetrics)}
						</SectionBlock>
						{truthAuctionSettlementSection}
						{importedForkSettlementSection}
						{renderChildSecurityPoolsSection({
							auctionOutcomeSelector,
							childSecurityPools,
							renderSelectedOutcomeChildPoolNotice,
						})}
					</fieldset>
				)
			}

			return undefined
		})()
	})()
	const content = (
		<>
			{!showSecurityPoolAddressInput && hasLoadedPoolContext ? undefined : (
				<div className='form-grid'>
					{!showSecurityPoolAddressInput ? undefined : <LookupFieldRow label={UI_STRING_SECURITY_POOL_ADDRESS} value={forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })} placeholder={UI_STRING_HEX_VALUE_PLACEHOLDER} />}
					{hasLoadedPoolContext ? undefined : <p className='detail'>{UI_STRING_LOAD_A_POOL_TO_INSPECT_FORK_PROGRESS_MIGRATION_AND_THE_TRUTH_AUCTION}</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{hasLoadedPoolContext ? stagePanel : undefined}

			<ErrorNotice message={forkAuctionError} />
		</>
	)
	if (embedInCard) return content
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={UI_STRING_FORK_TRUTH_AUCTION}>
			{content}
		</RouteWorkflowPanel>
	)
}
