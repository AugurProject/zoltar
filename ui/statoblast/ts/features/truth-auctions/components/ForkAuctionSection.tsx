import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as forkAuctionCopy from '../../../copy/forkAuction.js'
import { Fragment } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { EnumDropdown } from '@zoltar/ui-core-shared/components/EnumDropdown.js'
import { ImportedForkSettlementSection } from '@zoltar/ui-zoltar/features/reporting/components/ImportedForkSettlementSection.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { SecurityPoolLink } from '../../security-pools/components/SecurityPoolLink.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { TruthAuctionBidsSection, ViewerTruthAuctionBidsSection } from './TruthAuctionBidsSection.js'
import { TruthAuctionMarketViewSection } from './TruthAuctionMarketViewSection.js'
import { TruthAuctionSummaryCard } from './TruthAuctionSummaryCard.js'
import { ForkAuctionMigrationBalances, ForkAuctionMigrationStage } from './ForkAuctionMigrationStage.js'
import { ForkAuctionWorkflowShell, ForkTriggeredStage } from './ForkAuctionWorkflowShell.js'
import { createForkAuctionActionRenderer, ForkAuctionBidsStatusSection, ForkAuctionEndedNotice, ForkAuctionOutcomePoolNotice, ForkAuctionSettlementActionSection, ForkAuctionStartSection, ForkAuctionSubmitBidSection } from './ForkAuctionActionSections.js'
import { createActionAvailability } from '@zoltar/ui-core-shared/lib/actionAvailability.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, getTimeRemaining } from '../lib/forkAuction.js'
import { buildTruthAuctionDepthPoints, getTruthAuctionBidGuardMessage, getTruthAuctionBidPreview, getTruthAuctionBidPriceValidationMessage, getTruthAuctionOverviewProgress, getTruthAuctionWinningThresholdPrice } from '../lib/truthAuctionBook.js'
import { buildTruthAuctionBidRows, buildViewerTruthAuctionBidRows, updateTruthAuctionSettlementBidSelection } from '../lib/truthAuctionBidViewModels.js'
import { getTruthAuctionSettlementAction } from '../lib/truthAuctionSettlementActionState.js'
import { getTruthAuctionSettlementActionAvailabilityMessage, getTruthAuctionSettlementBidRows, getTruthAuctionSettlementSelectionEstimate } from '../lib/truthAuctionSettlement.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseTruthAuctionAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { getWrongNetworkReason, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { REPORTING_OUTCOME_DROPDOWN_OPTIONS, getReportingOutcomeLabel } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import { isPoolQuestionFinalized } from '@zoltar/ui-zoltar/features/reporting/lib/reportingDomain.js'
import { deriveSecurityPoolForkStage, deriveSecurityPoolLifecycleState, evaluateSecurityPoolState } from '../../security-pools/lib/securityPoolState.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection } from '../../security-pools/lib/securityPoolWorkflow.js'
import { useForkAuctionInteractionState } from '../hooks/useForkAuctionInteractionState.js'
import { useSelectedAuctionReadState } from '../hooks/useSelectedAuctionReadState.js'
import { useTruthAuctionBookData } from '../hooks/useTruthAuctionBookData.js'
import { useTruthAuctionSettlementActionState } from '../hooks/useTruthAuctionSettlementActionState.js'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import {
	clampPercentage,
	type DisplayMetric,
	estimateBidRep,
	ForkAuctionOutcomeStage,
	ForkAuctionMigrationSummaryCard,
	FORK_MIGRATION_DURATION,
	ForkWorkflowStageNavigator,
	getFinalizeTruthAuctionGuardMessage,
	getForkOnlyFallbackText,
	getForkTypeLabel,
	getForkWorkflowStageAheadMessage,
	getMigrationStateBadge,
	getMigrationWindowClosedGuardMessage,
	getPreviewForkTypeLabel,
	getPreviewMigrationSummary,
	getStartTruthAuctionGuardMessage,
	getTruthAuctionBypassReason,
	getTruthAuctionStateBadge,
	getTruthAuctionWindow,
	isFullReadClient,
	renderAddress,
	renderMetricValue,
	renderTimestamp,
	renderTruthAuctionPriceValue,
	renderTruthAuctionSettlementSelectionSummary,
	sameBigIntRecord,
} from './ForkAuctionPresentation.js'

