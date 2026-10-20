import { useEffect, useRef } from 'preact/hooks'
import { useBlockRefresh } from '@zoltar/ui-core-shared/hooks/useDataRefresh.js'
import { type Address, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ForkAuctionDetails, ListedSecurityPool, OpenOracleActionResult, OracleManagerDetails, ReportingDetails, SecurityPoolOverviewActionResult } from '../../../types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../../types.js'
import { isSelectedPoolForkWorkflowView, type SelectedPoolView, shouldReloadSelectedPoolDetails } from '../lib/securityPoolWorkflow.js'
import type { getLiquidationNoticeState } from '../lib/liquidationStatus.js'
import type { SecurityPoolLifecycleState } from '../lib/securityPoolState.js'
import { isForkLifecycleState } from '../lib/poolLifecycle.js'
import { hasEscalationGame } from '../../markets/lib/trading.js'

type UseSelectedPoolRefreshEffectsParameters = {
	currentTimestamp: bigint | undefined
	currentForkAuctionDetails: ForkAuctionDetails | undefined
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOracleManagerError: string | undefined
	currentReportingDetails: ReportingDetails | undefined
	forkAuction: SecurityPoolWorkflowRouteContentProps['forkAuction']
	hasLoadedCurrentVault: boolean
	liquidationNoticeState: ReturnType<typeof getLiquidationNoticeState>
	loadedForkAuctionDetails: ForkAuctionDetails | undefined
	loadedReportingDetails: ReportingDetails | undefined
	loadingPoolOracleManager: boolean
	normalizedReportingFormPoolAddress: string | undefined
	normalizedSelectedPoolAddress: string | undefined
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onRefreshSelectedPoolData: (securityPoolAddress?: string) => void
	poolOracleManagerDetails: OracleManagerDetails | undefined
	poolPriceOracleResult: OpenOracleActionResult | undefined
	reporting: SecurityPoolWorkflowRouteContentProps['reporting']
	reportingReady: boolean | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	securityVault: SecurityPoolWorkflowRouteContentProps['securityVault']
	selectedPool: ListedSecurityPool | undefined
	selectedPoolHasActualForkActivity: boolean
	selectedPoolLifecycleState: SecurityPoolLifecycleState | undefined
	selectedPoolManagerAddress: Address | undefined
	selectedPoolQuestionOutcome: ReportingOutcomeKey | 'none' | undefined
	selectedPoolRefreshNonce: number
	selectedPoolState: SecurityPoolSystemState | undefined
	shouldRefreshSelectedPoolReporting: boolean
	showSelectedPoolWorkflowDetails: boolean
	view: SelectedPoolView
}

/**
 * Owns the autoload and post-transaction refresh effects of the selected-pool workflow so the
 * section component only derives state and renders.
 */
