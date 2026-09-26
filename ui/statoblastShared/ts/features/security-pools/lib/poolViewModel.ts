import * as securityPoolCopy from '../../../copy/securityPool.js'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { sameCaseInsensitiveText } from '@zoltar/ui-core-shared/lib/caseInsensitive.js'
import { resolveRequestedLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js'
import { getPoolRegistryPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'
import { isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import type { ForkAuctionDetails, ReportingDetails, SecurityPoolVaultSummary, SecurityVaultDetails, TradingShareBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import { isPoolQuestionFinalized } from '../../reporting/lib/reportingDomain.js'
import { getReportingLockedUntilMessage, hasReportingOpened } from '../../reporting/lib/reporting.js'
import { addOpenOracleBountyBuffer } from '../../open-oracle/lib/openOracle.js'
import { AUCTION_TIME_SECONDS } from '../../truth-auctions/lib/forkAuction.js'
import type { SecurityPoolWorkflowRouteContentProps } from '../../types.js'
import type { RequestPriceReview } from '../components/SecurityPoolOracleSections.js'
import { buildSelectedPoolSummaryPool } from '../components/SecurityPoolWorkflowPresentation.js'
import { derivePoolActionItems, type PoolAccountVault } from './poolActions.js'
import { deriveListedPoolLifecycleStep, derivePoolLifecycleStep, getDefaultPoolTab, isForkWorkflowPrimary } from './poolLifecycle.js'
import { deriveSecurityPoolLifecycleState, deriveSecurityPoolReportingStage, deriveVaultAdmissionClosed, evaluateSecurityPoolState } from './securityPoolState.js'
import {
	applySelectedPoolWorkflowState,
	getCurrentForkWorkflowSelectionStage,
	getCurrentPoolOracleManagerDetails,
	getCurrentSelectedPoolForkAuctionDetails,
	getCurrentSelectedPoolForkStage,
	getCurrentSelectedPoolReportingDetails,
	getSelectedPoolOracleMetricValues,
	getSelectedPoolWorkflowLockedPresentation,
	hasCurrentSelectedPoolForkActivity,
	isForkWorkflowDisabled,
	resolveForkWorkflowSelectionStage,
	resolveSelectedPoolView,
	shouldShowSelectedPoolWorkflowDetails,
} from './securityPoolWorkflow.js'
import { getVaultExecutePendingOperationGuardMessage, getVaultRequestPriceGuardMessage } from './securityVaultGuards.js'
import { doesLoadedSecurityVaultMatchSelection, doesSecurityVaultExistOnchain, getSelectedVaultOwner, isOracleManagerPriceUsable, isSelectedVaultOwnedByAccount } from './securityVault.js'

export type PoolViewModelInput = Pick<
	SecurityPoolWorkflowRouteContentProps,
	'accountState' | 'activeUniverseId' | 'checkedSecurityPoolAddress' | 'liquidationManagerAddress' | 'loadingSecurityPools' | 'poolOracleManagerDetails' | 'poolOracleManagerError' | 'poolOracleManagerErrorAddress' | 'securityPoolAddress' | 'securityPoolOverviewError' | 'securityPools' | 'selectedPoolView'
> & {
	forkAuctionDetails: ForkAuctionDetails | undefined
	manualPendingOperationId: string
	/** The chain clock; the loaded reporting or fork details supply a time when it is unknown. */
	now: bigint | undefined
	reportingDetails: ReportingDetails | undefined
	reportingFormSecurityPoolAddress: string
	requestPriceReview: RequestPriceReview | undefined
	securityVaultDetails: SecurityVaultDetails | undefined
	selectedVaultOwnerInput: string
	shareBalances: TradingShareBalances | undefined
}

function toAccountVault(vault: Pick<SecurityPoolVaultSummary, 'capacityOwnershipAttoRep' | 'claimableFeesAttoEth' | 'disputeStakedAttoRep' | 'vaultAttoRepBacking'> | undefined): PoolAccountVault | undefined {
	if (vault === undefined) return undefined
	if (vault.capacityOwnershipAttoRep === 0n && vault.vaultAttoRepBacking === 0n && vault.claimableFeesAttoEth === 0n && vault.disputeStakedAttoRep === 0n) return undefined
	return { claimableFeesAttoEth: vault.claimableFeesAttoEth, disputeStakedAttoRep: vault.disputeStakedAttoRep, repAttoRep: vault.vaultAttoRepBacking }
}

function getReportingLockedReason({ marketEndTime, now, reportingReady, systemState }: { marketEndTime: bigint | undefined; now: bigint | undefined; reportingReady: boolean | undefined; systemState: string | undefined }) {
	if (systemState === 'poolForked') return securityPoolCopy.parentForkMigrationRedirectDetail
	if (systemState === 'forkMigration') return securityPoolCopy.reportingLockedDuringMigrationReason
	if (systemState === 'forkTruthAuction') return securityPoolCopy.reportingLockedDuringAuctionReason
	if (reportingReady === true) return undefined
	if (marketEndTime === undefined) return securityPoolCopy.reportingStartDetail
	return getReportingLockedUntilMessage(marketEndTime, now)
}

/**
 * Derives everything the selected pool page shows from the loaded chain data, the connected account, and the chain clock:
 * the pool's lifecycle and stage, the active tab, reporting and fork availability, oracle guards, and the account's actions.
 */
export function derivePoolViewModel(input: PoolViewModelInput) {
	const { accountState, activeUniverseId, checkedSecurityPoolAddress, liquidationManagerAddress, loadingSecurityPools, poolOracleManagerDetails, poolOracleManagerError, poolOracleManagerErrorAddress, securityPoolAddress, securityPoolOverviewError, securityPools, selectedPoolView } = input
	const isOnActiveAppChain = isActiveAppChain(accountState.chainId)
	const selectedPool = securityPools.find(pool => sameCaseInsensitiveText(pool.securityPoolAddress, securityPoolAddress))
	const normalizedSelectedPoolAddress = normalizeAddress(selectedPool?.securityPoolAddress)
	const normalizedReportingFormPoolAddress = normalizeAddress(input.reportingFormSecurityPoolAddress)
	const loadedReportingDetails = sameAddress(input.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? input.reportingDetails : undefined
	const currentReportingDetails = getCurrentSelectedPoolReportingDetails({ reportingDetails: loadedReportingDetails, selectedPool })
	const loadedForkAuctionDetails = sameAddress(input.forkAuctionDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) ? input.forkAuctionDetails : undefined
	const currentForkAuctionDetails = getCurrentSelectedPoolForkAuctionDetails({ forkAuctionDetails: loadedForkAuctionDetails, selectedPool })
	const selectedPoolLookupState = resolveRequestedLoadableValueState({ currentKey: normalizeAddress(securityPoolAddress), isLoading: loadingSecurityPools, resolvedKey: checkedSecurityPoolAddress, value: selectedPool })
	const marketDetails = selectedPool?.marketDetails ?? currentReportingDetails?.marketDetails ?? currentForkAuctionDetails?.marketDetails
	const selectedPoolState = currentForkAuctionDetails?.systemState ?? selectedPool?.systemState
	const selectedPoolQuestionOutcome = currentForkAuctionDetails?.questionOutcome ?? currentReportingDetails?.questionOutcome ?? selectedPool?.questionOutcome
	const effectiveSelectedPool = applySelectedPoolWorkflowState(selectedPool, { questionOutcome: selectedPoolQuestionOutcome, systemState: selectedPoolState })
	const currentTimestamp = input.now ?? currentReportingDetails?.currentTime ?? currentForkAuctionDetails?.currentTime
	const reportingReady = marketDetails === undefined ? undefined : hasReportingOpened(marketDetails.endTime, currentTimestamp)
	const selectedPoolReportingStage = deriveSecurityPoolReportingStage({ reportingDetails: currentReportingDetails, reportingReady })
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
		vaultAdmissionClosed: deriveVaultAdmissionClosed({ currentTimestamp, hasForkContinuationEscalationGame: effectiveSelectedPool?.hasForkContinuationEscalationGame, questionEndTime: marketDetails?.endTime }),
	})
	const forkTriggerAvailable = selectedPoolReportingStage === 'forkTriggered' && !selectedPoolHasActualForkActivity && selectedPoolState === 'operational' && selectedPoolQuestionOutcome === 'none'
	const triggerZoltarForkReason = (() => {
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolHasActualForkActivity) return securityPoolCopy.forkAlreadyTriggeredSettlementReason
		if (selectedPoolReportingStage === 'forkTriggered' && selectedPoolState !== 'operational') return securityPoolCopy.poolForkMigrationStatus
		return securityPoolCopy.forkTriggerUnavailableReason
	})()
	const selectedPoolHasForkActivity = selectedPoolReportingStage === 'forkTriggered' || selectedPoolHasActualForkActivity
	const selectedPoolForkWorkflowSystemState = selectedPoolLifecycleState === undefined || selectedPoolLifecycleState === 'ended' ? selectedPoolState : selectedPoolLifecycleState
	const reportingLockedReason = getReportingLockedReason({ marketEndTime: marketDetails?.endTime, now: currentTimestamp, reportingReady, systemState: selectedPoolState })
	const selectedPoolUniverseMismatch = selectedPool !== undefined && selectedPool.universeId !== activeUniverseId
	const hasSelectedPoolAddress = securityPoolAddress.trim() !== ''
	const showSelectedPoolWorkflowDetails = shouldShowSelectedPoolWorkflowDetails({ hasSelectedPoolAddress, selectedPoolExists: selectedPool !== undefined, selectedPoolUniverseMismatch })
	const currentForkStage = getCurrentSelectedPoolForkStage({
		forkAuctionDetails: currentForkAuctionDetails,
		selectedPool: selectedPool === undefined || selectedPoolForkWorkflowSystemState === undefined ? selectedPool : { ...selectedPool, systemState: selectedPoolForkWorkflowSystemState },
	})
	const currentForkWorkflowSelectionStage = getCurrentForkWorkflowSelectionStage({
		claimingAvailable: currentForkAuctionDetails?.claimingAvailable ?? false,
		currentForkStage,
		hasForkActivity: hasCurrentSelectedPoolForkActivity({ forkAuctionDetails: currentForkAuctionDetails, selectedPool }),
		systemState: currentForkAuctionDetails?.systemState ?? selectedPoolForkWorkflowSystemState,
		truthAuctionFinalized: currentForkAuctionDetails?.truthAuction?.finalized ?? false,
	})
	const lifecycleStep = derivePoolLifecycleStep({
		forkSettled: currentForkWorkflowSelectionStage === 'settlement',
		hasForkActivity: selectedPoolHasActualForkActivity,
		lifecycleState: selectedPoolLifecycleState,
		reportingOpen: reportingReady === true || selectedPool?.ordinaryEscalationGameStarted === true,
		reportingStage: selectedPoolReportingStage,
	})
	// The default tab comes from registry data alone, so it does not jump when reporting or fork details arrive later.
	const listedStep = selectedPool === undefined ? undefined : deriveListedPoolLifecycleStep(selectedPool, currentTimestamp).step
	const defaultView = getDefaultPoolTab(listedStep, selectedPool?.hasForkActivity ?? false)
	const view = selectedPoolView.trim() === '' ? defaultView : resolveSelectedPoolView(selectedPoolView)
	const selectedPoolManagerAddress = selectedPool?.managerAddress
	const currentPoolOracleManagerError = selectedPoolManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, selectedPoolManagerAddress) ? poolOracleManagerError : undefined
	const liquidationPoolOracleManagerError = liquidationManagerAddress !== undefined && sameAddress(poolOracleManagerErrorAddress, liquidationManagerAddress) ? poolOracleManagerError : undefined
	const currentPoolOracleManagerDetails = getCurrentPoolOracleManagerDetails({ poolOracleManagerDetails, selectedPoolManagerAddress })
	const selectedVaultOwner = getSelectedVaultOwner(input.selectedVaultOwnerInput, accountState.address) ?? ''
	const selectedVaultIsOwnedByAccount = isSelectedVaultOwnedByAccount(input.selectedVaultOwnerInput, accountState.address)
	const selectedVaultDetails = doesLoadedSecurityVaultMatchSelection({ accountAddress: accountState.address, securityPoolAddress: selectedPool?.securityPoolAddress, securityVaultDetails: input.securityVaultDetails, selectedVaultOwner: input.selectedVaultOwnerInput }) ? input.securityVaultDetails : undefined
	const hasLoadedCurrentVault = selectedVaultDetails !== undefined && sameAddress(selectedVaultDetails.vaultAddress, selectedVaultOwner) && sameAddress(selectedVaultDetails.securityPoolAddress, selectedPool?.securityPoolAddress)
	const selectedPoolSummaryPool = buildSelectedPoolSummaryPool({ forkAuctionDetails: currentForkAuctionDetails, selectedPool: effectiveSelectedPool })
	const selectedPoolParentPool = selectedPoolSummaryPool === undefined || selectedPoolSummaryPool.parent === zeroAddress ? undefined : securityPools.find(pool => sameAddress(pool.securityPoolAddress, selectedPoolSummaryPool.parent))
	const selectedPoolOracleMetricValues = effectiveSelectedPool === undefined ? undefined : getSelectedPoolOracleMetricValues(effectiveSelectedPool)
	const currentPoolOraclePriceUsable = currentPoolOracleManagerDetails === undefined ? undefined : isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)
	const requestPriceTransactionValueAttoEth = currentPoolOracleManagerDetails === undefined ? undefined : addOpenOracleBountyBuffer(currentPoolOracleManagerDetails.requestPriceCostAttoEth)
	const requestPriceGuardInput = { accountAddress: accountState.address, isOnActiveAppChain, isPriceValid: currentPoolOraclePriceUsable, pendingReportId: currentPoolOracleManagerDetails?.pendingReportId, walletBalanceAttoEth: accountState.ethBalanceAttoEth }
	const requestPriceGuardMessage = getVaultRequestPriceGuardMessage({ ...requestPriceGuardInput, hasLoadedSelectedPool: effectiveSelectedPool !== undefined, requiredCostAttoEth: currentPoolOracleManagerDetails?.requestPriceCostAttoEth })
	const selectedPendingOperationId = currentPoolOracleManagerDetails?.pendingOperationSlotId ?? 0n
	const selectedPendingOperationInput = selectedPendingOperationId > 0n ? selectedPendingOperationId.toString() : ''
	const pendingOperationInput = input.manualPendingOperationId.trim() === '' ? selectedPendingOperationInput : input.manualPendingOperationId.trim()
	const resolvedPendingOperationId = pendingOperationInput === '' ? undefined : tryParseBigIntInput(pendingOperationInput)
	const pendingOperation = currentPoolOracleManagerDetails?.pendingOperation
	const stagedOperations = currentPoolOracleManagerDetails?.stagedOperations ?? (pendingOperation === undefined ? [] : [pendingOperation])
	const activeStagedOperationCount = currentPoolOracleManagerDetails?.activeStagedOperationCount ?? BigInt(stagedOperations.length)
	const reportingOracleGuardMessage = (() => {
		if (reportingLockedReason !== undefined || !selectedPoolStateModel.actions.reportOutcome.enabled) return undefined
		if ((effectiveSelectedPool?.totalCapacityOwnershipAttoRep ?? 0n) === 0n) return undefined
		if (currentPoolOracleManagerDetails === undefined || currentPoolOraclePriceUsable === true) return undefined
		return currentPoolOracleManagerDetails.lastSettlementTimestamp > 0n ? securityPoolCopy.reportingOraclePriceExpiredReason : securityPoolCopy.reportingOraclePriceRequiredReason
	})()
	// The pool page's price row offers a new request only when the price is unusable and requesting one is allowed in this stage.
	const needsPrice = !isPoolQuestionFinalized(currentReportingDetails) && showSelectedPoolWorkflowDetails && selectedPoolStateModel.actions.requestPrice.enabled && (currentPoolOraclePriceUsable === false || currentPoolOracleManagerError !== undefined)
	const accountPoolVault = selectedPool?.vaults.find(vault => sameAddress(vault.vaultAddress, accountState.address))
	const accountVault = selectedVaultIsOwnedByAccount && hasLoadedCurrentVault ? toAccountVault(selectedVaultDetails) : toAccountVault(accountPoolVault)
	const truthAuctionStartedAt = currentForkAuctionDetails?.truthAuctionStartedAt ?? selectedPool?.truthAuctionStartedAt ?? 0n
	const poolActionItems =
		selectedPool === undefined
			? []
			: derivePoolActionItems({
					accountConnected: accountState.address !== undefined,
					auctionEndsAt: currentForkAuctionDetails?.truthAuction?.auctionEndsAt ?? (truthAuctionStartedAt > 0n ? truthAuctionStartedAt + AUCTION_TIME_SECONDS : undefined),
					escalationEndsAt: currentReportingDetails?.status === 'active' ? currentReportingDetails.escalationEndTime : undefined,
					forkClaimAvailable: currentForkAuctionDetails?.claimingAvailable === true,
					forkTriggerAvailable,
					hasForkActivity: selectedPoolHasActualForkActivity,
					migrationEndsAt: currentForkAuctionDetails?.migrationEndsAt,
					now: currentTimestamp,
					poolState: selectedPoolStateModel,
					reportingStage: selectedPoolReportingStage,
					shareBalances: input.shareBalances,
					stagedOperationCount: activeStagedOperationCount,
					step: lifecycleStep,
					vault: accountVault,
				})
	const actionItems = showSelectedPoolWorkflowDetails ? poolActionItems : []
	const currentPoolOraclePrice = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastPrice
	const currentPoolOracleSettlementTimestamp = (currentPoolOracleManagerDetails ?? selectedPoolOracleMetricValues)?.lastSettlementTimestamp
	const requestPriceOpenGuardMessage = requestPriceTransactionValueAttoEth === undefined ? securityPoolCopy.loadOracleBeforePriceReview : requestPriceGuardMessage
	// A pool from another universe keeps its workspace hidden, but a pending report stays reachable from its price row.
	const oracleStatus =
		selectedPool !== undefined && (showSelectedPoolWorkflowDetails || (currentPoolOracleManagerDetails?.pendingReportId ?? 0n) > 0n)
			? { ...currentPoolOracleManagerDetails, currentTimestamp, lastPrice: currentPoolOraclePrice, lastSettlementTimestamp: currentPoolOracleSettlementTimestamp ?? 0n, requestDisabledReason: requestPriceOpenGuardMessage }
			: undefined

	return {
		accountVault,
		actionItems,
		activeStagedOperationCount,
		canUseOracleActions: accountState.address !== undefined && isOnActiveAppChain,
		currentForkAuctionDetails,
		currentForkStage,
		currentForkWorkflowSelectionStage,
		currentPoolOracleManagerDetails,
		currentPoolOracleManagerError,
		currentPoolOraclePrice,
		currentPoolOraclePriceUsable,
		currentPoolOracleSettlementTimestamp,
		currentReportingDetails,
		currentTimestamp,
		effectiveSelectedPool,
		executePendingOperationGuardMessage: getVaultExecutePendingOperationGuardMessage({ accountAddress: accountState.address, hasLoadedOracleManager: currentPoolOracleManagerDetails !== undefined, isOnActiveAppChain, isPriceValid: currentPoolOraclePriceUsable, resolvedPendingOperationId }),
		forkWorkflowDisabled: isForkWorkflowDisabled(selectedPoolState, selectedPoolHasForkActivity),
		forkWorkflowPrimary: isForkWorkflowPrimary(lifecycleStep, selectedPoolHasForkActivity),
		hasLoadedCurrentVault,
		hasSelectedPoolAddress,
		isOnActiveAppChain,
		legacyForkWorkflowSelectionStage: resolveForkWorkflowSelectionStage(selectedPoolView),
		lifecycleStep,
		liquidationPoolOracleManagerError,
		loadedForkAuctionDetails,
		loadedReportingDetails,
		marketDetails,
		needsPrice,
		normalizedReportingFormPoolAddress,
		normalizedSelectedPoolAddress,
		oracleStatus,
		pendingSettlementOperationIds: currentPoolOracleManagerDetails?.pendingSettlementOperationIds ?? [],
		reportingLockedReason,
		reportingOracleGuardMessage,
		reportingReady,
		requestPriceConfirmationGuardMessage: getVaultRequestPriceGuardMessage({ ...requestPriceGuardInput, bufferRequiredEthCost: false, hasLoadedSelectedPool: input.requestPriceReview !== undefined, requiredCostAttoEth: input.requestPriceReview?.requestValueAttoEth }),
		requestPriceGuardMessage,
		requestPriceOpenGuardMessage,
		requestPriceTransactionValueAttoEth,
		resolvedPendingOperationId,
		selectedPendingOperationId,
		selectedPool,
		selectedPoolBrowsePresentation: selectedPool === undefined && securityPoolOverviewError === undefined ? getPoolRegistryPresentation({ mode: 'selection', state: selectedPoolLookupState }) : undefined,
		selectedPoolHasActualForkActivity,
		selectedPoolHasForkActivity,
		selectedPoolLifecycleState,
		selectedPoolLookupState,
		selectedPoolManagerAddress,
		selectedPoolOracleMetricValues,
		selectedPoolParentPool,
		selectedPoolQuestionOutcome,
		selectedPoolReportingStage,
		selectedPoolState,
		selectedPoolStateModel,
		selectedPoolSummaryPool,
		selectedPoolUniverseMismatch,
		selectedPoolWorkflowLockedPresentation: showSelectedPoolWorkflowDetails || securityPoolOverviewError !== undefined ? undefined : getSelectedPoolWorkflowLockedPresentation({ hasSelectedPoolAddress, selectedPoolLookupState, selectedPoolUniverseMismatch }),
		selectedVaultDetails,
		selectedVaultExistsOnchain: doesSecurityVaultExistOnchain(selectedVaultDetails),
		selectedVaultIsOwnedByAccount,
		selectedVaultOwner,
		shouldRefreshSelectedPoolReporting: showSelectedPoolWorkflowDetails && (sameAddress(input.reportingDetails?.securityPoolAddress, selectedPool?.securityPoolAddress) || (view === 'reporting' && normalizedSelectedPoolAddress !== undefined && normalizedReportingFormPoolAddress === normalizedSelectedPoolAddress)),
		showSelectedPoolWorkflowDetails,
		stagedOperations,
		triggerZoltarForkAvailability: { disabled: !forkTriggerAvailable, reason: triggerZoltarForkReason },
		view,
	}
}
