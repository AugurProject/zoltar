import { useEffect, useId, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressInfo } from './AddressInfo.js'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { ErrorNotice } from './ErrorNotice.js'
import { FormInput } from './FormInput.js'
import { MetricGrid } from './MetricGrid.js'
import { MetricField } from './MetricField.js'
import { OpenOraclePriceValue } from './OpenOraclePriceValue.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { WarningSurface } from './WarningSurface.js'
import { TransactionStatusCard } from './TransactionStatusCard.js'
import { assertNever } from '../lib/assert.js'
import { sameAddress } from '../lib/address.js'
import { pickFirstReason } from '../lib/actionAvailability.js'
import { useChainTimestamp } from '../lib/chainTimestamp.js'
import { formatCurrencyInputBalance, formatDuration } from '../lib/formatters.js'
import { getDeterministicLiquidationFailureReason, getLiquidationExecutionFailureDetail, getLiquidationFailureReason, getMaxLiquidationAmount, simulateLiquidation } from '../lib/liquidation.js'
import { tryParseBigIntInput, tryParseRepAmountInput } from '../lib/marketForm.js'
import { getOracleRequestEthGuardMessage, resolveOracleOperationEthFunding } from '../lib/oracleRequestEth.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../lib/repPriceSource.js'
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js'
import { getVaultCollateralizationPercent } from '../lib/trading.js'
import {
	UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_LIQUIDATION_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED,
	UI_STRING_AMOUNT,
	UI_STRING_CALLER_COLLATERALIZATION_AT_OPEN_ORACLE,
	UI_STRING_CALLER_VAULT,
	UI_STRING_CALLER_VAULT_AFTER_LIQUIDATION,
	UI_STRING_CANCEL,
	UI_STRING_CHECK_STATE,
	UI_STRING_CLOSE,
	UI_STRING_COLLATERALIZATION_AT_OPEN_ORACLE,
	UI_STRING_CONNECT_WALLET,
	UI_STRING_ENTER_A_LIQUIDATION_AMOUNT,
	UI_STRING_ENTER_A_LIQUIDATION_TIMEOUT_OF_AT_LEAST_1_MINUTE,
	UI_STRING_ENTER_WHOLE_MINUTES_QUEUED_STAGED_OPERATIONS_MUST_STAY_EXECUTABLE_FOR_AT_LEAST_1_MINUTE_AFTER_THE_ORACLE_SETTLEMENT_WINDOW_COMPLETES,
	UI_STRING_ETH,
	UI_STRING_EXECUTE_VAULT_LIQUIDATION,
	UI_STRING_EXECUTED,
	UI_STRING_EXECUTING_LIQUIDATION,
	UI_STRING_FAILED,
	UI_STRING_INVALID_LIQUIDATION_PAIR,
	UI_STRING_LIQUIDATE_VAULT,
	UI_STRING_LIQUIDATION_AMOUNT_ETH,
	UI_STRING_LIQUIDATION_EXECUTED,
	UI_STRING_LIQUIDATION_FAILED,
	UI_STRING_LIQUIDATION_QUEUED,
	UI_STRING_LIQUIDATION_SUBMITTED,
	UI_STRING_MANUAL_EXECUTION_TIMEOUT,
	UI_STRING_MANUAL_QUEUED_OPERATION,
	UI_STRING_MAX,
	UI_STRING_MINUTES,
	UI_STRING_MULTIPLIER_SUFFIX,
	UI_STRING_NONE_SELECTED,
	UI_STRING_OPEN_ORACLE_PRICE,
	UI_STRING_QUEUE_LIQUIDATION,
	UI_STRING_QUEUE_LIQUIDATION_LIQUIDATION_MODAL_QUEUE_LIQUIDATION_ACTION_LABEL,
	UI_STRING_QUEUE_VAULT_LIQUIDATION,
	UI_STRING_QUEUED,
	UI_STRING_QUEUEING_LIQUIDATION,
	UI_STRING_REFRESHING_LIQUIDATION_STATE,
	UI_STRING_REFRESHING_LIQUIDATION_STATE_LIQUIDATION_MODAL_REFRESHING_LIQUIDATION_STATE_TITLE,
	UI_STRING_REFRESHING_PRICE_VALIDITY,
	UI_STRING_REFRESHING_WITHOUT_ELLIPSIS,
	UI_STRING_RELOAD_THE_SELECTED_POOL_BEFORE_EXECUTING_LIQUIDATION,
	UI_STRING_RELOAD_THE_SELECTED_POOL_BEFORE_LIQUIDATING,
	UI_STRING_REP,
	UI_STRING_REP_COLLATERAL,
	UI_STRING_REP_MOVED,
	UI_STRING_REP_PER_ETH,
	UI_STRING_SECURITY_BOND_ALLOWANCE,
	UI_STRING_SECURITY_MULTIPLIER,
	UI_STRING_SECURITY_POOL,
	UI_STRING_SELECT_A_TARGET_VAULT_FIRST,
	UI_STRING_SELECT_A_TARGET_VAULT_THAT_IS_DIFFERENT_FROM_THE_CALLER_VAULT,
	UI_STRING_STAGED_OPERATION,
	UI_STRING_STAGED_OPERATION_RETRY,
	UI_STRING_SUBMITTING_LIQUIDATION_LIQUIDATION_MODAL_LIQUIDATE_VAULT_PENDING_LABEL,
	UI_STRING_TARGET_COLLATERALIZATION_AT_OPEN_ORACLE,
	UI_STRING_TARGET_VAULT,
	UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_LIQUIDATION_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT,
	UI_STRING_TRANSACTION_STATE_UNAVAILABLE,
	UI_STRING_UNAVAILABLE,
	UI_STRING_VIEW_IN_STAGED_OPERATIONS,
	UI_STRING_ZERO_DECIMAL_PLACEHOLDER,
	UI_TEMPLATE_TIMEOUT_HELP_TEXT_RESOLVED,
} from '../lib/uiStrings.js'
import { useModalFocusIsolation } from '../hooks/useModalFocusIsolation.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../types/contracts.js'
type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isMainnet: boolean
	liquidationAmount: string
	liquidationMaxAmount: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutMinutes: string
	loadingPoolOracleManager: boolean
	onLoadPoolOracleManager: (managerAddress: Address) => void
	onSelectedPoolViewChange: (view: string | undefined) => void
	repPerEthPrice: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	poolState?: SecurityPoolStateModel | undefined
	selectedPool: ListedSecurityPool | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolLiquidationError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	callerVaultSummary: SecurityPoolVaultSummary | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationTargetVault: string
	onLiquidationAmountChange: (value: string) => void
	onLiquidationTimeoutMinutesChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	walletEthBalance?: bigint | undefined
}
type QueuedLiquidationOperationView = {
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}
function getLiquidationExecutionMode(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	if (currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return isOracleManagerPriceUsable(currentPoolOracleManagerDetails) ? 'execute' : 'queue'
}
function getLiquidationModalTitle(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	switch (executionMode) {
		case 'execute':
			return UI_STRING_EXECUTE_VAULT_LIQUIDATION
		case 'queue':
			return UI_STRING_QUEUE_VAULT_LIQUIDATION
		case 'refreshing':
			return UI_STRING_LIQUIDATE_VAULT
		default:
			return assertNever(executionMode)
	}
}
function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	switch (executionMode) {
		case 'execute':
			return { idle: UI_STRING_EXECUTE_VAULT_LIQUIDATION, pending: UI_STRING_EXECUTING_LIQUIDATION }
		case 'queue':
			return { idle: UI_STRING_QUEUE_LIQUIDATION, pending: UI_STRING_QUEUEING_LIQUIDATION }
		case 'refreshing':
			return { idle: UI_STRING_LIQUIDATE_VAULT, pending: UI_STRING_SUBMITTING_LIQUIDATION_LIQUIDATION_MODAL_LIQUIDATE_VAULT_PENDING_LABEL }
		default:
			return assertNever(executionMode)
	}
}

