import { useState } from 'preact/hooks'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { getCurrentSelectedPoolForkAuctionDetails, getForkWorkflowStageSelection } from '../../security-pools/lib/securityPoolWorkflow.js'
import { useSelectedAuctionReadState } from './useSelectedAuctionReadState.js'
import type { ForkAuctionSectionProps } from '../../types.js'
import { getForkOnlyFallbackText, getForkTypeLabel, getForkWorkflowStageAheadMessage, getPreviewForkTypeLabel, getPreviewMigrationSummary, isFullReadClient } from '../components/ForkAuctionPresentation.js'

export function useForkAuctionContext(props: ForkAuctionSectionProps) {
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
		onWithdrawAuctionRefund,
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
	const [pendingEthRefundAttoEth, setPendingEthRefundAttoEth] = useState<bigint | undefined>(undefined)
	const [loadingPendingEthRefund, setLoadingPendingEthRefund] = useState(false)
	const [pendingEthRefundError, setPendingEthRefundError] = useState<string | undefined>(undefined)
	const [pendingEthRefundRetryNonce, setPendingEthRefundRetryNonce] = useState(0)
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
	return {
		accountState,
		auctionTruthAuctionAddress,
		setPendingEthRefundAttoEth,
		setLoadingPendingEthRefund,
		setPendingEthRefundError,
		truthAuctionReadClient,
		forkAuctionResult,
		pendingEthRefundRetryNonce,
		selectedPoolRefreshNonce,
		selectedAuctionError,
		auctionSecurityPoolAddress,
		effectiveCurrentTimestamp,
		forkAuctionDetails,
		selectedAuctionContext,
		auctionHasStartedAtValue,
		connectedWalletVaultSummary,
		forkAuctionActiveAction,
		forkAuctionError,
		reportingDetails,
		securityPoolAddress,
		selectedAuctionPoolAddress,
		forkAuctionForm,
		reportingForm,
		selectedAuctionChildPool,
		onForkAuctionFormChange,
		selectedOutcomeMigrationChildPool,
		selectedOutcomeMigrationChildVault,
		securityPools,
		auctionTruthAuctionStatus,
		hasSelectedAuctionChildPool,
		forkOnlyFallbackText,
		selectedStage,
		currentWorkflowStage,
		onClaimAuctionProceeds,
		onRefundLosingBids,
		selectedAuctionUniverseId,
		isOnActiveAppChain,
		currentStage,
		disabled,
		lifecycleStateOverride,
		previewPool,
		questionOutcome,
		systemState,
		onReportingFormChange,
		loadingReportingDetails,
		selectedOutcomeLabel,
		loadingSelectedOutcomeMigrationSeedStatus,
		selectedOutcomeMigrationSeedStatusError,
		selectedOutcomeMigrationSeedStatus,
		onStartTruthAuction,
		onSubmitBid,
		onFinalizeTruthAuction,
		onMigrateVault,
		onMigrateRepToZoltar,
		onClaimParentEscalationDeposits,
		onMigrateUnresolvedEscalation,
		onWithdrawForkedEscalation,
		selectedAuctionChildPoolRecoveryError,
		loadingSelectedAuctionChildPoolRecovery,
		retrySelectedAuctionChildPoolRecovery,
		selectedAuctionLabel,
		universeForkTime,
		migrationSummaryText,
		loadingPendingEthRefund,
		pendingEthRefundAttoEth,
		resolvedForkTypeLabel,
		retrySelectedAuctionDetails,
		retryingSelectedAuctionDetails,
		pendingEthRefundError,
		onWithdrawAuctionRefund,
		setPendingEthRefundRetryNonce,
		hasLoadedPoolContext,
		onSelectedStageViewChange,
		hasTriggeredFork,
		retrySelectedOutcomeMigrationSeedStatus,
		selectedStageAheadMessage,
		embedInCard,
		loadingForkAuctionDetails,
		onLoadForkAuction,
		onLoadReporting,
		reportingError,
		showHeader,
		showSecurityPoolAddressInput,
	}
}
