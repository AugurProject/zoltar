import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import { useEffect, useId, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getDeterministicLiquidationFailureReason, getLiquidationFailureReason, isVaultHealthyAtFactor, getMaxLiquidationAmount, simulateLiquidation } from '../lib/liquidation.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { tryParseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import type { UiRepPriceSource } from '../lib/repPriceSource.js'
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js'
import {
	ZERO_LIQUIDATION_APPROVAL_ID,
	getDelegatedLiquidationApprovalReason,
	getLiquidationBlockers,
	getLiquidationButtonLabels,
	getLiquidationExecutionMode,
	getLiquidationModalTitle,
	getQueuedLiquidationOperation,
	getQueuedLiquidationStatus,
	isDelegatedLiquidationReceiver,
	isLiquidationApprovalNonceInvalidated,
	isLiquidationApprovalRouteMismatch,
	isValidLiquidationApprovalId,
} from '../lib/liquidationModalGuards.js'
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/wallet/network.js'
import type { UiPriceOracle } from '../lib/uiPriceOracle.js'
import { LiquidationApprovalSummary, LiquidationContextSummary, LiquidationTransactionReview, QueuedLiquidationStatusCard } from './LiquidationModalSections.js'
type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isOnActiveAppChain: boolean
	liquidationDebtEthAmount: string
	maximumLiquidationDebtAttoEth: bigint | undefined
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
	repPerEthSource: UiRepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
	uiPriceOracle?: UiPriceOracle | undefined
	poolState?: SecurityPoolStateModel | undefined
	selectedPool: ListedSecurityPool | undefined
	securityPoolOverviewActiveAction: 'queueLiquidation' | undefined
	securityPoolLiquidationError: string | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
	receiverVaultSummary?: SecurityPoolVaultSummary | undefined
	callerVaultSummary?: SecurityPoolVaultSummary | undefined
	targetVaultSummary: SecurityPoolVaultSummary | undefined
	liquidationTargetVault: string
	liquidationReceiverVault?: string | undefined
	liquidationApprovalId?: string | undefined
	liquidationApprovalDetails?: LiquidationApprovalDetails | undefined
	liquidationApprovalError?: string | undefined
	liquidationReceiverVaultSummaryError?: string | undefined
	liquidationReceiverVaultSummaryResolved?: boolean | undefined
	loadingLiquidationApproval?: boolean | undefined
	loadingLiquidationReceiverVaultSummary?: boolean | undefined
	onLiquidationAmountChange: (value: string) => void
	onLiquidationReceiverVaultChange?: ((value: string) => void) | undefined
	onLiquidationApprovalIdChange?: ((value: string) => void) | undefined
	onLoadLiquidationApproval?: (() => void) | undefined
	onLoadLiquidationReceiverVaultSummary?: (() => void) | undefined
	onLiquidationTimeoutMinutesChange: (value: string) => void
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address) => void
	walletBalanceAttoEth?: bigint | undefined
}

