import { useEffect, useRef } from 'preact/hooks'
import { type Address, getAddress } from '@zoltar/core-shared/evm/ethereum'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ForkAuctionDetails, ListedSecurityPool, OpenOracleActionResult, OracleManagerDetails, ReportingDetails, ReportingOutcomeKey, SecurityPoolOverviewActionResult, SecurityPoolSystemState, StagedOracleOperation } from '@zoltar/ui-core-shared/types/contracts.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../../types.js'
import { isSelectedPoolForkWorkflowView, type SelectedPoolView, shouldReloadSelectedPoolDetails } from '../lib/securityPoolWorkflow.js'
import type { getLiquidationNoticeState } from '../lib/liquidationStatus.js'

type UseSelectedPoolRefreshEffectsParameters = {
	currentTimestamp: bigint | undefined
	currentForkAuctionDetails: ForkAuctionDetails | undefined
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOracleManagerError: string | undefined
	currentPoolOraclePriceUsable: boolean | undefined
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
	selectedPoolManagerAddress: Address | undefined
	selectedPoolQuestionOutcome: ReportingOutcomeKey | 'none' | undefined
	selectedPoolRefreshNonce: number
	selectedPoolState: SecurityPoolSystemState | undefined
	shouldRefreshSelectedPoolReporting: boolean
	showSelectedPoolWorkflowDetails: boolean
	stagedOperations: StagedOracleOperation[]
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
}: UseSelectedPoolRefreshEffectsParameters) {
	const lastHandledReportingRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastHandledForkAuctionRefreshNonceRef = useRef(selectedPoolRefreshNonce)
	const lastForkAuctionAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingAutoLoadKey = useRef<string | undefined>(undefined)
	const lastReportingOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const lastVaultStatusRefreshHash = useRef<string | undefined>(undefined)
	const lastQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastImmediateQueuedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastLiquidationOutcomeRefreshKey = useRef<string | undefined>(undefined)
	const lastExecutedOperationRefreshHash = useRef<string | undefined>(undefined)
	const lastForkAuctionOutcomeRefreshHash = useRef<string | undefined>(undefined)
	const pendingPriceRefresh = useRef({ loadingPoolOracleManager, onLoadPoolOracleManager })
	pendingPriceRefresh.current = { loadingPoolOracleManager, onLoadPoolOracleManager }
	const previousPendingReport = useRef<{ managerAddress: Address; reportId: bigint } | undefined>(undefined)
	useEffect(() => {
		if (currentPoolOracleManagerDetails === undefined) return
		const previous = previousPendingReport.current
		if (previous !== undefined && sameAddress(previous.managerAddress, currentPoolOracleManagerDetails.managerAddress) && previous.reportId > 0n && currentPoolOracleManagerDetails.pendingReportId === 0n) {
			onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		}
		previousPendingReport.current = { managerAddress: currentPoolOracleManagerDetails.managerAddress, reportId: currentPoolOracleManagerDetails.pendingReportId }
	}, [currentPoolOracleManagerDetails, onRefreshSelectedPoolData, selectedPool?.securityPoolAddress])
	useEffect(() => {
		if (currentPoolOracleManagerDetails?.pendingReportId === undefined || currentPoolOracleManagerDetails.pendingReportId === 0n || selectedPoolManagerAddress === undefined) return
		const readyAt = currentPoolOracleManagerDetails.pendingReportReadyAtTimestamp
		const secondsUntilReady = readyAt === undefined ? 5n : readyAt - (currentTimestamp ?? BigInt(Math.floor(Date.now() / 1000)))
		const firstDelay = secondsUntilReady <= 0n ? 0 : Number(secondsUntilReady > 2147483n ? 2147483n : secondsUntilReady) * 1000
		let interval: ReturnType<typeof setInterval> | undefined
		const refresh = () => {
			const state = pendingPriceRefresh.current
			if (state.loadingPoolOracleManager) return
			state.onLoadPoolOracleManager(selectedPoolManagerAddress)
		}
		const timeout = setTimeout(() => {
			refresh()
			interval = setInterval(refresh, 5000)
		}, firstDelay)
		return () => {
			clearTimeout(timeout)
			if (interval !== undefined) clearInterval(interval)
		}
	}, [currentPoolOracleManagerDetails?.pendingReportId, currentPoolOracleManagerDetails?.pendingReportReadyAtTimestamp, currentTimestamp, selectedPoolManagerAddress])
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
			if (securityVault.securityVaultResult?.action === 'queueWithdrawRep' || securityVault.securityVaultResult?.action === 'adjustVaultBackingFactor') return securityVault.securityVaultResult.hash
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
		const queuedOperationHash = securityVault.securityVaultResult?.action === 'queueWithdrawRep' || securityVault.securityVaultResult?.action === 'adjustVaultBackingFactor' ? securityVault.securityVaultResult.hash : undefined
		if (queuedOperationHash === undefined) {
			lastImmediateQueuedOperationRefreshHash.current = undefined
			return
		}
		if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return
		if (stagedOperations.some(operation => operation.operationId === securityVault.securityVaultResult?.queuedOperation?.operationId) || currentPoolOraclePriceUsable !== true) return
		if (lastImmediateQueuedOperationRefreshHash.current === queuedOperationHash) return
		lastImmediateQueuedOperationRefreshHash.current = queuedOperationHash
		void onRefreshSelectedPoolData(selectedPool?.securityPoolAddress)
		if ((securityVault.securityVaultResult?.action === 'queueWithdrawRep' || securityVault.securityVaultResult?.action === 'adjustVaultBackingFactor') && shouldRefreshSelectedPoolReporting) void reporting.onLoadReporting()
		if (showSelectedPoolWorkflowDetails && view === 'vaults' && hasLoadedCurrentVault) void securityVault.onLoadSecurityVault()
	}, [
		currentPoolOracleManagerDetails,
		currentPoolOraclePriceUsable,
		hasLoadedCurrentVault,
		loadingPoolOracleManager,
		onRefreshSelectedPoolData,
		stagedOperations,
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
}
