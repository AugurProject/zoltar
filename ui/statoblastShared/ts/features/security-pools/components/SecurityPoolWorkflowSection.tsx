import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useState } from 'preact/hooks'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { ViewTabs } from '@zoltar/ui-core-shared/components/ViewTabs.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import {
	applySelectedPoolWorkflowState,
	getCurrentSelectedPoolReportingDetails,
	getCurrentSelectedPoolForkAuctionDetails,
	getCurrentForkWorkflowSelectionStage,
	getCurrentPoolOracleManagerDetails,
	getCurrentSelectedPoolForkStage,
	hasCurrentSelectedPoolForkActivity,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolViewForForkWorkflowSelectionStage,
	getSelectedPoolViewLabel,
	getSelectedPoolWorkflowLockedPresentation,
	isSelectedPoolForkWorkflowView,
	isForkWorkflowDisabled,
	resolveForkWorkflowSelectionStage,
	resolveSelectedPoolView,
	SELECTED_POOL_VIEWS,
	shouldShowSelectedPoolWorkflowDetails,
} from '../lib/securityPoolWorkflow.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { getReportingLockedUntilMessage, hasReportingOpened } from '../../reporting/lib/reporting.js'
import { addOpenOracleBountyBuffer } from '../../open-oracle/lib/openOracle.js'
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, deriveVaultAdmissionClosed, evaluateSecurityPoolState } from '../lib/securityPoolState.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultOwner, isOracleManagerPriceUsable, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { useForkWorkflowSelectionState } from '../../truth-auctions/hooks/useForkWorkflowSelectionState.js'
import { useSelectedPoolRefreshEffects } from '../hooks/useSelectedPoolRefreshEffects.js'
import { useSelectedVaultWorkflowState, type SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import { buildSelectedPoolSummaryPool } from './SecurityPoolWorkflowPresentation.js'
import { SecurityPoolObjectHeader } from './SecurityPoolObjectHeader.js'
import { SecurityPoolRequestPriceModal, type RequestPriceReview } from './SecurityPoolOracleSections.js'
import { SecurityPoolUniverseMismatchNotice, SecurityPoolWorkflowEmptyState } from './SecurityPoolWorkflowEmptyState.js'
import { SelectedPoolForkWorkflowPanel, SelectedPoolPriceOraclePanel, SelectedPoolReportingPanel, SelectedPoolStagedOperationsPanel, SelectedPoolTradingPanel } from './SecurityPoolWorkflowTabPanels.js'
import { SecurityPoolVaultWorkspace } from './SecurityPoolVaultWorkspace.js'
import { SelectedPoolLiquidationModal } from './SelectedPoolLiquidationModal.js'

const SELECTED_POOL_WORKFLOW_PANEL_ID = 'selected-pool-workflow-panel'

type SecurityPoolWorkflowSectionProps = SecurityPoolWorkflowRouteContentProps & {
	initialVaultView?: SelectedVaultView
	showHeader?: boolean
}

export function SecurityPoolWorkflowSection(props: SecurityPoolWorkflowSectionProps) {
	const {
		accountState,
		activeUniverseId,
		checkedSecurityPoolAddress,
		forkAuction,
		liquidationManagerAddress,
		liquidationTargetVault,
		loadingPoolOracleManager,
		loadingSecurityPools,
		onLoadPoolOracleManager,
		onBrowsePools,
		onCreatePool,
		onOpenLiquidationModal,
		onReturnToCurrentUniverse,
		onSwitchToPoolUniverse,
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
		uiPriceOracle,
		reporting,
		selectedPoolView,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPoolAddress,
		securityPools,
		securityVault,
		initialVaultView,
		onSelectedPoolViewChange,
		showHeader = true,
		trading,
	} = props
	const view = resolveSelectedPoolView(selectedPoolView)
	const legacyForkWorkflowSelectionStage = resolveForkWorkflowSelectionStage(selectedPoolView)
	const chainCurrentTimestamp = useChainTimestamp()
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [requestPriceReview, setRequestPriceReview] = useState<RequestPriceReview | undefined>(undefined)
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
		vaultAdmissionClosed: deriveVaultAdmissionClosed({
			currentTimestamp,
			hasForkContinuationEscalationGame: effectiveSelectedPool?.hasForkContinuationEscalationGame,
			questionEndTime: marketDetails?.endTime,
		}),
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
	const selectedPoolWorkflowLockedPresentation = showSelectedPoolWorkflowDetails || securityPoolOverviewError !== undefined ? undefined : getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch })
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
	const requestPriceTransactionValueAttoEth = currentPoolOracleManagerDetails === undefined ? undefined : addOpenOracleBountyBuffer(currentPoolOracleManagerDetails.requestPriceCostAttoEth)
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isOnActiveAppChain,
		isPriceValid: currentPoolOraclePriceUsable,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requiredCostAttoEth: currentPoolOracleManagerDetails?.requestPriceCostAttoEth,
		walletBalanceAttoEth: accountState.ethBalanceAttoEth,
	})
	const requestPriceOpenGuardMessage = requestPriceTransactionValueAttoEth === undefined ? securityPoolCopy.loadOracleBeforePriceReview : requestPriceGuardMessage
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
	const selectedPoolBrowsePresentation = selectedPool === undefined && securityPoolOverviewError === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined
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
	useSelectedPoolRefreshEffects({
		currentForkAuctionDetails,
		currentPoolOracleManagerDetails,
		currentPoolOracleManagerError,
		currentPoolOraclePriceUsable,
		currentReportingDetails,
		forkAuction,
		hasLoadedCurrentVault,
		liquidationNoticeState,
		loadedForkAuctionDetails,
		loadedReportingDetails,
		loadingPoolOracleManager,
		normalizedReportingFormPoolAddress,
		normalizedSelectedPoolAddress,
		onLoadPoolOracleManager,
		onRefreshSelectedPoolData,
		poolOracleManagerDetails,
		poolPriceOracleResult,
		reporting,
		reportingReady,
		securityPoolOverviewResult,
		securityVault,
		selectedPool,
		selectedPoolHasActualForkActivity,
		selectedPoolManagerAddress,
		selectedPoolQuestionOutcome,
		selectedPoolRefreshNonce,
		selectedPoolState,
		shouldRefreshSelectedPoolReporting,
		showSelectedPoolWorkflowDetails,
		stagedOperations,
		view,
	})
	const selectedPoolViewOptions = SELECTED_POOL_VIEWS.map(selectedPoolUiView => ({
		id: `selected-pool-view-${selectedPoolUiView}`,
		label: getSelectedPoolViewLabel(selectedPoolUiView),
		panelId: SELECTED_POOL_WORKFLOW_PANEL_ID,
		value: selectedPoolUiView,
	}))
	const vaultBrowseEmptyState = (() => {
		if (selectedPool === undefined) return selectedPoolBrowsePresentation === undefined ? undefined : <StateHint presentation={selectedPoolBrowsePresentation} />
		let detail = securityPoolCopy.formatNoCurrentVaultPositions(selectedPool.vaultCount)
		if (selectedPool.vaultCount === 0n) detail = securityPoolCopy.poolVaultsEmpty
		if (selectedPool.vaultScanCapped === true) detail = securityPoolCopy.vaultRegistryScanEmpty
		return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail }} />
	})()
	let emptyWorkflowTitle: string | undefined
	if (selectedPoolLookupState === 'missing') emptyWorkflowTitle = securityPoolCopy.poolNotFound
	else if (showHeader) emptyWorkflowTitle = commonCopy.managePool
	return (
		<RouteWorkflowPanel showHeader={showHeader} title={securityPoolCopy.selectedPool}>
			<div className='selected-pool-change-control'>
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
			<ErrorNotice message={securityPoolOverviewError} />
			{selectedPoolSummaryPool === undefined || marketDetails === undefined ? undefined : (
				<SecurityPoolObjectHeader
					calculationPriceConfigured={uiPriceOracle !== undefined}
					currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
					currentPoolOraclePrice={currentPoolOraclePrice}
					currentPoolOracleSettlementTimestamp={currentPoolOracleSettlementTimestamp}
					currentTimestamp={currentTimestamp}
					marketDetails={marketDetails}
					onViewPendingReport={onViewPendingReport}
					repPerEthPrice={repPerEthPrice}
					selectedPoolHasActualForkActivity={selectedPoolHasActualForkActivity}
					selectedPoolLifecycleState={selectedPoolLifecycleState}
					selectedPoolParentPool={selectedPoolParentPool}
					selectedPoolQuestionOutcome={selectedPoolQuestionOutcome}
					selectedPoolSummaryPool={selectedPoolSummaryPool}
					selectedPoolView={selectedPoolView}
				/>
			)}

			{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : <SecurityPoolUniverseMismatchNotice activeUniverseId={activeUniverseId} onReturnToCurrentUniverse={onReturnToCurrentUniverse} onSwitchToPoolUniverse={onSwitchToPoolUniverse} selectedPool={selectedPool} />}

			{!showSelectedPoolWorkflowDetails ? (
				<SecurityPoolWorkflowEmptyState
					emptyWorkflowTitle={emptyWorkflowTitle}
					hasSelectedPoolAddress={hasSelectedPoolAddress}
					onBrowsePools={onBrowsePools}
					onCreatePool={onCreatePool}
					selectedPoolUniverseMismatch={selectedPoolUniverseMismatch}
					selectedPoolWorkflowLockedPresentation={selectedPoolWorkflowLockedPresentation}
				/>
			) : (
				<section className='selected-pool-workspace'>
					<ViewTabs ariaLabel={securityPoolCopy.selectedPoolViews} className='selected-pool-workspace-tabs' orientation='horizontal' semantics='tabs' size='compact' value={view} onChange={onSelectedPoolViewChange} options={selectedPoolViewOptions} />
					<div aria-labelledby={`selected-pool-view-${view}`} className='selected-pool-workflow-content' id={SELECTED_POOL_WORKFLOW_PANEL_ID} role='tabpanel'>
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

						{view === 'trading' ? <SelectedPoolTradingPanel calculationPriceConfigured={uiPriceOracle !== undefined} currentPoolOraclePriceUsable={currentPoolOraclePriceUsable} poolState={selectedPoolStateModel} selectedPool={effectiveSelectedPool} trading={trading} /> : undefined}

						{view === 'reporting' ? (
							<SelectedPoolReportingPanel
								currentReportingDetails={currentReportingDetails}
								currentTimestamp={currentTimestamp}
								forkAuction={forkAuction}
								marketDetails={marketDetails}
								onOpenForkWorkflow={openSelectedPoolForkWorkflow}
								onSelectedPoolViewChange={onSelectedPoolViewChange}
								reporting={reporting}
								reportingLockedReason={reportingLockedReason}
								reportingOracleGuardMessage={reportingOracleGuardMessage}
								selectedPoolHasActualForkActivity={selectedPoolHasActualForkActivity}
								triggerZoltarForkAvailability={triggerZoltarForkAvailability}
							/>
						) : undefined}

						{isSelectedPoolForkWorkflowView(view) ? (
							<SelectedPoolForkWorkflowPanel
								currentForkAuctionDetails={currentForkAuctionDetails}
								currentForkStage={currentForkStage}
								currentReportingDetails={currentReportingDetails}
								currentTimestamp={currentTimestamp}
								forkAuction={forkAuction}
								forkWorkflowDisabled={forkWorkflowDisabled}
								forkWorkflowSelectionStage={forkWorkflowSelectionStage}
								onForkWorkflowSelectionStageChange={onForkWorkflowSelectionStageChange}
								reporting={reporting}
								securityPools={securityPools}
								selectedPool={selectedPool}
								selectedPoolLifecycleState={selectedPoolLifecycleState}
								selectedPoolRefreshNonce={selectedPoolRefreshNonce}
								universeForkTime={universeForkTime}
							/>
						) : undefined}

						{view === 'staged-operations' && loadedSelectedPool !== undefined ? (
							<SelectedPoolStagedOperationsPanel
								activeStagedOperationCount={activeStagedOperationCount}
								currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
								currentPoolOracleManagerError={currentPoolOracleManagerError}
								executePendingOperationGuardMessage={executePendingOperationGuardMessage}
								loadedSelectedPool={loadedSelectedPool}
								loadingPoolOracleManager={loadingPoolOracleManager}
								manualPendingOperationId={manualPendingOperationId}
								onExecutePendingPoolOperation={onExecutePendingPoolOperation}
								onLoadPoolOracleManager={onLoadPoolOracleManager}
								onManualPendingOperationIdChange={setManualPendingOperationId}
								pendingSettlementOperationIds={pendingSettlementOperationIds}
								poolOracleActiveAction={poolOracleActiveAction}
								poolState={selectedPoolStateModel}
								resolvedPendingOperationId={resolvedPendingOperationId}
								selectedPendingOperationId={selectedPendingOperationId}
								stagedOperations={stagedOperations}
							/>
						) : undefined}

						{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
							<SelectedPoolPriceOraclePanel
								currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
								currentPoolOracleManagerError={currentPoolOracleManagerError}
								currentTimestamp={currentTimestamp}
								loadedSelectedPool={loadedSelectedPool}
								loadingPoolOracleManager={loadingPoolOracleManager}
								onLoadPoolOracleManager={onLoadPoolOracleManager}
								onOpenRequestReview={setRequestPriceReview}
								onViewPendingReport={onViewPendingReport}
								poolOracleActiveAction={poolOracleActiveAction}
								poolState={selectedPoolStateModel}
								requestPriceGuardMessage={requestPriceGuardMessage}
								requestPriceOpenGuardMessage={requestPriceOpenGuardMessage}
								requestPriceTransactionValueAttoEth={requestPriceTransactionValueAttoEth}
								selectedPoolOracleMetricValues={selectedPoolOracleMetricValues}
							/>
						) : undefined}
					</div>
				</section>
			)}
			<SecurityPoolRequestPriceModal
				canRequest={selectedPoolStateModel.actions.requestPrice.enabled && canUseOracleActions}
				closeOnSuccessKey={poolPriceOracleResult?.action === 'requestPrice' ? poolPriceOracleResult.hash : undefined}
				confirmationGuardMessage={requestPriceConfirmationGuardMessage}
				onClose={() => setRequestPriceReview(undefined)}
				onConfirm={review => onRequestPoolPrice(review.managerAddress, review.securityPoolAddress, review.requestValueAttoEth, review.universeId)}
				pending={poolOracleActiveAction === 'requestPrice'}
				review={requestPriceReview}
			/>
			<SelectedPoolLiquidationModal {...props} currentPoolOracleManagerDetails={currentPoolOracleManagerDetails} isOnActiveAppChain={isOnActiveAppChain} liquidationPoolOracleManagerError={liquidationPoolOracleManagerError} poolState={selectedPoolStateModel} selectedPool={selectedPool} />
		</RouteWorkflowPanel>
	)
}
