import * as commonCopy from '../../../copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { CollateralizationCircle } from './CollateralizationCircle.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { ForkAuctionSection } from '../../truth-auctions/components/ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from '../../../components/LookupFieldRow.js'
import { LoadingText } from '../../../components/LoadingText.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { getQuestionTitle, Question } from '../../markets/components/Question.js'
import { ReportingSection } from '../../reporting/components/ReportingSection.js'
import { RouteWorkflowPanel } from '../../../components/RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolLink } from './SecurityPoolLink.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SectionBlock } from '../../../components/SectionBlock.js'
import { getQueuedVaultOperation, SecurityVaultSection, SelectedVaultSummarySection } from './SecurityVaultSection.js'
import { StickyObjectContext } from '../../../components/StickyObjectContext.js'
import { StateHint } from '../../../components/StateHint.js'
import { TradingSection } from '../../markets/components/TradingSection.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { UniverseLink } from '../../universes/components/UniverseLink.js'
import { ViewTabs } from '../../../components/ViewTabs.js'
import { WarningSurface } from '../../../components/WarningSurface.js'
import { tryParseBigIntInput } from '../../markets/lib/marketForm.js'
import { assertNever } from '../../../lib/assert.js'
import { normalizeAddress, sameAddress } from '../../../lib/address.js'
import { getPoolCollateralizationPercent } from '../../markets/lib/trading.js'
import { useChainTimestamp } from '../../../lib/chainTimestamp.js'
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
import { sameCaseInsensitiveText } from '../../../lib/caseInsensitive.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '../../../lib/loadState.js'
import { isMainnetChain } from '../../../lib/network.js'
import { getReportingLockedUntilMessage, hasReportingOpened } from '../../reporting/lib/reporting.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '../../../lib/userCopy.js'
import { formatUniverseIdHex } from '../../universes/lib/universe.js'
import { useForkWorkflowSelectionState } from '../../truth-auctions/hooks/useForkWorkflowSelectionState.js'
import { useSelectedVaultWorkflowState, type SelectedVaultView } from '../hooks/useSelectedVaultWorkflowState.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../../types.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '../../../types/contracts.js'

function buildSelectedPoolSummaryPool({ forkAuctionDetails, selectedPool }: { forkAuctionDetails: ForkAuctionDetails | undefined; selectedPool: ListedSecurityPool | undefined }) {
	if (selectedPool === undefined) return undefined
	if (forkAuctionDetails === undefined) return selectedPool
	return {
		...selectedPool,
		completeSetCollateralAmount: forkAuctionDetails.completeSetCollateralAmount,
		hasForkActivity: forkAuctionDetails.hasForkActivity,
		forkOutcome: forkAuctionDetails.forkOutcome,
		forkOwnSecurityPool: forkAuctionDetails.forkOwnSecurityPool,
		marketDetails: forkAuctionDetails.marketDetails,
		migratedRep: forkAuctionDetails.migratedRep,
		questionOutcome: forkAuctionDetails.questionOutcome,
		securityPoolAddress: forkAuctionDetails.securityPoolAddress,
		systemState: forkAuctionDetails.systemState,
		truthAuctionAddress: forkAuctionDetails.truthAuctionAddress,
		truthAuctionStartedAt: forkAuctionDetails.truthAuctionStartedAt,
		universeId: forkAuctionDetails.universeId,
	}
}