function renderQueuedLiquidationStatusCard({
	onViewInStagedOperations,
	queuedLiquidationOperation,
	queuedLiquidationStatus,
	securityPoolOverviewResult,
}: {
	onViewInStagedOperations: () => void
	queuedLiquidationOperation: QueuedLiquidationOperationView | undefined
	queuedLiquidationStatus: 'executed' | 'failed' | 'manual-queued' | 'missing' | 'queued' | 'refreshing' | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}) {
	if (queuedLiquidationStatus === undefined) return null
	if (queuedLiquidationStatus === 'queued' || queuedLiquidationStatus === 'manual-queued') {
		if (queuedLiquidationOperation === undefined) return null
		return (
			<TransactionStatusCard
				title={UI_STRING_LIQUIDATION_QUEUED}
				badge={<Badge tone='warning'>{UI_STRING_QUEUED}</Badge>}
				metrics={
					<MetricGrid>
						<MetricField label={UI_STRING_STAGED_OPERATION}>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						{queuedLiquidationOperation.amount === undefined ? null : (
							<MetricField label={UI_STRING_AMOUNT}>
								<CurrencyValue value={queuedLiquidationOperation.amount} />
							</MetricField>
						)}
					</MetricGrid>
				}
				detail={queuedLiquidationStatus === 'manual-queued' ? UI_STRING_MANUAL_QUEUED_OPERATION : undefined}
				actions={
					<button className='secondary' type='button' onClick={onViewInStagedOperations}>
						{UI_STRING_VIEW_IN_STAGED_OPERATIONS}
					</button>
				}
			/>
		)
	}
	if (queuedLiquidationStatus === 'failed')
		return (
			<TransactionStatusCard
				title={UI_STRING_LIQUIDATION_FAILED}
				badge={<Badge tone='blocked'>{UI_STRING_FAILED}</Badge>}
				detail={getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? UI_STRING_THE_ORACLE_MANAGER_ATTEMPTED_THE_LIQUIDATION_IMMEDIATELY_BUT_THE_SECURITY_POOL_REJECTED_IT}
				secondaryDetail={UI_STRING_STAGED_OPERATION_RETRY}
			/>
		)
	if (queuedLiquidationStatus === 'executed') return <TransactionStatusCard title={UI_STRING_LIQUIDATION_EXECUTED} badge={<Badge tone='ok'>{UI_STRING_EXECUTED}</Badge>} detail={UI_STRING_A_VALID_ORACLE_PRICE_WAS_ALREADY_AVAILABLE_SO_THE_LIQUIDATION_EXECUTED_IMMEDIATELY_AND_NO_STAGED_OPERATION_WAS_CREATED} />
	if (queuedLiquidationStatus === 'missing') return <TransactionStatusCard title={UI_STRING_LIQUIDATION_SUBMITTED} badge={<Badge tone='warning'>{UI_STRING_CHECK_STATE}</Badge>} detail={UI_STRING_TRANSACTION_STATE_UNAVAILABLE} />
	return <TransactionStatusCard title={UI_STRING_REFRESHING_LIQUIDATION_STATE_LIQUIDATION_MODAL_REFRESHING_LIQUIDATION_STATE_TITLE} badge={<Badge tone='muted'>{UI_STRING_REFRESHING_WITHOUT_ELLIPSIS}</Badge>} detail={UI_STRING_REFRESHING_LIQUIDATION_STATE} />
}
export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isMainnet,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	liquidationTargetVault,
	onLoadPoolOracleManager,
	onSelectedPoolViewChange,
	poolState,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	selectedPool,
	securityPoolOverviewActiveAction,
	securityPoolLiquidationError,
	securityPoolOverviewResult,
	callerVaultSummary,
	targetVaultSummary,
	onLiquidationAmountChange,
	onLiquidationTimeoutMinutesChange,
	onQueueLiquidation,
	walletEthBalance,
}: LiquidationModalProps) {
	const chainCurrentTimestamp = useChainTimestamp()
	const dialogRef = useRef<HTMLElement | null>(null)
	const closeButtonRef = useRef<HTMLButtonElement | null>(null)
	const titleId = useId()
	const showLiquidationModal = liquidationModalOpen || securityPoolOverviewActiveAction === 'queueLiquidation' || securityPoolOverviewResult?.action === 'queueLiquidation' || securityPoolLiquidationError !== undefined
	useModalFocusIsolation({
		dialogRef,
		initialFocusRef: closeButtonRef,
		isOpen: showLiquidationModal,
		onClose: closeLiquidationModal,
	})
	useEffect(() => {
		if (!showLiquidationModal) return
		if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager) return
		onLoadPoolOracleManager(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationManagerAddress, loadingPoolOracleManager, onLoadPoolOracleManager, showLiquidationModal])
	if (!showLiquidationModal) return undefined
	const currentTimestamp = chainCurrentTimestamp
	const liquidationAmountValue = tryParseRepAmountInput(liquidationAmount)
	const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const poolOracleCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, poolOraclePrice)
	const quotedPriceCollateralization = targetVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(targetVaultSummary.repDepositShare, targetVaultSummary.securityBondAllowance, repPerEthPrice)
	const callerPoolOracleCollateralization = callerVaultSummary === undefined ? undefined : getVaultCollateralizationPercent(callerVaultSummary.repDepositShare, callerVaultSummary.securityBondAllowance, poolOraclePrice)
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)
	const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails)
	const hasUsableOraclePrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails)
	const trimmedLiquidationTargetVault = liquidationTargetVault.trim()
	const liquidationTimeoutDisplayValue = liquidationTimeoutMinutes === '' ? '' : liquidationTimeoutMinutes
	const liquidationTimeoutSeconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(liquidationTimeoutDisplayValue))
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? UI_STRING_ENTER_WHOLE_MINUTES_QUEUED_STAGED_OPERATIONS_MUST_STAY_EXECUTABLE_FOR_AT_LEAST_1_MINUTE_AFTER_THE_ORACLE_SETTLEMENT_WINDOW_COMPLETES : UI_TEMPLATE_TIMEOUT_HELP_TEXT_RESOLVED(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = accountAddress === undefined || trimmedLiquidationTargetVault === '' || !sameAddress(accountAddress, trimmedLiquidationTargetVault) ? undefined : UI_STRING_SELECT_A_TARGET_VAULT_THAT_IS_DIFFERENT_FROM_THE_CALLER_VAULT
	const liquidationSimulation =
		targetVaultSummary === undefined || poolOraclePrice === undefined || selectedPool?.securityMultiplier === undefined || liquidationAmountValue === undefined
			? undefined
			: simulateLiquidation({
					callerVaultSummary,
					liquidationAmount: liquidationAmountValue,
					repPerEthPrice: poolOraclePrice,
					securityMultiplier: selectedPool.securityMultiplier,
					targetVaultSummary,
				})
	const computedLiquidationMaxAmount = getMaxLiquidationAmount({
		repPerEthPrice: poolOraclePrice,
		securityMultiplier: selectedPool?.securityMultiplier,
		targetVaultSummary,
	})
	const liquidationMaxActionAmount = hasUsableOraclePrice ? (computedLiquidationMaxAmount ?? liquidationMaxAmount) : liquidationMaxAmount
	const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		liquidationAmount: liquidationAmountValue,
		maxDebtToMove: hasUsableOraclePrice ? computedLiquidationMaxAmount : undefined,
		repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
		securityMultiplier: selectedPool?.securityMultiplier,
		targetVaultSummary,
	})
	const directLiquidationReason = (() => {
		if (liquidationExecutionMode !== 'execute') return undefined
		if (selectedPool?.securityMultiplier === undefined) return UI_STRING_RELOAD_THE_SELECTED_POOL_BEFORE_EXECUTING_LIQUIDATION

		return getLiquidationFailureReason({
			callerVaultSummary,
			liquidationAmount: liquidationAmountValue,
			repPerEthPrice: poolOraclePrice,
			securityMultiplier: selectedPool.securityMultiplier,
			targetVaultSummary,
		})
	})()
	const queueLiquidationEthGuardMessage =
		liquidationExecutionMode !== 'queue'
			? undefined
			: (() => {
					const funding = resolveOracleOperationEthFunding({
						managerDetails: currentPoolOracleManagerDetails,
					})
					return getOracleRequestEthGuardMessage({
						actionLabel: UI_STRING_QUEUE_LIQUIDATION_LIQUIDATION_MODAL_QUEUE_LIQUIDATION_ACTION_LABEL,
						includeBuffer: funding?.includeBuffer === true,
						requiredEthCost: funding?.ethCost,
						walletEthBalance,
					})
				})()
	const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true
	const canUseLiquidationAction = accountAddress !== undefined && isMainnet
	const liquidationActionReason = pickFirstReason(
		liquidationExecutionMode === 'refreshing' ? UI_STRING_REFRESHING_PRICE_VALIDITY : undefined,
		liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? UI_STRING_RELOAD_THE_SELECTED_POOL_BEFORE_LIQUIDATING : undefined,
		trimmedLiquidationTargetVault === '' ? UI_STRING_SELECT_A_TARGET_VAULT_FIRST : undefined,
		sameVaultWarning,
		liquidationAmount.trim() === '' ? UI_STRING_ENTER_A_LIQUIDATION_AMOUNT : undefined,
		liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? UI_STRING_ENTER_A_LIQUIDATION_TIMEOUT_OF_AT_LEAST_1_MINUTE : undefined,
		deterministicLiquidationReason,
		directLiquidationReason,
		queueLiquidationEthGuardMessage,
	)
	const queuedLiquidationOperation = (() => {
		if (securityPoolOverviewResult?.action !== 'queueLiquidation') return undefined
		if (currentPoolOracleManagerDetails?.pendingOperation?.operation === 'liquidation' && currentPoolOracleManagerDetails.pendingOperation.targetVault === liquidationTargetVault) {
			return {
				amount: currentPoolOracleManagerDetails.pendingOperation.amount,
				isPendingSlot: true,
				operationId: currentPoolOracleManagerDetails.pendingOperation.operationId,
			} satisfies QueuedLiquidationOperationView
		}
		if (securityPoolOverviewResult.queuedOperation?.operation !== 'liquidation') return undefined
		return {
			amount: undefined,
			isPendingSlot: securityPoolOverviewResult.queuedOperation.isPendingSlot,
			operationId: securityPoolOverviewResult.queuedOperation.operationId,
		} satisfies QueuedLiquidationOperationView
	})()
	const queuedLiquidationStatus =
		securityPoolOverviewResult?.action !== 'queueLiquidation'
			? undefined
			: (() => {
					if (securityPoolOverviewResult.stagedExecution !== undefined) {
						if (securityPoolOverviewResult.stagedExecution.success) return 'executed'

						return 'failed'
					}
					if (queuedLiquidationOperation !== undefined) return queuedLiquidationOperation.isPendingSlot ? 'queued' : 'manual-queued'
					if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return 'refreshing'

					return (() => {
						if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails)) return 'executed'

						return 'missing'
					})()
				})()
	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section ref={dialogRef} className='modal-panel' role='dialog' aria-modal='true' aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{getLiquidationModalTitle(currentPoolOracleManagerDetails)}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={UI_STRING_CLOSE} title={UI_STRING_CLOSE} onClick={closeLiquidationModal}>
						×
					</button>
				</div>
				{renderQueuedLiquidationStatusCard({
					onViewInStagedOperations: () => onSelectedPoolViewChange('staged-operations'),
					queuedLiquidationOperation,
					queuedLiquidationStatus,
					securityPoolOverviewResult,
				})}
				<ErrorNotice message={securityPoolLiquidationError} />
				<DataGrid className='modal-summary-grid' columns={2}>
					<AddressInfo address={liquidationSecurityPoolAddress} label={UI_STRING_SECURITY_POOL} />
					<MetricField label={UI_STRING_SECURITY_MULTIPLIER}>{selectedPool?.securityMultiplier === undefined ? UI_STRING_UNAVAILABLE : `${selectedPool.securityMultiplier.toString()}${UI_STRING_MULTIPLIER_SUFFIX}`}</MetricField>
					<MetricField label={UI_STRING_CALLER_VAULT}>{accountAddress === undefined ? UI_STRING_CONNECT_WALLET : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label={UI_STRING_TARGET_VAULT}>{trimmedLiquidationTargetVault === '' ? UI_STRING_NONE_SELECTED : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label={UI_STRING_OPEN_ORACLE_PRICE} valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={poolOracleCollateralization}
						label={UI_STRING_TARGET_COLLATERALIZATION_AT_OPEN_ORACLE}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={UI_STRING_UNAVAILABLE}
					/>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? UI_STRING_UNAVAILABLE : <CurrencyValue value={repPerEthPrice} suffix={UI_STRING_REP_PER_ETH} copyable={false} />}
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={quotedPriceCollateralization}
						label={
							<span>
								{repPriceSourceCopy.quotedCollateralizationLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={UI_STRING_UNAVAILABLE}
					/>
					<CollateralizationMetricField
						collateralizationPercent={callerPoolOracleCollateralization}
						label={UI_STRING_CALLER_COLLATERALIZATION_AT_OPEN_ORACLE}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={callerVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={UI_STRING_UNAVAILABLE}
					/>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<WarningSurface as='section' variant='compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{UI_STRING_INVALID_LIQUIDATION_PAIR}</h4>
							</div>
						</div>
						<p className='detail'>{sameVaultWarning}</p>
					</WarningSurface>
				)}
				<div className='form-grid'>
					<label className='field'>
						<span>{UI_STRING_LIQUIDATION_AMOUNT_ETH}</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder={UI_STRING_ZERO_DECIMAL_PLACEHOLDER} />
							<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxActionAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxActionAmount))} disabled={liquidationMaxActionAmount === undefined || liquidationMaxActionAmount <= 0n}>
								{UI_STRING_MAX}
							</button>
						</div>
					</label>
					{liquidationExecutionMode === 'execute' ? null : (
						<label className='field'>
							<span>{UI_STRING_MANUAL_EXECUTION_TIMEOUT}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' inputMode='numeric' min='1' pattern='[0-9]*' step='1' value={liquidationTimeoutDisplayValue} onInput={event => onLiquidationTimeoutMinutesChange(event.currentTarget.value)} />
								<span className='field-inline-action'>{UI_STRING_MINUTES}</span>
							</div>
						</label>
					)}
				</div>
				{liquidationExecutionMode === 'execute' ? null : <p className='detail'>{liquidationTimeoutHelpText}</p>}
				{liquidationSimulation === undefined ? null : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{UI_STRING_CALLER_VAULT_AFTER_LIQUIDATION}</h4>
							</div>
						</div>
						<MetricGrid>
							<MetricField label={UI_STRING_REP_COLLATERAL}>
								<CurrencyValue value={liquidationSimulation.callerAfter.repDepositShare} suffix={UI_STRING_REP} />
							</MetricField>
							<MetricField label={UI_STRING_SECURITY_BOND_ALLOWANCE}>
								<CurrencyValue value={liquidationSimulation.callerAfter.securityBondAllowance} suffix={UI_STRING_ETH} />
							</MetricField>
							<CollateralizationMetricField
								collateralizationPercent={liquidationSimulation.callerAfter.collateralization}
								label={UI_STRING_COLLATERALIZATION_AT_OPEN_ORACLE}
								repPerEthSource={undefined}
								repPerEthSourceUrl={undefined}
								securityBondAllowance={liquidationSimulation.callerAfter.securityBondAllowance}
								securityMultiplier={selectedPool?.securityMultiplier}
								unavailableCopy={UI_STRING_UNAVAILABLE}
							/>
							<MetricField label={UI_STRING_REP_MOVED}>
								<CurrencyValue value={liquidationSimulation.repToMove} suffix={UI_STRING_REP} />
							</MetricField>
						</MetricGrid>
					</section>
				)}
				<div className='actions liquidation-modal-actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						{UI_STRING_CANCEL}
					</button>
					<TransactionActionButton
						idleLabel={buttonLabels.idle}
						pendingLabel={buttonLabels.pending}
						onClick={() => {
							if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined) return
							onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress)
						}}
						pending={securityPoolOverviewActiveAction === 'queueLiquidation'}
						availability={{
							disabled: !liquidationEnabled || !canUseLiquidationAction || liquidationActionReason !== undefined,
							reason: liquidationEnabled && canUseLiquidationAction ? liquidationActionReason : undefined,
						}}
						showDisabledReason={liquidationExecutionMode !== 'queue'}
					/>
				</div>
			</section>
		</div>
	)
}
