import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { ForkAuctionSection } from '../../truth-auctions/components/ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '@zoltar/ui-core-shared/components/Question.js'
import { ReportingSection } from '@zoltar/ui-zoltar/features/reporting/components/ReportingSection.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { getQueuedVaultOperation } from './SecurityVaultSection.js'
import { StickyObjectContext } from '@zoltar/ui-core-shared/components/StickyObjectContext.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TradingSection } from '../../markets/components/TradingSection.js'
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import {
	applySelectedPoolWorkflowState,
	getCurrentSelectedPoolReportingDetails,
	getCurrentSelectedPoolForkAuctionDetails,
	getCurrentForkWorkflowSelectionStage,
	getCurrentPoolOracleManagerDetails,
	getCurrentSelectedPoolForkStage,
	hasCurrentSelectedPoolForkActivity,
	getSelectedPoolCardTitle,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolViewForForkWorkflowSelectionStage,
	getSelectedPoolViewLabel,
	getSelectedPoolWorkflowGuardMessage,
	getSelectedPoolWorkflowLockedPresentation,
	isSelectedPoolForkWorkflowView,
	isForkWorkflowDisabled,
	resolveForkWorkflowSelectionStage,
	resolveSelectedPoolView,
	SELECTED_POOL_PRIMARY_VIEWS,
	SELECTED_POOL_SECONDARY_VIEWS,
	SELECTED_POOL_VIEWS,
	shouldReloadSelectedPoolDetails,
	shouldShowSelectedPoolWorkflowDetails,
} from '../lib/securityPoolWorkflow.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { getReportingLockedUntilMessage, hasReportingOpened } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import { addOpenOracleBountyBuffer } from '@zoltar/ui-zoltar/features/open-oracle/lib/openOracle.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultOwner, isOracleManagerPriceUsable, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { formatUniverseIdHex } from '@zoltar/ui-zoltar/features/universes/lib/universe.js'
import { useForkWorkflowSelectionState } from '../../truth-auctions/hooks/useForkWorkflowSelectionState.js'
import { useSelectedVaultWorkflowState, type SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import { buildSelectedPoolSummaryPool, getSecurityPoolStatusBadgeTone } from './SecurityPoolWorkflowPresentation.js'
import { SecurityPoolPriceOracleSection, SecurityPoolRequestPriceModal, SecurityPoolStagedOperationsSection, type RequestPriceReview } from './SecurityPoolOracleSections.js'
import { SecurityPoolVaultWorkspace } from './SecurityPoolVaultWorkspace.js'

export function SecurityPoolWorkflowSection({
	accountState,
	activeUniverseId,
	checkedSecurityPoolAddress,
	closeLiquidationModal,
	forkAuction,
	liquidationDebtEthAmount,
	maximumLiquidationDebtAttoEth,
	liquidationManagerAddress,
	liquidationFundingPreview,
	liquidationFundingPreviewError,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	liquidationReceiverVault,
	liquidationApprovalId,
	liquidationApprovalDetails,
	liquidationApprovalError,
	liquidationReceiverVaultSummary,
	liquidationReceiverVaultSummaryError,
	liquidationReceiverVaultSummaryResolved,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingLiquidationFundingPreview,
	loadingLiquidationApproval,
	loadingLiquidationReceiverVaultSummary,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLiquidationReceiverVaultChange,
	onLiquidationApprovalIdChange,
	onLoadLiquidationApproval,
	onLoadLiquidationReceiverVaultSummary,
	onLiquidationTimeoutMinutesChange,
	onLoadPoolOracleManager,
	onBrowsePools,
	onCreatePool,
	onLoadLiquidationFundingPreview,
	onOpenLiquidationModal,
	onReturnToCurrentUniverse,
	onSwitchToPoolUniverse,
	onQueueLiquidation,
	onExecutePendingPoolOperation,
	onRefreshSelectedPoolData,
	onRequestPoolPrice,
	onViewPendingReport,
	poolOracleActiveAction,
	poolOracleManagerDetails,
	poolOracleManagerError,
	poolOracleManagerErrorAddress,
	poolPriceOracleResult,
	universeForkTime,
	selectedPoolRefreshNonce,
	onSecurityPoolAddressChange,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	reporting,
	selectedPoolView,
	securityPoolOverviewActiveAction,
	securityPoolOverviewError,
	securityPoolLiquidationError,
	securityPoolOverviewResult,
	securityPoolAddress,
	securityPools,
	securityVault,
	initialVaultView,
	onSelectedPoolViewChange,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & {
	initialVaultView?: SelectedVaultView
	showHeader?: boolean
}) {
	const view = resolveSelectedPoolView(selectedPoolView)
	const legacyForkWorkflowSelectionStage = resolveForkWorkflowSelectionStage(selectedPoolView)
	const chainCurrentTimestamp = useChainTimestamp()
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [requestPriceReview, setRequestPriceReview] = useState<RequestPriceReview | undefined>(undefined)
	const lastHandledReportingRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastHandledForkAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastForkAuctionAutoLoadKey = useRef<string | undefined>(undefined)
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
	const normalizedReportingFormPoolAddress = normalizeAddress(reporting.reportingForm.securityPoolAddress)
	const loadedReportingDetails = sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? reporting.reportingDetails : undefined
	const currentReportingDetails = getCurrentSelectedPoolReportingDetails({
		reportingDetails: loadedReportingDetails,
		selectedPool,
	})
	const loadedForkAuctionDetails = sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? forkAuction.forkAuctionDetails : undefined
	const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({
		forkAuctionDetails: loadedForkAuctionDetails,
		selectedPool,
	})
	const selectedPoolLookupState = resolveRequestedLoadableValueState({
		currentKey: normalizeAddress(securityPoolAddress),
		isLoading: loadingSecurityPools,
		resolvedKey: checkedSecurityPoolAddress,
		value: selectedPool,
	})
	const marketDetails = selectedPool?.marketDetails ?? currentReportingDetails?.marketDetails ?? currentForkAuctionDetails?.marketDetails
	const selectedPoolState = currentForkAuctionDetails?.systemState ?? selectedPool?.systemState
	const selectedPoolQuestionOutcome = currentForkAuctionDetails?.questionOutcome ?? currentReportingDetails?.questionOutcome ?? selectedPool?.questionOutcome
	const effectiveSelectedPool = applySelectedPoolWorkflowState(selectedPool, {
		questionOutcome: selectedPoolQuestionOutcome,
		systemState: selectedPoolState,
	})
	const currentTimestamp = chainCurrentTimestamp ?? currentReportingDetails?.currentTime ?? currentForkAuctionDetails?.currentTime
	const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, currentTimestamp)
	const selectedPoolReportingStage = deriveSecurityPoolReportingStage({
		reportingDetails: currentReportingDetails,
		reportingReady,
	})
	const selectedPoolHasActualForkActivity = currentForkAuctionDetails?.hasForkActivity ?? selectedPool?.hasForkActivity ?? false
	const selectedPoolLifecycleState =
		selectedPoolReportingStage === 'forkTriggered' && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'
			? 'poolForked'
			: deriveSecurityPoolLifecycleState({
					hasForkActivity: selectedPoolHasActualForkActivity,
					isChildPool: effectiveSelectedPool !== undefined && effectiveSelectedPool.parent !== zeroAddress,
					questionOutcome: selectedPoolQuestionOutcome,
					systemState: selectedPoolState,
					universeHasForked: effectiveSelectedPool?.universeHasForked,
				})
	const selectedPoolStateModel = evaluateSecurityPoolState({
		lifecycleState: selectedPoolLifecycleState,
		reportingStage: selectedPoolReportingStage,
		universeHasForked: effectiveSelectedPool?.universeHasForked === true,
	})
	const triggerZoltarForkReason = (() => {
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolHasActualForkActivity) {
			return securityPoolCopy.forkAlreadyTriggeredSettlementReason
		}
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolState !== 'operational') {
			return securityPoolCopy.poolForkMigrationStatus
		}
		return securityPoolCopy.forkTriggerUnavailableReason
	})()
	const triggerZoltarForkAvailability = {
		disabled: !(selectedPoolReportingStage === 'forkTriggered' && !selectedPoolHasActualForkActivity && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'),
		reason: triggerZoltarForkReason,
	}
	const selectedPoolHasForkActivity = (() => {
		if (selectedPoolReportingStage === 'forkTriggered') return true
		return selectedPoolHasActualForkActivity
	})()
	const selectedPoolForkWorkflowSystemState = selectedPoolLifecycleState === undefined || selectedPoolLifecycleState === 'ended' ? selectedPoolState : selectedPoolLifecycleState
	const reportingLockedReason = (() => {
		if (selectedPoolState === 'poolForked') return securityPoolCopy.parentForkMigrationRedirectDetail
		if (selectedPoolState === 'forkMigration') return securityPoolCopy.reportingLockedDuringMigrationReason
		if (selectedPoolState === 'forkTruthAuction') return securityPoolCopy.reportingLockedDuringAuctionReason
		if (reportingReady) return undefined
		if (marketDetails === undefined) return securityPoolCopy.reportingStartDetail

		return getReportingLockedUntilMessage(marketDetails.endTime, currentTimestamp)
	})()
	const forkWorkflowDisabled = isForkWorkflowDisabled(selectedPoolState, selectedPoolHasForkActivity)
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const showSelectedPoolWorkflowDetails = shouldShowSelectedPoolWorkflowDetails({
		hasSelectedPoolAddress,
		selectedPoolExists: selectedPool !== undefined,
		selectedPoolUniverseMismatch,
	})
	const currentForkStage = getCurrentSelectedPoolForkStage({
		forkAuctionDetails: currentForkAuctionDetails,
		selectedPool:
			selectedPool === undefined || selectedPoolForkWorkflowSystemState === undefined
				? selectedPool
				: {
						...selectedPool,
						systemState: selectedPoolForkWorkflowSystemState,
					},
	})
	const currentForkWorkflowSelectionStage = getCurrentForkWorkflowSelectionStage({
		claimingAvailable: currentForkAuctionDetails?.claimingAvailable ?? false,
		currentForkStage,
		hasForkActivity: hasCurrentSelectedPoolForkActivity({
			forkAuctionDetails: currentForkAuctionDetails,
			selectedPool,
		}),
		systemState: currentForkAuctionDetails?.systemState ?? selectedPoolForkWorkflowSystemState,
		truthAuctionFinalized: currentForkAuctionDetails?.truthAuction?.finalized ?? false,
	})
	const { forkWorkflowSelectionStage, onForkWorkflowSelectionStageChange } = useForkWorkflowSelectionState({
		currentForkWorkflowSelectionStage,
		legacyForkWorkflowSelectionStage,
		onSelectedStageViewChange: stage => onSelectedPoolViewChange(getSelectedPoolViewForForkWorkflowSelectionStage(stage)),
		selectedPoolAddress: selectedPool?.securityPoolAddress,
		view,
	})
	const openSelectedPoolForkWorkflow = selectedPoolHasActualForkActivity ? () => onSelectedPoolViewChange('fork-workflow') : undefined
	const shouldRefreshSelectedPoolReporting =
		showSelectedPoolWorkflowDetails && (sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) || (view === 'reporting' && normalizedSelectedPoolAddress !== undefined && normalizedReportingFormPoolAddress === normalizedSelectedPoolAddress))
	const selectedPoolWorkflowGuardMessage = getSelectedPoolWorkflowGuardMessage({
		hasSelectedPoolAddress,
		selectedPoolLookupState,
		selectedPoolUniverseMismatch,
	})
	const selectedPoolWorkflowLockedPresentation = showSelectedPoolWorkflowDetails
		? undefined
		: getSelectedPoolWorkflowLockedPresentation({
				hasSelectedPoolAddress,
				selectedPoolLookupState,
				selectedPoolUniverseMismatch,
			})
	const selectedVaultViewOptions: ViewTabOption<SelectedVaultView>[] = [
		{ label: securityPoolCopy.directory, value: 'browse-vaults' },
		{ label: commonCopy.selected, value: 'selected-vault' },
	]
	const selectedPoolManagerAddress = selectedPool?.managerAddress
	const currentPoolOracleManagerError = selectedPoolManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, selectedPoolManagerAddress) ? poolOracleManagerError : undefined
	const liquidationPoolOracleManagerError = liquidationManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, liquidationManagerAddress) ? poolOracleManagerError : undefined
	const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({
		poolOracleManagerDetails,
		selectedPoolManagerAddress,
	})
	const selectedVaultOwnerInput = securityVault.securityVaultForm.selectedVaultOwner ?? ''
	const selectedVaultOwner = getSelectedVaultOwner(selectedVaultOwnerInput, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultOwnerInput, accountState.address)
	const selectedVaultSecurityPoolAddress = securityVault.securityVaultForm.securityPoolAddress.trim()
	const selectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: selectedPool?.securityPoolAddress,
		securityVaultDetails: securityVault.securityVaultDetails,
		selectedVaultOwner: selectedVaultOwnerInput,
	})
		? securityVault.securityVaultDetails
		: undefined
	const selectedVaultExistsOnchain = doesSecurityVaultExistOnchain(selectedVaultDetails)
	const currentSecurityVaultResult = selectedVaultDetails === undefined ? undefined : securityVault.securityVaultResult
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const { setVaultView, vaultView } = useSelectedVaultWorkflowState({
		accountAddress: accountState.address,
		hasLoadedCurrentVault,
		initialVaultView,
		loadingSecurityVault: securityVault.loadingSecurityVault,
		onLoadSecurityVault: securityVault.onLoadSecurityVault,
		onSecurityVaultFormChange: securityVault.onSecurityVaultFormChange,
		selectedPoolAddress: selectedPool?.securityPoolAddress,
		selectedVaultOwner,
		selectedVaultOwnerInput: securityVault.securityVaultForm.selectedVaultOwner,
		selectedVaultSecurityPoolAddress,
		showSelectedPoolWorkflowDetails,
		view,
	})
	const lastReportingAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const lastVaultStatusRefreshHash = useRef<string | undefined>(undefined)
	const lastQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastImmediateQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastLiquidationOutcomeRefreshKey = useRef<string | undefined>(undefined)
	const lastExecutedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastForkAuctionOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const queuedVaultOperation = getQueuedVaultOperation({
		pendingOperation: currentPoolOracleManagerDetails?.pendingOperation,
		selectedVaultOwner,
		securityVaultResult: currentSecurityVaultResult,
	})
	const liquidationNoticeState = getLiquidationNoticeState({
		currentTimestamp,
		currentPoolOracleManagerDetails,
		liquidationTargetVault,
		loadingPoolOracleManager,
		securityPoolOverviewResult,
	})
	const loadedSelectedPool = effectiveSelectedPool
	const selectedPoolSummaryPool = buildSelectedPoolSummaryPool({
		forkAuctionDetails: currentForkAuctionDetails,
		selectedPool: loadedSelectedPool,
	})
	const selectedPoolParentPool = selectedPoolSummaryPool === undefined || selectedPoolSummaryPool.parent === zeroAddress ? undefined : securityPools.find(pool => sameAddress(pool.securityPoolAddress, selectedPoolSummaryPool.parent))
	const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool)
	const currentPoolOraclePrice = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice
	const currentPoolOracleSettlementTimestamp = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp
	const currentPoolOraclePriceUsable = currentPoolOracleManagerDetails === undefined ? undefined : isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)
	const requestPriceTransactionEthValue = currentPoolOracleManagerDetails === undefined ? undefined : addOpenOracleBountyBuffer(currentPoolOracleManagerDetails.requestPriceCostAttoEth)
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isOnActiveAppChain,
		isPriceValid: currentPoolOraclePriceUsable,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requiredCostAttoEth: currentPoolOracleManagerDetails?.requestPriceCostAttoEth,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const requestPriceOpenGuardMessage = requestPriceTransactionEthValue === undefined ? securityPoolCopy.loadOracleBeforePriceReview : requestPriceGuardMessage
	const requestPriceConfirmationGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		bufferRequiredEthCost: false,
		hasLoadedSelectedPool: requestPriceReview !== undefined,
		isOnActiveAppChain,
		isPriceValid: currentPoolOraclePriceUsable,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requiredCostAttoEth: requestPriceReview?.requestValueAttoEth,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const selectedPendingOperationId = currentPoolOracleManagerDetails?.pendingOperationSlotId ?? 0n
	const reportingOracleGuardMessage = (() => {
		if (reportingLockedReason !== undefined) return undefined
		if (!selectedPoolStateModel.actions.reportOutcome.enabled) return undefined
		if ((loadedSelectedPool?.totalCapacityOwnershipAttoRep ?? 0n) === 0n) return undefined
		if (currentPoolOracleManagerDetails === undefined || currentPoolOraclePriceUsable === true) return undefined
		return currentPoolOracleManagerDetails.lastSettlementTimestamp > 0n ? securityPoolCopy.reportingOraclePriceExpiredReason : securityPoolCopy.reportingOraclePriceRequiredReason
	})()
	const liquidationEnabled = selectedPoolStateModel.actions.queueLiquidation.enabled
	const pendingOperationInput = (() => {
		if (manualPendingOperationId.trim() !== '') return manualPendingOperationId.trim()
		if (selectedPendingOperationId > 0n) return selectedPendingOperationId.toString()

		return ''
	})()
	const resolvedPendingOperationId = pendingOperationInput === '' ? undefined : tryParseBigIntInput(pendingOperationInput)
	const executePendingOperationGuardMessage = getVaultExecutePendingOperationGuardMessage({
		accountAddress: accountState.address,
		hasLoadedOracleManager: currentPoolOracleManagerDetails !== undefined,
		isOnActiveAppChain,
		isPriceValid: currentPoolOraclePriceUsable,
		resolvedPendingOperationId,
	})
	const pendingOperation = currentPoolOracleManagerDetails?.pendingOperation
	const canUseOracleActions = accountState.address !== undefined && isOnActiveAppChain
	const stagedOperations = currentPoolOracleManagerDetails?.stagedOperations ?? (pendingOperation === undefined ? [] : [pendingOperation])
	const pendingSettlementOperationIds = currentPoolOracleManagerDetails?.pendingSettlementOperationIds ?? []
	const activeStagedOperationCount = currentPoolOracleManagerDetails?.activeStagedOperationCount ?? BigInt(stagedOperations.length)
	const selectedPoolBrowsePresentation = selectedPool === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined
	const selectedVaultLoadNotice = (() => {
		if (securityVault.loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>{securityPoolCopy.loadingVault}</LoadingText>
				</p>
			)
		if (securityVault.securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: securityPoolCopy.invalidVaultAddressHint }} />

		return undefined
	})()
	let selectedPoolSummaryContent: ComponentChildren
	if (selectedPoolSummaryPool === undefined) {
		selectedPoolSummaryContent = undefined
	} else if (view === 'vaults' || view === 'trading') {
		selectedPoolSummaryContent = (
			<div className='selected-pool-context-summary selected-pool-context-summary-hero selected-pool-context-summary-hero-compact'>
				<div className='selected-pool-context-overview'>
					<div className='selected-pool-hero-story'>
						<div className='selected-pool-hero-story-title-row'>
							<div className='security-pool-card-title-row'>
								<span className='security-pool-card-title-copy'>{marketDetails === undefined ? '' : getQuestionTitle(marketDetails)}</span>
							</div>
						</div>
						{marketDetails === undefined ? null : <Question className='selected-pool-hero-question' question={marketDetails} variant='preview' showTitle={false} />}
					</div>
					<SecurityPoolSummaryMetrics
						className='selected-pool-context-grid'
						currentTimestamp={currentTimestamp}
						pool={{
							...selectedPoolSummaryPool,
							lastOraclePrice: currentPoolOraclePrice ?? selectedPoolSummaryPool.lastOraclePrice,
							lastOracleSettlementTimestamp: currentPoolOracleSettlementTimestamp ?? selectedPoolSummaryPool.lastOracleSettlementTimestamp,
						}}
						showTotalBacking
						variant='hero'
					>
						{selectedPoolSummaryPool.parent === zeroAddress ? undefined : (
							<MetricField label={securityPoolCopy.parentPool}>
								<SecurityPoolLink securityPoolAddress={selectedPoolSummaryPool.parent} selectedPoolView={selectedPoolView} universeId={selectedPoolParentPool?.universeId} />
							</MetricField>
						)}
						{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
							<MetricField label={securityPoolCopy.pendingRequest}>
								<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
									{securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString())}
								</button>
							</MetricField>
						)}
					</SecurityPoolSummaryMetrics>
				</div>
			</div>
		)
	} else {
		selectedPoolSummaryContent = (
			<div className='selected-pool-context-summary'>
				<div className='selected-pool-context-overview'>
					<SecurityPoolSummaryMetrics metricVariant='context' pool={selectedPoolSummaryPool} showTotalBacking>
						{selectedPoolSummaryPool.parent === zeroAddress ? undefined : (
							<MetricField label={securityPoolCopy.parentPool}>
								<SecurityPoolLink securityPoolAddress={selectedPoolSummaryPool.parent} selectedPoolView={selectedPoolView} universeId={selectedPoolParentPool?.universeId} />
							</MetricField>
						)}
						<MetricField label={commonCopy.openOraclePrice} valueTagName='span'>
							<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={currentPoolOraclePrice} lastSettlementTimestamp={currentPoolOracleSettlementTimestamp ?? 0n} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
						</MetricField>
						{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
							<MetricField label={securityPoolCopy.pendingRequest}>
								<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
									{securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString())}
								</button>
							</MetricField>
						)}
					</SecurityPoolSummaryMetrics>
				</div>
				{marketDetails === undefined ? undefined : (
					<SectionBlock headingLevel={3} title={commonCopy.question} variant='embedded'>
						<Question question={marketDetails} />
					</SectionBlock>
				)}
			</div>
		)
	}
	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (sameAddress(poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress)) return
		if (loadingPoolOracleManager) return
		if (currentPoolOracleManagerError !== undefined) return
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [currentPoolOracleManagerError, loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress])
	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (loadingPoolOracleManager) return
		const queuedOperationHash = (() => {
			if (securityVault.securityVaultResult?.action === 'queueWithdrawRep') return securityVault.securityVaultResult.hash
			if (securityPoolOverviewResult?.action === 'queueLiquidation') return securityPoolOverviewResult.hash

			return undefined
		})()
		if (queuedOperationHash === undefined) {
			lastQueuedOperationRefreshHash.current = undefined
			return
		}
		if (lastQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastQueuedOperationRefreshHash.current = queuedOperationHash
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [loadingPoolOracleManager, onLoadPoolOracleManager, securityPoolOverviewResult, securityVault.securityVaultResult, selectedPoolManagerAddress])
	useEffect(() => {
		const shouldAutoloadReportingForFork = view === 'fork-workflow'
		const shouldAutoloadReportingForCurrentView = view === 'reporting' || shouldAutoloadReportingForFork
		if (!shouldAutoloadReportingForCurrentView || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
			lastReportingAutoLoadKey.current = undefined
			return
		}
		if (normalizedReportingFormPoolAddress === undefined || normalizedReportingFormPoolAddress !== normalizedSelectedPoolAddress) return
		if (reporting.loadingReportingDetails) return
		const shouldReloadReporting = shouldReloadSelectedPoolDetails({
			currentDetailsAvailable: currentReportingDetails !== undefined,
			lastHandledRefreshNonce: lastHandledReportingRefreshNonceRef.current,
			loadedDetailsAddress: loadedReportingDetails?.securityPoolAddress,
			refreshNonce: selectedPoolRefreshNonce,
			selectedPoolAddress: normalizedSelectedPoolAddress,
		})
		if (!shouldReloadReporting && sameAddress(loadedReportingDetails?.securityPoolAddress, normalizedSelectedPoolAddress) && currentReportingDetails !== undefined) return
		const reportingAutoLoadKey = `${normalizedSelectedPoolAddress}:${normalizedReportingFormPoolAddress}:${selectedPoolRefreshNonce}`
		if (lastReportingAutoLoadKey.current === reportingAutoLoadKey) return
		lastReportingAutoLoadKey.current = reportingAutoLoadKey
		lastHandledReportingRefreshNonceRef.current = selectedPoolRefreshNonce
		void reporting.onLoadReporting()
	}, [
		normalizedReportingFormPoolAddress,
		normalizedSelectedPoolAddress,
		currentReportingDetails,
		loadedReportingDetails?.securityPoolAddress,
		reporting.loadingReportingDetails,
		reporting.onLoadReporting,
		reportingReady,
		selectedPoolRefreshNonce,
		selectedPoolHasActualForkActivity,
		selectedPoolQuestionOutcome,
		selectedPoolState,
		showSelectedPoolWorkflowDetails,
		view,
	])
	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (!isSelectedPoolForkWorkflowView(view) || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
			lastForkAuctionAutoLoadKey.current = undefined
			return
		}
		if (forkAuction.loadingForkAuctionDetails) return
		const shouldReloadForkAuction = shouldReloadSelectedPoolDetails({
			currentDetailsAvailable: currentForkAuctionDetails !== undefined,
			lastHandledRefreshNonce: lastHandledForkAuctionRefreshNonceRef.current,
			loadedDetailsAddress: loadedForkAuctionDetails?.securityPoolAddress,
			refreshNonce: selectedPoolRefreshNonce,
			selectedPoolAddress: normalizedSelectedPoolAddress,
		})
		if (!shouldReloadForkAuction && sameAddress(loadedForkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress) && currentForkAuctionDetails !== undefined) return
		const forkAuctionAutoLoadKey = `${normalizedSelectedPoolAddress}:${selectedPoolRefreshNonce}`
		if (lastForkAuctionAutoLoadKey.current === forkAuctionAutoLoadKey) return
		lastForkAuctionAutoLoadKey.current = forkAuctionAutoLoadKey
		lastHandledForkAuctionRefreshNonceRef.current = selectedPoolRefreshNonce
		void forkAuction.onLoadForkAuction(getAddress(normalizedSelectedPoolAddress))
	}, [currentForkAuctionDetails, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, loadedForkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress, selectedPoolRefreshNonce, showSelectedPoolWorkflowDetails, view])
	useEffect(() => {
		const reportingRefreshHash = reporting.reportingResult?.hash
		if (reportingRefreshHash === undefined) {
			lastReportingOutcomeRefreshHash.current = undefined
			return
		}
		if (lastReportingOutcomeRefreshHash.current === reportingRefreshHash) return
		lastReportingOutcomeRefreshHash.current = reportingRefreshHash
		void onRefreshSelectedPoolData(reporting.reportingResult?.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [hasLoadedCurrentVault, onRefreshSelectedPoolData, reporting.reportingResult, securityVault.onLoadSecurityVault, showSelectedPoolWorkflowDetails])
	useEffect(() => {
		const nextForkAuctionResult = forkAuction.forkAuctionResult
		const forkAuctionRefreshHash = nextForkAuctionResult?.hash
		if (forkAuctionRefreshHash === undefined) {
			lastForkAuctionOutcomeRefreshHash.current = undefined
			return
		}
		if (nextForkAuctionResult === undefined) return
		if (lastForkAuctionOutcomeRefreshHash.current === forkAuctionRefreshHash) return
		lastForkAuctionOutcomeRefreshHash.current = forkAuctionRefreshHash
		void onRefreshSelectedPoolData(nextForkAuctionResult.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && nextForkAuctionResult.action === 'startTruthAuction') {
			void forkAuction.onLoadForkAuction(nextForkAuctionResult.securityPoolAddress)
		}
		if (
			showSelectedPoolWorkflowDetails &&
			hasLoadedCurrentVault &&
			(nextForkAuctionResult.action === 'claimAuctionProceeds' ||
				nextForkAuctionResult.action === 'claimParentEscalationDeposits' ||
				nextForkAuctionResult.action === 'migrateUnresolvedEscalation' ||
				nextForkAuctionResult.action === 'migrateVault' ||
				nextForkAuctionResult.action === 'settleForkedEscalation' ||
				nextForkAuctionResult.action === 'startTruthAuction')
		) {
			void securityVault.onLoadSecurityVault()
		}
		if (
			shouldRefreshSelectedPoolReporting &&
			(nextForkAuctionResult.action === 'claimParentEscalationDeposits' || nextForkAuctionResult.action === 'migrateUnresolvedEscalation' || nextForkAuctionResult.action === 'forkWithOwnEscalation' || nextForkAuctionResult.action === 'settleForkedEscalation' || nextForkAuctionResult.action === 'startTruthAuction')
		) {
			void reporting.onLoadReporting()
		}
	}, [forkAuction.forkAuctionResult, forkAuction.onLoadForkAuction, hasLoadedCurrentVault, onRefreshSelectedPoolData, reporting.onLoadReporting, securityVault.onLoadSecurityVault, shouldRefreshSelectedPoolReporting, showSelectedPoolWorkflowDetails])
	useEffect(() => {
		const vaultStatusRefreshHash = securityVault.securityVaultResult?.action === 'depositRepToVault' || securityVault.securityVaultResult?.action === 'redeemRepFromVault' ? securityVault.securityVaultResult.hash : undefined
		if (vaultStatusRefreshHash === undefined) {
			lastVaultStatusRefreshHash.current = undefined
			return
		}
		if (lastVaultStatusRefreshHash.current === vaultStatusRefreshHash) return
		lastVaultStatusRefreshHash.current = vaultStatusRefreshHash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
	}, [onRefreshSelectedPoolData, reporting.onLoadReporting, securityVault.securityVaultResult, selectedPool?.securityPoolAddress, shouldRefreshSelectedPoolReporting])
	useEffect(() => {
		const queuedOperationHash = securityVault.securityVaultResult?.action === 'queueWithdrawRep' ? securityVault.securityVaultResult.hash : undefined
		if (queuedOperationHash === undefined) {
			lastImmediateQueuedOperationRefreshHash.current = undefined
			return
		}
		if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return
		if (queuedVaultOperation !== undefined || currentPoolOraclePriceUsable !== true) return
		if (lastImmediateQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastImmediateQueuedOperationRefreshHash.current = queuedOperationHash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (securityVault.securityVaultResult?.action === 'queueWithdrawRep' && shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [
		currentPoolOracleManagerDetails,
		currentPoolOraclePriceUsable,
		hasLoadedCurrentVault,
		loadingPoolOracleManager,
		onRefreshSelectedPoolData,
		queuedVaultOperation,
		reporting.onLoadReporting,
		securityVault.onLoadSecurityVault,
		securityVault.securityVaultResult,
		selectedPool?.securityPoolAddress,
		shouldRefreshSelectedPoolReporting,
		showSelectedPoolWorkflowDetails,
		view,
	])
	useEffect(() => {
		const liquidationRefreshKey = securityPoolOverviewResult?.action !== 'queueLiquidation' || liquidationNoticeState === undefined || liquidationNoticeState === 'submitted' ? undefined : `${securityPoolOverviewResult.hash}:${liquidationNoticeState}`
		if (liquidationRefreshKey === undefined) {
			lastLiquidationOutcomeRefreshKey.current = undefined
			return
		}
		if (lastLiquidationOutcomeRefreshKey.current === liquidationRefreshKey) return
		lastLiquidationOutcomeRefreshKey.current = liquidationRefreshKey
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [hasLoadedCurrentVault, liquidationNoticeState, onRefreshSelectedPoolData, securityPoolOverviewResult, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])
	useEffect(() => {
		if (poolPriceOracleResult?.action !== 'executeStagedOperation') {
			lastExecutedOperationRefreshHash.current = undefined
			return
		}
		if (lastExecutedOperationRefreshHash.current === poolPriceOracleResult.hash) return
		lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (poolPriceOracleResult.stagedExecution?.success === true && poolPriceOracleResult.stagedExecution.operation === 'withdrawRep' && shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [hasLoadedCurrentVault, onRefreshSelectedPoolData, poolPriceOracleResult, reporting.onLoadReporting, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, shouldRefreshSelectedPoolReporting, showSelectedPoolWorkflowDetails, view])
	const selectedPoolViewOptions = SELECTED_POOL_VIEWS.map(selectedPoolUiView => ({
		disabled: selectedPoolUniverseMismatch || selectedPoolWorkflowGuardMessage !== undefined,
		id: `selected-pool-view-${selectedPoolUiView}`,
		label: getSelectedPoolViewLabel(selectedPoolUiView),
		...(selectedPoolUniverseMismatch || selectedPoolWorkflowGuardMessage === undefined ? {} : { reason: selectedPoolWorkflowGuardMessage }),
		value: selectedPoolUiView,
	}))
	const vaultBrowseEmptyState = (() => {
		if (selectedPool === undefined) return selectedPoolBrowsePresentation === undefined ? undefined : <StateHint presentation={selectedPoolBrowsePresentation} />
		let detail = securityPoolCopy.formatNoCurrentVaultPositions(selectedPool.vaultCount)
		if (selectedPool.vaultCount === 0n) detail = securityPoolCopy.poolVaultsEmpty
		if (selectedPool.vaultScanCapped === true) detail = securityPoolCopy.vaultRegistryScanEmpty
		return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail }} />
	})()
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={securityPoolCopy.selectedPool}>
			<StickyObjectContext
				{...(loadedSelectedPool === undefined || selectedPoolSummaryPool === undefined
					? {}
					: {
							badge: (
								<Badge tone={getSecurityPoolStatusBadgeTone(selectedPoolStateModel.lifecycleState)}>
									{getSecurityPoolStatusBadgeLabel({
										hasForkActivity: selectedPoolSummaryPool.hasForkActivity,
										questionOutcome: selectedPoolSummaryPool.questionOutcome,
										lifecycleState: selectedPoolStateModel.lifecycleState,
									})}
								</Badge>
							),
						})}
				title={getSelectedPoolCardTitle(marketDetails === undefined ? undefined : getQuestionTitle(marketDetails))}
				items={selectedPoolSummaryPool === undefined ? [] : [{ label: commonCopy.securityPoolAddress, value: <AddressValue address={selectedPoolSummaryPool.securityPoolAddress} /> }]}
				variant='embedded-context-strip'
			/>
			<div className='selected-pool-context-nonsticky'>
				<div className='selected-pool-context-controls'>
					<div className='selected-pool-change-control'>
						<div className='selected-pool-context-lookup'>
							<LookupFieldRow
								label={commonCopy.securityPoolAddress}
								value={securityPoolAddress}
								onInput={onSecurityPoolAddressChange}
								placeholder={commonCopy.hexValuePlaceholder}
								action={
									<button className='secondary' onClick={() => onRefreshSelectedPoolData()} disabled={!hasSelectedPoolAddress || loadingSecurityPools}>
										{loadingSecurityPools ? <LoadingText>{securityPoolCopy.refreshingPool}</LoadingText> : securityPoolCopy.refreshPool}
									</button>
								}
							/>
						</div>
					</div>
				</div>
				{selectedPoolSummaryContent === undefined ? undefined : (
					<details className='selected-pool-context-details'>
						<summary>{securityPoolCopy.poolContextAndMetrics}</summary>
						<div className='selected-pool-context-details-content'>{selectedPoolSummaryContent}</div>
					</details>
				)}
			</div>
			<ErrorNotice message={securityPoolOverviewError} />

			{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (
				<SectionBlock title={securityPoolCopy.universeMismatch} tone='critical' variant='embedded'>
					<p className='detail'>
						<span>{securityPoolCopy.poolUniverseLead}</span> <UniverseLink format='hex' universeId={selectedPool.universeId} /> <span>{securityPoolCopy.activeUniverseSeparator}</span> <span>{formatUniverseIdHex(activeUniverseId)}</span>. <span>{securityPoolCopy.missingPoolDetail}</span>
					</p>
					<div className='actions'>
						<button className='primary' type='button' onClick={() => onSwitchToPoolUniverse?.(selectedPool.universeId, selectedPool.securityPoolAddress)}>
							{securityPoolCopy.switchToPoolUniverse}
						</button>
						<button className='secondary' type='button' onClick={onReturnToCurrentUniverse}>
							{securityPoolCopy.returnToCurrentUniverse}
						</button>
					</div>
				</SectionBlock>
			)}

			<section className='selected-pool-workspace'>
				<div className='selected-pool-workspace-grid'>
					<div className='selected-pool-workflow-rail'>
						<ViewTabs
							ariaLabel={securityPoolCopy.selectedPoolViews}
							className='selected-pool-workflow-nav'
							groups={[
								{ ariaLabel: securityPoolCopy.primaryPoolActions, className: 'selected-pool-workflow-group', values: SELECTED_POOL_PRIMARY_VIEWS },
								{ ariaLabel: securityPoolCopy.additionalPoolActions, className: 'selected-pool-workflow-group selected-pool-workflow-group-secondary', values: SELECTED_POOL_SECONDARY_VIEWS },
							]}
							orientation='vertical'
							semantics='switcher'
							size='compact'
							value={view}
							onChange={nextView => onSelectedPoolViewChange(hasSelectedPoolAddress ? nextView : undefined)}
							options={selectedPoolViewOptions}
						/>
					</div>

					<div className='selected-pool-workflow-content'>
						{!showSelectedPoolWorkflowDetails ? (
							<SectionBlock title={selectedPoolLookupState === 'missing' ? securityPoolCopy.poolNotFound : commonCopy.managePool} variant='plain'>
								{selectedPoolUniverseMismatch || selectedPoolWorkflowLockedPresentation === undefined ? undefined : <StateHint presentation={selectedPoolWorkflowLockedPresentation} />}
								{hasSelectedPoolAddress ? undefined : (
									<div className='actions'>
										<button className='primary' type='button' onClick={onBrowsePools}>
											{commonCopy.browsePoolsAction}
										</button>
										<button className='secondary' type='button' onClick={onCreatePool}>
											{commonCopy.createPoolAction}
										</button>
									</div>
								)}
							</SectionBlock>
						) : (
							<>
								{view === 'vaults' ? (
									<SecurityPoolVaultWorkspace
										browseEmptyState={vaultBrowseEmptyState}
										currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
										isOnActiveAppChain={isOnActiveAppChain}
										liquidationEnabled={liquidationEnabled}
										onOpenLiquidationModal={onOpenLiquidationModal}
										onSelectedPoolViewChange={onSelectedPoolViewChange}
										poolState={selectedPoolStateModel}
										repPerEthPrice={repPerEthPrice}
										repPerEthSource={repPerEthSource}
										repPerEthSourceUrl={repPerEthSourceUrl}
										securityVault={securityVault}
										selectedPool={selectedPool}
										selectedVaultDetails={selectedVaultDetails}
										selectedVaultExistsOnchain={selectedVaultExistsOnchain}
										selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
										selectedVaultLoadNotice={selectedVaultLoadNotice}
										selectedVaultOwner={selectedVaultOwner}
										selectedVaultOwnerInput={selectedVaultOwnerInput}
										selectedVaultViewOptions={selectedVaultViewOptions}
										setVaultView={setVaultView}
										vaultView={vaultView}
										walletAddress={accountState.address}
									/>
								) : undefined}

								{view === 'trading' ? <TradingSection {...trading} selectedPool={effectiveSelectedPool} poolState={selectedPoolStateModel} embedInCard showHeader={false} showSecurityPoolAddressInput={false} /> : undefined}

								{view === 'reporting' ? (
									<ReportingSection
										{...reporting}
										currentTimestamp={currentTimestamp}
										embedInCard
										forkAlreadyTriggered={selectedPoolHasActualForkActivity}
										lockedReason={reportingLockedReason}
										mode='full-reporting'
										onOpenForkWorkflow={openSelectedPoolForkWorkflow}
										onOpenPriceOracle={() => onSelectedPoolViewChange('price-oracle')}
										onTriggerZoltarFork={triggerZoltarForkAvailability.disabled ? undefined : forkAuction.onForkWithOwnEscalation}
										previewMarketDetails={currentReportingDetails === undefined ? marketDetails : undefined}
										reportingDetails={currentReportingDetails}
										reportActionGuardMessage={reportingOracleGuardMessage}
										showHeader={false}
										showSecurityPoolAddressInput={false}
										triggerZoltarForkAvailability={triggerZoltarForkAvailability}
										triggerZoltarForkPending={forkAuction.forkAuctionActiveAction === 'forkWithOwnEscalation'}
									/>
								) : undefined}

								{isSelectedPoolForkWorkflowView(view) ? (
									<ForkAuctionSection
										{...forkAuction}
										currentStageView={currentForkStage}
										currentTimestamp={currentTimestamp}
										disabled={forkWorkflowDisabled}
										disabledMessage={forkWorkflowDisabled ? securityPoolCopy.operationalForkReadOnlyDetail : undefined}
										embedInCard
										forkAuctionDetails={currentForkAuctionDetails}
										lifecycleStateOverride={selectedPoolLifecycleState}
										loadingReportingDetails={reporting.loadingReportingDetails}
										onLoadReporting={reporting.onLoadReporting}
										onReportingFormChange={reporting.onReportingFormChange}
										previewPool={selectedPool}
										reportingDetails={currentReportingDetails}
										reportingError={reporting.reportingError}
										reportingForm={reporting.reportingForm}
										selectedStageView={forkWorkflowSelectionStage}
										selectedPoolRefreshNonce={selectedPoolRefreshNonce}
										securityPools={securityPools}
										universeForkTime={universeForkTime}
										onSelectedStageViewChange={onForkWorkflowSelectionStageChange}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}

								{view === 'staged-operations' && loadedSelectedPool !== undefined ? (
									<SecurityPoolStagedOperationsSection
										activeOperationCount={activeStagedOperationCount}
										canExecute={selectedPoolStateModel.actions.executeStagedOperation.enabled}
										executeGuardMessage={executePendingOperationGuardMessage}
										executionPending={poolOracleActiveAction === 'executeStagedOperation'}
										loadingManager={loadingPoolOracleManager}
										managerAddress={loadedSelectedPool.managerAddress}
										managerDetails={currentPoolOracleManagerDetails}
										managerError={currentPoolOracleManagerError}
										manualOperationId={manualPendingOperationId}
										onExecute={onExecutePendingPoolOperation}
										onLoadManager={onLoadPoolOracleManager}
										onManualOperationIdChange={setManualPendingOperationId}
										pendingSettlementOperationIds={pendingSettlementOperationIds}
										resolvedOperationId={resolvedPendingOperationId}
										securityPoolAddress={loadedSelectedPool.securityPoolAddress}
										stagedOperations={stagedOperations}
										suggestedOperationId={selectedPendingOperationId}
										universeId={loadedSelectedPool.universeId}
									/>
								) : undefined}

								{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
									<SecurityPoolPriceOracleSection
										canRequest={selectedPoolStateModel.actions.requestPrice.enabled}
										currentTimestamp={currentTimestamp}
										loadingManager={loadingPoolOracleManager}
										managerAddress={loadedSelectedPool.managerAddress}
										managerDetails={currentPoolOracleManagerDetails}
										managerError={currentPoolOracleManagerError}
										metricValues={selectedPoolOracleMetricValues}
										onLoadManager={onLoadPoolOracleManager}
										onOpenRequestReview={() => {
											if (requestPriceTransactionEthValue === undefined) return
											setRequestPriceReview({
												requestValueAttoEth: requestPriceTransactionEthValue,
												managerAddress: loadedSelectedPool.managerAddress,
												questionTitle: marketDetails === undefined ? undefined : getQuestionTitle(marketDetails),
												securityPoolAddress: loadedSelectedPool.securityPoolAddress,
												universeId: loadedSelectedPool.universeId,
											})
										}}
										onViewPendingReport={onViewPendingReport}
										requestGuardMessage={requestPriceOpenGuardMessage ?? requestPriceGuardMessage}
										requestPending={poolOracleActiveAction === 'requestPrice'}
										requestValueAttoEth={requestPriceTransactionEthValue}
									/>
								) : undefined}
							</>
						)}
					</div>
				</div>
			</section>
			<SecurityPoolRequestPriceModal
				canRequest={selectedPoolStateModel.actions.requestPrice.enabled && canUseOracleActions}
				closeOnSuccessKey={poolPriceOracleResult?.action === 'requestPrice' ? poolPriceOracleResult.hash : undefined}
				confirmationGuardMessage={requestPriceConfirmationGuardMessage}
				onClose={() => setRequestPriceReview(undefined)}
				onConfirm={review => onRequestPoolPrice(review.managerAddress, review.securityPoolAddress, review.requestValueAttoEth, review.universeId)}
				pending={poolOracleActiveAction === 'requestPrice'}
				review={requestPriceReview}
			/>
			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
				isOnActiveAppChain={isOnActiveAppChain}
				liquidationDebtEthAmount={liquidationDebtEthAmount}
				maximumLiquidationDebtAttoEth={maximumLiquidationDebtAttoEth}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationFundingPreview={liquidationFundingPreview}
				liquidationFundingPreviewError={liquidationFundingPreviewError}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				liquidationTimeoutMinutes={liquidationTimeoutMinutes}
				loadingPoolOracleManager={loadingPoolOracleManager}
				loadingLiquidationFundingPreview={loadingLiquidationFundingPreview}
				liquidationTargetVault={liquidationTargetVault}
				liquidationReceiverVault={liquidationReceiverVault}
				liquidationApprovalId={liquidationApprovalId}
				liquidationApprovalDetails={liquidationApprovalDetails}
				liquidationApprovalError={liquidationApprovalError}
				liquidationReceiverVaultSummaryError={liquidationReceiverVaultSummaryError}
				liquidationReceiverVaultSummaryResolved={liquidationReceiverVaultSummaryResolved}
				loadingLiquidationApproval={loadingLiquidationApproval}
				loadingLiquidationReceiverVaultSummary={loadingLiquidationReceiverVaultSummary}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onLoadLiquidationFundingPreview={onLoadLiquidationFundingPreview}
				onLoadLiquidationApproval={onLoadLiquidationApproval}
				onLoadLiquidationReceiverVaultSummary={onLoadLiquidationReceiverVaultSummary}
				onSelectedPoolViewChange={onSelectedPoolViewChange}
				poolState={selectedPoolStateModel}
				poolOracleManagerError={liquidationPoolOracleManagerError}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolLiquidationError={securityPoolLiquidationError}
				securityPoolOverviewResult={securityPoolOverviewResult}
				walletBalanceAttoEth={accountState.ethBalanceAttoEth}
				receiverVaultSummary={liquidationReceiverVaultSummary ?? selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationReceiverVault))}
				targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationReceiverVaultChange={onLiquidationReceiverVaultChange}
				onLiquidationApprovalIdChange={onLiquidationApprovalIdChange}
				onLiquidationTimeoutMinutesChange={onLiquidationTimeoutMinutesChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
