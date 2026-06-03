import { useEffect, useRef, useState } from 'preact/hooks'
import { getAddress } from 'viem'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { ForkAuctionSection } from './ForkAuctionSection.js'
import { LiquidationModal } from './LiquidationModal.js'
import { LookupFieldRow } from './LookupFieldRow.js'
import { LoadingText } from './LoadingText.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { Question } from './Question.js'
import { ReportingSection } from './ReportingSection.js'
import { RouteWorkflowPanel } from './RouteWorkflowPanel.js'
import { SecurityPoolSummaryMetrics } from './SecurityPoolSummaryMetrics.js'
import { SecurityPoolVaultDirectory } from './SecurityPoolVaultDirectory.js'
import { SectionBlock } from './SectionBlock.js'
import { getQueuedVaultOperation, SecurityVaultSection, SelectedVaultSummarySection } from './SecurityVaultSection.js'
import { StickyObjectContext } from './StickyObjectContext.js'
import { StateHint } from './StateHint.js'
import { TradingSection } from './TradingSection.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { UniverseLink } from './UniverseLink.js'
import { ViewTabs } from './ViewTabs.js'
import { WarningSurface } from './WarningSurface.js'
import { tryParseBigIntInput } from '../lib/marketForm.js'
import { assertNever } from '../lib/assert.js'
import { normalizeAddress, sameAddress } from '../lib/address.js'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
import {
	applySelectedPoolWorkflowState,
	getForkStageViewForSelectedPoolView,
	getCurrentPoolOracleManagerDetails,
	getSelectedPoolCardTitle,
	getSelectedPoolForkWorkflowView,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolViewLabel,
	getSelectedPoolWorkflowGuardMessage,
	getSelectedPoolWorkflowLockedPresentation,
	isSelectedPoolForkStageView,
	isForkWorkflowDisabled,
	resolveSelectedPoolView,
	SELECTED_POOL_FORK_STAGE_VIEWS,
	SELECTED_POOL_PRIMARY_VIEWS,
	SELECTED_POOL_SECONDARY_VIEWS,
	SELECTED_POOL_VIEWS,
	shouldShowSelectedPoolWorkflowDetails,
	type SelectedPoolView,
} from '../lib/securityPoolWorkflow.js'
import { sameCaseInsensitiveText } from '../lib/caseInsensitive.js'
import { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import { resolveRequestedLoadableValueState } from '../lib/loadState.js'
import { isMainnetChain } from '../lib/network.js'
import { getReportingLockedUntilMessage } from '../lib/reporting.js'
import { getSecurityPoolStatusBadgeLabel } from '../lib/securityPoolLabels.js'
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, evaluateSecurityPoolState, type SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from '../lib/securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, getSelectedVaultAddress, isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js'
import { getPoolRegistryPresentation } from '../lib/userCopy.js'
import { formatUniverseLabel } from '../lib/universe.js'
import type { SecurityPoolWorkflowRouteContentProps, ViewTabOption } from '../types/components.js'
import type { ForkAuctionDetails, ListedSecurityPool } from '../types/contracts.js'
type SelectedVaultView = 'browse-vaults' | 'selected-vault'

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
			return 'Liquidation'
		case 'withdrawRep':
			return 'Withdraw REP'
		case 'setSecurityBondsAllowance':
			return 'Set Bond Allowance'
		default:
			return assertNever(operation)
	}
}
function getSecurityPoolStatusBadgeTone(systemState: SecurityPoolLifecycleState | undefined) {
	if (systemState === 'operational') return 'ok'
	if (systemState === undefined) return 'muted'
	return 'warn'
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
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTargetVault,
	loadingPoolOracleManager,
	loadingSecurityPools,
	onLiquidationAmountChange,
	onLoadPoolOracleManager,
	onOpenLiquidationModal,
	onQueueLiquidation,
	onExecutePendingPoolOperation,
	onRefreshSelectedPoolData,
	onRequestPoolPrice,
	onViewPendingReport,
	poolOracleActiveAction,
	poolOracleManagerDetails,
	poolOracleManagerError,
	poolPriceOracleResult,
	onSecurityPoolAddressChange,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	reporting,
	selectedPoolView,
	securityPoolOverviewActiveAction,
	securityPoolOverviewFeedback,
	securityPoolOverviewError,
	securityPoolOverviewResult,
	securityPoolAddress,
	securityPools,
	securityVault,
	onSelectedPoolViewChange,
	showHeader = true,
	trading,
}: SecurityPoolWorkflowRouteContentProps & {
	showHeader?: boolean
}) {
	const view = resolveSelectedPoolView(selectedPoolView)
	const chainCurrentTimestamp = useChainTimestamp()
	const [manualPendingOperationId, setManualPendingOperationId] = useState('')
	const [vaultView, setVaultView] = useState<SelectedVaultView>('selected-vault')
	const isMainnet = isMainnetChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
	const normalizedReportingFormPoolAddress = normalizeAddress(reporting.reportingForm.securityPoolAddress)
	const currentReportingDetails = sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? reporting.reportingDetails : undefined
	const currentForkAuctionDetails = sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? forkAuction.forkAuctionDetails : undefined
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
	const reportingReady = marketDetails !== undefined && currentTimestamp !== undefined && marketDetails.endTime <= currentTimestamp
	const selectedPoolReportingStage = deriveSecurityPoolReportingStage({
		reportingDetails: currentReportingDetails,
		reportingReady,
	})
	const selectedPoolHasActualForkActivity = currentForkAuctionDetails?.hasForkActivity ?? selectedPool?.hasForkActivity ?? false
	const selectedPoolLifecycleState =
		selectedPoolReportingStage === 'forkTriggered' && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'
			? 'poolForked'
			: deriveSecurityPoolLifecycleState({
					questionOutcome: selectedPoolQuestionOutcome,
					systemState: selectedPoolState,
				})
	const selectedPoolStateModel = evaluateSecurityPoolState({
		lifecycleState: selectedPoolLifecycleState,
		reportingStage: selectedPoolReportingStage,
		universeHasForked: effectiveSelectedPool?.universeHasForked === true,
	})
	const triggerZoltarForkReason = (() => {
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolHasActualForkActivity) {
			return 'Zoltar fork has already been triggered for this pool. Continue in the Fork workflow.'
		}
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolState !== 'operational') {
			return 'This pool has already entered its fork workflow. Continue in the Fork workflow.'
		}
		return 'Triggering a Zoltar fork is not available in the current pool state.'
	})()
	const triggerZoltarForkAvailability = {
		disabled: !(selectedPoolReportingStage === 'forkTriggered' && !selectedPoolHasActualForkActivity && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'),
		reason: triggerZoltarForkReason,
	}
	const selectedPoolHasForkActivity = (() => {
		if (selectedPoolReportingStage === 'forkTriggered') return true
		return selectedPoolHasActualForkActivity
	})()
	const showSelectedPoolForkSummaryMetrics = selectedPoolHasActualForkActivity || (selectedPoolStateModel.lifecycleState !== 'operational' && selectedPoolReportingStage !== 'forkTriggered')
	const reportingLockedReason = (() => {
		if (reportingReady) return undefined
		if (marketDetails === undefined) return 'Reporting opens after market end.'

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
	const currentForkWorkflowView = getSelectedPoolForkWorkflowView({
		forkAuctionDetails: currentForkAuctionDetails,
		selectedPool,
	})
	const openSelectedPoolForkWorkflow = selectedPoolHasActualForkActivity ? () => onSelectedPoolViewChange(currentForkWorkflowView) : undefined
	const shouldRefreshSelectedPoolReporting =
		showSelectedPoolWorkflowDetails &&
		(sameAddress(reporting.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) || ((view === 'reporting' || view === 'withdraw-escalation-deposits') && normalizedSelectedPoolAddress !== undefined && normalizedReportingFormPoolAddress === normalizedSelectedPoolAddress))
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
		{ label: 'Directory', value: 'browse-vaults' },
		{ label: 'Selected', value: 'selected-vault' },
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
	const currentSecurityVaultResult = selectedVaultDetails === undefined ? undefined : securityVault.securityVaultResult
	const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultAddress) ?? ''}:${normalizeAddress(selectedPool?.securityPoolAddress) ?? ''}`
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultAddress) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const lastSelectedVaultAutoLoadKey = useRef<string | undefined>(undefined)
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
	const selectedPoolForkOwnSecurityPool = selectedPoolSummaryPool?.forkOwnSecurityPool
	const selectedPoolOracleMetricValues = loadedSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(loadedSelectedPool)
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({
		accountAddress: accountState.address,
		hasLoadedSelectedPool: loadedSelectedPool !== undefined,
		isMainnet,
		pendingReportId: currentPoolOracleManagerDetails?.pendingReportId,
		requestPriceEthCost: currentPoolOracleManagerDetails?.requestPriceEthCost,
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
	const selectedPoolBrowsePresentation = selectedPool === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined
	const selectedVaultLoadNotice = (() => {
		if (securityVault.loadingSecurityVault)
			return (
				<p className='detail'>
					<LoadingText>Loading vault...</LoadingText>
				</p>
			)
		if (securityVault.securityVaultMissing) return <StateHint presentation={{ key: 'not_found', badgeLabel: 'Not found', badgeTone: 'blocked', detail: 'Try another vault address.' }} />

		return undefined
	})()
	const selectedPoolVaultDefaultKey = `${normalizeAddress(selectedPool?.securityPoolAddress) ?? ''}:${normalizeAddress(accountState.address) ?? ''}`
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
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (normalizedSelectedPoolAddress === undefined) return
		setVaultView('selected-vault')
		if (accountState.address === undefined) return
		if (isSelectedVaultOwnedByAccountHelper(securityVault.securityVaultForm.selectedVaultAddress, accountState.address)) return
		securityVault.onSecurityVaultFormChange({ selectedVaultAddress: accountState.address.toString() })
	}, [accountState.address, securityVault.onSecurityVaultFormChange, securityVault.securityVaultForm.selectedVaultAddress, selectedPoolVaultDefaultKey])
	useEffect(() => {
		if (!showSelectedPoolWorkflowDetails || view !== 'vaults') return
		if (accountState.address === undefined) return
		if (selectedPool?.securityPoolAddress === undefined || selectedVaultAddress === '') return
		if (!sameAddress(selectedVaultSecurityPoolAddress, selectedPool.securityPoolAddress)) return
		if (hasLoadedCurrentVault || securityVault.loadingSecurityVault) return
		if (lastSelectedVaultAutoLoadKey.current === selectedVaultAutoLoadKey) return
		lastSelectedVaultAutoLoadKey.current = selectedVaultAutoLoadKey
		void securityVault.onLoadSecurityVault()
	}, [accountState.address, hasLoadedCurrentVault, securityVault.loadingSecurityVault, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, selectedVaultAddress, selectedVaultAutoLoadKey, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view])
	useEffect(() => {
		const shouldAutoloadReportingForFork = view === 'fork-migration'
		const shouldAutoloadReportingForCurrentView = view === 'reporting' || view === 'withdraw-escalation-deposits' || shouldAutoloadReportingForFork
		if (!shouldAutoloadReportingForCurrentView || !reportingReady || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
			lastReportingAutoLoadKey.current = undefined
			return
		}
		if (sameAddress(reporting.reportingDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (normalizedReportingFormPoolAddress === undefined || normalizedReportingFormPoolAddress !== normalizedSelectedPoolAddress) return
		if (reporting.loadingReportingDetails) return
		const reportingAutoLoadKey = `${normalizedSelectedPoolAddress}:${normalizedReportingFormPoolAddress}`
		if (lastReportingAutoLoadKey.current === reportingAutoLoadKey) return
		lastReportingAutoLoadKey.current = reportingAutoLoadKey
		void reporting.onLoadReporting()
	}, [
		normalizedReportingFormPoolAddress,
		normalizedSelectedPoolAddress,
		reporting.loadingReportingDetails,
		reporting.onLoadReporting,
		reporting.reportingDetails?.securityPoolAddress,
		reportingReady,
		selectedPoolHasActualForkActivity,
		selectedPoolQuestionOutcome,
		selectedPoolState,
		showSelectedPoolWorkflowDetails,
		view,
	])
	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if (!isSelectedPoolForkStageView(view) || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) return
		if (sameAddress(forkAuction.forkAuctionDetails?.securityPoolAddress, normalizedSelectedPoolAddress)) return
		if (forkAuction.loadingForkAuctionDetails) return
		void forkAuction.onLoadForkAuction(getAddress(normalizedSelectedPoolAddress))
	}, [forkAuction.forkAuctionDetails?.securityPoolAddress, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, selectedPool?.securityPoolAddress, showSelectedPoolWorkflowDetails, view])
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
		if (showSelectedPoolWorkflowDetails && hasLoadedCurrentVault && (nextForkAuctionResult.action === 'claimAuctionProceeds' || nextForkAuctionResult.action === 'migrateEscalationDeposits' || nextForkAuctionResult.action === 'migrateVault' || nextForkAuctionResult.action === 'startTruthAuction')) {
			void securityVault.onLoadSecurityVault()
		}
		if (shouldRefreshSelectedPoolReporting && (nextForkAuctionResult.action === 'migrateEscalationDeposits' || nextForkAuctionResult.action === 'forkWithOwnEscalation' || nextForkAuctionResult.action === 'startTruthAuction')) {
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
		if (poolPriceOracleResult.stagedExecution?.success === false) {
			lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash
			return
		}
		if (lastExecutedOperationRefreshHash.current === poolPriceOracleResult.hash) return
		lastExecutedOperationRefreshHash.current = poolPriceOracleResult.hash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if (poolPriceOracleResult.stagedExecution?.operation === 'withdrawRep' && shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [hasLoadedCurrentVault, onRefreshSelectedPoolData, poolPriceOracleResult, reporting.onLoadReporting, securityVault.onLoadSecurityVault, selectedPool?.securityPoolAddress, shouldRefreshSelectedPoolReporting, showSelectedPoolWorkflowDetails, view])
	const selectSelectedPoolView = (nextView: SelectedPoolView) => {
		onSelectedPoolViewChange(hasSelectedPoolAddress ? nextView : undefined)
	}
	const moveSelectedPoolView = (currentView: SelectedPoolView, direction: 'next' | 'previous' | 'first' | 'last') => {
		if (selectedPoolWorkflowGuardMessage !== undefined) return undefined
		const enabledViews = SELECTED_POOL_VIEWS
		if (enabledViews.length === 0) return undefined
		if (direction === 'first') return enabledViews[0]
		if (direction === 'last') return enabledViews[enabledViews.length - 1]
		const currentIndex = enabledViews.indexOf(currentView)
		if (currentIndex === -1) return enabledViews[0]
		const nextIndex = direction === 'next' ? (currentIndex + 1) % enabledViews.length : (currentIndex - 1 + enabledViews.length) % enabledViews.length
		return enabledViews[nextIndex]
	}
	const handleSelectedPoolViewKeyDown = (currentView: SelectedPoolView, event: KeyboardEvent) => {
		const navigationKey = (() => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowRight') return 'next'
			if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') return 'previous'
			if (event.key === 'Home') return 'first'
			if (event.key === 'End') return 'last'
			return undefined
		})()
		if (navigationKey === undefined) return
		const nextView = moveSelectedPoolView(currentView, navigationKey)
		if (nextView === undefined) return
		event.preventDefault()
		selectSelectedPoolView(nextView)
		const nextTab = document.getElementById(`selected-pool-view-${nextView}`)
		if (nextTab instanceof HTMLElement) nextTab.focus()
	}
	const renderSelectedPoolViewTab = (selectedPoolUiView: SelectedPoolView) => {
		return (
			<button
				aria-label={getSelectedPoolViewLabel(selectedPoolUiView)}
				key={selectedPoolUiView}
				aria-selected={view === selectedPoolUiView}
				className={`view-tab ${view === selectedPoolUiView ? 'active' : ''}`.trim()}
				disabled={selectedPoolWorkflowGuardMessage !== undefined}
				id={`selected-pool-view-${selectedPoolUiView}`}
				onClick={() => selectSelectedPoolView(selectedPoolUiView)}
				onKeyDown={event => handleSelectedPoolViewKeyDown(selectedPoolUiView, event)}
				role='tab'
				tabIndex={view === selectedPoolUiView ? 0 : -1}
				title={selectedPoolWorkflowGuardMessage}
				type='button'
			>
				{getSelectedPoolViewLabel(selectedPoolUiView)}
			</button>
		)
	}
	return (
		<RouteWorkflowPanel showHeader={showHeader} title='Selected Pool'>
			<StickyObjectContext
				{...(loadedSelectedPool === undefined || selectedPoolSummaryPool === undefined
					? {}
					: {
							badge: <span className={`badge ${getSecurityPoolStatusBadgeTone(selectedPoolStateModel.lifecycleState)}`}>{getSecurityPoolStatusBadgeLabel({ hasForkActivity: selectedPoolSummaryPool.hasForkActivity, lifecycleState: selectedPoolStateModel.lifecycleState })}</span>,
						})}
				sticky={false}
				title={getSelectedPoolCardTitle()}
				items={[]}
			>
				<div className='selected-pool-context-controls'>
					<div className='selected-pool-context-lookup'>
						<LookupFieldRow
							label='Security Pool Address'
							value={securityPoolAddress}
							onInput={onSecurityPoolAddressChange}
							placeholder='0x...'
							action={
								<button className='secondary' onClick={() => onRefreshSelectedPoolData()} disabled={!hasSelectedPoolAddress || loadingSecurityPools}>
									{loadingSecurityPools ? <LoadingText>Refreshing pool...</LoadingText> : 'Refresh pool'}
								</button>
							}
						/>
					</div>
				</div>
				{selectedPoolSummaryPool === undefined ? undefined : (
					<div className='selected-pool-context-summary'>
						<div className='selected-pool-context-overview'>
							<SecurityPoolSummaryMetrics className='selected-pool-context-grid' pool={selectedPoolSummaryPool} repPerEthPrice={repPerEthPrice} repPerEthSource={repPerEthSource} repPerEthSourceUrl={repPerEthSourceUrl} showTotalBacking>
								<MetricField label='Open Oracle Price' valueTagName='span'>
									<OpenOraclePriceValue
										currentTimestamp={currentTimestamp}
										lastPrice={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice}
										lastSettlementTimestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n}
										priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
									/>
								</MetricField>
								{!showSelectedPoolForkSummaryMetrics ? undefined : (
									<>
										<MetricField label='Fork Mode'>{selectedPoolForkOwnSecurityPool === true ? 'Own escalation fork' : 'Parent / Zoltar fork'}</MetricField>
									</>
								)}
								{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
									<MetricField label='Pending Request'>
										<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
											Report #{currentPoolOracleManagerDetails.pendingReportId.toString()}
										</button>
									</MetricField>
								)}
							</SecurityPoolSummaryMetrics>
						</div>
						{marketDetails === undefined ? undefined : (
							<SectionBlock headingLevel={3} title='Question' variant='embedded'>
								<Question question={marketDetails} />
							</SectionBlock>
						)}
					</div>
				)}
			</StickyObjectContext>

			{selectedPool === undefined || !selectedPoolUniverseMismatch ? undefined : (
				<SectionBlock title='Universe Mismatch' tone='critical'>
					<p className='detail'>
						This pool belongs to <UniverseLink universeId={selectedPool.universeId} /> but the app is currently set to {formatUniverseLabel(activeUniverseId)}.
					</p>
					<p className='detail'>Switch to the same universe before using this pool.</p>
				</SectionBlock>
			)}

			<section className='selected-pool-workspace'>
				<div className='selected-pool-workspace-grid'>
					<div className='selected-pool-workflow-rail'>
						<div aria-label='Selected pool views' className='selected-pool-workflow-nav view-tabs' data-orientation='vertical' data-size='compact' role='tablist'>
							<div className='selected-pool-workflow-group' role='group' aria-label='Primary pool workflows'>
								{SELECTED_POOL_PRIMARY_VIEWS.map(renderSelectedPoolViewTab)}
							</div>
							<div className='selected-pool-workflow-group selected-pool-workflow-group-fork' role='group' aria-label='Fork workflow stages'>
								<p className='selected-pool-workflow-group-label'>Fork Workflow</p>
								{SELECTED_POOL_FORK_STAGE_VIEWS.map(renderSelectedPoolViewTab)}
							</div>
							<div className='selected-pool-workflow-group selected-pool-workflow-group-secondary' role='group' aria-label='Additional pool workflows'>
								{SELECTED_POOL_SECONDARY_VIEWS.map(renderSelectedPoolViewTab)}
							</div>
						</div>
					</div>

					<div className='selected-pool-workflow-content'>
						{!showSelectedPoolWorkflowDetails ? (
							<SectionBlock title={selectedPoolLookupState === 'missing' ? 'Pool not found' : 'Pool Workflows'}>{selectedPoolWorkflowLockedPresentation === undefined ? undefined : <StateHint presentation={selectedPoolWorkflowLockedPresentation} />}</SectionBlock>
						) : (
							<>
								{view === 'vaults' ? (
									<div className='workflow-stack vault-workspace'>
										<SectionBlock
											density='compact'
											title='Vault Operations'
											actions={
												<div className='actions'>
													<ViewTabs ariaLabel='Selected pool vault views' className='vault-content-switch' size='compact' value={vaultView} onChange={setVaultView} options={selectedVaultViewOptions} />
												</div>
											}
										>
											{selectedVaultLoadNotice}
											<LookupFieldRow
												label='Selected Vault Address'
												value={selectedVaultAddressInput}
												onInput={selectedVaultAddress => securityVault.onSecurityVaultFormChange({ selectedVaultAddress })}
												placeholder='0x...'
												action={
													<button className='secondary' onClick={() => securityVault.onLoadSecurityVault()} disabled={securityVault.loadingSecurityVault}>
														{securityVault.loadingSecurityVault ? <LoadingText>Refreshing...</LoadingText> : 'Refresh'}
													</button>
												}
											/>
											{selectedVaultIsOwnedByAccount ? undefined : <p className='detail'>Select your own vault to unlock actions.</p>}
											{vaultView === 'selected-vault' && selectedVaultDetails !== undefined ? (
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
											<SectionBlock title='Vault Directory'>
												<SecurityPoolVaultDirectory
													emptyState={(() => {
														if (selectedPool === undefined) {
															if (selectedPoolBrowsePresentation === undefined) return undefined

															return <StateHint presentation={selectedPoolBrowsePresentation} />
														}

														return <StateHint presentation={{ key: 'empty', badgeLabel: 'None yet', badgeTone: 'muted', detail: 'No vaults in this pool yet.' }} />
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
																	Select Vault
																</button>
																<button
																	className='destructive'
																	onClick={() => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, vault.vaultAddress, vault.securityBondAllowance)}
																	disabled={accountState.address === undefined || !isMainnet || currentPoolOracleManagerDetails?.isPriceValid === false || !liquidationEnabled}
																>
																	Liquidate Vault
																</button>
															</div>
														)
													}}
													renderBadge={vault => (selectedVaultAddress !== '' && sameCaseInsensitiveText(selectedVaultAddress, vault.vaultAddress) ? <span className='badge ok'>Selected</span> : undefined)}
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
													{
														actionLabel: 'Liquidate Vault',
														description: 'Queue a high-risk liquidation against the selected vault.',
														key: 'liquidate-vault',
														readiness: liquidationEnabled ? 'ready' : 'blocked',
														title: 'Liquidate Vault',
														...(() => {
															if (selectedPool === undefined || selectedVaultDetails === undefined) return { blocker: 'Refresh the selected vault first.' }
															if (selectedVaultAddress === '') return { blocker: 'Select a pool and vault first.' }

															return {}
														})(),
														...(selectedPool === undefined || selectedVaultDetails === undefined || selectedVaultAddress === '' || !liquidationEnabled
															? {}
															: {
																	onAction: () => onOpenLiquidationModal(selectedPool.managerAddress, selectedPool.securityPoolAddress, selectedVaultDetails.vaultAddress, selectedVaultDetails.securityBondAllowance),
																}),
													},
												]}
												modalFirst
												onViewStagedOperations={() => onSelectedPoolViewChange('staged-operations')}
												oracleManagerDetails={currentPoolOracleManagerDetails}
												poolState={selectedPoolStateModel}
												selectedPoolTotalRepDeposit={selectedPool?.totalRepDeposit}
												selectedPoolTotalSecurityBondAllowance={selectedPool?.totalSecurityBondAllowance}
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

								{view === 'withdraw-escalation-deposits' ? (
									<ReportingSection
										{...reporting}
										currentTimestamp={currentTimestamp}
										embedInCard
										forkAlreadyTriggered={selectedPoolHasActualForkActivity}
										lockedReason={reportingLockedReason}
										mode='withdraw-only'
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

								{isSelectedPoolForkStageView(view) ? (
									<ForkAuctionSection
										{...forkAuction}
										currentTimestamp={currentTimestamp}
										disabled={forkWorkflowDisabled}
										disabledMessage={forkWorkflowDisabled ? 'This pool is currently operational, so fork and truth auction actions are read only.' : undefined}
										embedInCard
										forkAuctionDetails={currentForkAuctionDetails}
										lifecycleStateOverride={selectedPoolLifecycleState}
										loadingReportingDetails={reporting.loadingReportingDetails}
										onReportingFormChange={reporting.onReportingFormChange}
										previewPool={selectedPool}
										reportingDetails={currentReportingDetails}
										reportingForm={reporting.reportingForm}
										securityPools={securityPools}
										stageView={getForkStageViewForSelectedPoolView(view)}
										showHeader={false}
										showSecurityPoolAddressInput={false}
									/>
								) : undefined}

								{view === 'staged-operations' && loadedSelectedPool !== undefined ? (
									<SectionBlock density='compact' title='Staged Operations'>
										<ErrorNotice message={poolOracleManagerError} />
										<SectionBlock density='compact' headingLevel={4} title='Staged Operations List' variant='embedded'>
											{currentPoolOracleManagerDetails?.pendingOperation === undefined ? null : (
												<WarningSurface as='article' className='warning-entity-card' variant='compact'>
													<div className='entity-card-header'>
														<div className='entity-card-copy'>
															<h3>{getPendingOperationLabel(currentPoolOracleManagerDetails.pendingOperation.operation)}</h3>
														</div>
													</div>
													<div className='entity-card-body workflow-metric-grid'>
														<MetricField label='Operation Id'>{currentPoolOracleManagerDetails.pendingOperation.operationId.toString()}</MetricField>
														<MetricField label='Initiator'>
															<AddressValue address={currentPoolOracleManagerDetails.pendingOperation.initiatorVault} />
														</MetricField>
														<MetricField label='Target Vault'>
															<AddressValue address={currentPoolOracleManagerDetails.pendingOperation.targetVault} />
														</MetricField>
														<MetricField label='Amount'>
															<CurrencyValue value={currentPoolOracleManagerDetails.pendingOperation.amount} />
														</MetricField>
													</div>
												</WarningSurface>
											)}
											{currentPoolOracleManagerDetails === undefined || currentPoolOracleManagerDetails.pendingOperation !== undefined ? null : <StateHint presentation={{ key: 'empty', badgeLabel: 'None queued', badgeTone: 'muted', detail: 'No staged operations are currently queued for this pool.' }} />}
										</SectionBlock>
										{currentPoolOracleManagerDetails === undefined ? undefined : (
											<label className='field'>
												<span>Staged Operation Id</span>
												<FormInput value={manualPendingOperationId} onInput={event => setManualPendingOperationId(event.currentTarget.value)} placeholder={selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : '0'} />
											</label>
										)}
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{(() => {
													if (loadingPoolOracleManager) return <LoadingText>Refreshing operations...</LoadingText>
													if (currentPoolOracleManagerDetails === undefined) return 'Load Staged Operations'

													return 'Refresh Staged Operations'
												})()}
											</button>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
												<TransactionActionButton
													idleLabel='Execute Staged Operation'
													pendingLabel='Executing staged operation...'
													onClick={() => {
														if (resolvedPendingOperationId === undefined) return
														onExecutePendingPoolOperation(loadedSelectedPool.managerAddress, resolvedPendingOperationId)
													}}
													pending={poolOracleActiveAction === 'executeStagedOperation'}
													tone='secondary'
													availability={{
														disabled: !selectedPoolStateModel.actions.executeStagedOperation.enabled || executePendingOperationGuardMessage !== undefined,
														reason: selectedPoolStateModel.actions.executeStagedOperation.enabled ? executePendingOperationGuardMessage : undefined,
													}}
												/>
											)}
										</div>
									</SectionBlock>
								) : undefined}

								{view === 'price-oracle' && loadedSelectedPool !== undefined ? (
									<SectionBlock density='compact' title='Open Oracle'>
										<div className='workflow-metric-grid'>
											<MetricField label='Open Oracle Price' valueTagName='span'>
												<OpenOraclePriceValue
													currentTimestamp={currentTimestamp}
													lastPrice={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice}
													lastSettlementTimestamp={(currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp ?? 0n}
													priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp}
												/>
											</MetricField>
											{currentPoolOracleManagerDetails === undefined ? undefined : (
												<MetricField label='Request Cost'>
													<CurrencyValue value={currentPoolOracleManagerDetails.requestPriceEthCost} suffix='ETH' />
												</MetricField>
											)}
											{currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n ? undefined : (
												<MetricField label='Pending Request'>
													<button className='link' type='button' onClick={() => onViewPendingReport(currentPoolOracleManagerDetails.pendingReportId)}>
														Report #{currentPoolOracleManagerDetails.pendingReportId.toString()}
													</button>
												</MetricField>
											)}
										</div>
										<ErrorNotice message={poolOracleManagerError} />
										<div className='actions'>
											<button className='secondary' onClick={() => onLoadPoolOracleManager(loadedSelectedPool.managerAddress)} disabled={loadingPoolOracleManager}>
												{loadingPoolOracleManager ? <LoadingText>Refreshing oracle...</LoadingText> : 'Refresh Oracle'}
											</button>
											<TransactionActionButton
												idleLabel='Request New Price'
												pendingLabel='Requesting new price...'
												onClick={() => onRequestPoolPrice(loadedSelectedPool.managerAddress)}
												pending={poolOracleActiveAction === 'requestPrice'}
												tone='secondary'
												availability={{
													disabled: !selectedPoolStateModel.actions.requestPrice.enabled || requestPriceGuardMessage !== undefined,
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
				liquidationModalOpen={liquidationModalOpen}
				liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
				loadingPoolOracleManager={loadingPoolOracleManager}
				liquidationTargetVault={liquidationTargetVault}
				onLoadPoolOracleManager={onLoadPoolOracleManager}
				onSelectedPoolViewChange={onSelectedPoolViewChange}
				poolState={selectedPoolStateModel}
				repPerEthPrice={repPerEthPrice}
				repPerEthSource={repPerEthSource}
				repPerEthSourceUrl={repPerEthSourceUrl}
				selectedPool={selectedPool}
				securityPoolOverviewActiveAction={securityPoolOverviewActiveAction}
				securityPoolOverviewError={securityPoolOverviewError}
				securityPoolOverviewFeedback={securityPoolOverviewFeedback}
				securityPoolOverviewResult={securityPoolOverviewResult}
				walletEthBalance={accountState.ethBalance}
				callerVaultSummary={accountState.address === undefined ? undefined : selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))}
				targetVaultSummary={selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, liquidationTargetVault))}
				onLiquidationAmountChange={onLiquidationAmountChange}
				onQueueLiquidation={onQueueLiquidation}
			/>
		</RouteWorkflowPanel>
	)
}
