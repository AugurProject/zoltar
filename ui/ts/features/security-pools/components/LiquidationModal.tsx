import * as commonCopy from '../../../copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import * as transactionReviewCopy from '../../../copy/transactionReview.js'
import { useEffect, useId, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressInfo } from '../../../components/AddressInfo.js'
import { AddressValue } from '../../../components/AddressValue.js'
import { Badge } from '../../../components/Badge.js'
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
import { tryParseBigIntInput, tryParseEthAmountInput } from '../../markets/lib/marketForm.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '../../open-oracle/lib/repPriceSource.js'
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { useModalFocusIsolation } from '../../../hooks/useModalFocusIsolation.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { getWrongNetworkMessage } from '../../../lib/network.js'
type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isOnActiveAppChain: boolean
	coverageCommitmentTransferEthAmount: string
	maximumCoverageCommitmentTransferAttoEth: bigint | undefined
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
	poolOracleManagerError?: string | undefined
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
	walletBalanceAttoEth?: bigint | undefined
}
type QueuedLiquidationOperationView = {
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}
function getLiquidationExecutionMode(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined) {
	if (currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp) ? 'execute' : 'queue'
}
function getLiquidationModalTitle(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp)
	switch (executionMode) {
		case 'execute':
			return liquidationCopy.executeVaultLiquidationTitle
		case 'queue':
			return liquidationCopy.queueVaultLiquidation
		case 'refreshing':
			return liquidationCopy.liquidateVaultTitle
		default:
			return assertNever(executionMode)
	}
}
function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined) {
	const executionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp)
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
				surface='flat'
				title={liquidationCopy.liquidationQueued}
				badge={<Badge tone='warning'>{liquidationCopy.queued}</Badge>}
				metrics={
					<MetricGrid>
						<MetricField label={commonCopy.stagedOperation}>#{queuedLiquidationOperation.operationId.toString()}</MetricField>
						{queuedLiquidationOperation.amount === undefined ? null : (
							<MetricField label={liquidationCopy.coverageCommitmentTransfer}>
								<CurrencyValue precision='exact' value={queuedLiquidationOperation.amount} suffix={commonCopy.eth} />
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
				surface='flat'
				title={commonCopy.liquidationFailed}
				badge={<Badge tone='blocked'>{commonCopy.failed}</Badge>}
				detail={getLiquidationExecutionFailureDetail(securityPoolOverviewResult?.stagedExecution?.errorMessage) ?? liquidationCopy.immediateLiquidationRejectedDetail}
				secondaryDetail={commonCopy.stagedOperationRetryDetail}
			/>
		)
	if (queuedLiquidationStatus === 'executed') return <TransactionStatusCard surface='flat' title={commonCopy.liquidationExecuted} badge={<Badge tone='ok'>{commonCopy.executed}</Badge>} detail={liquidationCopy.immediateLiquidationSuccessDetail} />
	if (queuedLiquidationStatus === 'missing') return <TransactionStatusCard surface='flat' title={commonCopy.liquidationSubmitted} badge={<Badge tone='warning'>{liquidationCopy.checkState}</Badge>} detail={commonCopy.transactionStateUnavailableDetail} />
	return <TransactionStatusCard surface='flat' title={liquidationCopy.refreshingLiquidationStateTitle} badge={<Badge tone='muted'>{commonCopy.refreshingWithoutEllipsis}</Badge>} detail={liquidationCopy.refreshingLiquidationState} />
}
export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isOnActiveAppChain,
	coverageCommitmentTransferEthAmount,
	maximumCoverageCommitmentTransferAttoEth,
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
	poolOracleManagerError = undefined,
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
	walletBalanceAttoEth,
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
		if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager || poolOracleManagerError !== undefined) return
		onLoadPoolOracleManager(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationManagerAddress, loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerError, showLiquidationModal])
	useEffect(() => {
		if (!showLiquidationModal || getLiquidationExecutionMode(currentPoolOracleManagerDetails, chainCurrentTimestamp) !== 'queue') return
		if (liquidationManagerAddress === undefined || liquidationFundingPreview !== undefined || liquidationFundingPreviewError !== undefined || loadingLiquidationFundingPreview) return
		onLoadLiquidationFundingPreview(liquidationManagerAddress)
	}, [chainCurrentTimestamp, currentPoolOracleManagerDetails, liquidationFundingPreview, liquidationFundingPreviewError, liquidationManagerAddress, loadingLiquidationFundingPreview, onLoadLiquidationFundingPreview, showLiquidationModal])
	if (!showLiquidationModal) return undefined
	const currentTimestamp = chainCurrentTimestamp
	const liquidationAmountValue = tryParseEthAmountInput(coverageCommitmentTransferEthAmount)
	const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)
	const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails, currentTimestamp)
	const hasUsableOraclePrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)
	const trimmedLiquidationTargetVault = liquidationTargetVault.trim()
	const liquidationTimeoutDisplayValue = liquidationTimeoutMinutes === '' ? '' : liquidationTimeoutMinutes
	const liquidationTimeoutSeconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(liquidationTimeoutDisplayValue))
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = accountAddress === undefined || trimmedLiquidationTargetVault === '' || !sameAddress(accountAddress, trimmedLiquidationTargetVault) ? undefined : liquidationCopy.distinctTargetVaultRequired
	const liquidationSimulation =
		targetVaultSummary === undefined || poolOraclePrice === undefined || selectedPool?.statoblastSecurityMultiplierBps === undefined || liquidationAmountValue === undefined
			? undefined
			: simulateLiquidation({
					callerVaultSummary,
					coverageCommitmentTransferAttoEth: liquidationAmountValue,
					repPerEthPrice: poolOraclePrice,
					statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
					targetVaultSummary,
				})
	const computedLiquidationMaxAmount = getMaxLiquidationAmount({
		repPerEthPrice: poolOraclePrice,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const liquidationMaxActionAmount = hasUsableOraclePrice ? (computedLiquidationMaxAmount ?? maximumCoverageCommitmentTransferAttoEth) : maximumCoverageCommitmentTransferAttoEth
	const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary,
		coverageCommitmentTransferAttoEth: liquidationAmountValue,
		maxCoverageCommitmentToTransferAttoEth: hasUsableOraclePrice ? computedLiquidationMaxAmount : undefined,
		repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const directLiquidationReason = (() => {
		if (liquidationExecutionMode !== 'execute') return undefined
		if (selectedPool?.statoblastSecurityMultiplierBps === undefined) return liquidationCopy.selectedPoolReloadRequired

		return getLiquidationFailureReason({
			callerVaultSummary,
			coverageCommitmentTransferAttoEth: liquidationAmountValue,
			repPerEthPrice: poolOraclePrice,
			statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
			targetVaultSummary,
		})
	})()
	const queueLiquidationEthGuardMessage =
		liquidationExecutionMode !== 'queue'
			? undefined
			: (() => {
					return getOracleRequestEthGuardMessage({
						actionLabel: liquidationCopy.queueLiquidationActionLabel,
						requiredCostAttoEth: liquidationFundingPreview?.totalWalletEthRequiredAttoEth,
						walletBalanceAttoEth,
					})
				})()
	const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true
	const canUseLiquidationAction = accountAddress !== undefined && isOnActiveAppChain
	const liquidationActionReason = pickFirstReason(
		liquidationExecutionMode === 'refreshing' ? liquidationCopy.refreshingPriceValidity : undefined,
		liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? liquidationCopy.liquidationPoolReloadRequired : undefined,
		trimmedLiquidationTargetVault === '' ? liquidationCopy.targetVaultRequired : undefined,
		sameVaultWarning,
		coverageCommitmentTransferEthAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined,
		liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? liquidationCopy.liquidationTimeoutMinimumReason : undefined,
		liquidationExecutionMode === 'queue' && loadingLiquidationFundingPreview ? liquidationCopy.loadingQueueFunding : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreviewError !== undefined ? liquidationFundingPreviewError : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreview === undefined ? liquidationCopy.loadingQueueFunding : undefined,
		deterministicLiquidationReason,
		directLiquidationReason,
		queueLiquidationEthGuardMessage,
	)
	const liquidationButtonDisabledReason = (() => {
		if (!isOnActiveAppChain) return getWrongNetworkMessage() ?? commonCopy.mainnetRequiredReason
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
						if (isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)) return 'executed'

						return 'missing'
					})()
				})()
	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section ref={dialogRef} className='modal-panel' role='dialog' aria-modal='true' aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{getLiquidationModalTitle(currentPoolOracleManagerDetails, currentTimestamp)}</h3>
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
				<ErrorNotice message={poolOracleManagerError} />
				{poolOracleManagerError === undefined || liquidationManagerAddress === undefined ? undefined : (
					<div className='actions'>
						<button className='secondary' disabled={loadingPoolOracleManager} onClick={() => onLoadPoolOracleManager(liquidationManagerAddress)} type='button'>
							{liquidationCopy.retryPriceStatus}
						</button>
					</div>
				)}
				<ErrorNotice message={securityPoolLiquidationError} />
				<DataGrid className='modal-summary-grid' columns={2}>
					<AddressInfo address={liquidationSecurityPoolAddress} label={liquidationCopy.securityPool} />
					<MetricField label={commonCopy.statoblastSecurityMultiplierBps}>{selectedPool?.statoblastSecurityMultiplierBps === undefined ? commonCopy.unavailable : `${formatStatoblastSecurityMultiplier(selectedPool.statoblastSecurityMultiplierBps)}${liquidationCopy.multiplierSuffix}`}</MetricField>
					<MetricField label={liquidationCopy.callerVault}>{accountAddress === undefined ? commonCopy.connectWallet : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label={commonCopy.targetVault}>{trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label={commonCopy.openOraclePrice} valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<MetricField label={liquidationCopy.targetCoverageCommitmentAttoEth}>
						<CurrencyValue value={targetVaultSummary?.coverageCommitmentAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={liquidationCopy.targetVaultRepBackingAttoRep}>
						<CurrencyValue value={targetVaultSummary?.vaultRepBackingAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.targetDisputeStakedRepAttoRep}>
						<CurrencyValue value={targetVaultSummary?.disputeStakedRepAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField
						label={
							<span>
								{repPriceSourceCopy.quotedRepPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
							</span>
						}
					>
						{repPerEthPrice === undefined ? commonCopy.unavailable : <CurrencyValue value={repPerEthPrice} suffix={commonCopy.repPerEth} copyable={false} />}
					</MetricField>
					<MetricField label={liquidationCopy.callerCoverageCommitmentAttoEth}>
						<CurrencyValue value={callerVaultSummary?.coverageCommitmentAttoEth} suffix={commonCopy.eth} />
					</MetricField>
					<MetricField label={liquidationCopy.callerVaultRepBackingAttoRep}>
						<CurrencyValue value={callerVaultSummary?.vaultRepBackingAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.callerDisputeStakedRepAttoRep}>
						<CurrencyValue value={callerVaultSummary?.disputeStakedRepAttoRep} suffix={commonCopy.rep} />
					</MetricField>
				</DataGrid>
				{sameVaultWarning === undefined ? null : (
					<WarningSurface as='section' surface='flat' variant='compact'>
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
							<FormInput className='field-inline-input' value={coverageCommitmentTransferEthAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder={commonCopy.zeroDecimalPlaceholder} />
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
				<TransactionReview
					context={[
						{ label: commonCopy.question, value: selectedPool?.marketDetails.title ?? commonCopy.unavailable },
						{ label: commonCopy.universe, value: <TransactionUniverseValue universeId={selectedPool?.universeId} /> },
					]}
					primary={[
						{ label: liquidationCopy.coverageCommitmentAssumed, value: <CurrencyValue value={liquidationSimulation?.coverageCommitmentToTransferAttoEth} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.residualBadDebt, value: <CurrencyValue value={liquidationSimulation?.badDebtAttoEth} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.grossRepAwardAttoRep, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.grossRepAwardAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.repMoved, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.vaultRepBackingToTransferAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.targetAccruedFeesRetained, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.targetAccruedFeesRetained} suffix={commonCopy.eth} /> },
						...(liquidationExecutionMode === 'queue' ? [{ label: liquidationCopy.totalWalletEthRequiredAttoEth, value: <CurrencyValue value={liquidationFundingPreview?.totalWalletEthRequiredAttoEth} suffix={commonCopy.eth} /> }] : []),
					]}
					details={[
						{ label: liquidationCopy.resultingCallerRep, value: <CurrencyValue value={liquidationSimulation?.callerAfter.vaultRepBackingAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.resultingCallerBond, value: <CurrencyValue value={liquidationSimulation?.callerAfter.coverageCommitmentAttoEth} suffix={commonCopy.eth} /> },
					]}
					disclosures={
						liquidationExecutionMode === 'queue'
							? [
									{
										title: liquidationCopy.fundingDetails,
										rows: [
											{ label: liquidationCopy.bufferedQueueCost, value: <CurrencyValue value={liquidationFundingPreview?.queueOperationValueAttoEth} suffix={commonCopy.eth} /> },
											{ label: liquidationCopy.ethWrappedToWeth, value: <CurrencyValue value={liquidationFundingPreview?.wethShortfallAttoEth} suffix={commonCopy.eth} /> },
											{ label: liquidationCopy.repLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportRepRequiredAttoRep} suffix={commonCopy.rep} /> },
											{ label: liquidationCopy.wethLockedForInitialReport, value: <CurrencyValue value={liquidationFundingPreview?.initialReportWethRequiredAttoEth} suffix={commonCopy.weth} /> },
											{
												label: liquidationCopy.resultingWalletEth,
												value: (
													<CurrencyValue
														value={liquidationFundingPreview === undefined || walletBalanceAttoEth === undefined || liquidationFundingPreview.totalWalletEthRequiredAttoEth > walletBalanceAttoEth ? undefined : walletBalanceAttoEth - liquidationFundingPreview.totalWalletEthRequiredAttoEth}
														suffix={commonCopy.eth}
													/>
												),
											},
											{
												label: liquidationCopy.resultingWalletRep,
												value: (
													<CurrencyValue
														value={liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportRepRequiredAttoRep > liquidationFundingPreview.currentRepBalanceAttoRep ? undefined : liquidationFundingPreview.currentRepBalanceAttoRep - liquidationFundingPreview.initialReportRepRequiredAttoRep}
														suffix={commonCopy.rep}
													/>
												),
											},
											{
												label: liquidationCopy.resultingWalletWeth,
												value: (
													<CurrencyValue
														value={
															liquidationFundingPreview === undefined || liquidationFundingPreview.initialReportWethRequiredAttoEth > liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth
																? undefined
																: liquidationFundingPreview.currentWethBalanceAttoEth + liquidationFundingPreview.wethShortfallAttoEth - liquidationFundingPreview.initialReportWethRequiredAttoEth
														}
														suffix={commonCopy.weth}
													/>
												),
											},
										],
									},
								]
							: []
					}
					risks={[liquidationCopy.liquidationStateRisk, ...(liquidationExecutionMode === 'queue' ? [liquidationCopy.queuedLiquidationRisk, liquidationCopy.queuedFundingSequenceRisk] : [])]}
					technicalDetails={[
						{ label: transactionReviewCopy.contract, value: liquidationManagerAddress === undefined ? commonCopy.unavailable : <AddressValue address={liquidationManagerAddress} /> },
						{ label: transactionReviewCopy.network, value: <TransactionNetworkValue /> },
					]}
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