export function ForkAuctionSection(props: ForkAuctionSectionProps) {
	const {
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
		loadingForkAuctionDetails,
		onClaimAuctionProceeds,
		onFinalizeTruthAuction,
		onForkAuctionFormChange,
		onLoadForkAuction,
		onMigrateRepToZoltar,
		onClaimParentEscalationDeposits,
		onMigrateUnresolvedEscalation,
		onMigrateVault,
		onRefundLosingBids,
		onLoadReporting,
		onReportingFormChange,
		onStartTruthAuction,
		onSubmitBid,
		onWithdrawForkedEscalation,
		previewPool,
		reportingDetails,
		reportingError,
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
	} = props
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const effectiveCurrentTimestamp = currentTimestamp ?? forkAuctionDetails?.currentTime
	const securityPoolAddress = forkAuctionDetails?.securityPoolAddress ?? previewPool?.securityPoolAddress
	const universeId = forkAuctionDetails?.universeId ?? previewPool?.universeId
	const systemState = forkAuctionDetails?.systemState ?? previewPool?.systemState
	const hasEnteredForkLifecycle = lifecycleStateOverride === 'poolForked' || lifecycleStateOverride === 'forkMigration' || lifecycleStateOverride === 'forkTruthAuction'
	const hasTriggeredFork = hasEnteredForkLifecycle || (universeForkTime !== undefined && universeForkTime > 0n)
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
	const {
		loadingSelectedAuctionChildPoolRecovery,
		loadingSelectedOutcomeMigrationSeedStatus,
		retryingSelectedAuctionDetails,
		retrySelectedAuctionChildPoolRecovery,
		retrySelectedAuctionDetails,
		retrySelectedOutcomeMigrationSeedStatus,
		selectedAuctionChildPool,
		selectedAuctionChildPoolRecoveryError,
		selectedAuctionDetails,
		selectedAuctionError,
		selectedOutcomeMigrationSeedStatus,
		selectedOutcomeMigrationSeedStatusError,
	} = useSelectedAuctionReadState({
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
	const selectedAuctionUniverseId = selectedAuctionChildPool?.universeId
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
	const { beginStartTruthAuctionProgress, beginVaultMigrationProgress, hasCompletedVaultMigration, isStartTruthAuctionInProgressState, isVaultMigrationPending, optimisticClaimedParentDisputeStakedRep, setPendingParentEscalationClaimSelection } = useForkAuctionInteractionState({
		accountAddress: accountState.address,
		connectedWalletDisputeStakedAttoRep: connectedWalletVaultSummary?.disputeStakedAttoRep,
		forkAuctionActiveAction,
		forkAuctionError,
		forkAuctionResult,
		hasStartedTruthAuction,
		reportingDetails,
		securityPoolAddress,
		startTruthAuctionSecurityPoolAddress: selectedAuctionPoolAddress,
	})
	const effectiveDisputeStakedAttoRep = (() => {
		if (connectedWalletVaultSummary === undefined) return undefined
		if (connectedWalletVaultSummary.disputeStakedAttoRep > optimisticClaimedParentDisputeStakedRep) {
			return connectedWalletVaultSummary.disputeStakedAttoRep - optimisticClaimedParentDisputeStakedRep
		}
		return 0n
	})()
	const activeReportingDetails = reportingDetails?.status === 'active' ? reportingDetails : undefined
	const isMigrationRequired = activeReportingDetails?.settlementState === 'migration-required'
	const isMigrationExpired = activeReportingDetails?.settlementState === 'migration-expired'
	const escalationMigrationEntitlement = reportingDetails?.viewerEscalationMigrationEntitlement
	const hasStoredEscalationMigrationEntitlement = escalationMigrationEntitlement?.initialized === true
	const selectedOutcomeEscalationEntitlementMaterialized = escalationMigrationEntitlement?.materializedByOutcome[forkAuctionForm.selectedOutcome] === true
	const hasUnresolvedMigrationState = isMigrationRequired || isMigrationExpired || hasStoredEscalationMigrationEntitlement
	const selectedParentEscalationClaimSide = reportingDetails?.status !== 'active' ? undefined : reportingDetails.sides.find(side => side.key === forkAuctionForm.selectedOutcome)
	const selectedParentEscalationClaimDeposits = selectedParentEscalationClaimSide?.userDeposits ?? []
	const selectedParentEscalationClaimDepositIndexes = reportingForm?.selectedWithdrawDepositIndexesByOutcome[forkAuctionForm.selectedOutcome] ?? []
	const hasSelectedParentEscalationClaimDeposits = selectedParentEscalationClaimDeposits.length > 0
	const unresolvedMigrationSides = activeReportingDetails?.sides ?? []
	const [selectedImportedForkDepositIndexesByOutcome, setSelectedImportedForkDepositIndexesByOutcome] = useState<Record<ReportingOutcomeKey, bigint[]>>({
		invalid: [],
		yes: [],
		no: [],
	})
	function renderSelectedOutcomeChildPoolLink() {
		if (selectedAuctionChildPool === undefined) return undefined

		return (
			<SecurityPoolLink className='fork-workflow-outcome-link' securityPoolAddress={selectedAuctionChildPool.securityPoolAddress} universeId={selectedAuctionChildPool.universeId}>
				{forkAuctionCopy.childPool}
			</SecurityPoolLink>
		)
	}

	const migrationBalancesContent = (
		<ForkAuctionMigrationBalances
			accountConnected={accountState.address !== undefined}
			connectedWalletVaultSummary={connectedWalletVaultSummary}
			effectiveDisputeStakedAttoRep={effectiveDisputeStakedAttoRep}
			onSelectedOutcomeChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })}
			renderSelectedOutcomeChildPoolLink={renderSelectedOutcomeChildPoolLink}
			renderSelectedOutcomeChildPoolNotice={renderSelectedOutcomeChildPoolNotice}
			selectedOutcome={forkAuctionForm.selectedOutcome}
			selectedOutcomeMigrationChildPool={selectedOutcomeMigrationChildPool}
			selectedOutcomeMigrationChildVault={selectedOutcomeMigrationChildVault}
		/>
	)
	const hasWalletVaultMigrationBalance = connectedWalletVaultSummary !== undefined && (connectedWalletVaultSummary.vaultAttoRepBacking > 0n || connectedWalletVaultSummary.capacityOwnershipAttoRep > 0n)
	const hasWalletParentEscalationClaimBalance = effectiveDisputeStakedAttoRep !== undefined && effectiveDisputeStakedAttoRep > 0n
	const migrateVaultBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance ? forkAuctionCopy.poolMigrationCapacityEmpty : undefined
	const claimParentEscalationBalanceGuardMessage = connectedWalletVaultSummary !== undefined && !hasWalletParentEscalationClaimBalance ? forkAuctionCopy.walletDisputeStakedRepEmpty : undefined
	const totalUnresolvedMigrationDepositCount = unresolvedMigrationSides.reduce((count, side) => count + side.userDeposits.length, 0)
	const hasUnresolvedMigrationDeposits = totalUnresolvedMigrationDepositCount > 0
	const importedForkSettlementSides = activeReportingDetails?.sides.filter(side => side.importedUserDeposits.length > 0) ?? []
	const hasImportedForkSettlementDeposits = importedForkSettlementSides.length > 0
	const importedForkSettlementResolved = isPoolQuestionFinalized(activeReportingDetails)
	const childSecurityPools = securityPoolAddress === undefined ? [] : securityPools.filter(pool => sameAddress(pool.parent, securityPoolAddress))
	const enteredBidPreview = getTruthAuctionBidPreview(forkAuctionForm.submitBidPrice)
	const enteredBidPrice = enteredBidPreview?.enteredPrice
	const submittedBidPrice = enteredBidPreview?.submittedPrice
	const enteredBidTick = enteredBidPreview?.tick
	const enteredBidAmount = tryParseTruthAuctionAmountInput(forkAuctionForm.submitBidAmount)
	const estimatedAttoRep = estimateBidRep(forkAuctionForm.submitBidAmount, submittedBidPrice)
	const resultingBidBalanceAttoEth = enteredBidAmount === undefined || accountState.ethBalanceAttoEth === undefined || enteredBidAmount > accountState.ethBalanceAttoEth ? undefined : accountState.ethBalanceAttoEth - enteredBidAmount
	const auctionWindow = getTruthAuctionWindow(effectiveTruthAuctionStartedAt)
	const truthAuctionEndsAt = auctionTruthAuctionStatus?.auctionEndsAt ?? auctionWindow?.endsAt
	const truthAuctionFallback = (() => {
		if (auctionTruthAuctionStatus !== undefined) return commonCopy.metricUnavailablePlaceholder
		if (hasSelectedAuctionChildPool) return commonCopy.metricUnavailablePlaceholder
		return forkOnlyFallbackText
	})()
	const truthAuctionStatus = auctionTruthAuctionStatus
	const isTruthAuctionDetailsLoading = hasSelectedAuctionChildPool && hasStartedTruthAuction && truthAuctionStatus === undefined && selectedAuctionContextError === undefined
	const shouldShowTruthAuctionVisualization = truthAuctionStatus !== undefined && auctionTruthAuctionAddress !== undefined && auctionTruthAuctionAddress !== zeroAddress
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
		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={auctionWindow.endsAt} />
	})()
	const hasStartedSelectedTruthAuctionTimeline = hasStartedTruthAuction || truthAuctionStatus !== undefined || selectedStage === 'auction' || selectedStage === 'settlement' || currentWorkflowStage === 'auction' || currentWorkflowStage === 'settlement'
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
		if (!hasSelectedAuctionChildPool) return forkAuctionCopy.forkUnavailablePlaceholder
		if (selectedAuctionContext?.claimingAvailable) return commonCopy.yes

		return commonCopy.no
	})()
	const settlementBidRows = getTruthAuctionSettlementBidRows({
		accountAddress: accountState.address,
		truthAuction: truthAuctionStatus,
		viewerBids: truthAuctionBookData.viewerBids,
	})
	const { isSettleSelectedBidsInProgress, selectedSettlementBidKeys, setSelectedSettlementBidKeys, settlementBidResultByKey, settlementSelectionState, submitSelectedSettlementBids } = useTruthAuctionSettlementActionState({
		accountAddress: accountState.address,
		forkAuctionError,
		forkAuctionResult,
		onClaimAuctionProceeds,
		onRefundLosingBids,
		selectedAuctionPoolAddress,
		selectedAuctionUniverseId,
		selectedStage,
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
		auctionedCapacityOwnershipAttoRep: selectedAuctionContext?.auctionedCapacityOwnershipAttoRep,
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
		if (accountState.address === undefined) return forkAuctionCopy.forkActionWalletRequired
		if (!isOnActiveAppChain) return getWrongNetworkReason()

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
	const renderStageActionButton = createForkAuctionActionRenderer({
		activeAction: forkAuctionActiveAction,
		forkPoolState,
		interactionDisabledReason,
		isOnActiveAppChain,
		wrongNetworkReason: getWrongNetworkReason(),
	})
	const truthAuctionBidGuardMessage = (() => {
		if (isTruthAuctionDetailsLoading) return undefined
		if (!hasStartedTruthAuction) return forkAuctionCopy.truthAuctionNotStartedReason
		if (selectedAuctionContextError !== undefined) return selectedAuctionContextError
		return getTruthAuctionBidGuardMessage({
			accountAddress: accountState.address,
			currentTimestamp: effectiveCurrentTimestamp,
			isOnActiveAppChain,
			submitBidAmountInput: forkAuctionForm.submitBidAmount,
			truthAuction: truthAuctionStatus,
			walletBalanceAttoEth: accountState.ethBalanceAttoEth,
		})
	})()
	const startTruthAuctionGuardMessage = getStartTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const finalizeTruthAuctionGuardMessage = getFinalizeTruthAuctionGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		truthAuction: truthAuctionStatus,
		truthAuctionEndsAt,
	})
	const finalizeTruthAuctionAction = renderStageActionButton({
		action: 'finalizeTruthAuction',
		availability: createActionAvailability(finalizeTruthAuctionGuardMessage),
		forceEnabled: hasSelectedAuctionChildPool,
		idleLabel: forkAuctionCopy.finalizeTruthAuction,
		onClick: onFinalizeTruthAuctionForSelectedAuction,
		pendingLabel: forkAuctionCopy.finalizingTruthAuctionTruncated,
	})
	const truthAuctionEndedNotice = truthAuctionStatus === undefined ? undefined : <ForkAuctionEndedNotice actionButton={finalizeTruthAuctionAction} currentTimestamp={effectiveCurrentTimestamp} finalized={truthAuctionStatus.finalized} truthAuctionEndsAt={truthAuctionEndsAt} />
	const startTruthAuctionReadyInText = (() => {
		if (startTruthAuctionCountdown === undefined) return undefined
		if (startTruthAuctionCountdown === 0n) return undefined
		return forkAuctionCopy.formatTruthAuctionStartDelay(formatDuration(startTruthAuctionCountdown))
	})()
	const isVaultMigrationComplete = hasCompletedVaultMigration || (connectedWalletVaultSummary !== undefined && !hasWalletVaultMigrationBalance)
	const truthAuctionBypassReason = getTruthAuctionBypassReason({
		migratedAttoRep: selectedAuctionContext?.migratedAttoRep ?? selectedAuctionChildPool?.migratedAttoRep ?? 0n,
		parentSettlementCollateralAttoEthAmount: forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth,
		auctionableAttoRepAtFork: forkAuctionDetails?.auctionableAttoRepAtFork,
	})
	const bidPriceValidationMessage = getTruthAuctionBidPriceValidationMessage(forkAuctionForm.submitBidPrice)
	const startTruthAuctionAvailabilityMessage = (() => {
		if (isStartTruthAuctionInProgress) return forkAuctionCopy.startingTruthAuction
		return startTruthAuctionGuardMessage
	})()
	const setSelectedParentEscalationClaimDepositIndexes = (nextSelectedDepositIndexes: bigint[]) => {
		if (onReportingFormChange === undefined || reportingForm === undefined) return
		onReportingFormChange({
			selectedWithdrawDepositIndexesByOutcome: {
				...reportingForm.selectedWithdrawDepositIndexesByOutcome,
				[forkAuctionForm.selectedOutcome]: nextSelectedDepositIndexes,
			},
		})
	}
	const claimSelectedParentEscalationDepositsGuardMessage = (() => {
		if (claimParentEscalationBalanceGuardMessage !== undefined) return claimParentEscalationBalanceGuardMessage
		if (loadingReportingDetails) return forkAuctionCopy.eligibleDepositsLoading
		if (reportingDetails?.status !== 'active') return forkAuctionCopy.escalationDepositDetailsUnavailable
		if (isMigrationRequired) return forkAuctionCopy.useUnresolvedMigrationReason
		if (isMigrationExpired) return forkAuctionCopy.unresolvedMigrationExpiredReason
		if (selectedParentEscalationClaimDeposits.length === 0) return forkAuctionCopy.formatNoClaimableParentEscalationDeposits(selectedOutcomeLabel)
		if (selectedParentEscalationClaimDepositIndexes.length > 0) return undefined
		return forkAuctionCopy.parentEscalationClaimSelectionRequired
	})()
	const migrationWindowClosedGuardMessage = getMigrationWindowClosedGuardMessage({
		currentTimestamp: effectiveCurrentTimestamp,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrateUnresolvedEscalationGuardMessage = (() => {
		if (migrationWindowClosedGuardMessage !== undefined) return migrationWindowClosedGuardMessage
		if (loadingReportingDetails) return forkAuctionCopy.unresolvedDepositsLoading
		if (selectedOutcomeEscalationEntitlementMaterialized) return forkAuctionCopy.formatEntitlementAlreadyMaterialized(selectedOutcomeLabel)
		if (hasStoredEscalationMigrationEntitlement) return undefined
		if (!isMigrationRequired) return forkAuctionCopy.unresolvedMigrationUnavailableReason
		if (activeReportingDetails === undefined) return forkAuctionCopy.unresolvedDepositDetailsUnavailable
		if (!hasUnresolvedMigrationDeposits) return forkAuctionCopy.walletUnresolvedDepositsEmpty
		return undefined
	})()
	const migratePoolToUniverseGuardMessage = (() => {
		if (loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus?.seeded) return forkAuctionCopy.formatPoolRepAlreadyMigrated(selectedOutcomeLabel)
		return undefined
	})()
	const selectedOutcomeMigrationSeedGuardMessage = (() => {
		if (migrateVaultBalanceGuardMessage !== undefined) return undefined
		if (loadingSelectedOutcomeMigrationSeedStatus) return forkAuctionCopy.formatCheckingPoolRepMigratedToChildUniverse(selectedOutcomeLabel)
		if (selectedOutcomeMigrationSeedStatusError !== undefined) return selectedOutcomeMigrationSeedStatusError
		if (selectedOutcomeMigrationSeedStatus === undefined || selectedOutcomeMigrationSeedStatus.seeded) return undefined
		return forkAuctionCopy.formatPoolMigrationRequiredForVault(selectedOutcomeLabel)
	})()
	const migrateVaultCompletedMessage = isVaultMigrationComplete ? forkAuctionCopy.vaultMigrationCompleteReason : undefined
	const vaultMigrationInProgressMessage = isVaultMigrationPending ? forkAuctionCopy.migratingVault : undefined
	const migrateVaultGuardMessage = isMigrationRequired ? forkAuctionCopy.combinedUnresolvedMigrationDetail : (migrationWindowClosedGuardMessage ?? migrateVaultBalanceGuardMessage ?? selectedOutcomeMigrationSeedGuardMessage ?? migrateVaultCompletedMessage ?? vaultMigrationInProgressMessage)
	const submitBidGuardMessage = truthAuctionBidGuardMessage ?? bidPriceValidationMessage
	const migrationStateBadge = getMigrationStateBadge({
		currentTimestamp: effectiveCurrentTimestamp,
		effectiveTruthAuctionStartedAt,
		migrationEndsAt: forkAuctionDetails?.migrationEndsAt,
	})
	const migrationStatusBadge = <Badge tone={migrationStateBadge.tone}>{migrationStateBadge.label}</Badge>
	const onStartTruthAuctionSubmit = () => {
		beginStartTruthAuctionProgress()
		onStartTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	const onSubmitBidForSelectedAuction = () => {
		onSubmitBid(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	function onFinalizeTruthAuctionForSelectedAuction() {
		onFinalizeTruthAuction(selectedAuctionPoolAddress, selectedAuctionUniverseId)
	}
	const settlementActionAvailabilityMessage = getTruthAuctionSettlementActionAvailabilityMessage({
		claimingAvailable: selectedAuctionContext?.claimingAvailable,
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
		onMigrateVault()
	}
	const onMigrateSelectedOutcomeRepToZoltar = () => {
		onMigrateRepToZoltar([forkAuctionForm.selectedOutcome])
	}
	const onClaimSelectedParentEscalationDeposits = () => {
		setPendingParentEscalationClaimSelection({
			depositIndexes: selectedParentEscalationClaimDepositIndexes,
			outcome: forkAuctionForm.selectedOutcome,
		})
		onClaimParentEscalationDeposits(forkAuctionForm.selectedOutcome, selectedParentEscalationClaimDepositIndexes)
	}
	const onMigrateUnresolvedEscalationSubmit = () => {
		setPendingParentEscalationClaimSelection(undefined)
		beginVaultMigrationProgress()
		onMigrateUnresolvedEscalation(forkAuctionForm.selectedOutcome)
	}
	const onWithdrawForkedEscalationSubmit = (outcome: ReportingOutcomeKey) => {
		const selectedDepositIndexes = selectedImportedForkDepositIndexesByOutcome[outcome]
		if (selectedDepositIndexes.length === 0) return
		onWithdrawForkedEscalation(outcome, selectedDepositIndexes)
	}
	function renderSelectedOutcomeChildPoolNotice() {
		return <ForkAuctionOutcomePoolNotice error={selectedAuctionChildPoolRecoveryError} loading={loadingSelectedAuctionChildPoolRecovery} onRetry={retrySelectedAuctionChildPoolRecovery} outcomeLabel={selectedOutcomeLabel} poolAvailable={selectedAuctionChildPool !== undefined} />
	}
	const submitBidAction = renderStageActionButton({
		action: 'submitBid',
		availability: createActionAvailability(submitBidGuardMessage),
		forceEnabled: hasSelectedAuctionChildPool,
		idleLabel: forkAuctionCopy.submitBid,
		onClick: onSubmitBidForSelectedAuction,
		pending: isTruthAuctionDetailsLoading || forkAuctionActiveAction === 'submitBid',
		pendingLabel: isTruthAuctionDetailsLoading ? forkAuctionCopy.loadingTruthAuction : forkAuctionCopy.submittingBidTruncated,
	})
	const submitBidSection = (
		<ForkAuctionSubmitBidSection
			auctionSecurityPoolAddress={auctionSecurityPoolAddress}
			enteredBidAmount={enteredBidAmount}
			enteredBidPrice={enteredBidPrice}
			estimatedAttoRep={estimatedAttoRep}
			onBidAmountChange={submitBidAmount => onForkAuctionFormChange({ submitBidAmount })}
			onBidPriceChange={submitBidPrice => onForkAuctionFormChange({ submitBidPrice })}
			questionTitle={selectedAuctionChildPool?.marketDetails.title ?? previewPool?.marketDetails.title}
			resultingBidBalanceAttoEth={resultingBidBalanceAttoEth}
			selectedAuctionLabel={selectedAuctionLabel}
			submitBidAction={submitBidAction}
			submitBidAmount={forkAuctionForm.submitBidAmount}
			submitBidPreviewPrice={submitBidPreviewTickSummary?.price}
			submitBidPrice={forkAuctionForm.submitBidPrice}
			submittedBidPrice={submittedBidPrice}
		/>
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
	const migrationRepAtForkDisplay = forkAuctionDetails === undefined ? forkOnlyFallbackText : <CurrencyValue value={forkAuctionDetails.auctionableAttoRepAtFork} suffix={commonCopy.rep} />
	const migrationRepDisplay = renderMetricValue(forkAuctionDetails?.migratedAttoRep ?? previewPool?.migratedAttoRep, commonCopy.rep, commonCopy.metricUnavailablePlaceholder)
	const migrationSettlementCollateralDisplay = renderMetricValue(forkAuctionDetails?.settlementCollateralAttoEth ?? previewPool?.settlementCollateralAttoEth, commonCopy.eth, commonCopy.metricUnavailablePlaceholder)
	const migrationStartedDisplay = migrationStartedAt === undefined || migrationStartedAt <= 0n ? forkAuctionCopy.notStarted : <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={migrationStartedAt} />
	const migrationEndsDisplay = (() => {
		if (forkAuctionDetails === undefined) return migrationSummaryText
		if (hasStartedSelectedTruthAuctionTimeline && effectiveTruthAuctionStartedAt !== undefined && effectiveTruthAuctionStartedAt > 0n) {
			return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={effectiveTruthAuctionStartedAt} />
		}
		if (forkAuctionDetails.migrationEndsAt === undefined) return forkAuctionCopy.notStarted

		return <TimestampValue {...(effectiveCurrentTimestamp === undefined ? {} : { currentTimestamp: effectiveCurrentTimestamp })} timestamp={forkAuctionDetails.migrationEndsAt} />
	})()
	const truthAuctionStateBadgeElement = <Badge tone={truthAuctionStateBadge.tone}>{truthAuctionStateBadge.label}</Badge>
	const auctionStatusMetrics: DisplayMetric[] = [
		{ label: forkAuctionCopy.truthAuctionAddress, value: renderAddress(auctionTruthAuctionAddress) },
		{ label: forkAuctionCopy.started, value: startedDisplay },
		{ label: commonCopy.ends, value: endsDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.clearingPrice, value: clearingPriceDisplay },
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.minBidSizeAttoEth, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.minBidSizeAttoEth} suffix={commonCopy.eth} /> },
		{ label: forkAuctionCopy.maxAttoRepBeingSold, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={truthAuctionStatus.maxAttoRepBeingSold} suffix={commonCopy.rep} /> },
	]
	const settlementStatusMetrics: DisplayMetric[] = [
		{ label: AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL, value: selectedAuctionContext === undefined ? truthAuctionFallback : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
		{ label: forkAuctionCopy.settlementAvailable, value: settlementAvailableDisplay },
		{ label: forkAuctionCopy.ethRaisedPerCap, value: ethRaisedCapDisplay },
		{ label: forkAuctionCopy.repPurchasedAttoRep, value: truthAuctionStatus === undefined ? truthAuctionFallback : <CurrencyValue value={displayedRepSoldAttoRep} suffix={commonCopy.rep} /> },
	]
	const auctionOutcomeSelector = (
		<div className='form-grid fork-workflow-outcome-selector'>
			<label className='field'>
				<span>{commonCopy.outcome}</span>
				<div className='fork-workflow-outcome-selector-row'>
					<EnumDropdown options={REPORTING_OUTCOME_DROPDOWN_OPTIONS} value={forkAuctionForm.selectedOutcome} onChange={selectedOutcome => onForkAuctionFormChange({ selectedOutcome })} />
					{renderSelectedOutcomeChildPoolLink()}
				</div>
			</label>
		</div>
	)
	const truthAuctionHero = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionSummaryCard
				auctionedCapacityOwnershipAttoRepDisplay={selectedAuctionContext === undefined ? commonCopy.metricUnavailablePlaceholder : <CurrencyValue value={selectedAuctionContext.auctionedCapacityOwnershipAttoRep} suffix={commonCopy.rep} />}
				badge={truthAuctionStateBadgeElement}
				clearingPriceDisplay={renderTruthAuctionPriceValue(truthAuctionStatus.clearingPrice)}
				displayedEthRaisedAttoEth={displayedEthRaisedAttoEth}
				displayedRepSoldAttoRep={displayedRepSoldAttoRep}
				endsDisplay={endsDisplay}
				attoEthRaiseCap={truthAuctionStatus.attoEthRaiseCap}
				ethRaisedProgress={ethRaisedProgress}
				maxAttoRepBeingSold={truthAuctionStatus.maxAttoRepBeingSold}
				minBidSizeAttoEth={truthAuctionStatus.minBidSizeAttoEth}
				repSoldProgress={repSoldProgress}
				startedDisplay={startedDisplay}
				winningThresholdPriceDisplay={winningThresholdPrice === undefined ? undefined : renderTruthAuctionPriceValue(winningThresholdPrice)}
			/>
		)
	})()
	const migrationSummaryCard = (
		<ForkAuctionMigrationSummaryCard
			badge={migrationStatusBadge}
			forkAuctionDetails={forkAuctionDetails}
			forkTypeDisplay={resolvedForkTypeLabel}
			migratedRepDisplay={migrationRepDisplay}
			migrationEndsDisplay={migrationEndsDisplay}
			migrationStartedDisplay={migrationStartedDisplay}
			repAtForkDisplay={migrationRepAtForkDisplay}
			settlementCollateralDisplay={migrationSettlementCollateralDisplay}
		/>
	)
	const truthAuctionMarketViewSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined
		return (
			<TruthAuctionMarketViewSection
				clearingTick={truthAuctionStatus.clearingTick}
				hasMoreTickSummaries={hasMoreTickSummaries}
				loadingTruthAuctionBook={loadingTruthAuctionBook}
				maxTickAttoEth={maxTickAttoEth}
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
				error={truthAuctionBookError}
				hasLoadedData={hasLoadedTruthAuctionBook && hasLoadedAggregatedAuctionBids}
				hasMoreAggregatedAuctionBids={hasMoreAggregatedAuctionBids}
				loadedTickCount={truthAuctionBookData.tickSummaries.length}
				loadingAggregatedAuctionBids={loadingTruthAuctionBook || loadingAggregatedAuctionBids}
				onLoadNextAuctionBidPage={loadNextAuctionBidPage}
				onRetry={retryPublicTruthAuctionBook}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={retryingPublicTruthAuctionBook}
				rows={auctionBidRows}
			/>
		)
	})()
	const auctionWideBidsStatusSection = <ForkAuctionBidsStatusSection error={selectedAuctionContextError} loading={isTruthAuctionDetailsLoading} onRetry={retrySelectedAuctionDetails} retrying={retryingSelectedAuctionDetails} />
	const viewerTruthAuctionBidsSection = (() => {
		if (!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined) return undefined

		return (
			<ViewerTruthAuctionBidsSection
				accountAddress={accountState.address}
				error={viewerTruthAuctionBidsError}
				hasLoadedData={hasLoadedViewerTruthAuctionBids}
				hasMoreViewerBids={hasMoreViewerBids}
				loadingTruthAuctionBook={loadingViewerTruthAuctionBids}
				onLoadNextViewerBidPage={loadNextViewerBidPage}
				onRetry={retryViewerTruthAuctionBids}
				onSettlementBidSelectionChange={onSettlementBidSelectionChange}
				renderPriceValue={renderTruthAuctionPriceValue}
				retrying={retryingViewerTruthAuctionBids}
				rows={viewerBidRows}
				showSettlementActionColumn={showViewerSettlementActionColumn}
			/>
		)
	})()
	const settlementSelectionSummary = renderTruthAuctionSettlementSelectionSummary({
		estimatedAssignedCapacityOwnershipAttoRep: settlementSelectionEstimate.estimatedAssignedCapacityOwnershipAttoRep,
		estimatedRefundedAttoEth: settlementSelectionEstimate.estimatedRefundedAttoEth,
		estimatedVaultRepBackingAttoRep: settlementSelectionEstimate.estimatedVaultRepBackingAttoRep,
		selectedClaimCount: selectedClaimSettlementBidRows.length,
		selectedRefundCount: selectedRefundSettlementBidRows.length,
		selectedRowCount: selectedSettlementBidRows.length,
	})
	const settlementActionButton = renderStageActionButton({
		action: settlementAction,
		availability: createActionAvailability(settlementActionAvailabilityMessage),
		forceEnabled: hasSelectedAuctionChildPool,
		idleLabel: settlementActionLabel,
		onClick: onSettleSelectedBidsForSelectedAuction,
		pendingLabel: settlementActionPendingLabel,
		pending: isSettleSelectedBidsInProgress,
		tone: 'primary',
	})
	const truthAuctionSettlementSection =
		!shouldShowTruthAuctionVisualization || truthAuctionStatus === undefined ? undefined : (
			<ForkAuctionSettlementActionSection actionButton={settlementActionButton} description={settlementActionDescription} selectionSummary={settlementSelectionSummary} showRefundOnlyNotice={showRefundOnlySettlementCapacityOwnershipNotice} title={settlementActionLabel} />
		)
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
						idleLabel: forkAuctionCopy.formatSettleSelectedValueForkCarriedDeposits(sideLabel),
						onClick: () => onWithdrawForkedEscalationSubmit(outcome),
						pendingLabel: forkAuctionCopy.settlingForkCarriedDepositsTruncated,
						tone: 'secondary',
					})
				}
				resolved={importedForkSettlementResolved}
				selectedDepositIndexesByOutcome={selectedImportedForkDepositIndexesByOutcome}
				sides={importedForkSettlementSides}
				winningOutcome={activeReportingDetails?.questionOutcome === 'none' ? undefined : activeReportingDetails?.questionOutcome}
			/>
		)
	})()
	const forkWorkflowStageNavigator = !hasLoadedPoolContext ? undefined : <ForkWorkflowStageNavigator currentStage={currentWorkflowStage} onStageChange={onSelectedStageViewChange} selectedStage={selectedStage} />
	const startTruthAuctionAction = renderStageActionButton({
		action: 'startTruthAuction',
		availability: createActionAvailability(!hasSelectedAuctionChildPool ? forkAuctionCopy.formatMissingChildUniverseDetail(selectedAuctionLabel) : startTruthAuctionAvailabilityMessage),
		forceEnabled: hasSelectedAuctionChildPool,
		idleLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startTruthAuction : forkAuctionCopy.bypassTruthAuction,
		onClick: onStartTruthAuctionSubmit,
		pendingLabel: truthAuctionBypassReason === undefined ? forkAuctionCopy.startingTruthAuction : forkAuctionCopy.bypassingAuctionTruncated,
		tone: 'primary',
	})
	const startTruthAuctionSection = <ForkAuctionStartSection actionButton={startTruthAuctionAction} bypassReason={truthAuctionBypassReason} readyInText={startTruthAuctionReadyInText} />
	const stagePanel = (() => {
		if (selectedStage === 'fork-triggered') return <ForkTriggeredStage currentTimestamp={effectiveCurrentTimestamp} disabled={disabled} hasTriggeredFork={hasTriggeredFork} universeForkTime={universeForkTime} />
		if (selectedStage === 'migration')
			return (
				<ForkAuctionMigrationStage
					accountConnected={accountState.address !== undefined}
					activeReportingDetails={activeReportingDetails}
					claimParentDepositsGuardMessage={claimSelectedParentEscalationDepositsGuardMessage}
					claimSelectionDisabled={forkAuctionActiveAction === 'claimParentEscalationDeposits'}
					connectedWalletVaultSummary={connectedWalletVaultSummary}
					disabled={disabled}
					hasSelectedParentEscalationClaimDeposits={hasSelectedParentEscalationClaimDeposits}
					hasStoredEscalationMigrationEntitlement={hasStoredEscalationMigrationEntitlement}
					hasUnresolvedMigrationDeposits={hasUnresolvedMigrationDeposits}
					hasUnresolvedMigrationState={hasUnresolvedMigrationState}
					hasWalletParentEscalationClaimBalance={hasWalletParentEscalationClaimBalance}
					hasWalletVaultMigrationBalance={hasWalletVaultMigrationBalance}
					isMigrationExpired={isMigrationExpired}
					isVaultMigrationComplete={isVaultMigrationComplete}
					loadingReportingDetails={loadingReportingDetails}
					loadingSelectedOutcomeMigrationSeedStatus={loadingSelectedOutcomeMigrationSeedStatus}
					migratePoolGuardMessage={migratePoolToUniverseGuardMessage}
					migrateUnresolvedGuardMessage={migrateUnresolvedEscalationGuardMessage}
					migrateVaultGuardMessage={migrateVaultGuardMessage}
					migrationBalancesContent={migrationBalancesContent}
					migrationSummaryCard={migrationSummaryCard}
					onClaimParentDeposits={onClaimSelectedParentEscalationDeposits}
					onMigratePool={onMigrateSelectedOutcomeRepToZoltar}
					onMigrateUnresolved={onMigrateUnresolvedEscalationSubmit}
					onMigrateVault={onMigrateVaultSubmit}
					onParentDepositSelectionChange={setSelectedParentEscalationClaimDepositIndexes}
					renderAction={renderStageActionButton}
					reportingDetails={reportingDetails}
					retrySelectedOutcomeMigrationSeedStatus={retrySelectedOutcomeMigrationSeedStatus}
					selectedOutcome={forkAuctionForm.selectedOutcome}
					selectedOutcomeLabel={selectedOutcomeLabel}
					selectedOutcomeMigrationSeedStatus={selectedOutcomeMigrationSeedStatus}
					selectedOutcomeMigrationSeedStatusError={selectedOutcomeMigrationSeedStatusError}
					selectedParentEscalationClaimDeposits={selectedParentEscalationClaimDeposits}
					selectedParentEscalationClaimDepositIndexes={selectedParentEscalationClaimDepositIndexes}
					selectedStageAheadMessage={selectedStageAheadMessage}
				/>
			)

		return (
			<ForkAuctionOutcomeStage
				auctionOutcomeSelector={auctionOutcomeSelector}
				auctionStatusMetrics={auctionStatusMetrics}
				auctionWideBidsSection={auctionWideBidsSection}
				auctionWideBidsStatusSection={auctionWideBidsStatusSection}
				childSecurityPools={childSecurityPools}
				disabled={disabled}
				hasStartedTruthAuction={hasStartedTruthAuction}
				importedForkSettlementSection={importedForkSettlementSection}
				renderSelectedOutcomeChildPoolNotice={renderSelectedOutcomeChildPoolNotice}
				selectedStage={selectedStage}
				selectedStageAheadMessage={selectedStageAheadMessage}
				settlementStatusMetrics={settlementStatusMetrics}
				shouldShowVisualization={shouldShowTruthAuctionVisualization}
				startTruthAuctionSection={startTruthAuctionSection}
				submitBidSection={submitBidSection}
				truthAuctionEndedNotice={truthAuctionEndedNotice}
				truthAuctionHero={truthAuctionHero}
				truthAuctionMarketViewSection={truthAuctionMarketViewSection}
				truthAuctionSettlementSection={truthAuctionSettlementSection}
				truthAuctionStateBadgeElement={truthAuctionStateBadgeElement}
				viewerTruthAuctionBidsSection={viewerTruthAuctionBidsSection}
			/>
		)
	})()
	return (
		<ForkAuctionWorkflowShell
			embedInCard={embedInCard}
			forkAuctionDetailsAvailable={forkAuctionDetails !== undefined}
			forkAuctionError={forkAuctionError}
			loadingForkAuctionDetails={loadingForkAuctionDetails}
			loadingReportingDetails={loadingReportingDetails}
			onLoadForkAuction={onLoadForkAuction}
			onLoadReporting={onLoadReporting}
			reportingError={reportingError}
			securityPoolAddress={securityPoolAddress}
			showHeader={showHeader}
		>
			{!showSecurityPoolAddressInput && hasLoadedPoolContext ? undefined : (
				<div className='form-grid'>
					{!showSecurityPoolAddressInput ? undefined : <LookupFieldRow label={commonCopy.securityPoolAddress} value={forkAuctionForm.securityPoolAddress} onInput={securityPoolAddress => onForkAuctionFormChange({ securityPoolAddress })} placeholder={commonCopy.hexValuePlaceholder} />}
					{hasLoadedPoolContext ? undefined : <p className='detail'>{forkAuctionCopy.forkWorkflowDescription}</p>}
				</div>
			)}
			{forkWorkflowStageNavigator}
			{hasLoadedPoolContext ? stagePanel : undefined}
		</ForkAuctionWorkflowShell>
	)
}
