import { usePendingAuctionRefund } from './usePendingAuctionRefund.js'
import { ForkAuctionOutcomePoolNotice } from '../components/ForkAuctionActionSections.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { Fragment } from 'preact'
import { useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { ForkAuctionMigrationBalances } from '../components/ForkAuctionMigrationStage.js'
import { createForkAuctionActionRenderer, ForkAuctionEndedNotice } from '../components/ForkAuctionActionSections.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/transactions/actionAvailability.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import { isPoolQuestionFinalized } from '../../reporting/lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import { useForkAuctionInteractionState } from './useForkAuctionInteractionState.js'
import { useTruthAuctionBookData } from './useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from './useTruthAuctionSettlementActionState.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import {
	clampPercentage,
	estimateBidRep,
	getFinalizeTruthAuctionGuardMessage,
	getMigrationStateBadge,
	getMigrationWindowClosedGuardMessage,
	getStartTruthAuctionGuardMessage,
	getTruthAuctionBypassReason,
	getTruthAuctionStateBadge,
	getTruthAuctionWindow,
	renderTimestamp,
	renderTruthAuctionPriceValue,
} from '../components/ForkAuctionPresentation.js'
import { useForkAuctionContext } from './useForkAuctionContext.js'

export function useForkAuctionSectionState(props: ForkAuctionSectionProps) {
	const context = useForkAuctionContext(props)
	const renderSelectedOutcomeChildPoolNotice = () => (
		<ForkAuctionOutcomePoolNotice error={context.selectedAuctionChildPoolRecoveryError} loading={context.loadingSelectedAuctionChildPoolRecovery} onRetry={context.retrySelectedAuctionChildPoolRecovery} outcomeLabel={context.selectedOutcomeLabel} poolAvailable={context.selectedAuctionChildPool !== undefined} />
	)
	usePendingAuctionRefund(context)
	const selectedAuctionContextError = context.selectedAuctionError
	const optimisticTruthAuctionStartedAt =
		context.forkAuctionResult?.action === 'startTruthAuction' && context.auctionSecurityPoolAddress !== undefined && sameAddress(context.forkAuctionResult.securityPoolAddress, context.auctionSecurityPoolAddress)
			? (context.effectiveCurrentTimestamp ?? context.forkAuctionDetails?.migrationEndsAt ?? context.selectedAuctionContext?.currentTime ?? 1n)
			: undefined
	let effectiveTruthAuctionStartedAt = optimisticTruthAuctionStartedAt
	if (context.auctionHasStartedAtValue > 0n) effectiveTruthAuctionStartedAt = context.auctionHasStartedAtValue
	const hasStartedTruthAuction = effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n
	const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticClaimedParentDisputeStakedRep, setPendingParentEscalationClaimSelection } = useForkAuctionInteractionState({
		accountAddress: context.accountState.address,
		connectedWalletDisputeStakedAttoRep: context.connectedWalletVaultSummary?.disputeStakedAttoRep,
		forkAuctionActiveAction: context.forkAuctionActiveAction,
		forkAuctionError: context.forkAuctionError,
		forkAuctionResult: context.forkAuctionResult,
		hasStartedTruthAuction,
		reportingDetails: context.reportingDetails,
		securityPoolAddress: context.securityPoolAddress,
		startTruthAuctionSecurityPoolAddress: context.selectedAuctionPoolAddress,
	})
	const effectiveDisputeStakedAttoRep = (() => {
		if (context.connectedWalletVaultSummary === undefined) return undefined
		if (context.connectedWalletVaultSummary.disputeStakedAttoRep > optimisticClaimedParentDisputeStakedRep) {
			return context.connectedWalletVaultSummary.disputeStakedAttoRep - optimisticClaimedParentDisputeStakedRep
		}
		return 0n
	})()
	const activeReportingDetails = context.reportingDetails?.status === 'active' ? context.reportingDetails : undefined
	const isMigrationRequired = activeReportingDetails?.settlementState === 'migration-required'
	const isMigrationExpired = activeReportingDetails?.settlementState === 'migration-expired'
	const escalationMigrationEntitlement = context.reportingDetails?.viewerEscalationMigrationEntitlement
	const hasStoredEscalationMigrationEntitlement = escalationMigrationEntitlement?.initialized === true
	const selectedOutcomeEscalationEntitlementMaterialized = escalationMigrationEntitlement?.materializedByOutcome[context.forkAuctionForm.selectedOutcome] === true
	const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired || hasStoredEscalationMigrationEntitlement
	const selectedParentEscalationClaimSide = context.reportingDetails?.status !== 'active' ? undefined : context.reportingDetails.sides.find(side => side.key === context.forkAuctionForm.selectedOutcome)
	const selectedParentEscalationClaimDeposits = selectedParentEscalationClaimSide?.userDeposits ?? []
	const selectedParentEscalationClaimDepositIndexes = context.reportingForm?.selectedWithdrawDepositIndexesByOutcome[context.forkAuctionForm.selectedOutcome] ?? []
	const hasSelectedParentEscalationClaimDeposits = selectedParentEscalationClaimDeposits.length > 0
	const unresolvedMigrationSides = activeReportingDetails?.sides ?? []
	const [selectedImportedForkDepositIndexesByOutcome, setSelectedImportedForkDepositIndexesByOutcome] = useState<Record<ReportingOutcomeKey, bigint[]>>({
		invalid: [],
		yes: [],
		no: [],
	})
	function renderSelectedOutcomeChildPoolLink() {
		if (context.selectedAuctionChildPool === undefined) return undefined

		return (
			<SecurityPoolLink className='fork-workflow-outcome-link' securityPoolAddress={context.selectedAuctionChildPool.securityPoolAddress} universeId={context.selectedAuctionChildPool.universeId}>
				{forkAuctionCopy.childPool}
			</SecurityPoolLink>
		)
	}
	const migrationBalancesContent = (
		<ForkAuctionMigrationBalances
			accountConnected={context.accountState.address !== undefined}
			connectedWalletVaultSummary={context.connectedWalletVaultSummary}
			effectiveDisputeStakedAttoRep={effectiveDisputeStakedAttoRep}
			onSelectedOutcomeChange={selectedOutcome => context.onForkAuctionFormChange({ selectedOutcome })}
			renderSelectedOutcomeChildPoolLink={renderSelectedOutcomeChildPoolLink}
			renderSelectedOutcomeChildPoolNotice={renderSelectedOutcomeChildPoolNotice}
			selectedOutcome={context.forkAuctionForm.selectedOutcome}
			selectedOutcomeMigrationChildPool={context.selectedOutcomeMigrationChildPool}
			selectedOutcomeMigrationChildVault={context.selectedOutcomeMigrationChildVault}
		/>
	)
	const hasWalletVaultMigrationBalance = context.connectedWalletVaultSummary !== undefined && (context.connectedWalletVaultSummary.vaultAttoRepBacking > 0n || context.connectedWalletVaultSummary.capacityOwnershipAttoRep > 0n)
	const hasWalletParentEscalationClaimBalance = effectiveDisputeStakedAttoRep !== undefined && effectiveDisputeStakedAttoRep > 0n
	const migrateVaultBalanceGuardMessage = context.connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? forkAuctionCopy.poolMigrationCapacityEmpty : undefined
	const claimParentEscalationBalanceGuardMessage = context.connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? forkAuctionCopy.walletDisputeStakedRepEmpty : undefined
	const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0)
	const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0
	const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? []
	const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0
	const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails)
	const childSecurityPools = context.securityPoolAddress === undefined ? [] : context.securityPools.filter(pool => sameAddress(pool.parent, context.securityPoolAddress))
	const enteredBidPreview = getTruthAuctionBidPreview(context.forkAuctionForm.submitBidPrice)
	const enteredBidPrice = enteredBidPreview?.enteredPrice
	const submittedBidPrice = enteredBidPreview?.submittedPrice
	const enteredBidTick = enteredBidPreview?.tick
	const enteredBidAmount = tryParseTruthAuctionAmountInput(context.forkAuctionForm.submitBidAmount)
	const estimatedAttoRep = estimateBidRep(context.forkAuctionForm.submitBidAmount, submittedBidPrice)
	const resultingBidBalanceAttoEth = enteredBidAmount === undefined || context.accountState.ethBalanceAttoEth === undefined || enteredBidAmount > context.accountState.ethBalanceAttoEth ? undefined : context.accountState.ethBalanceAttoEth - enteredBidAmount
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = context.auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (context.auctionTruthAuctionStatus !== undefined) return commonCopy.metricUnavailablePlaceholder
		if (context.hasSelectedAuctionChildPool) return commonCopy.metricUnavailablePlaceholder
		return context.forkOnlyFallbackText
	})()
	const truthAuctionStatus = context.auctionTruthAuctionStatus
	const isTruthAuctionDetailsLoading = context.hasSelectedAuctionChildPool && hasStartedTruthAuction && truthAuctionStatus === undefined && selectedAuctionContextError === undefined
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && context.auctionTruthAuctionAddress !== undefined && context.auctionTruthAuctionAddress !== zeroAddress
	const {
		aggregatedAuctionBidCountForLoadedTicks,
		aggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		hasMoreTickSummaries,
		hasMoreViewerBids,
		hasLoadedAggregatedAuctionBids,
		hasLoadedTruthAuctionBook,
		hasLoadedViewerTruthAuctionBids,
		loadNextAuctionBidPage,
		loadNextTickPage,
		loadNextViewerBidPage,
		loadingAggregatedAuctionBids,
		loadingTruthAuctionBook,
		loadingViewerTruthAuctionBids,
		retryingPublicTruthAuctionBook,
		retryingViewerTruthAuctionBids,
		retryPublicTruthAuctionBook,
		retryViewerTruthAuctionBids,
		selectTruthAuctionTick,
		selectedBookTick,
		truthAuctionBookData,
		truthAuctionBookError,
		viewerTruthAuctionBidsError,
	} = useTruthAuctionBookData({
		accountAddress: context.accountState.address,
		enteredBidTick,
		forkAuctionResultHash: context.forkAuctionResult?.hash,
		selectedStage: context.selectedStage,
		shouldShowTruthAuctionVisualization,
		truthAuctionAddress: context.auctionTruthAuctionAddress,
		truthAuctionClearingTick: truthAuctionStatus?.clearingTick,
		truthAuctionReadClient: context.truthAuctionReadClient,
	})
	const winningThresholdPrice = getTruthAuctionWinningThresholdPrice(truthAuctionStatus)
	const startTruthAuctionCountdown = context.forkAuctionDetails?.migrationEndsAt === undefined || context.effectiveCurrentTimestamp === undefined ? undefined : getTimeRemaining(context.forkAuctionDetails.migrationEndsAt, context.effectiveCurrentTimestamp)
	const isStartTruthAuctionInProgress = (() => {
		if (hasStartedTruthAuction) return false
		if (isStartTruthAuctionInProgressState) return true
		if (context.forkAuctionActiveAction === 'startTruthAuction') return true

		return false
	})()
	const truthAuctionStateBadge = getTruthAuctionStateBadge({
		hasSelectedAuctionChildPool: context.hasSelectedAuctionChildPool,
		isStartTruthAuctionInProgress,
		startTruthAuctionCountdown,
		truthAuction: truthAuctionStatus,
		truthAuctionStartedAt: effectiveTruthAuctionStartedAt ?? 0n,
	})
	const startedDisplay = (() => {
		if (hasStartedTruthAuction) {
			return renderTimestamp({
				displayTimestamp: effectiveTruthAuctionStartedAt,
				fallbackText: forkAuctionCopy.notStarted,
			})
		}
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruncated
		if (effectiveTruthAuctionStartedAt === undefined || effectiveTruthAuctionStartedAt === 0n) {
			if (startTruthAuctionCountdown !== undefined && startTruthAuctionCountdown > 0n) return forkAuctionCopy.formatStartsInValue(formatDuration(startTruthAuctionCountdown))
			return forkAuctionCopy.notStarted
		}
		return forkAuctionCopy.notStarted
	})()
	const endsDisplay = (() => {
		if (auctionWindow === undefined) return isStartTruthAuctionInProgress ? forkAuctionCopy.pendingConfirmation : forkAuctionCopy.notStarted
		return <TimestampValue {...(context.effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: context.effectiveCurrentTimestamp })} timestamp={auctionWindow.endsAt} />
	})()
	const hasStartedSelectedTruthAuctionTimeline = hasStartedTruthAuction || truthAuctionStatus !== undefined || context.selectedStage === 'auction' || context.selectedStage === 'settlement' || context.currentWorkflowStage === 'auction' || context.currentWorkflowStage === 'settlement'
	const activeTickSummaries = truthAuctionBookData.tickSummaries
	const truthAuctionOverviewProgress = getTruthAuctionOverviewProgress(truthAuctionStatus, activeTickSummaries)
	const displayedEthRaisedAttoEth = truthAuctionOverviewProgress?.attoEthRaised ?? truthAuctionStatus?.attoEthRaised ?? 0n
	const displayedRepSoldAttoRep = truthAuctionOverviewProgress?.attoRepSold ?? truthAuctionStatus?.totalAttoRepPurchased ?? 0n
	const ethRaisedProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedEthRaisedAttoEth, truthAuctionStatus.attoEthRaiseCap)
	const repSoldProgress = truthAuctionStatus === undefined ? 0 : clampPercentage(displayedRepSoldAttoRep, truthAuctionStatus.maxAttoRepBeingSold)
	const truthAuctionDepthPoints = buildTruthAuctionDepthPoints({
		enteredBidTick,
		selectedBookTick,
		tickSummaries: activeTickSummaries,
		truthAuction: truthAuctionStatus,
	})
	const selectedLoadedTickSummary = selectedBookTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === selectedBookTick)
	const previewTickSummary = enteredBidTick === undefined ? undefined : activeTickSummaries.find(tickSummary => tickSummary.tick === enteredBidTick)
	const submitBidPreviewTickSummary = previewTickSummary ?? (enteredBidTick !== undefined && selectedLoadedTickSummary?.tick === enteredBidTick ? selectedLoadedTickSummary : undefined)
	const maxTickAttoEth = truthAuctionDepthPoints.reduce((maximumEth, point) => (point.currentTotalBidAttoEth > maximumEth ? point.currentTotalBidAttoEth : maximumEth), 0n)
	const ethRaisedCapDisplay =
		truthAuctionStatus === undefined ? (
			truthAuctionFallback
		) : (
			<Fragment>
				<CurrencyValue value={displayedEthRaisedAttoEth} suffix={commonCopy.eth} /> / <CurrencyValue value={truthAuctionStatus.attoEthRaiseCap} suffix={commonCopy.eth} />
			</Fragment>
		)
	const clearingPriceDisplay = truthAuctionStatus === undefined ? truthAuctionFallback : renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)
	const settlementAvailableDisplay = (() => {
		if (!context.hasSelectedAuctionChildPool) return forkAuctionCopy.forkUnavailablePlaceholder
		if (context.selectedAuctionContext?.claimingAvailable) return commonCopy.yes

		return commonCopy.no
	})()
	const settlementBidRows = getTruthAuctionSettlementBidRows({
		accountAddress: context.accountState.address,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const { isSettleSelectedBidsInProgress, selectedSettlementBidKeys, setSelectedSettlementBidKeys, settlementBidResultByKey, settlementSelectionState, submitSelectedSettlementBids } = useTruthAuctionSettlementActionState({
		accountAddress: context.accountState.address,
		forkAuctionError: context.forkAuctionError,
		forkAuctionResult: context.forkAuctionResult,
		onClaimAuctionProceeds: context.onClaimAuctionProceeds,
		onRefundLosingBids: context.onRefundLosingBids,
		selectedAuctionPoolAddress: context.selectedAuctionPoolAddress,
		selectedAuctionUniverseId: context.selectedAuctionUniverseId,
		selectedStage: context.selectedStage,
		settlementBidRows,
		truthAuctionFinalized: truthAuctionStatus?.finalized === true,
	})
	const selectedSettlementBidRows = settlementSelectionState.selectedRows
	const selectedRefundSettlementBidRows = settlementSelectionState.selectedRefundRows
	const selectedClaimSettlementBidRows = settlementSelectionState.selectedClaimRows
	const settlementSelectionMode = settlementSelectionState.selectionMode
	const settlementSelectionHasClaims = settlementSelectionState.selectionHasClaims
	const settlementSelectionHasRefunds = settlementSelectionState.selectionHasRefunds
	const settlementSelectionEstimate = getTruthAuctionSettlementSelectionEstimate({
		auctionedCapacityOwnershipAttoRep: context.selectedAuctionContext?.auctionedCapacityOwnershipAttoRep,
		selectedRows: selectedSettlementBidRows,
		truthAuction: truthAuctionStatus,
	})
	const settlementAction =
		getTruthAuctionSettlementAction({
			selectionHasClaims: settlementSelectionHasClaims,
			selectionHasRefunds: settlementSelectionHasRefunds,
			truthAuctionFinalized: truthAuctionStatus?.finalized === true,
		}) ?? 'refundLosingBids'
	const showRefundOnlySettlementCapacityOwnershipNotice = truthAuctionStatus?.finalized === true && selectedRefundSettlementBidRows.length > 0 && selectedClaimSettlementBidRows.length === 0
	const settlementActionLabel = forkAuctionCopy.settleSelectedBids
	const settlementActionDescription = (() => {
		if (settlementSelectionMode === 'claim') return forkAuctionCopy.formatWinningBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		if (settlementSelectionMode === 'refund') {
			if (truthAuctionStatus?.finalized === true) return forkAuctionCopy.formatFinalizedRefundBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
			return forkAuctionCopy.formatRefundableBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
		}
		return forkAuctionCopy.formatMixedBidBatchSettlementDetail(AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL)
	})()
	const settlementActionPendingLabel = forkAuctionCopy.submittingSettlementTransactionTruncated
	const auctionBidRows = buildTruthAuctionBidRows({
		bids: aggregatedAuctionBids,
		truthAuction: truthAuctionStatus,
	})
	const viewerBidRowsViewModel = buildViewerTruthAuctionBidRows({
		accountAddress: context.accountState.address,
		isSettlementInProgress: isSettleSelectedBidsInProgress,
		selectedBidKeys: selectedSettlementBidKeys,
		selectedStage: context.selectedStage,
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
		if (context.accountState.address === undefined) return forkAuctionCopy.forkActionWalletRequired
		if (!context.isOnActiveAppChain) return getWrongNetworkReason()

		return undefined
	})()
	const forkPoolState = evaluateSecurityPoolState({
		forkStage: deriveSecurityPoolForkStage({
			currentStage: context.currentStage,
			workflowDisabled: context.disabled,
		}),
		lifecycleState:
			context.lifecycleStateOverride ??
			deriveSecurityPoolLifecycleState({
				hasForkActivity: context.forkAuctionDetails?.hasForkActivity ?? context.previewPool?.hasForkActivity,
				isChildPool: (context.forkAuctionDetails?.parentSecurityPoolAddress ?? context.previewPool?.parent) !== zeroAddress,
				questionOutcome: context.questionOutcome,
				systemState: context.systemState,
				universeHasForked: context.previewPool?.universeHasForked,
			}),
		universeHasForked: context.previewPool?.universeHasForked === true,
	})
	const renderStageActionButton = createForkAuctionActionRenderer({
		activeAction: context.forkAuctionActiveAction,
		forkPoolState,
		interactionDisabledReason,
		isOnActiveAppChain: context.isOnActiveAppChain,
		wrongNetworkReason: getWrongNetworkReason(),
	})
	const truthAuctionBidGuardMessage = (() => {
		if (isTruthAuctionDetailsLoading) return undefined
		if (!hasStartedTruthAuction) return forkAuctionCopy.truthAuctionNotStartedReason
		if (selectedAuctionContextError !== undefined) return selectedAuctionContextError
		return getTruthAuctionBidGuardMessage({
			accountAddress: context.accountState.address,
			currentTimestamp: context.effectiveCurrentTimestamp,
			isOnActiveAppChain: context.isOnActiveAppChain,
			submitBidAmountInput: context.forkAuctionForm.submitBidAmount,
			truthAuction: truthAuctionStatus,
			walletBalanceAttoEth: context.accountState.ethBalanceAttoEth,
		})
	})()
	const startTruthAuctionGuardMessage = getStartTruthAuctionGuardMessage({
		currentTimestamp: context.effectiveCurrentTimestamp,
		migrationEndsAt: context.forkAuctionDetails?.migrationEndsAt,
	})
	const finalizeTruthAuctionGuardMessage = getFinalizeTruthAuctionGuardMessage({
		currentTimestamp: context.effectiveCurrentTimestamp,
		truthAuction: truthAuctionStatus,
		truthAuctionEndsAt,
	})
	const finalizeTruthAuctionAction = renderStageActionButton({
		action: 'finalizeTruthAuction',
		availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
		forceEnabled: context.hasSelectedAuctionChildPool,
		idleLabel: forkAuctionCopy.finalizeTruthAuction,
		onClick: onFinalizeTruthAuctionForSelectedAuction,
		pendingLabel: forkAuctionCopy.finalizingTruthAuctionTruncated,
	})
	const truthAuctionEndedNotice = truthAuctionStatus === undefined ? undefined : <ForkAuctionEndedNotice actionButton={finalizeTruthAuctionAction} currentTimestamp={context.effectiveCurrentTimestamp} finalized={truthAuctionStatus.finalized} truthAuctionEndsAt={truthAuctionEndsAt} />
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return forkAuctionCopy.formatTruthAuctionStartDelay(formatDuration(startTruthAuctionCountdown))
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (context.connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedAttoRep: context.selectedAuctionContext?.migratedAttoRep ?? context.selectedAuctionChildPool?.migratedAttoRep ?? 0n,
		parentSettlementCollateralAttoEthAmount: context.forkAuctionDetails?.settlementCollateralAttoEth ?? context.previewPool?.settlementCollateralAttoEth,
		auctionableAttoRepAtFork: context.forkAuctionDetails?.auctionableAttoRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(context.forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruthAuction
		return startTruthAuctionGuardMessage
	})()
	const setSelectedParentEscalationClaimDepositIndexes = (nextSelectedDepositIndexes: bigint[]) => {
		if (context.onReportingFormChange === undefined || context.reportingForm === undefined) return
		context.onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: {
				...context.reportingForm.selectedWithdrawDepositIndexesByOutcome,
				[context.forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
			},
		})
	}
	const claimSelectedParentEscalationDepositsGuardMessage = (() => {
		if (claimParentEscalationBalanceGuardMessage !== undefined) return claimParentEscalationBalanceGuardMessage
		if (context.loadingReportingDetails) return forkAuctionCopy.eligibleDepositsLoading
		if (context.reportingDetails?.status !== 'active') return forkAuctionCopy.escalationDepositDetailsUnavailable
		if (isMigrationRequired) return forkAuctionCopy.useUnresolvedMigrationReason
		if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredReason
		if (selectedParentEscalationClaimDeposits.length === 0) return forkAuctionCopy.formatNoClaimableParentEscalationDeposits(context.selectedOutcomeLabel)
		if (selectedParentEscalationClaimDepositIndexes.length > 0) return undefined
		return forkAuctionCopy.parentEscalationClaimSelectionRequired
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: context.effectiveCurrentTimestamp,
		migrationEndsAt: context.forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (context.loadingReportingDetails) return forkAuctionCopy.unresolvedDepositsLoading
		if (selectedOutcomeEscalationEntitlementMaterialized) return forkAuctionCopy.formatEntitlementAlreadyMaterialized(context.selectedOutcomeLabel)
		if (hasStoredEscalationMigrationEntitlement) return undefined
		if (!isMigrationRequired) return forkAuctionCopy.unresolvedMigrationUnavailableReason
		if (activeReportingDetails === undefined) return forkAuctionCopy.unresolvedDepositDetailsUnavailable
		if (!hasUnresolvedMigrationDeposits) return forkAuctionCopy.walletUnresolvedDepositsEmpty
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (context.loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(context.selectedOutcomeLabel)
		if (context.selectedOutcomeMigrationSeedStatusError !== undefined) return context.selectedOutcomeMigrationSeedStatusError
		if (context.selectedOutcomeMigrationSeedStatus?.seeded) return forkAuctionCopy.formatPoolRepAlreadyMigrated(context.selectedOutcomeLabel)
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (context.loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(context.selectedOutcomeLabel)
		if (context.selectedOutcomeMigrationSeedStatusError !== undefined) return context.selectedOutcomeMigrationSeedStatusError
		if (context.selectedOutcomeMigrationSeedStatus === undefined || context.selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return forkAuctionCopy.formatPoolMigrationRequiredForVault(context.selectedOutcomeLabel)
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? forkAuctionCopy.vaultMigrationCompleteReason : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? forkAuctionCopy.migratingVault : undefined
	const migrateVaultGuardMessage = isMigrationRequired ? forkAuctionCopy.combinedUnresolvedMigrationDetail : (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
	const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage
	const migrationStateBadge = getMigrationStateBadge({
		currentTimestamp: context.effectiveCurrentTimestamp,
		effectiveTruthAuctionStartedAt,
		migrationEndsAt: context.forkAuctionDetails?.migrationEndsAt,
	})
	const migrationStatusBadge = <Badge tone={migrationStateBadge.tone}>{migrationStateBadge.label}</Badge>
	const onStartTruthAuctionSubmit = () => {
		beginStartTruthAuctionProgress()
		context.onStartTruthAuction(context.selectedAuctionPoolAddress, context.selectedAuctionUniverseId)
	}
	const onSubmitBidForSelectedAuction = () => {
		context.onSubmitBid(context.selectedAuctionPoolAddress, context.selectedAuctionUniverseId)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		context.onFinalizeTruthAuction(context.selectedAuctionPoolAddress, context.selectedAuctionUniverseId)
	}
	const settlementActionAvailabilityMessage = getTruthAuctionSettlementActionAvailabilityMessage({
		claimingAvailable: context.selectedAuctionContext?.claimingAvailable,
		selectedClaimRows: selectedClaimSettlementBidRows,
		selectedRows: selectedSettlementBidRows,
		selectionHasClaims: settlementSelectionHasClaims,
		selectionHasRefunds: settlementSelectionHasRefunds,
		truthAuction: truthAuctionStatus,
	})
	const onSettleSelectedBidsForSelectedAuction = () => {
		submitSelectedSettlementBids()
	}
	const onMigrateVaultSubmit = () => {
		beginVaultMigrationProgress()
		context.onMigrateVault()
	}
	const onMigrateSelectedOutcomeRepToZoltar = () => {
		context.onMigrateRepToZoltar([context.forkAuctionForm.selectedOutcome])
	}
	const onClaimSelectedParentEscalationDeposits = () => {
		setPendingParentEscalationClaimSelection({
			depositIndexes: selectedParentEscalationClaimDepositIndexes,
			outcome: context.forkAuctionForm.selectedOutcome,
		})
		context.onClaimParentEscalationDeposits(context.forkAuctionForm.selectedOutcome, selectedParentEscalationClaimDepositIndexes)
	}
	const onMigrateUnresolvedEscalationSubmit = () => {
		setPendingParentEscalationClaimSelection(undefined)
		beginVaultMigrationProgress()
		context.onMigrateUnresolvedEscalation(context.forkAuctionForm.selectedOutcome)
	}
	const onWithdrawForkedEscalationSubmit = (outcome: ReportingOutcomeKey) => {
		const selectedDepositIndexes = selectedImportedForkDepositIndexesByOutcome[outcome]
		if (selectedDepositIndexes.length === 0) return
		context.onWithdrawForkedEscalation(outcome, selectedDepositIndexes)
	}
	return {
		...context,
		renderSelectedOutcomeChildPoolNotice,
		renderStageActionButton,
		submitBidGuardMessage,
		onSubmitBidForSelectedAuction,
		isTruthAuctionDetailsLoading,
		enteredBidAmount,
		enteredBidPrice,
		estimatedAttoRep,
		resultingBidBalanceAttoEth,
		submitBidPreviewTickSummary,
		submittedBidPrice,
		isMigrationRequired,
		activeReportingDetails,
		importedForkSettlementSides,
		setSelectedImportedForkDepositIndexesByOutcome,
		hasStartedSelectedTruthAuctionTimeline,
		effectiveTruthAuctionStartedAt,
		truthAuctionStateBadge,
		startedDisplay,
		endsDisplay,
		ethRaisedCapDisplay,
		truthAuctionStatus,
		truthAuctionFallback,
		displayedRepSoldAttoRep,
		clearingPriceDisplay,
		settlementAvailableDisplay,
		renderSelectedOutcomeChildPoolLink,
		shouldShowTruthAuctionVisualization,
		displayedEthRaisedAttoEth,
		ethRaisedProgress,
		repSoldProgress,
		winningThresholdPrice,
		migrationStatusBadge,
		hasMoreTickSummaries,
		loadingTruthAuctionBook,
		maxTickAttoEth,
		loadNextTickPage,
		selectTruthAuctionTick,
		truthAuctionBookError,
		truthAuctionDepthPoints,
		aggregatedAuctionBidCountForLoadedTicks,
		hasLoadedTruthAuctionBook,
		hasLoadedAggregatedAuctionBids,
		hasMoreAggregatedAuctionBids,
		truthAuctionBookData,
		loadingAggregatedAuctionBids,
		loadNextAuctionBidPage,
		retryPublicTruthAuctionBook,
		retryingPublicTruthAuctionBook,
		auctionBidRows,
		selectedAuctionContextError,
		viewerTruthAuctionBidsError,
		hasLoadedViewerTruthAuctionBids,
		hasMoreViewerBids,
		loadingViewerTruthAuctionBids,
		loadNextViewerBidPage,
		retryViewerTruthAuctionBids,
		onSettlementBidSelectionChange,
		retryingViewerTruthAuctionBids,
		viewerBidRows,
		showViewerSettlementActionColumn,
		settlementSelectionEstimate,
		selectedClaimSettlementBidRows,
		selectedRefundSettlementBidRows,
		selectedSettlementBidRows,
		settlementAction,
		settlementActionAvailabilityMessage,
		settlementActionLabel,
		onSettleSelectedBidsForSelectedAuction,
		settlementActionPendingLabel,
		isSettleSelectedBidsInProgress,
		settlementActionDescription,
		showRefundOnlySettlementCapacityOwnershipNotice,
		hasImportedForkSettlementDeposits,
		onWithdrawForkedEscalationSubmit,
		importedForkSettlementResolved,
		selectedImportedForkDepositIndexesByOutcome,
		startTruthAuctionAvailabilityMessage,
		truthAuctionBypassReason,
		onStartTruthAuctionSubmit,
		startTruthAuctionReadyInText,
		claimSelectedParentEscalationDepositsGuardMessage,
		hasSelectedParentEscalationClaimDeposits,
		hasStoredEscalationMigrationEntitlement,
		hasUnresolvedMigrationDeposits,
		hasUnresolvedMigrationState,
		hasWalletParentEscalationClaimBalance,
		hasWalletVaultMigrationBalance,
		isMigrationExpired,
		isVaultMigrationComplete,
		migratePoolToUniverseGuardMessage,
		migrateUnresolvedEscalationGuardMessage,
		migrateVaultGuardMessage,
		migrationBalancesContent,
		onClaimSelectedParentEscalationDeposits,
		onMigrateSelectedOutcomeRepToZoltar,
		onMigrateUnresolvedEscalationSubmit,
		onMigrateVaultSubmit,
		setSelectedParentEscalationClaimDepositIndexes,
		selectedParentEscalationClaimDeposits,
		selectedParentEscalationClaimDepositIndexes,
		childSecurityPools,
		hasStartedTruthAuction,
		truthAuctionEndedNotice,
	}
}