function getPendingOperationLabel(operation: 'liquidation' | 'setSecurityBondsAllowance' | 'withdrawRep') {
	switch (operation) {
		case 'liquidation':
			return securityPoolCopy.liquidation
		case 'withdrawRep':
			return securityPoolCopy.withdrawRep
		case 'setSecurityBondsAllowance':
			return securityPoolCopy.setBondAllowance
		default:
			return assertNever(operation)
	}
}
function getStagedOperationExecutionModeLabel(operationId: bigint, pendingSettlementOperationIds: bigint[]) {
	return pendingSettlementOperationIds.includes(operationId) ? securityPoolCopy.autoExecPending : securityPoolCopy.manualExecution
}
function getSecurityPoolStatusBadgeTone(systemState: SecurityPoolLifecycleState | undefined) {
	if (systemState === 'operational') return 'ok'
	if (systemState === undefined) return 'muted'
	return 'warning'
}
export function SecurityPoolWorkflowSection({
	accountState,
	activeUniverseId,
	checkedSecurityPoolAddress,
	closeLiquidationModal,
	forkAuction,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationFundingPreview,
	liquidationFundingPreviewError,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingLiquidationFundingPreview,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLiquidationTimeoutMinutesChange,
	onLoadPoolOracleManager,
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
	const lastHandledReportingRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastHandledForkAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const isMainnet = isMainnetChain(accountState.chainId)
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
	const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({
		poolOracleManagerDetails,
		selectedPoolManagerAddress,
	})
	const selectedVaultAddressInput = securityVault.securityVaultForm.selectedVaultAddress ?? ''
	const selectedVaultAddress = getSelectedVaultAddress(selectedVaultAddressInput, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccountHelper(selectedVaultAddressInput, accountState.address)
	const selectedVaultSecurityPoolAddress = securityVault.securityVaultForm.securityPoolAddress.trim()
	const selectedVaultDetails = doesLoadedSecurityVaultMatchSelection({
		accountAddress: accountState.address,
		securityPoolAddress: selectedPool?.securityPoolAddress,
		securityVaultDetails: securityVault.securityVaultDetails,
		selectedVaultAddress: selectedVaultAddressInput,
	})
		? securityVault.securityVaultDetails
		: undefined
	const selectedVaultExistsOnchain = doesSecurityVaultExistOnchain(selectedVaultDetails)
	const currentSecurityVaultResult = selectedVaultDetails === undefined ? undefined : securityVault.securityVaultResult
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const { setVaultView, vaultView } = useSelectedVaultWorkflowState({
		accountAddress: accountState.address,
		hasLoadedCurrentVault,
		initialVaultView,
		loadingSecurityVault: securityVault.loadingSecurityVault,
		onLoadSecurityVault: securityVault.onLoadSecurityVault,
		onSecurityVaultFormChange: securityVault.onSecurityVaultFormChange,
		selectedPoolAddress: selectedPool?.securityPoolAddress,
		selectedVaultAddress,
		selectedVaultAddressInput: securityVault.securityVaultForm.selectedVaultAddress,
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
		selectedVaultAddress,
		securityVaultResult: currentSecurityVaultResult,
	})
	const liquidationNoticeState = getLiquidationNoticeState({
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
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isMainnet,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requiredEthCost: currentPoolOracleManagerDetails?.requestPriceEthCost,
		walletEthBalance: accountState.ethBalance,
	})
	const selectedPendingOperationId = currentPoolOracleManagerDetails?.pendingOperationSlotId ?? 0n
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
		isMainnet,
		isPriceValid: currentPoolOracleManagerDetails?.isPriceValid,
		resolvedPendingOperationId,
	})
	const pendingOperation = currentPoolOracleManagerDetails?.pendingOperation
	const canUseOracleActions = accountState.address !== undefined && isMainnet
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
	const selectedPoolCollateralizationPercent = selectedPoolSummaryPool === undefined ? undefined : getPoolCollateralizationPercent(selectedPoolSummaryPool.totalRepDeposit, selectedPoolSummaryPool.totalSecurityBondAllowance, repPerEthPrice)
	const selectedPoolCollateralizationTarget = selectedPoolSummaryPool === undefined ? undefined : selectedPoolSummaryPool.securityMultiplier * 100n * 10n ** 18n

	if (selectedPoolSummaryPool === undefined) {
		selectedPoolSummaryContent = undefined
	} else if (view === 'vaults' || view === 'trading') {
		selectedPoolSummaryContent = (
			<div className='selected-pool-context-summary selected-pool-context-summary-hero selected-pool-context-summary-hero-compact'>
				<div className='selected-pool-context-overview'>
					<div className='selected-pool-hero-story'>
						<div className='selected-pool-hero-story-title-row'>
							<div className='security-pool-card-title-row'>
								<CollateralizationCircle className='security-pool-card-title-collateralization' collateralizationPercent={selectedPoolCollateralizationPercent} size='small' targetCollateralizationPercent={selectedPoolCollateralizationTarget} />
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
						repPerEthPrice={repPerEthPrice}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
						showTotalBacking
						showCollateralizationGauge={false}
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
					<SecurityPoolSummaryMetrics metricVariant='context' pool={selectedPoolSummaryPool} repPerEthPrice={repPerEthPrice} repPerEthSource={repPerEthSource} repPerEthSourceUrl={repPerEthSourceUrl} showTotalBacking>
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
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerDetails?.managerAddress, selectedPoolManagerAddress])
	useEffect(() => {
		if (selectedPoolManagerAddress === undefined) return
		if (loadingPoolOracleManager) return
		const queuedOperationHash = (() => {
			if (securityVault.securityVaultResult?.action === 'queueSetSecurityBondAllowance' || securityVault.securityVaultResult?.action === 'queueWithdrawRep') return securityVault.securityVaultResult.hash
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
		if (!isSelectedPoolForkWorkflowView(view) || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (forkAuction.loadingForkAuctionDetails) return
		const shouldReloadForkAuction = shouldReloadSelectedPoolDetails({
			currentDetailsAvailable: currentForkAuctionDetails !== undefined,
			lastHandledRefreshNonce: lastHandledForkAuctionRefreshNonceRef.current,
			loadedDetailsAddress: loadedForkAuctionDetails?.securityPoolAddress,
			refreshNonce: selectedPoolRefreshNonce,
			selectedPoolAddress: normalizedSelectedPoolAddress,
		})
		if (!shouldReloadForkAuction && sameAddress(loadedForkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress) && currentForkAuctionDetails !== undefined) return
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
		const vaultStatusRefreshHash = securityVault.securityVaultResult?.action === 'depositRep' || securityVault.securityVaultResult?.action === 'redeemRep' ? securityVault.securityVaultResult.hash : undefined
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
		const queuedOperationHash = securityVault.securityVaultResult?.action === 'queueSetSecurityBondAllowance' || securityVault.securityVaultResult?.action === 'queueWithdrawRep' ? securityVault.securityVaultResult.hash : undefined
		if (queuedOperationHash === undefined) {
			lastImmediateQueuedOperationRefreshHash.current = undefined
			return
		}
		if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return
		if (queuedVaultOperation !== undefined || !currentPoolOracleManagerDetails.isPriceValid) return
		if (lastImmediateQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastImmediateQueuedOperationRefreshHash.current = queuedOperationHash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (securityVault.securityVaultResult?.action === 'queueWithdrawRep' && shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [
		currentPoolOracleManagerDetails,
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
				sticky={false}
				title={getSelectedPoolCardTitle()}
				items={[]}
				variant='context-strip'
			>
				<div className='selected-pool-context-controls'>
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
				{selectedPoolSummaryContent === undefined ? undefined : (
					<details className='selected-pool-context-details'>
						<summary>{securityPoolCopy.poolContextAndMetrics}</summary>
						<div className='selected-pool-context-details-content'>{selectedPoolSummaryContent}</div>
					</details>
				)}
			</StickyObjectContext>
			<ErrorNotice message={securityPoolOverviewError} />

			{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (
				<SectionBlock title={securityPoolCopy.universeMismatch} tone='critical'>
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
							</SectionBlock>
						) : (
							<>
								{view === 'vaults' ? (
									<div className='workflow-stack vault-workspace'>
										<SectionBlock
											density='compact'
											title={securityPoolCopy.vaultOperations}
											variant='plain'
											actions={
												<div className='actions'>
													<ViewTabs ariaLabel={securityPoolCopy.selectedPoolVaultViews} className='vault-content-switch' semantics='switcher' size='compact' value={vaultView} onChange={setVaultView} options={selectedVaultViewOptions} />
												</div>
											}
										>
											{selectedVaultLoadNotice}
											<LookupFieldRow
												label={securityPoolCopy.selectedVaultAddress}
												value={selectedVaultAddressInput}
												onInput={selectedVaultAddress => securityVault.onSecurityVaultFormChange({ selectedVaultAddress })}
												placeholder={commonCopy.hexValuePlaceholder}
												action={
													<button className='secondary' onClick={() => securityVault.onLoadSecurityVault()} disabled={securityVault.loadingSecurityVault}>
														{securityVault.loadingSecurityVault ? <LoadingText>{securityPoolCopy.refreshing}</LoadingText> : commonCopy.refresh}
													</button>
												}
											/>
											{vaultView === 'selected-vault' && selectedVaultDetails !== undefined && selectedVaultExistsOnchain ? (
												<SelectedVaultSummarySection
													repPerEthPrice={repPerEthPrice}
													repPerEthSource={repPerEthSource}
													repPerEthSourceUrl={repPerEthSourceUrl}
													securityBondAllowance={selectedVaultDetails.securityBondAllowance}
													securityVaultDetails={selectedVaultDetails}
													selectedPoolSecurityMultiplier={securityVault.selectedPoolSecurityMultiplier}
													selectedVaultIsOwnedByAccount={selectedVaultIsOwnedByAccount}
													variant='embedded'
												/>
											) : undefined}
										</SectionBlock>

										{vaultView === 'browse-vaults' ? (
											<SectionBlock title={securityPoolCopy.vaultDirectory} variant='embedded'>
												<SecurityPoolVaultDirectory
													emptyState={(() => {
														if (selectedPool === undefined) {
															if (selectedPoolBrowsePresentation === undefined) return undefined

															return <StateHint presentation={selectedPoolBrowsePresentation} />
														}

														return <StateHint presentation={{ key: 'empty', badgeLabel: commonCopy.none, badgeTone: 'muted', detail: securityPoolCopy.poolVaultsEmpty }} />
													})()}
													pool={selectedPool}
													renderActions={vault => {
														if (selectedPool === undefined) return undefined
														return (
															<div className='actions'>
																<button
																	className='secondary'
																	onClick={() => {
																		securityVault.onSecurityVaultFormChange({ selectedVaultAddress: vault.vaultAddress.toString() })
																		setVaultView('selected-vault')
																		void securityVault.onLoadSecurityVault(vault.vaultAddress.toString())
																	}}
																>
																	{securityPoolCopy.selectVault}
																</button>
																<button
																	className='secondary'
																	onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)}
																	disabled={accountState.address === undefined || !isMainnet || currentPoolOracleManagerDetails?.isPriceValid === false || !liquidationEnabled}
																	title={!isMainnet && accountState.address !== undefined ? commonCopy.mainnetRequiredReason : securityPoolCopy.reviewLiquidation}
																>
																	{securityPoolCopy.reviewLiquidation}
																</button>
															</div>
														)
													}}
													renderBadge={vault => (selectedVaultAddress !== '' && sameCaseInsensitiveText(selectedVaultAddress, vault.vaultAddress) ? <Badge tone='ok'>{commonCopy.selected}</Badge> : undefined)}
													repPerEthPrice={repPerEthPrice}
													repPerEthSource={repPerEthSource}
													repPerEthSourceUrl={repPerEthSourceUrl}
												/>
											</SectionBlock>
										) : (
											<SecurityVaultSection
												{...securityVault}
												compactLayout
												extraReadinessActions={[
													(() => {
														const canUseSelectedVaultActions = accountState.address !== undefined && selectedVaultIsOwnedByAccount && selectedVaultDetails !== undefined && isMainnet
														const loadedVaultMissing = selectedVaultDetails !== undefined && !selectedVaultExistsOnchain
														const liquidationBlocker = (() => {
															if (loadedVaultMissing) return securityPoolCopy.missingVaultDetail
															return undefined
														})()

														return {
															actionLabel: securityPoolCopy.reviewLiquidation,
															...(liquidationBlocker === undefined ? {} : { blocker: liquidationBlocker }),
															description: securityPoolCopy.liquidationWorkflowDescription,
															key: 'liquidate-vault',
															readiness: liquidationBlocker === undefined && liquidationEnabled && canUseSelectedVaultActions ? 'ready' : 'blocked',
															title: securityPoolCopy.reviewLiquidation,
															...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultAddress === '' || !liquidationEnabled || !selectedVaultExistsOnchain || !canUseSelectedVaultActions
																? {}
																: {
																		onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress, selectedVaultDetails.securityBondAllowance),
																	}),
														}
													})(),
												]}
												autoLoadVault
												modalFirst
												onViewStagedOperations={() => onSelectedPoolViewChange('staged-operations')}
												oracleManagerDetails={currentPoolOracleManagerDetails}
												poolState={selectedPoolStateModel}
												selectedPoolTotalRepDeposit={selectedPool?.totalRepDeposit}
												selectedPoolTotalSecurityBondAllowance={selectedPool?.totalSecurityBondAllowance}
												selectedMarketTitle={selectedPool?.marketDetails.title}
												showHeader={false}
												showLookupSection={false}
												showSecurityPoolAddressInput={false}
												showSummarySection={false}
											/>
										)}
									</div>
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
										onTriggerZoltarFork={triggerZoltarForkAvailability.disabled ? undefined : forkAuction.onForkWithOwnEscalation}
										previewMarketDetails={currentReportingDetails === undefined ? marketDetails : undefined}
										reportingDetails={currentReportingDetails}
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
										onReportingFormChange={reporting.onReportingFormChange}
										previewPool={selectedPool}
										reportingDetails={currentReportingDetails}
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
									<SectionBlock density='compact' title={securityPoolCopy.stagedOperations} variant='plain'>
										<ErrorNotice message={poolOracleManagerError} />
										<SectionBlock density='compact' variant='embedded'>
											{stagedOperations.map(operation => (
												<WarningSurface key={operation.operationId.toString()} as='article' className='warning-entity-card' variant='compact'>
													<div className='entity-card-header'>
														<div className='entity-card-copy'>
															<h3>{getPendingOperationLabel(operation.operation)}</h3>
															<p className='detail'>{getStagedOperationExecutionModeLabel(operation.operationId, pendingSettlementOperationIds)}</p>
														</div>
													</div>
													<MetricGrid className='entity-card-body'>
														<MetricField label={securityPoolCopy.operationId}>{operation.operationId.toString()}</MetricField>
														<MetricField label={securityPoolCopy.initiator}>
															<AddressValue address={operation.initiatorVault} />
														</MetricField>
														<MetricField label={commonCopy.targetVault}>
															<AddressValue address={operation.targetVault} />
														</MetricField>
														<MetricField label={commonCopy.amount}>
															<CurrencyValue value={operation.amount} />
														</MetricField>
													</MetricGrid>
												</WarningSurface>
											))}
											{activeStagedOperationCount > BigInt(stagedOperations.length) ? <p className='detail'>{securityPoolCopy.formatShowingActiveStagedOperationsLabel(stagedOperations.length.toString(), activeStagedOperationCount.toString())}</p> : null}
											{currentPoolOracleManagerDetails === undefined || stagedOperations.length > 0 ? null : <StateHint presentation={{ key: 'empty', badgeLabel: securityPoolCopy.noneQueued, badgeTone: 'muted', detail: securityPoolCopy.stagedOperationsEmpty }} />}
										</SectionBlock>
										{currentPoolOracleManagerDetails === undefined ? undefined : (
											<label className='field'>
												<span>{securityPoolCopy.stagedOperationId}</span>
												<FormInput value={manualPendingOperationId} onInput={event => setManualPendingOperationId(event.currentTarget.value)} placeholder={selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : securityPoolCopy.zeroPlaceholder} />
											</label>
										)}
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{(() => {
													if (loadingPoolOracleManager) return <LoadingText>{securityPoolCopy.refreshingOperations}</LoadingText>
													if (currentPoolOracleManagerDetails === undefined) return securityPoolCopy.loadStagedOperations

													return securityPoolCopy.refreshStagedOperations
												})()}
											</button>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
												<TransactionActionButton
													idleLabel={securityPoolCopy.executeStagedOperation}
													pendingLabel={securityPoolCopy.executingStagedOperationLabel}
													onClick={() => {
														if (resolvedPendingOperationId === undefined) return
														onExecutePendingPoolOperation(loadedSelectedPool.managerAddress, resolvedPendingOperationId)
													}}
													pending={poolOracleActiveAction === 'executeStagedOperation'}
													tone='secondary'
													availability={{
														disabled: !selectedPoolStateModel.actions.executeStagedOperation.enabled || !canUseOracleActions || executePendingOperationGuardMessage !== undefined,
														reason: selectedPoolStateModel.actions.executeStagedOperation.enabled ? executePendingOperationGuardMessage : undefined,
													}}
												/>
											)}
										</div>
									</SectionBlock>
								) : undefined}

								{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
									<SectionBlock density='compact' title={securityPoolCopy.openOracle} variant='plain'>
										<MetricGrid>
											<MetricField label={commonCopy.openOraclePrice} valueTagName='span'>
												<OpenOraclePriceValue
													currentTimestamp={currentTimestamp}
													lastPrice={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice}
													lastSettlementTimestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n}
													priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
												/>
											</MetricField>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
												<MetricField label={securityPoolCopy.requestCost}>
													<CurrencyValue value={currentPoolOracleManagerDetails.requestPriceEthCost} suffix={commonCopy.eth} />
												</MetricField>
											)}
											{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
												<MetricField label={securityPoolCopy.pendingRequest}>
													<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
														{securityPoolCopy.formatPendingReportLabel(currentPoolOracleManagerDetails.pendingReportId.toString())}
													</button>
												</MetricField>
											)}
										</MetricGrid>
										<ErrorNotice message={poolOracleManagerError} />
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{loadingPoolOracleManager ? <LoadingText>{securityPoolCopy.refreshingOracle}</LoadingText> : securityPoolCopy.refreshOracle}
											</button>
											<TransactionActionButton
												idleLabel={securityPoolCopy.requestNewPrice}
												pendingLabel={securityPoolCopy.requestingNewPrice}
												onClick={() => onRequestPoolPrice(loadedSelectedPool.managerAddress)}
												pending={poolOracleActiveAction === 'requestPrice'}
												tone='secondary'
												availability={{
													disabled: !selectedPoolStateModel.actions.requestPrice.enabled || !canUseOracleActions || requestPriceGuardMessage !== undefined,
													reason: selectedPoolStateModel.actions.requestPrice.enabled ? requestPriceGuardMessage : undefined,
												}}
											/>
										</div>
									</SectionBlock>
								) : undefined}
							</>
						)}
					</div>
				</div>
			</section>
			<LiquidationModal
				accountAddress={accountState.address}
				closeLiquidationModal={closeLiquidationModal}
				currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
				isMainnet={isMainnet}
				liquidationAmount={liquidationAmount}
				liquidationMaxAmount={liquidationMaxAmount}
				liquidationManagerAddress={liquidationManagerAddress}
				liquidationFundingPreview={liquidationFundingPreview}
				liquidationFundingPreviewError={liquidationFundingPreviewError}
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				liquidationTimeoutMinutes={liquidationTimeoutMinutes}
				loadingPoolOracleManager={loadingPoolOracleManager}
				loadingLiquidationFundingPreview={loadingLiquidationFundingPreview}
				liquidationTargetVault={liquidationTargetVault}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onLoadLiquidationFundingPreview={onLoadLiquidationFundingPreview}
				onSelectedPoolViewChange={onSelectedPoolViewChange}
				poolState={selectedPoolStateModel}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolLiquidationError={securityPoolLiquidationError}
				securityPoolOverviewResult={securityPoolOverviewResult}
				walletEthBalance={accountState.ethBalance}
				callerVaultSummary={accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))}
				targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onLiquidationTimeoutMinutesChange={onLiquidationTimeoutMinutesChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
