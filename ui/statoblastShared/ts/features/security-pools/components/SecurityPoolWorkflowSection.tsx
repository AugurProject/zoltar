import { ReportingOracleBlocker } from '../../reporting/components/ReportingOracleBlocker.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { useState } from 'preact/hooks'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { getSelectedPoolViewForForkWorkflowSelectionStage, isSelectedPoolForkWorkflowView } from '../lib/securityPoolWorkflow.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { derivePoolViewModel } from '../lib/poolViewModel.js'
import { useForkWorkflowSelectionState } from '../../truth-auctions/hooks/useForkWorkflowSelectionState.js'
import { useSelectedPoolRefreshEffects } from '../hooks/useSelectedPoolRefreshEffects.js'
import { useSelectedVaultWorkflowState, type SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js'
import { buildRouteHref, getRouteHashSearch } from '@zoltar/ui-core-shared/navigation/routing.js'
import { POOLS_ROUTE_HASH } from '../../../lib/statoblastLocation.js'
import { SecurityPoolObjectHeader, SecurityPoolReferenceDetails } from './SecurityPoolObjectHeader.js'
import { PoolSelectionControl } from './PoolSelectionControl.js'
import { PoolOracleStatusRow, PoolWorkspaceNavigation } from './PoolWorkspaceNavigation.js'
import { PoolActionCard, PoolLifecycleStepper } from './PoolStagePanel.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { createRequestPriceReview, PRICE_ORACLE_HEADING_ID, SecurityPoolRequestPriceModal, type RequestPriceReview } from './SecurityPoolOracleSections.js'
import { SecurityPoolUniverseMismatchNotice, SecurityPoolWorkflowEmptyState } from './SecurityPoolWorkflowEmptyState.js'
import { SelectedPoolForkWorkflowPanel, SelectedPoolPriceOraclePanel, SelectedPoolReportingPanel, SelectedPoolStagedOperationsPanel, SelectedPoolTradingPanel } from './SecurityPoolWorkflowTabPanels.js'
import { SecurityPoolVaultWorkspace } from './SecurityPoolVaultWorkspace.js'
import { SelectedPoolLiquidationModal } from './SelectedPoolLiquidationModal.js'

const SELECTED_POOL_WORKFLOW_PANEL_ID = 'selected-pool-workflow-panel'

type SecurityPoolWorkflowSectionProps = SecurityPoolWorkflowRouteContentProps & {
	initialVaultView?: SelectedVaultView
	showHeader?: boolean
}

function SelectedVaultLoadNotice({ loading, missing }: { loading: boolean; missing: boolean }) {
	if (loading)
		return (
			<p className='detail'>
				<LoadingText>{securityPoolCopy.loadingVault}</LoadingText>
			</p>
		)
	if (missing) return <StateHint presentation={{ key: 'not_found', badgeLabel: commonCopy.notFound, badgeTone: 'blocked', detail: securityPoolCopy.invalidVaultAddressHint }} />
	return undefined
}

function getVaultBrowseEmptyState(selectedPool: ListedSecurityPool | undefined, browsePresentation: ReturnType<typeof derivePoolViewModel>['selectedPoolBrowsePresentation']) {
	if (selectedPool === undefined) return browsePresentation === undefined ? undefined : <StateHint presentation={browsePresentation} />
	let detail = securityPoolCopy.formatNoCurrentVaultPositions(selectedPool.vaultCount)
	if (selectedPool.vaultCount === 0n) detail = securityPoolCopy.poolVaultsEmpty
	if (selectedPool.vaultScanCapped === true) detail = securityPoolCopy.vaultRegistryScanEmpty
	return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail }} />
}