export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isOnActiveAppChain,
	liquidationDebtEthAmount,
	maximumLiquidationDebtAttoEth,
	liquidationManagerAddress,
	liquidationFundingPreview,
	liquidationFundingPreviewError,
	liquidationModalOpen,
	liquidationSecurityPoolAddress,
	liquidationTimeoutMinutes,
	loadingPoolOracleManager,
	loadingLiquidationFundingPreview = false,
	liquidationTargetVault,
	liquidationReceiverVault = accountAddress ?? '',
	liquidationApprovalId = ZERO_LIQUIDATION_APPROVAL_ID,
	liquidationApprovalDetails,
	liquidationApprovalError,
	liquidationReceiverVaultSummaryError,
	liquidationReceiverVaultSummaryResolved = false,
	loadingLiquidationApproval = false,
	loadingLiquidationReceiverVaultSummary = false,
	onLoadPoolOracleManager,
	onLoadLiquidationFundingPreview = () => undefined,
	onSelectedPoolViewChange,
	poolState,
	poolOracleManagerError = undefined,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	uiPriceOracle,
	selectedPool,
	securityPoolOverviewActiveAction,
	securityPoolLiquidationError,
	securityPoolOverviewResult,
	receiverVaultSummary: loadedReceiverVaultSummary,
	callerVaultSummary,
	targetVaultSummary,
	onLiquidationAmountChange,
	onLiquidationReceiverVaultChange = () => undefined,
	onLiquidationApprovalIdChange = () => undefined,
	onLoadLiquidationApproval = () => undefined,
	onLoadLiquidationReceiverVaultSummary = () => undefined,
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
	const delegatedReceiver = isDelegatedLiquidationReceiver(accountAddress, liquidationReceiverVault)
	const hasValidApprovalId = isValidLiquidationApprovalId(liquidationApprovalId)
	useEffect(() => {
		if (!showLiquidationModal || !delegatedReceiver || !hasValidApprovalId || liquidationApprovalDetails !== undefined || liquidationApprovalError !== undefined || loadingLiquidationApproval) return
		onLoadLiquidationApproval()
	}, [delegatedReceiver, hasValidApprovalId, liquidationApprovalDetails, liquidationApprovalError, loadingLiquidationApproval, onLoadLiquidationApproval, showLiquidationModal])
	const hasValidReceiverVault = tryParseAddressInput(liquidationReceiverVault) !== undefined
	useEffect(() => {
		if (!showLiquidationModal || !delegatedReceiver || !hasValidReceiverVault || liquidationReceiverVaultSummaryResolved || liquidationReceiverVaultSummaryError !== undefined || loadingLiquidationReceiverVaultSummary) return
		onLoadLiquidationReceiverVaultSummary()
	}, [delegatedReceiver, hasValidReceiverVault, liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved, loadingLiquidationReceiverVaultSummary, onLoadLiquidationReceiverVaultSummary, showLiquidationModal])
	if (!showLiquidationModal) return undefined
	const receiverVaultSummary = delegatedReceiver ? loadedReceiverVaultSummary : (loadedReceiverVaultSummary ?? callerVaultSummary)
	const currentTimestamp = chainCurrentTimestamp
	const liquidationAmountValue = tryParseEthAmountInput(liquidationDebtEthAmount)
	const poolOraclePrice = currentPoolOracleManagerDetails?.lastPrice ?? selectedPool?.lastOraclePrice
	const uiCalculationPrice = uiPriceOracle === undefined ? poolOraclePrice : repPerEthPrice
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails, currentTimestamp)
	const hasUsableOraclePrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)
	const trimmedLiquidationTargetVault = liquidationTargetVault.trim()
	const trimmedLiquidationReceiverVault = liquidationReceiverVault.trim()
	const liquidationTimeoutDisplayValue = liquidationTimeoutMinutes === '' ? '' : liquidationTimeoutMinutes
	const liquidationTimeoutSeconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(liquidationTimeoutDisplayValue))
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = trimmedLiquidationReceiverVault === '' || trimmedLiquidationTargetVault === '' || !sameAddress(trimmedLiquidationReceiverVault, trimmedLiquidationTargetVault) ? undefined : liquidationCopy.distinctTargetVaultRequired
	const approvalRouteMismatch = isLiquidationApprovalRouteMismatch({ accountAddress, liquidationApprovalDetails, liquidationSecurityPoolAddress, trimmedLiquidationReceiverVault, trimmedLiquidationTargetVault })
	const approvalLatestExecutionTimestamp = currentTimestamp === undefined || liquidationTimeoutSeconds === undefined || currentPoolOracleManagerDetails?.settlementTime === undefined ? undefined : currentTimestamp + currentPoolOracleManagerDetails.settlementTime + liquidationTimeoutSeconds
	const approvalNonceInvalidated = isLiquidationApprovalNonceInvalidated(liquidationApprovalDetails)
	const delegatedApprovalReason = getDelegatedLiquidationApprovalReason({
		approvalLatestExecutionTimestamp,
		approvalNonceInvalidated,
		approvalRouteMismatch,
		currentTimestamp,
		delegatedReceiver,
		liquidationAmountValue,
		liquidationApprovalDetails,
		liquidationApprovalError,
		liquidationApprovalId,
		loadingLiquidationApproval,
	})
	const liquidationSimulation =
		targetVaultSummary === undefined || uiCalculationPrice === undefined || selectedPool?.statoblastSecurityMultiplierBps === undefined || liquidationAmountValue === undefined
			? undefined
			: simulateLiquidation({
					callerVaultSummary: receiverVaultSummary,
					requestedDebtAttoEth: liquidationAmountValue,
					totalCapacityOwnershipAttoRep: selectedPool.totalCapacityOwnershipAttoRep,
					minimumVaultRepDepositAttoRep: selectedPool.minimumVaultRepDepositAttoRep,
					repPerEthPrice: uiCalculationPrice,
					settlementCollateralAttoEth: selectedPool.settlementCollateralAttoEth,
					statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
					targetVaultSummary,
				})
	const receiverOpenInterest = receiverVaultSummary?.openInterestAttoEth ?? (receiverVaultSummary === undefined && liquidationReceiverVaultSummaryResolved ? 0n : undefined)
	const minimumReceiverHealth = delegatedReceiver ? liquidationApprovalDetails?.params.minPostLiquidationHealthFactorBps : 10000n
	const receiverHealthy =
		minimumReceiverHealth === undefined || !hasUsableOraclePrice || liquidationSimulation === undefined || receiverOpenInterest === undefined || uiCalculationPrice === undefined || selectedPool === undefined
			? undefined
			: isVaultHealthyAtFactor({
					disputeStakedAttoRep: liquidationSimulation.callerAfter.disputeStakedAttoRep,
					healthFactorBps: minimumReceiverHealth,
					openInterestAttoEth: receiverOpenInterest + liquidationSimulation.debtMovedAttoEth,
					poolHeldVaultRepBackingAttoRep: liquidationSimulation.callerAfter.vaultAttoRepBacking,
					poolSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
					repPerEthPrice: uiCalculationPrice,
				})

	const computedLiquidationMaxAmount = getMaxLiquidationAmount({
		repPerEthPrice: uiCalculationPrice,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const protocolLiquidationMaxAmount = getMaxLiquidationAmount({
		repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const liquidationMaxActionAmount = computedLiquidationMaxAmount ?? (uiPriceOracle === undefined ? maximumLiquidationDebtAttoEth : undefined)
	const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary: receiverVaultSummary,
		requestedDebtAttoEth: liquidationAmountValue,
		totalCapacityOwnershipAttoRep: selectedPool?.totalCapacityOwnershipAttoRep,
		maxLiquidationDebtAttoEth: protocolLiquidationMaxAmount,
		minimumSecurityBondDebtAttoEth: selectedPool?.minimumSecurityBondDebtAttoEth,
		minimumVaultRepDepositAttoRep: selectedPool?.minimumVaultRepDepositAttoRep,
		repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
		settlementCollateralAttoEth: selectedPool?.settlementCollateralAttoEth,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const directLiquidationReason = (() => {
		if (liquidationExecutionMode !== 'execute') return undefined
		if (selectedPool?.statoblastSecurityMultiplierBps === undefined) return liquidationCopy.selectedPoolReloadRequired

		return getLiquidationFailureReason({
			callerVaultSummary: receiverVaultSummary,
			requestedDebtAttoEth: liquidationAmountValue,
			totalCapacityOwnershipAttoRep: selectedPool.totalCapacityOwnershipAttoRep,
			minimumReceiverHealthFactorBps: delegatedReceiver ? liquidationApprovalDetails?.params.minPostLiquidationHealthFactorBps : undefined,
			minimumSecurityBondDebtAttoEth: selectedPool.minimumSecurityBondDebtAttoEth,
			minimumVaultRepDepositAttoRep: selectedPool.minimumVaultRepDepositAttoRep,
			repPerEthPrice: poolOraclePrice,
			settlementCollateralAttoEth: selectedPool.settlementCollateralAttoEth,
			statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
			targetVaultSummary,
		})
	})()
	const queueLiquidationEthGuardMessage =
		liquidationExecutionMode !== 'queue'
			? undefined
			: getOracleRequestEthGuardMessage({
					actionLabel: liquidationCopy.queueLiquidationActionLabel,
					requiredCostAttoEth: liquidationFundingPreview?.totalWalletEthRequiredAttoEth,
					walletBalanceAttoEth,
				})
	const liquidationEnabled = poolState?.actions.queueLiquidation.enabled ?? true
	const canUseLiquidationAction = accountAddress !== undefined && isOnActiveAppChain
	const liquidationBlockers = getLiquidationBlockers({
		delegatedApprovalReason,
		delegatedReceiver,
		deterministicLiquidationReason,
		directLiquidationReason,
		liquidationDebtEthAmount,
		liquidationExecutionMode,
		liquidationFundingPreviewError,
		liquidationFundingPreviewLoaded: liquidationFundingPreview !== undefined,
		liquidationManagerAddress,
		liquidationReceiverVaultSummaryError,
		liquidationReceiverVaultSummaryResolved,
		liquidationSecurityPoolAddress,
		liquidationTimeoutSeconds,
		loadingLiquidationApproval,
		loadingLiquidationFundingPreview,
		loadingLiquidationReceiverVaultSummary,
		queueLiquidationEthGuardMessage,
		sameVaultWarning,
		trimmedLiquidationReceiverVault,
		trimmedLiquidationTargetVault,
	})
	const liquidationBlocker = liquidationBlockers.find(blocker => blocker.reason !== undefined)
	const liquidationActionReason = liquidationBlocker?.reason
	let liquidationButtonDisabledReason = liquidationEnabled ? liquidationActionReason : undefined
	if (accountAddress === undefined) liquidationButtonDisabledReason = commonCopy.walletConnectionRequired
	if (!isOnActiveAppChain) liquidationButtonDisabledReason = getWrongNetworkReason()
	const queuedLiquidationOperation = getQueuedLiquidationOperation({ currentPoolOracleManagerDetails, liquidationTargetVault, securityPoolOverviewResult })
	const queuedLiquidationStatus = getQueuedLiquidationStatus({ currentPoolOracleManagerDetails, currentTimestamp, loadingPoolOracleManager, queuedLiquidationOperation, securityPoolOverviewResult })
	return (
		<div className='modal-backdrop' role='presentation' onClick={closeLiquidationModal}>
			<section ref={dialogRef} className='modal-panel liquidation-modal-panel' role='dialog' aria-modal='true' aria-labelledby={titleId} onClick={event => event.stopPropagation()}>
				<div className='modal-header'>
					<div className='modal-header-title'>
						<h3 id={titleId}>{getLiquidationModalTitle(currentPoolOracleManagerDetails, currentTimestamp)}</h3>
					</div>
					<button ref={closeButtonRef} className='quiet modal-close-button' type='button' aria-label={commonCopy.close} title={commonCopy.close} onClick={closeLiquidationModal}>
						×
					</button>
				</div>
				<div className='liquidation-modal-content'>
					<QueuedLiquidationStatusCard onViewInStagedOperations={() => onSelectedPoolViewChange('staged-operations')} queuedLiquidationOperation={queuedLiquidationOperation} queuedLiquidationStatus={queuedLiquidationStatus} securityPoolOverviewResult={securityPoolOverviewResult} />
					<ErrorNotice message={poolOracleManagerError} />
					{poolOracleManagerError === undefined || liquidationManagerAddress === undefined ? undefined : (
						<div className='actions'>
							<button className='secondary' disabled={loadingPoolOracleManager} onClick={() => onLoadPoolOracleManager(liquidationManagerAddress)} type='button'>
								{liquidationCopy.retryPriceStatus}
							</button>
						</div>
					)}
					<ErrorNotice message={securityPoolLiquidationError} />
					<LiquidationContextSummary
						accountAddress={accountAddress}
						currentPoolOracleManagerDetails={currentPoolOracleManagerDetails}
						currentTimestamp={currentTimestamp}
						liquidationSecurityPoolAddress={liquidationSecurityPoolAddress}
						poolOraclePrice={poolOraclePrice}
						poolOracleSettlementTimestamp={poolOracleSettlementTimestamp}
						receiverVaultSummary={receiverVaultSummary}
						repPerEthPrice={repPerEthPrice}
						repPerEthSource={repPerEthSource}
						repPerEthSourceUrl={repPerEthSourceUrl}
						selectedPool={selectedPool}
						targetVaultSummary={targetVaultSummary}
						trimmedLiquidationReceiverVault={trimmedLiquidationReceiverVault}
						trimmedLiquidationTargetVault={trimmedLiquidationTargetVault}
					/>
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
					{delegatedReceiver ? (
						<WarningSurface as='section' surface='flat' variant='compact'>
							<div className='entity-card-header'>
								<div>
									<h4>{liquidationCopy.receiverLiabilityTitle}</h4>
								</div>
							</div>
							<p className='detail'>{liquidationCopy.receiverLiabilityDetail}</p>
						</WarningSurface>
					) : null}
					<div className='form-grid'>
						<label className='field'>
							<span>{liquidationCopy.receiverVault}</span>
							<FormInput value={liquidationReceiverVault} onInput={event => onLiquidationReceiverVaultChange(event.currentTarget.value)} />
						</label>
						{delegatedReceiver && loadingLiquidationReceiverVaultSummary ? (
							<p className='detail' id='liquidation-receiver-loading-status' role='status'>
								{liquidationCopy.loadingReceiverVault}
							</p>
						) : null}
						{delegatedReceiver && liquidationReceiverVaultSummaryError !== undefined ? (
							<div className='actions'>
								<button className='secondary' type='button' onClick={onLoadLiquidationReceiverVaultSummary} disabled={loadingLiquidationReceiverVaultSummary || !hasValidReceiverVault}>
									{liquidationCopy.retryReceiverVault}
								</button>
							</div>
						) : null}
						{delegatedReceiver ? (
							<>
								<label className='field'>
									<span>{liquidationCopy.boundedApprovalId}</span>
									<FormInput value={liquidationApprovalId} onInput={event => onLiquidationApprovalIdChange(event.currentTarget.value)} />
									<small className='field-help'>{liquidationCopy.receiverOperatorEconomics}</small>
								</label>
								{loadingLiquidationApproval ? (
									<p className='detail' role='status'>
										{liquidationCopy.loadingBoundedApproval}
									</p>
								) : null}
								{liquidationApprovalError === undefined ? null : (
									<div className='actions'>
										<button className='secondary' type='button' onClick={onLoadLiquidationApproval} disabled={!hasValidApprovalId}>
											{liquidationCopy.retryBoundedApproval}
										</button>
									</div>
								)}
							</>
						) : null}
						<label className='field'>
							<span>{liquidationCopy.requestedLiquidationDebtEth}</span>
							<div className='field-inline'>
								<FormInput className='field-inline-input' value={liquidationDebtEthAmount} onInput={event => onLiquidationAmountChange(event.currentTarget.value)} placeholder={commonCopy.zeroDecimalPlaceholder} />
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
					{delegatedReceiver ? <ErrorNotice message={liquidationReceiverVaultSummaryError} /> : null}
					{delegatedReceiver ? <ErrorNotice message={liquidationApprovalError} /> : null}
					{!delegatedReceiver || liquidationApprovalDetails === undefined ? null : <LiquidationApprovalSummary approvalNonceInvalidated={approvalNonceInvalidated} currentTimestamp={currentTimestamp} liquidationApprovalDetails={liquidationApprovalDetails} />}
					{liquidationExecutionMode === 'execute' ? null : <p className='detail'>{liquidationTimeoutHelpText}</p>}
					{liquidationExecutionMode !== 'queue' || liquidationFundingPreviewError === undefined ? null : (
						<div className='actions'>
							<button className='secondary' type='button' onClick={() => (liquidationManagerAddress === undefined ? undefined : onLoadLiquidationFundingPreview(liquidationManagerAddress))} disabled={loadingLiquidationFundingPreview}>
								{liquidationCopy.retryQueueFunding}
							</button>
						</div>
					)}
					<LiquidationTransactionReview receiverHealthy={receiverHealthy} liquidationExecutionMode={liquidationExecutionMode} liquidationFundingPreview={liquidationFundingPreview} liquidationSimulation={liquidationSimulation} selectedPool={selectedPool} walletBalanceAttoEth={walletBalanceAttoEth} />
				</div>
				<div className='actions liquidation-modal-actions'>
					<TransactionActionButton
						disabledReasonElementId={delegatedReceiver && loadingLiquidationReceiverVaultSummary ? 'liquidation-receiver-loading-status' : undefined}
						idleLabel={buttonLabels.idle}
						pendingLabel={buttonLabels.pending}
						onClick={() => {
							if (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined) return
							onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress)
						}}
						pending={securityPoolOverviewActiveAction === 'queueLiquidation'}
						availability={{
							disabled: !liquidationEnabled || !canUseLiquidationAction || liquidationActionReason !== undefined,
							loading: canUseLiquidationAction && liquidationEnabled && liquidationBlocker?.loading === true,
							reason: liquidationButtonDisabledReason,
						}}
						showDisabledReason={!(delegatedReceiver && loadingLiquidationReceiverVaultSummary)}
					/>
					<button className='secondary' onClick={closeLiquidationModal}>
						{commonCopy.cancel}
					</button>
				</div>
			</section>
		</div>
	)
}
