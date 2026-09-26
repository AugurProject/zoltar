import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ForkAuctionSection } from '../../truth-auctions/components/ForkAuctionSection.js'
import { ReportingSection } from '../../reporting/components/ReportingSection.js'
import { TradingSection } from '../../markets/components/TradingSection.js'
import type { ForkAuctionDetails, ListedSecurityPool, MarketDetails, OpenOracleActionResult, OracleManagerDetails, ReportingDetails, StagedOracleOperation } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ActionAvailability } from '@zoltar/ui-core-shared/types/components.js'
import type { ForkAuctionSectionProps, SecurityPoolWorkflowRouteContentProps } from '../../types.js'
import type { SecurityPoolLifecycleState, SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { getSelectedPoolOracleMetricValues } from '../lib/securityPoolWorkflow.js'
import { createRequestPriceReview, SecurityPoolPriceOracleSection, SecurityPoolStagedOperationsSection, type RequestPriceReview } from './SecurityPoolOracleSections.js'

export function SelectedPoolTradingPanel({
	calculationPriceConfigured,
	currentPoolOraclePriceUsable,
	poolState,
	selectedPool,
	trading,
}: {
	calculationPriceConfigured: boolean
	currentPoolOraclePriceUsable: boolean | undefined
	poolState: SecurityPoolStateModel
	selectedPool: ListedSecurityPool | undefined
	trading: SecurityPoolWorkflowRouteContentProps['trading']
}) {
	return <TradingSection {...trading} oraclePriceUsable={currentPoolOraclePriceUsable} calculationPriceConfigured={calculationPriceConfigured} selectedPool={selectedPool} poolState={poolState} embedInCard showHeader={false} showSecurityPoolAddressInput={false} />
}

export function SelectedPoolReportingPanel({
	oracleBlocker,
	currentReportingDetails,
	currentTimestamp,
	forkAuction,
	marketDetails,
	onOpenForkWorkflow,
	onSelectedPoolViewChange,
	reporting,
	reportingLockedReason,
	reportingOracleGuardMessage,
	selectedPoolHasActualForkActivity,
	triggerZoltarForkAvailability,
}: {
	oracleBlocker?: import('preact').ComponentChildren
	currentReportingDetails: ReportingDetails | undefined
	currentTimestamp: bigint | undefined
	forkAuction: SecurityPoolWorkflowRouteContentProps['forkAuction']
	marketDetails: MarketDetails | undefined
	onOpenForkWorkflow: (() => void) | undefined
	onSelectedPoolViewChange: SecurityPoolWorkflowRouteContentProps['onSelectedPoolViewChange']
	reporting: SecurityPoolWorkflowRouteContentProps['reporting']
	reportingLockedReason: string | undefined
	reportingOracleGuardMessage: string | undefined
	selectedPoolHasActualForkActivity: boolean
	triggerZoltarForkAvailability: ActionAvailability
}) {
	return (
		<ReportingSection
			{...reporting}
			oracleBlocker={oracleBlocker}
			currentTimestamp={currentTimestamp}
			embedInCard
			forkAlreadyTriggered={selectedPoolHasActualForkActivity}
			lockedReason={reportingLockedReason}
			mode='full-reporting'
			onOpenForkWorkflow={onOpenForkWorkflow}
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
	)
}

export function SelectedPoolForkWorkflowPanel({
	currentForkAuctionDetails,
	currentForkStage,
	currentReportingDetails,
	currentTimestamp,
	forkAuction,
	forkWorkflowDisabled,
	forkWorkflowSelectionStage,
	onForkWorkflowSelectionStageChange,
	reporting,
	securityPools,
	selectedPool,
	selectedPoolLifecycleState,
	selectedPoolRefreshNonce,
	universeForkTime,
}: {
	currentForkAuctionDetails: ForkAuctionDetails | undefined
	currentForkStage: ForkAuctionSectionProps['currentStageView']
	currentReportingDetails: ReportingDetails | undefined
	currentTimestamp: bigint | undefined
	forkAuction: SecurityPoolWorkflowRouteContentProps['forkAuction']
	forkWorkflowDisabled: boolean
	forkWorkflowSelectionStage: ForkAuctionSectionProps['selectedStageView']
	onForkWorkflowSelectionStageChange: ForkAuctionSectionProps['onSelectedStageViewChange']
	reporting: SecurityPoolWorkflowRouteContentProps['reporting']
	securityPools: ListedSecurityPool[]
	selectedPool: ListedSecurityPool | undefined
	selectedPoolLifecycleState: SecurityPoolLifecycleState | undefined
	selectedPoolRefreshNonce: number
	universeForkTime: bigint | undefined
}) {
	return (
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
	)
}

export function SelectedPoolStagedOperationsPanel({
	activeStagedOperationCount,
	currentPoolOracleManagerDetails,
	currentPoolOracleManagerError,
	executePendingOperationGuardMessage,
	loadedSelectedPool,
	loadingPoolOracleManager,
	manualPendingOperationId,
	onExecutePendingPoolOperation,
	onLoadPoolOracleManager,
	onManualPendingOperationIdChange,
	pendingSettlementOperationIds,
	poolOracleActiveAction,
	poolState,
	resolvedPendingOperationId,
	selectedPendingOperationId,
	stagedOperations,
}: {
	activeStagedOperationCount: bigint
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOracleManagerError: string | undefined
	executePendingOperationGuardMessage: string | undefined
	loadedSelectedPool: ListedSecurityPool
	loadingPoolOracleManager: boolean
	manualPendingOperationId: string
	onExecutePendingPoolOperation: SecurityPoolWorkflowRouteContentProps['onExecutePendingPoolOperation']
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onManualPendingOperationIdChange: (value: string) => void
	pendingSettlementOperationIds: bigint[]
	poolOracleActiveAction: OpenOracleActionResult['action'] | undefined
	poolState: SecurityPoolStateModel
	resolvedPendingOperationId: bigint | undefined
	selectedPendingOperationId: bigint
	stagedOperations: StagedOracleOperation[]
}) {
	return (
		<SecurityPoolStagedOperationsSection
			activeOperationCount={activeStagedOperationCount}
			canExecute={poolState.actions.executeStagedOperation.enabled}
			executeGuardMessage={executePendingOperationGuardMessage}
			executionPending={poolOracleActiveAction === 'executeStagedOperation'}
			loadingManager={loadingPoolOracleManager}
			managerAddress={loadedSelectedPool.managerAddress}
			managerDetails={currentPoolOracleManagerDetails}
			managerError={currentPoolOracleManagerError}
			manualOperationId={manualPendingOperationId}
			onExecute={onExecutePendingPoolOperation}
			onLoadManager={onLoadPoolOracleManager}
			onManualOperationIdChange={onManualPendingOperationIdChange}
			pendingSettlementOperationIds={pendingSettlementOperationIds}
			resolvedOperationId={resolvedPendingOperationId}
			securityPoolAddress={loadedSelectedPool.securityPoolAddress}
			stagedOperations={stagedOperations}
			suggestedOperationId={selectedPendingOperationId}
			universeId={loadedSelectedPool.universeId}
		/>
	)
}

export function SelectedPoolPriceOraclePanel({
	currentPoolOracleManagerDetails,
	currentPoolOracleManagerError,
	currentTimestamp,
	loadedSelectedPool,
	loadingPoolOracleManager,
	onLoadPoolOracleManager,
	onOpenRequestReview,
	onViewPendingReport,
	poolOracleActiveAction,
	poolState,
	requestPriceGuardMessage,
	requestPriceOpenGuardMessage,
	requestPriceTransactionValueAttoEth,
	selectedPoolOracleMetricValues,
}: {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentPoolOracleManagerError: string | undefined
	currentTimestamp: bigint | undefined
	loadedSelectedPool: ListedSecurityPool
	loadingPoolOracleManager: boolean
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onOpenRequestReview: (review: RequestPriceReview) => void
	onViewPendingReport: (reportId: bigint) => void
	poolOracleActiveAction: OpenOracleActionResult['action'] | undefined
	poolState: SecurityPoolStateModel
	requestPriceGuardMessage: string | undefined
	requestPriceOpenGuardMessage: string | undefined
	requestPriceTransactionValueAttoEth: bigint | undefined
	selectedPoolOracleMetricValues: ReturnType<typeof getSelectedPoolOracleMetricValues> | undefined
}) {
	return (
		<SecurityPoolPriceOracleSection
			canRequest={poolState.actions.requestPrice.enabled}
			currentTimestamp={currentTimestamp}
			loadingManager={loadingPoolOracleManager}
			managerAddress={loadedSelectedPool.managerAddress}
			managerDetails={currentPoolOracleManagerDetails}
			managerError={currentPoolOracleManagerError}
			metricValues={selectedPoolOracleMetricValues}
			onLoadManager={onLoadPoolOracleManager}
			onOpenRequestReview={() => {
				if (requestPriceTransactionValueAttoEth === undefined) return
				onOpenRequestReview(createRequestPriceReview(loadedSelectedPool, requestPriceTransactionValueAttoEth))
			}}
			onViewPendingReport={onViewPendingReport}
			requestGuardMessage={requestPriceOpenGuardMessage ?? requestPriceGuardMessage}
			requestPending={poolOracleActiveAction === 'requestPrice'}
			requestValueAttoEth={requestPriceTransactionValueAttoEth}
		/>
	)
}
