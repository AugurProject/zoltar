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
import { UI_STRINGS } from '../lib/uiStrings.js'
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
			return UI_STRINGS.liquidationModal.executeVaultLiquidationTitle
		case 'queue':
			return UI_STRINGS.liquidationModal.queueVaultLiquidationTitle
		case 'refreshing':
			return UI_STRINGS.liquidationModal.liquidateVaultTitle
		default:
			return assertNever(executionMode)
	}
}
function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	switch (executionMode) {
		case 'execute':
			return { idle: UI_STRINGS.liquidationModal.executeVaultLiquidationTitle, pending: UI_STRINGS.liquidationModal.executeLiquidationPendingLabel }
		case 'queue':
			return { idle: UI_STRINGS.liquidationModal.queueLiquidationIdleLabel, pending: UI_STRINGS.liquidationModal.queueLiquidationPendingLabel }
		case 'refreshing':
			return { idle: UI_STRINGS.liquidationModal.liquidateVaultIdleLabel, pending: UI_STRINGS.liquidationModal.liquidateVaultPendingLabel }
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
				title={UI_STRINGS.liquidationModal.liquidationQueuedTitle}
				badge={<Badge tone='warning'>{UI_STRINGS.liquidationModal.queuedBadgeLabel}</Badge>}
				metrics={
					<MetricGrid>
						<MetricField label={UI_STRINGS.securityVaultSection.stagedOperationLabel}>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						{queuedLiquidationOperation.amount === undefined ? null : (
							<MetricField label={UI_STRINGS.liquidationModal.metricAmountLabel}>
								<CurrencyValue value={queuedLiquidationOperation.amount} />
							</MetricField>
						)}
					</MetricGrid>
				}
				detail={queuedLiquidationStatus === 'manual-queued' ? UI_STRINGS.liquidationModal.manualQueuedLiquidationDetail : undefined}
				actions={
					<button className='secondary' type='button' onClick={onViewInStagedOperations}>
						{UI_STRINGS.liquidationModal.viewInStagedOperationsLabel}
					</button>
				}
			/>
		)
	}
	if (queuedLiquidationStatus === 'failed')
		return (
			<TransactionStatusCard
				title={UI_STRINGS.liquidationModal.liquidationFailedTitle}
				badge={<Badge tone='blocked'>{UI_STRINGS.liquidationModal.failedBadgeLabel}</Badge>}
				detail={getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? UI_STRINGS.liquidationModal.liquidationFailedDetail}
				secondaryDetail={UI_STRINGS.liquidationModal.submitNewStagedOperationDetail}
			/>
		)
	if (queuedLiquidationStatus === 'executed') return <TransactionStatusCard title={UI_STRINGS.liquidationModal.liquidationExecutedTitle} badge={<Badge tone='ok'>{UI_STRINGS.liquidationModal.operationExecutedBadgeLabel}</Badge>} detail={UI_STRINGS.liquidationModal.validOracleExecutedDetail} />
	if (queuedLiquidationStatus === 'missing') return <TransactionStatusCard title={UI_STRINGS.liquidationModal.liquidationSubmittedTitle} badge={<Badge tone='warning'>{UI_STRINGS.liquidationModal.checkStateBadgeLabel}</Badge>} detail={UI_STRINGS.liquidationModal.transactionStateUnavailableDetail} />
	return <TransactionStatusCard title={UI_STRINGS.liquidationModal.refreshingLiquidationStateTitle} badge={<Badge tone='muted'>{UI_STRINGS.liquidationModal.refreshingBadgeLabel}</Badge>} detail={UI_STRINGS.liquidationModal.refreshingLiquidationStateDetail} />
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
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? UI_STRINGS.liquidationModal.timeoutHelpTextInvalid : UI_STRINGS.liquidationModal.timeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = accountAddress === undefined || trimmedLiquidationTargetVault === '' || !sameAddress(accountAddress, trimmedLiquidationTargetVault) ? undefined : UI_STRINGS.liquidationModal.selectDifferentTargetVaultReason
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
		if (selectedPool?.securityMultiplier === undefined) return UI_STRINGS.liquidationModal.reloadPoolBeforeExecutingReason

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
						actionLabel: UI_STRINGS.liquidationModal.queueLiquidationActionLabel,
						includeBuffer: funding?.includeBuffer === true,
						requiredEthCost: funding?.ethCost,
						walletEthBalance,
					})
				})()
	const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true
	const canUseLiquidationAction = accountAddress !== undefined && isMainnet
	const liquidationActionReason = pickFirstReason(
		liquidationExecutionMode === 'refreshing' ? UI_STRINGS.liquidationModal.refreshingOpenOracleValidityReason : undefined,
		liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? UI_STRINGS.liquidationModal.reloadPoolBeforeLiquidatingReason : undefined,
		trimmedLiquidationTargetVault === '' ? UI_STRINGS.liquidationModal.selectTargetVaultReason : undefined,
		sameVaultWarning,
		liquidationAmount.trim() === '' ? UI_STRINGS.liquidationModal.enterLiquidationAmountReason : undefined,
		liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? UI_STRINGS.liquidationModal.enterLiquidationTimeoutReason : undefined,
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
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={UI_STRINGS.liquidationModal.closeButtonAriaLabel} title={UI_STRINGS.liquidationModal.closeButtonAriaLabel} onClick={closeLiquidationModal}>
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
					<AddressInfo address={liquidationSecurityPoolAddress} label={UI_STRINGS.liquidationModal.securityPoolLabel} />
					<MetricField label={UI_STRINGS.liquidationModal.securityMultiplierLabel}>{selectedPool?.securityMultiplier === undefined ? UI_STRINGS.common.unavailableLabel : `${selectedPool.securityMultiplier.toString()}${UI_STRINGS.common.multiplierSuffix}`}</MetricField>
					<MetricField label={UI_STRINGS.liquidationModal.callerVaultLabel}>{accountAddress === undefined ? UI_STRINGS.userCopy.wallet.connectWalletBadgeLabel : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label={UI_STRINGS.liquidationModal.targetVaultLabel}>{trimmedLiquidationTargetVault === '' ? UI_STRINGS.common.noneSelectedLabel : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label={UI_STRINGS.liquidationModal.openOraclePriceLabel} valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={poolOracleCollateralization}
						label={UI_STRINGS.liquidationModal.targetCollateralizationAtOpenOracleLabel}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={UI_STRINGS.common.unavailableLabel}
					/>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? UI_STRINGS.common.unavailableLabel : <CurrencyValue value={repPerEthPrice} suffix={UI_STRINGS.common.repPerEthSuffix} copyable={false} />}
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
						unavailableCopy={UI_STRINGS.common.unavailableLabel}
					/>
					<CollateralizationMetricField
						collateralizationPercent={callerPoolOracleCollateralization}
						label={UI_STRINGS.liquidationModal.callerCollateralizationAtOpenOracleLabel}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={callerVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={UI_STRINGS.common.unavailableLabel}
					/>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<WarningSurface as='section' variant='compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{UI_STRINGS.liquidationModal.invalidLiquidationPairTitle}</h4>
							</div>
						</div>
						<p className='detail'>{sameVaultWarning}</p>
					</WarningSurface>
				)}
				<div className='form-grid'>
					<label className='field'>
						<span>{UI_STRINGS.liquidationModal.liquidationAmountLabel}</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder={UI_STRINGS.liquidationModal.liquidationAmountPlaceholder} />
							<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxActionAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxActionAmount))} disabled={liquidationMaxActionAmount === undefined || liquidationMaxActionAmount <= 0n}>
								{UI_STRINGS.common.maxLabel}
							</button>
						</div>
					</label>
					{liquidationExecutionMode === 'execute' ? null : (
						<label className='field'>
							<span>{UI_STRINGS.liquidationModal.manualExecutionTimeoutLabel}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' inputMode='numeric' min='1' pattern='[0-9]*' step='1' value={liquidationTimeoutDisplayValue} onInput={event => onLiquidationTimeoutMinutesChange(event.currentTarget.value)} />
								<span className='field-inline-action'>{UI_STRINGS.common.minutesLabel}</span>
							</div>
						</label>
					)}
				</div>
				{liquidationExecutionMode === 'execute' ? null : <p className='detail'>{liquidationTimeoutHelpText}</p>}
				{liquidationSimulation === undefined ? null : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{UI_STRINGS.liquidationModal.callerVaultAfterLiquidationTitle}</h4>
							</div>
						</div>
						<MetricGrid>
							<MetricField label={UI_STRINGS.liquidationModal.repCollateralLabel}>
								<CurrencyValue value={liquidationSimulation.callerAfter.repDepositShare} suffix={UI_STRINGS.common.repLabel} />
							</MetricField>
							<MetricField label={UI_STRINGS.liquidationModal.securityBondAllowanceLabel}>
								<CurrencyValue value={liquidationSimulation.callerAfter.securityBondAllowance} suffix={UI_STRINGS.common.ethSuffix} />
							</MetricField>
							<CollateralizationMetricField
								collateralizationPercent={liquidationSimulation.callerAfter.collateralization}
								label={UI_STRINGS.liquidationModal.collateralizationAtOpenOracleLabel}
								repPerEthSource={undefined}
								repPerEthSourceUrl={undefined}
								securityBondAllowance={liquidationSimulation.callerAfter.securityBondAllowance}
								securityMultiplier={selectedPool?.securityMultiplier}
								unavailableCopy={UI_STRINGS.common.unavailableLabel}
							/>
							<MetricField label={UI_STRINGS.liquidationModal.repMovedLabel}>
								<CurrencyValue value={liquidationSimulation.repToMove} suffix={UI_STRINGS.common.repLabel} />
							</MetricField>
						</MetricGrid>
					</section>
				)}
				<div className='actions liquidation-modal-actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						{UI_STRINGS.common.cancelLabel}
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