export function useSelectedPoolRefreshEffects({
	currentTimestamp,
	currentForkAuctionDetails,
	currentPoolOracleManagerDetails,
	currentPoolOracleManagerError,
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
	selectedPoolLifecycleState,
	selectedPoolManagerAddress,
	selectedPoolQuestionOutcome,
	selectedPoolRefreshNonce,
	selectedPoolState,
	shouldRefreshSelectedPoolReporting,
	showSelectedPoolWorkflowDetails,
	view,
}: UseSelectedPoolRefreshEffectsParameters) {
	const lastHandledReportingRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastHandledForkAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastForkAuctionAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const lastStagedViewRefreshManager = useRef<Address | undefined>(undefined)
	const lastQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastLiquidationOutcomeRefreshKey = useRef<string | undefined>(undefined)
	const lastExecutedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastForkAuctionOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const pendingPriceRefresh = useRef({ loadingPoolOracleManager, onLoadPoolOracleManager })
	pendingPriceRefresh.current = { loadingPoolOracleManager, onLoadPoolOracleManager }
	const previousPendingReport = useRef<{ managerAddress: Address; reportId: bigint } | undefined>(undefined)
	useEffect(() => {
		if (currentPoolOracleManagerDetails === undefined) return
		const previous = previousPendingReport.current
		if (previous !== undefined && sameAddress(previous.managerAddress, currentPoolOracleManagerDetails.managerAddress) && previous.reportId > 0n && previous.reportId !== currentPoolOracleManagerDetails.pendingReportId) {
			onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		}
		previousPendingReport.current = { managerAddress: currentPoolOracleManagerDetails.managerAddress, reportId: currentPoolOracleManagerDetails.pendingReportId }
	}, [currentPoolOracleManagerDetails, onRefreshSelectedPoolData, selectedPool?.securityPoolAddress])
	// A pending price report becomes settleable at its ready time; from then on every new block re-reads the manager until the report settles.
	const pendingReportId = currentPoolOracleManagerDetails?.pendingReportId
	const pendingReportReadyAt = currentPoolOracleManagerDetails?.pendingReportReadyAtTimestamp
	const pendingReportRefreshActive = pendingReportId !== undefined && pendingReportId !== 0n && selectedPoolManagerAddress !== undefined && (pendingReportReadyAt === undefined || currentTimestamp === undefined || currentTimestamp >= pendingReportReadyAt)
	const refreshPendingReport = () => {
		const state = pendingPriceRefresh.current
		if (state.loadingPoolOracleManager || selectedPoolManagerAddress === undefined) return
		state.onLoadPoolOracleManager(selectedPoolManagerAddress)
	}
	useEffect(() => {
		if (pendingReportRefreshActive) refreshPendingReport()
	}, [pendingReportId, pendingReportRefreshActive, selectedPoolManagerAddress])
	useEffect(() => {
		if (view !== 'staged-operations') {
			lastStagedViewRefreshManager.current = undefined
			return
		}
		if (selectedPoolManagerAddress === undefined || loadingPoolOracleManager || lastStagedViewRefreshManager.current === selectedPoolManagerAddress) return
		lastStagedViewRefreshManager.current = selectedPoolManagerAddress
		refreshPendingReport()
	}, [view, selectedPoolManagerAddress, loadingPoolOracleManager])
	useBlockRefresh(refreshPendingReport, pendingReportRefreshActive || view === 'vaults' || view === 'staged-operations')
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
		const queuedOperationHash = securityPoolOverviewResult?.action === 'queueLiquidation' ? securityPoolOverviewResult.hash : undefined
		if (queuedOperationHash === undefined) {
			lastQueuedOperationRefreshHash.current = undefined
			return
		}
		if (lastQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastQueuedOperationRefreshHash.current = queuedOperationHash
		void onLoadPoolOracleManager(selectedPoolManagerAddress)
	}, [loadingPoolOracleManager, onLoadPoolOracleManager, securityPoolOverviewResult, selectedPoolManagerAddress])
	// Once an escalation has started, the reporting stage decides whether the pool is forked, which the header reflects on every tab.
	const selectedPoolEscalationStarted = selectedPool !== undefined && hasEscalationGame(selectedPool)
	useEffect(() => {
		const shouldAutoloadReportingForFork = view === 'fork-workflow'
		const shouldAutoloadReportingForCurrentView = view === 'reporting' || shouldAutoloadReportingForFork || selectedPoolEscalationStarted
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
		selectedPoolEscalationStarted,
		selectedPoolRefreshNonce,
		selectedPoolHasActualForkActivity,
		selectedPoolQuestionOutcome,
		selectedPoolState,
		showSelectedPoolWorkflowDetails,
		view,
	])
	// A forked pool's header shows its migration or auction deadline on every tab, so its fork details load whatever the view.
	// The derived lifecycle decides, as the header does: a parent pool in a forked universe is forked while its registry state is still operational.
	const selectedPoolInForkStage = isForkLifecycleState(selectedPoolLifecycleState)
	useEffect(() => {
		const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
		if ((!isSelectedPoolForkWorkflowView(view) && !selectedPoolInForkStage) || !showSelectedPoolWorkflowDetails || normalizedSelectedPoolAddress === undefined) {
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
	}, [currentForkAuctionDetails, forkAuction.loadingForkAuctionDetails, forkAuction.onLoadForkAuction, loadedForkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress, selectedPoolInForkStage, selectedPoolRefreshNonce, showSelectedPoolWorkflowDetails, view])
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
}