/** The pool page: stage context and next actions above the pool's tabbed workspace. State comes from `derivePoolViewModel`; this component wires hooks and renders. */
export function SecurityPoolWorkflowSection(props: SecurityPoolWorkflowSectionProps) {
	const {
		RequestPriceModal = SecurityPoolRequestPriceModal,
		accountState,
		activeUniverseId,
		forkAuction,
		inlineOracle,
		initialVaultView,
		liquidationTargetVault,
		loadingPoolOracleManager,
		loadingSecurityPools,
		onBrowsePools,
		onCreatePool,
		onExecutePendingPoolOperation,
		onLoadPoolOracleManager,
		onOpenLiquidationModal,
		onRefreshSelectedPoolData,
		onRequestPoolPrice,
		onReturnToCurrentUniverse,
		onSecurityPoolAddressChange,
		onSelectedPoolViewChange,
		onSwitchToPoolUniverse,
		onViewPendingReport,
		poolOracleActiveAction,
		poolOracleManagerDetails,
		poolPriceOracleResult,
		repPerEthPrice,
		repPerEthSource,
		repPerEthSourceUrl,
		reporting,
		securityPoolAddress,
		securityPoolOverviewError,
		securityPoolOverviewResult,
		securityPools,
		securityVault,
		selectedPoolRefreshNonce,
		selectedPoolView,
		showHeader = true,
		trading,
		uiPriceOracle,
		universeForkTime,
	} = props
	const chainCurrentTimestamp = useChainTimestamp()
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [requestPriceReview, setRequestPriceReview] = useState<RequestPriceReview | undefined>(undefined)
	const model = derivePoolViewModel({
		...props,
		forkAuctionDetails: forkAuction.forkAuctionDetails,
		manualPendingOperationId,
		now: chainCurrentTimestamp,
		reportingDetails: reporting.reportingDetails,
		reportingFormSecurityPoolAddress: reporting.reportingForm.securityPoolAddress,
		requestPriceReview,
		securityVaultDetails: securityVault.securityVaultDetails,
		selectedVaultOwnerInput: securityVault.securityVaultForm.selectedVaultOwner ?? '',
		shareBalances: trading.tradingDetails?.shareBalances,
	})
	const { currentPoolOracleManagerDetails, currentReportingDetails, currentTimestamp, effectiveSelectedPool: loadedSelectedPool, marketDetails, selectedPool, selectedPoolStateModel, showSelectedPoolWorkflowDetails, view } = model
	const { forkWorkflowSelectionStage, onForkWorkflowSelectionStageChange } = useForkWorkflowSelectionState({
		currentForkWorkflowSelectionStage: model.currentForkWorkflowSelectionStage,
		legacyForkWorkflowSelectionStage: model.legacyForkWorkflowSelectionStage,
		onSelectedStageViewChange: stage => onSelectedPoolViewChange(getSelectedPoolViewForForkWorkflowSelectionStage(stage)),
		selectedPoolAddress: selectedPool?.securityPoolAddress,
		view,
	})
	const selectedVaultViewOptions: ViewTabOption<SelectedVaultView>[] = [
		{ label: workspaceCopy.allVaults, value: 'browse-vaults' },
		{ label: workspaceCopy.myVault, value: 'selected-vault', disabled: accountState.address === undefined },
		{ label: workspaceCopy.byAddress, value: 'vault-by-address' },
	]
	const { setVaultView, vaultView } = useSelectedVaultWorkflowState({
		selectedVaultExistsOnchain: model.selectedVaultExistsOnchain,
		accountAddress: accountState.address,
		hasLoadedCurrentVault: model.hasLoadedCurrentVault,
		initialVaultView,
		loadingSecurityVault: securityVault.loadingSecurityVault,
		onLoadSecurityVault: securityVault.onLoadSecurityVault,
		onSecurityVaultFormChange: securityVault.onSecurityVaultFormChange,
		selectedPoolAddress: selectedPool?.securityPoolAddress,
		selectedVaultOwner: model.selectedVaultOwner,
		selectedVaultOwnerInput: securityVault.securityVaultForm.selectedVaultOwner,
		selectedVaultSecurityPoolAddress: securityVault.securityVaultForm.securityPoolAddress.trim(),
		showSelectedPoolWorkflowDetails,
		view,
	})
	const liquidationNoticeState = getLiquidationNoticeState({ currentTimestamp, currentPoolOracleManagerDetails, liquidationTargetVault, loadingPoolOracleManager, securityPoolOverviewResult })
	useSelectedPoolRefreshEffects({
		currentTimestamp,
		currentForkAuctionDetails: model.currentForkAuctionDetails,
		currentPoolOracleManagerDetails,
		currentPoolOracleManagerError: model.currentPoolOracleManagerError,
		currentPoolOraclePriceUsable: model.currentPoolOraclePriceUsable,
		currentReportingDetails,
		forkAuction,
		hasLoadedCurrentVault: model.hasLoadedCurrentVault,
		liquidationNoticeState,
		loadedForkAuctionDetails: model.loadedForkAuctionDetails,
		loadedReportingDetails: model.loadedReportingDetails,
		loadingPoolOracleManager,
		normalizedReportingFormPoolAddress: model.normalizedReportingFormPoolAddress,
		normalizedSelectedPoolAddress: model.normalizedSelectedPoolAddress,
		onLoadPoolOracleManager,
		onRefreshSelectedPoolData,
		poolOracleManagerDetails,
		poolPriceOracleResult,
		reporting,
		reportingReady: model.reportingReady,
		securityPoolOverviewResult,
		securityVault,
		selectedPool,
		selectedPoolHasActualForkActivity: model.selectedPoolHasActualForkActivity,
		selectedPoolManagerAddress: model.selectedPoolManagerAddress,
		selectedPoolQuestionOutcome: model.selectedPoolQuestionOutcome,
		selectedPoolRefreshNonce,
		selectedPoolState: model.selectedPoolState,
		shouldRefreshSelectedPoolReporting: model.shouldRefreshSelectedPoolReporting,
		showSelectedPoolWorkflowDetails,
		stagedOperations: model.stagedOperations,
		view,
	})
	const openRequestPriceReview = () => {
		if (loadedSelectedPool !== undefined && model.requestPriceTransactionValueAttoEth !== undefined) setRequestPriceReview(createRequestPriceReview(loadedSelectedPool, model.requestPriceTransactionValueAttoEth))
	}
	let emptyWorkflowTitle: string | undefined
	if (model.selectedPoolLookupState === 'missing') emptyWorkflowTitle = securityPoolCopy.poolNotFound
	else if (showHeader) emptyWorkflowTitle = securityPoolCopy.selectedPool
	const objectHeaderProps =
		model.selectedPoolSummaryPool === undefined || marketDetails === undefined
			? undefined
			: {
					calculationPriceConfigured: uiPriceOracle !== undefined,
					currentPoolOracleManagerDetails,
					currentPoolOraclePrice: model.currentPoolOraclePrice,
					currentPoolOracleSettlementTimestamp: model.currentPoolOracleSettlementTimestamp,
					currentTimestamp,
					marketDetails,
					repPerEthPrice,
					selectedPoolHasActualForkActivity: model.selectedPoolHasActualForkActivity,
					selectedPoolLifecycleState: model.selectedPoolLifecycleState,
					selectedPoolParentPool: model.selectedPoolParentPool,
					selectedPoolQuestionOutcome: model.selectedPoolQuestionOutcome,
					selectedPoolSummaryPool: model.selectedPoolSummaryPool,
					selectedPoolView,
				}
	return (
		<RouteWorkflowPanel showHeader={showHeader && objectHeaderProps === undefined} title={securityPoolCopy.selectedPool}>
			<div className='pool-context'>
				<div className='pool-page-toolbar'>
					<a
						className='pool-back-link'
						href={buildRouteHref(POOLS_ROUTE_HASH, getRouteHashSearch())}
						onClick={event => {
							if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
							event.preventDefault()
							onBrowsePools()
						}}
					>
						<span aria-hidden='true'>←</span>
						{workspaceCopy.allPools}
					</a>
					<PoolSelectionControl address={securityPoolAddress} loading={loadingSecurityPools} onAddressChange={onSecurityPoolAddressChange} onLoad={onRefreshSelectedPoolData} poolLoaded={selectedPool !== undefined} />
				</div>
				{objectHeaderProps === undefined ? undefined : <SecurityPoolObjectHeader {...objectHeaderProps} />}
				<ErrorNotice message={securityPoolOverviewError} />
				{model.oracleStatus === undefined ? undefined : <PoolOracleStatusRow needsPrice={model.needsPrice} oracle={{ ...model.oracleStatus, requestPending: poolOracleActiveAction === 'requestPrice' }} onRequestPrice={openRequestPriceReview} onViewReport={onViewPendingReport} />}
				{showSelectedPoolWorkflowDetails ? <PoolLifecycleStepper step={model.lifecycleStep} /> : undefined}
				{showSelectedPoolWorkflowDetails ? <PoolActionCard currentTimestamp={currentTimestamp} currentView={view} items={model.actionItems} onChange={onSelectedPoolViewChange} /> : undefined}
				{objectHeaderProps === undefined ? undefined : <SecurityPoolReferenceDetails {...objectHeaderProps} />}
			</div>

			{selectedPool === undefined || !model.selectedPoolUniverseMismatch ? undefined : <SecurityPoolUniverseMismatchNotice activeUniverseId={activeUniverseId} onReturnToCurrentUniverse={onReturnToCurrentUniverse} onSwitchToPoolUniverse={onSwitchToPoolUniverse} selectedPool={selectedPool} />}

			{!showSelectedPoolWorkflowDetails ? (
				<SecurityPoolWorkflowEmptyState
					emptyWorkflowTitle={emptyWorkflowTitle}
					hasSelectedPoolAddress={model.hasSelectedPoolAddress}
					onBrowsePools={onBrowsePools}
					onCreatePool={onCreatePool}
					selectedPoolUniverseMismatch={model.selectedPoolUniverseMismatch}
					selectedPoolWorkflowLockedPresentation={model.selectedPoolWorkflowLockedPresentation}
				/>
			) : (
				<section className='selected-pool-workspace'>
					<PoolWorkspaceNavigation forkWorkflowPrimary={model.forkWorkflowPrimary} view={view} onChange={onSelectedPoolViewChange} panelId={SELECTED_POOL_WORKFLOW_PANEL_ID} />
					<div aria-labelledby={`selected-pool-view-${view}`} className='selected-pool-workflow-content' id={SELECTED_POOL_WORKFLOW_PANEL_ID} role='tabpanel'>
						{view === 'vaults' ? (
							<SecurityPoolVaultWorkspace
								browseEmptyState={getVaultBrowseEmptyState(selectedPool, model.selectedPoolBrowsePresentation)}
								currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
								isOnActiveAppChain={model.isOnActiveAppChain}
								liquidationEnabled={selectedPoolStateModel.actions.queueLiquidation.enabled}
								onOpenLiquidationModal={onOpenLiquidationModal}
								onSelectedPoolViewChange={onSelectedPoolViewChange}
								poolState={selectedPoolStateModel}
								repPerEthPrice={repPerEthPrice}
								repPerEthSource={repPerEthSource}
								repPerEthSourceUrl={repPerEthSourceUrl}
								securityVault={securityVault}
								selectedPool={selectedPool}
								selectedVaultDetails={model.selectedVaultDetails}
								selectedVaultExistsOnchain={model.selectedVaultExistsOnchain}
								selectedVaultIsOwnedByAccount={model.selectedVaultIsOwnedByAccount}
								selectedVaultLoadNotice={<SelectedVaultLoadNotice loading={securityVault.loadingSecurityVault} missing={securityVault.securityVaultMissing} />}
								selectedVaultOwner={model.selectedVaultOwner}
								selectedVaultOwnerInput={securityVault.securityVaultForm.selectedVaultOwner ?? ''}
								selectedVaultViewOptions={selectedVaultViewOptions}
								setVaultView={setVaultView}
								vaultView={vaultView}
								walletAddress={accountState.address}
							/>
						) : undefined}

						{view === 'trading' ? <SelectedPoolTradingPanel calculationPriceConfigured={uiPriceOracle !== undefined} currentPoolOraclePriceUsable={model.currentPoolOraclePriceUsable} poolState={selectedPoolStateModel} selectedPool={loadedSelectedPool} trading={trading} /> : undefined}

						{view === 'reporting' ? (
							<SelectedPoolReportingPanel
								oracleBlocker={
									<ReportingOracleBlocker
										blocked={model.reportingOracleGuardMessage !== undefined}
										manager={currentPoolOracleManagerDetails}
										now={currentTimestamp}
										oracle={inlineOracle}
										onViewReport={onViewPendingReport}
										onRefresh={() => {
											if (loadedSelectedPool !== undefined) onLoadPoolOracleManager(loadedSelectedPool.managerAddress)
										}}
										requestReason={model.requestPriceOpenGuardMessage}
										onRequest={openRequestPriceReview}
									/>
								}
								currentReportingDetails={currentReportingDetails}
								currentTimestamp={currentTimestamp}
								forkAuction={forkAuction}
								marketDetails={marketDetails}
								onOpenForkWorkflow={model.selectedPoolHasActualForkActivity ? () => onSelectedPoolViewChange('fork-workflow') : undefined}
								onSelectedPoolViewChange={onSelectedPoolViewChange}
								reporting={reporting}
								reportingLockedReason={model.reportingLockedReason}
								reportingOracleGuardMessage={model.reportingOracleGuardMessage}
								selectedPoolHasActualForkActivity={model.selectedPoolHasActualForkActivity}
								triggerZoltarForkAvailability={model.triggerZoltarForkAvailability}
							/>
						) : undefined}

						{isSelectedPoolForkWorkflowView(view) ? (
							<SelectedPoolForkWorkflowPanel
								currentForkAuctionDetails={model.currentForkAuctionDetails}
								currentForkStage={model.currentForkStage}
								currentReportingDetails={currentReportingDetails}
								currentTimestamp={currentTimestamp}
								forkAuction={forkAuction}
								forkWorkflowDisabled={model.forkWorkflowDisabled}
								forkWorkflowSelectionStage={forkWorkflowSelectionStage}
								onForkWorkflowSelectionStageChange={onForkWorkflowSelectionStageChange}
								reporting={reporting}
								securityPools={securityPools}
								selectedPool={selectedPool}
								selectedPoolLifecycleState={model.selectedPoolLifecycleState}
								selectedPoolRefreshNonce={selectedPoolRefreshNonce}
								universeForkTime={universeForkTime}
							/>
						) : undefined}

						{view === 'staged-operations' && loadedSelectedPool !== undefined ? (
							<SelectedPoolStagedOperationsPanel
								activeStagedOperationCount={model.activeStagedOperationCount}
								currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
								currentPoolOracleManagerError={model.currentPoolOracleManagerError}
								executePendingOperationGuardMessage={model.executePendingOperationGuardMessage}
								loadedSelectedPool={loadedSelectedPool}
								loadingPoolOracleManager={loadingPoolOracleManager}
								manualPendingOperationId={manualPendingOperationId}
								onExecutePendingPoolOperation={onExecutePendingPoolOperation}
								onLoadPoolOracleManager={onLoadPoolOracleManager}
								onManualPendingOperationIdChange={setManualPendingOperationId}
								pendingSettlementOperationIds={model.pendingSettlementOperationIds}
								poolOracleActiveAction={poolOracleActiveAction}
								poolState={selectedPoolStateModel}
								resolvedPendingOperationId={model.resolvedPendingOperationId}
								selectedPendingOperationId={model.selectedPendingOperationId}
								stagedOperations={model.stagedOperations}
							/>
						) : undefined}

						{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
							<SelectedPoolPriceOraclePanel
								currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
								currentPoolOracleManagerError={model.currentPoolOracleManagerError}
								currentTimestamp={currentTimestamp}
								loadedSelectedPool={loadedSelectedPool}
								loadingPoolOracleManager={loadingPoolOracleManager}
								onLoadPoolOracleManager={onLoadPoolOracleManager}
								onOpenRequestReview={setRequestPriceReview}
								onViewPendingReport={onViewPendingReport}
								poolOracleActiveAction={poolOracleActiveAction}
								poolState={selectedPoolStateModel}
								requestPriceGuardMessage={model.requestPriceGuardMessage}
								requestPriceOpenGuardMessage={model.requestPriceOpenGuardMessage}
								requestPriceTransactionValueAttoEth={model.requestPriceTransactionValueAttoEth}
								selectedPoolOracleMetricValues={model.selectedPoolOracleMetricValues}
							/>
						) : undefined}
					</div>
				</section>
			)}
			<RequestPriceModal
				canRequest={selectedPoolStateModel.actions.requestPrice.enabled && model.canUseOracleActions}
				closeOnSuccessKey={poolPriceOracleResult?.action === 'requestPrice' ? poolPriceOracleResult.hash : undefined}
				confirmationGuardMessage={model.requestPriceConfirmationGuardMessage}
				getReturnFocusTarget={() => {
					const panel = document.getElementById(SELECTED_POOL_WORKFLOW_PANEL_ID)
					return panel?.querySelector<HTMLElement>('.oracle-actions .tx-action-button:not(:disabled)') ?? panel?.querySelector<HTMLElement>('.workflow-metric-grid button.link') ?? document.getElementById(PRICE_ORACLE_HEADING_ID) ?? document.querySelector<HTMLElement>('.pool-oracle-status button:not(:disabled)')
				}}
				onClose={() => setRequestPriceReview(undefined)}
				onConfirm={(review, signal) => onRequestPoolPrice(review.managerAddress, review.securityPoolAddress, review.requestValueAttoEth, review.universeId, review.proposedRepPerEthPrice, signal)}
				pending={poolOracleActiveAction === 'requestPrice'}
				review={requestPriceReview}
			/>
			<SelectedPoolLiquidationModal {...props} currentPoolOracleManagerDetails={currentPoolOracleManagerDetails} isOnActiveAppChain={model.isOnActiveAppChain} liquidationPoolOracleManagerError={model.liquidationPoolOracleManagerError} poolState={selectedPoolStateModel} selectedPool={selectedPool} />
		</RouteWorkflowPanel>
	)
}
