import * as commonCopy from '../../../copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useId, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressInfo } from '../../../components/AddressInfo.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
import { CollateralizationMetricField } from './CollateralizationMetricField.js'
import { CurrencyValue } from '../../../components/CurrencyValue.js'
import { DataGrid } from '../../../components/DataGrid.js'
import { ErrorNotice } from '../../../components/ErrorNotice.js'
import { FormInput } from '../../../components/FormInput.js'
import { MetricGrid } from '../../../components/MetricGrid.js'
import { MetricField } from '../../../components/MetricField.js'
import { OpenOraclePriceValue } from '../../open-oracle/components/OpenOraclePriceValue.js'
import { TransactionActionButton } from '../../../components/TransactionActionButton.js'
import { TransactionReview } from '../../../components/TransactionReview.js'
import { TransactionNetworkValue } from '../../../components/TransactionNetworkValue.js'
import { TransactionUniverseValue } from '../../universes/components/TransactionUniverseValue.js'
import { WarningSurface } from '../../../components/WarningSurface.js'
import { TransactionStatusCard } from '../../../components/TransactionStatusCard.js'
import { assertNever } from '../../../lib/assert.js'
import { sameAddress } from '../../../lib/address.js'
import { pickFirstReason } from '../../../lib/actionAvailability.js'
import { useChainTimestamp } from '../../../lib/chainTimestamp.js'
import { formatCurrencyInputBalance, formatDuration } from '../../../lib/formatters.js'
import { getDeterministicLiquidationFailureReason, getLiquidationExecutionFailureDetail, getLiquidationFailureReason, getMaxLiquidationAmount, simulateLiquidation } from '../lib/liquidation.js'
import { tryParseBigIntInput, tryParseRepAmountInput } from '../../markets/lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../../open-oracle/lib/repPriceSource.js'
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js'
import { getVaultCollateralizationPercent } from '../../markets/lib/trading.js'
import { useModalFocusIsolation } from '../../../hooks/useModalFocusIsolation.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../../../types/contracts.js'
type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isMainnet: boolean
	liquidationAmount: string
	liquidationMaxAmount: bigint | undefined
	liquidationManagerAddress: Address | undefined
	liquidationFundingPreview?: LiquidationFundingPreview | undefined
	liquidationFundingPreviewError?: string | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutMinutes: string
	loadingPoolOracleManager: boolean
	loadingLiquidationFundingPreview?: boolean | undefined
	onLoadLiquidationFundingPreview?: ((managerAddress: Address) => void) | undefined
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
			return liquidationCopy.executeVaultLiquidation
		case 'queue':
			return liquidationCopy.queueVaultLiquidation
		case 'refreshing':
			return liquidationCopy.liquidateVault
		default:
			return assertNever(executionMode)
	}
}
function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails)
	switch (executionMode) {
		case 'execute':
			return { idle: liquidationCopy.executeVaultLiquidation, pending: liquidationCopy.executingLiquidation }
		case 'queue':
			return { idle: liquidationCopy.queueLiquidation, pending: liquidationCopy.queueingLiquidation }
		case 'refreshing':
			return { idle: liquidationCopy.liquidateVault, pending: liquidationCopy.liquidateVaultPendingLabel }
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
				title={liquidationCopy.liquidationQueued}
				badge={<Badge tone='warning'>{liquidationCopy.queued}</Badge>}
				metrics={
					<MetricGrid>
						<MetricField label={commonCopy.stagedOperation}>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						{queuedLiquidationOperation.amount === undefined ? null : (
							<MetricField label={commonCopy.amount}>
								<CurrencyValue value={queuedLiquidationOperation.amount} />
							</MetricField>
						)}
					</MetricGrid>
				}
				detail={queuedLiquidationStatus === 'manual-queued' ? commonCopy.manualQueuedOperationDetail : undefined}
				actions={
					<button className='secondary' type='button' onClick={onViewInStagedOperations}>
						{commonCopy.viewInStagedOperations}
					</button>
				}
			/>
		)
	}
	if (queuedLiquidationStatus === 'failed')
		return (
			<TransactionStatusCard
				title={commonCopy.liquidationFailed}
				badge={<Badge tone='blocked'>{commonCopy.failed}</Badge>}
				detail={getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? liquidationCopy.immediateLiquidationRejectedDetail}
				secondaryDetail={commonCopy.stagedOperationRetryDetail}
			/>
		)
	if (queuedLiquidationStatus === 'executed') return <TransactionStatusCard title={commonCopy.liquidationExecuted} badge={<Badge tone='ok'>{commonCopy.executed}</Badge>} detail={liquidationCopy.immediateLiquidationSuccessDetail} />
	if (queuedLiquidationStatus === 'missing') return <TransactionStatusCard title={commonCopy.liquidationSubmitted} badge={<Badge tone='warning'>{liquidationCopy.checkState}</Badge>} detail={commonCopy.transactionStateUnavailableDetail} />
	return <TransactionStatusCard title={liquidationCopy.refreshingLiquidationStateTitle} badge={<Badge tone='muted'>{commonCopy.refreshingWithoutEllipsis}</Badge>} detail={liquidationCopy.refreshingLiquidationState} />
}
export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isMainnet,
	liquidationAmount,
	liquidationMaxAmount,
	liquidationManagerAddress,
	liquidationFundingPreview,
	liquidationFundingPreviewError,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingLiquidationFundingPreview = false,
	liquidationTargetVault,
	onLoadPoolOracleManager,
	onLoadLiquidationFundingPreview = () => undefined,
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
	useEffect(() => {
		if (!showLiquidationModal || getLiquidationExecutionMode(currentPoolOracleManagerDetails) !== 'queue') return
		if (liquidationManagerAddress === undefined || liquidationFundingPreview !== undefined || liquidationFundingPreviewError !== undefined || loadingLiquidationFundingPreview) return
		onLoadLiquidationFundingPreview(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationFundingPreview, liquidationFundingPreviewError, liquidationManagerAddress, loadingLiquidationFundingPreview, onLoadLiquidationFundingPreview, showLiquidationModal])
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
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = accountAddress === undefined || trimmedLiquidationTargetVault === '' || !sameAddress(accountAddress, trimmedLiquidationTargetVault) ? undefined : liquidationCopy.distinctTargetVaultRequired
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
		if (selectedPool?.securityMultiplier === undefined) return liquidationCopy.selectedPoolReloadRequired

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
					return getOracleRequestEthGuardMessage({
						actionLabel: liquidationCopy.queueLiquidationActionLabel,
						requiredEthCost: liquidationFundingPreview?.totalWalletEthRequired,
						walletEthBalance,
					})
				})()
	const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true
	const canUseLiquidationAction = accountAddress !== undefined && isMainnet
	const liquidationActionReason = pickFirstReason(
		liquidationExecutionMode === 'refreshing' ? liquidationCopy.refreshingPriceValidity : undefined,
		liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? liquidationCopy.liquidationPoolReloadRequired : undefined,
		trimmedLiquidationTargetVault === '' ? liquidationCopy.targetVaultRequired : undefined,
		sameVaultWarning,
		liquidationAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined,
		liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? liquidationCopy.liquidationTimeoutMinimumReason : undefined,
		liquidationExecutionMode === 'queue' && loadingLiquidationFundingPreview ? liquidationCopy.loadingQueueFunding : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreviewError !== undefined ? liquidationFundingPreviewError : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreview === undefined ? liquidationCopy.queueFundingRequired : undefined,
		deterministicLiquidationReason,
		directLiquidationReason,
		queueLiquidationEthGuardMessage,
	)
	const liquidationButtonDisabledReason = (() => {
		if (!isMainnet) return commonCopy.mainnetRequiredReason
		if (accountAddress === undefined) return commonCopy.walletConnectionRequired
		if (!liquidationEnabled) return undefined
		return liquidationActionReason
	})()
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
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={commonCopy.close} title={commonCopy.close} onClick={closeLiquidationModal}>
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
					<AddressInfo address={liquidationSecurityPoolAddress} label={liquidationCopy.securityPool} />
					<MetricField label={commonCopy.securityMultiplier}>{selectedPool?.securityMultiplier === undefined ? commonCopy.unavailable : `${selectedPool.securityMultiplier.toString()}${liquidationCopy.multiplierSuffix}`}</MetricField>
					<MetricField label={liquidationCopy.callerVault}>{accountAddress === undefined ? commonCopy.connectWallet : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label={commonCopy.targetVault}>{trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label={commonCopy.openOraclePrice} valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<CollateralizationMetricField
						collateralizationPercent={poolOracleCollateralization}
						label={liquidationCopy.targetCollateralizationAtOpenOracle}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={targetVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={commonCopy.unavailable}
					/>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? commonCopy.unavailable : <CurrencyValue value={repPerEthPrice} suffix={commonCopy.repPerEth} copyable={false} />}
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
						unavailableCopy={commonCopy.unavailable}
					/>
					<CollateralizationMetricField
						collateralizationPercent={callerPoolOracleCollateralization}
						label={liquidationCopy.callerCollateralizationAtOpenOracle}
						repPerEthSource={undefined}
						repPerEthSourceUrl={undefined}
						securityBondAllowance={callerVaultSummary?.securityBondAllowance}
						securityMultiplier={selectedPool?.securityMultiplier}
						unavailableCopy={commonCopy.unavailable}
					/>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<WarningSurface as='section' variant='compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{liquidationCopy.invalidLiquidationPair}</h4>
							</div>
						</div>
						<p className='detail'>{sameVaultWarning}</p>
					</WarningSurface>
				)}
				<div className='form-grid'>
					<label className='field'>
						<span>{liquidationCopy.liquidationAmountEth}</span>
						<div className='field-inline'>
							<FormInput className='field-inline-input' value={liquidationAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder={commonCopy.zeroDecimalPlaceholder} />
							<button className='quiet field-inline-action' type='button' onClick={() => onLiquidationAmountChange(liquidationMaxActionAmount === undefined ? '' : formatCurrencyInputBalance(liquidationMaxActionAmount))} disabled={liquidationMaxActionAmount === undefined || liquidationMaxActionAmount <= 0n}>
								{commonCopy.max}
							</button>
						</div>
					</label>
					{liquidationExecutionMode === 'execute' ? null : (
						<label className='field'>
							<span>{commonCopy.manualExecutionTimeout}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' inputMode='numeric' min='1' pattern='[0-9]*' step='1' value={liquidationTimeoutDisplayValue} onInput={event => onLiquidationTimeoutMinutesChange(event.currentTarget.value)} />
								<span className='field-inline-action'>{commonCopy.minutes}</span>
							</div>
						</label>
					)}
				</div>
				{liquidationExecutionMode === 'execute' ? null : <p className='detail'>{liquidationTimeoutHelpText}</p>}
				{liquidationExecutionMode !== 'queue' || liquidationFundingPreviewError === undefined ? null : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={() => (liquidationManagerAddress === undefined ? undefined : onLoadLiquidationFundingPreview(liquidationManagerAddress))} disabled={loadingLiquidationFundingPreview}>
							{liquidationCopy.retryQueueFunding}
						</button>
					</div>
				)}
				{liquidationSimulation === undefined ? null : (
					<section className='entity-card compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{liquidationCopy.callerVaultAfterLiquidation}</h4>
							</div>
						</div>
						<MetricGrid>
							<MetricField label={commonCopy.repCollateral}>
								<CurrencyValue value={liquidationSimulation.callerAfter.repDepositShare} suffix={commonCopy.rep} />
							</MetricField>
							<MetricField label={commonCopy.securityBondAllowance}>
								<CurrencyValue value={liquidationSimulation.callerAfter.securityBondAllowance} suffix={commonCopy.eth} />
							</MetricField>
							<CollateralizationMetricField
								collateralizationPercent={liquidationSimulation.callerAfter.collateralization}
								label={liquidationCopy.collateralizationAtOpenOracle}
								repPerEthSource={undefined}
								repPerEthSourceUrl={undefined}
								securityBondAllowance={liquidationSimulation.callerAfter.securityBondAllowance}
								securityMultiplier={selectedPool?.securityMultiplier}
								unavailableCopy={commonCopy.unavailable}
							/>
							<MetricField label={liquidationCopy.repMoved}>
								<CurrencyValue value={liquidationSimulation.repToMove} suffix={commonCopy.rep} />
							</MetricField>
						</MetricGrid>
					</section>
				)}
				<TransactionReview
					context={[
						{ label: commonCopy.question, value: selectedPool?.marketDetails.title ?? commonCopy.unavailable },
						{ label: liquidationCopy.securityPool, value: liquidationSecurityPoolAddress === undefined ? commonCopy.unavailable : <AddressValue address={liquidationSecurityPoolAddress} /> },
						{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={selectedPool?.universeId} /> },
						{ label: commonCopy.targetVault, value: trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationTargetVault} /> },
					]}
					primary={[
						{ label: liquidationCopy.debtAssumed, value: <CurrencyValue value={liquidationAmountValue} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.repMoved, value: <CurrencyValue value={liquidationSimulation?.repToMove} suffix={commonCopy.rep} /> },
						...(liquidationExecutionMode === 'queue' ? [{ label: liquidationCopy.totalWalletEthRequired, value: <CurrencyValue value={liquidationFundingPreview?.totalWalletEthRequired} suffix={commonCopy.eth} /> }] : []),
					]}
					details={[
						{ label: liquidationCopy.resultingCallerRep, value: <CurrencyValue value={liquidationSimulation?.callerAfter.repDepositShare} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.resultingCallerBond, value: <CurrencyValue value={liquidationSimulation?.callerAfter.securityBondAllowance} suffix={commonCopy.eth} /> },
						...(liquidationExecutionMode === 'queue'
							? [
									{ label: liquidationCopy.bufferedQueueCost, value: <CurrencyValue value={liquidationFundingPreview?.queueOperationEthValue} suffix={commonCopy.eth} /> },
									{ label: liquidationCopy.ethWrappedToWeth, value: <CurrencyValue value={liquidationFundingPreview?.wethShortfall} suffix={commonCopy.eth} /> },
									{ label: liquidationCopy.repLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportRepRequired} suffix={commonCopy.rep} /> },
									{ label: liquidationCopy.wethLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportWethRequired} suffix={commonCopy.weth} /> },
									{
										label: liquidationCopy.resultingWalletEth,
										value: <CurrencyValue value={liquidationFundingPreview === undefined || walletEthBalance === undefined || liquidationFundingPreview.totalWalletEthRequired > walletEthBalance ? undefined : walletEthBalance - liquidationFundingPreview.totalWalletEthRequired} suffix={commonCopy.eth} />,
									},
									{
										label: liquidationCopy.resultingWalletRep,
										value: (
											<CurrencyValue
												value={liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportRepRequired > liquidationFundingPreview.currentRepBalance ? undefined : liquidationFundingPreview.currentRepBalance - liquidationFundingPreview.initialReportRepRequired}
												suffix={commonCopy.rep}
											/>
										),
									},
									{
										label: liquidationCopy.resultingWalletWeth,
										value: (
											<CurrencyValue
												value={
													liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportWethRequired > liquidationFundingPreview.currentWethBalance + liquidationFundingPreview.wethShortfall
														? undefined
														: liquidationFundingPreview.currentWethBalance + liquidationFundingPreview.wethShortfall - liquidationFundingPreview.initialReportWethRequired
												}
												suffix={commonCopy.weth}
											/>
										),
									},
								]
							: [{ label: liquidationCopy.oracleRequestEth, value: transactionReviewCopy.noProtocolFee }]),
						{ label: transactionReviewCopy.contract, value: liquidationManagerAddress === undefined ? commonCopy.unavailable : <AddressValue address={liquidationManagerAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
					risks={[liquidationCopy.liquidationStateRisk, ...(liquidationExecutionMode === 'queue' ? [liquidationCopy.queuedLiquidationRisk, liquidationCopy.queuedFundingSequenceRisk] : [])]}
				/>
				<div className='actions liquidation-modal-actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						{commonCopy.cancel}
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
							reason: liquidationButtonDisabledReason,
						}}
						showDisabledReason={liquidationExecutionMode !== 'queue'}
					/>
				</div>
			</section>
		</div>
	)
}
