import { OracleOperationActions } from './OracleOperationActions.js'
import { usePreparedOracleOperation } from '../hooks/usePreparedOracleOperation.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { OracleInitialPriceFields, parseOracleInitialPrice, type OracleInitialPriceInput } from './OracleInitialPriceFields.js'
import { getOracleOperationTimingReason, needsOracleInitialPrice } from '../lib/oracleOperationPresentation.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import { useEffect, useId, useState } from 'preact/hooks'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { RetryableNotice } from '@zoltar/ui-core-shared/components/RetryableNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/wallet/chainTimestamp.js'
import { formatCurrencyBalanceWithUnit, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getDeterministicLiquidationFailureReason, getLiquidationFailureReason, getMaxLiquidationAmount } from '../lib/liquidation.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/forms/integerInput.js'
import { tryParseEthAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getOracleRequestEthGuardMessage } from '../../open-oracle/lib/oracleRequestEth.js'
import type { UiRepPriceSource } from '../lib/repPriceSource.js'
import { getStagedOperationTimeoutFieldError, getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable, MAX_STAGED_OPERATION_TIMEOUT_MINUTES, MIN_STAGED_OPERATION_TIMEOUT_MINUTES } from '../lib/securityVault.js'
import {
	ZERO_LIQUIDATION_APPROVAL_ID,
	getApprovalClampedLiquidationAmount,
	getDelegatedLiquidationApprovalReason,
	getLiquidationBlockers,
	getLiquidationButtonLabels,
	getLiquidationExecutionMode,
	getLiquidationLifecycleBlocker,
	getLiquidationModalTitle,
	getQueuedLiquidationOperation,
	getQueuedLiquidationStatus,
	isDelegatedLiquidationReceiver,
	isLiquidationApprovalNonceInvalidated,
	isLiquidationApprovalRouteMismatch,
	isValidLiquidationApprovalId,
} from '../lib/liquidationModalGuards.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '../../../types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { UiPriceOracle } from '../lib/uiPriceOracle.js'
import { LiquidationApprovalSummary, LiquidationContextSummary, QueuedLiquidationStatusCard } from './LiquidationModalSections.js'
type LiquidationModalProps = {
	accountAddress: Address | undefined
	closeLiquidationModal: () => void
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	isOnActiveAppChain: boolean
	liquidationDebtEthAmount: string
	liquidationManagerAddress: Address | undefined
	liquidationFundingPreview?: LiquidationFundingPreview | undefined
	liquidationFundingPreviewError?: string | undefined
	liquidationModalOpen: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutMinutes: string
	loadingPoolOracleManager: boolean
	loadingLiquidationFundingPreview?: boolean | undefined
	onLoadLiquidationFundingPreview?: ((managerAddress: Address, proposedRepPerEthPrice?: bigint) => void) | undefined
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
	onQueueLiquidation: (managerAddress: Address, securityPoolAddress: Address, proposedRepPerEthPrice?: bigint) => void | Promise<void>
	walletBalanceAttoEth?: bigint | undefined
}

export function LiquidationModal({
	accountAddress,
	closeLiquidationModal,
	currentPoolOracleManagerDetails,
	isOnActiveAppChain,
	liquidationDebtEthAmount,
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
	const initialPriceFieldId = useId()
	const priceContextKey = `${liquidationManagerAddress}:${liquidationSecurityPoolAddress}:${liquidationTargetVault}`
	const [initialPriceState, setInitialPriceState] = useState<{ key: string; value: OracleInitialPriceInput }>({ key: '', value: { price: '' } })
	const initialPrice = initialPriceState.key === priceContextKey ? initialPriceState.value : { price: '' }
	const needsInitialPrice = needsOracleInitialPrice(currentPoolOracleManagerDetails, isOracleManagerPriceUsable(currentPoolOracleManagerDetails, chainCurrentTimestamp))
	const { proposedRepPerEthPrice, error: initialPriceError } = parseOracleInitialPrice(needsInitialPrice ? initialPrice : undefined)
	const changeInitialPrice = (value: OracleInitialPriceInput) => {
		setInitialPriceState({ key: priceContextKey, value })
		const parsed = parseOracleInitialPrice(value)
		if (liquidationManagerAddress !== undefined && parsed.error === undefined) onLoadLiquidationFundingPreview(liquidationManagerAddress, parsed.proposedRepPerEthPrice)
	}
	const timeoutErrorId = useId()
	const showLiquidationModal = liquidationModalOpen

	useEffect(() => {
		if (!showLiquidationModal) return
		if (liquidationManagerAddress === undefined || currentPoolOracleManagerDetails !== undefined || loadingPoolOracleManager || poolOracleManagerError !== undefined) return
		onLoadPoolOracleManager(liquidationManagerAddress)
	}, [currentPoolOracleManagerDetails, liquidationManagerAddress, loadingPoolOracleManager, onLoadPoolOracleManager, poolOracleManagerError, showLiquidationModal])
	useEffect(() => {
		if (initialPriceError !== undefined || !showLiquidationModal || getLiquidationExecutionMode(currentPoolOracleManagerDetails, chainCurrentTimestamp) !== 'queue') return
		if (liquidationManagerAddress === undefined || liquidationFundingPreview !== undefined || liquidationFundingPreviewError !== undefined || loadingLiquidationFundingPreview) return
		onLoadLiquidationFundingPreview(liquidationManagerAddress, proposedRepPerEthPrice)
	}, [initialPriceError, proposedRepPerEthPrice, chainCurrentTimestamp, currentPoolOracleManagerDetails, liquidationFundingPreview, liquidationFundingPreviewError, liquidationManagerAddress, loadingLiquidationFundingPreview, onLoadLiquidationFundingPreview, showLiquidationModal])
	const delegatedReceiver = isDelegatedLiquidationReceiver(accountAddress, liquidationReceiverVault)
	const hasValidApprovalId = isValidLiquidationApprovalId(liquidationApprovalId)
	useEffect(() => {
		if (!showLiquidationModal || !delegatedReceiver || !hasValidApprovalId || liquidationApprovalDetails !== undefined || liquidationApprovalError !== undefined || loadingLiquidationApproval) return
		onLoadLiquidationApproval()
	}, [delegatedReceiver, hasValidApprovalId, liquidationApprovalDetails, liquidationApprovalError, loadingLiquidationApproval, onLoadLiquidationApproval, showLiquidationModal])
	const hasValidReceiverVault = tryParseAddressInput(liquidationReceiverVault) !== undefined
	const receiverVaultAddressError = liquidationReceiverVault.trim() === '' || hasValidReceiverVault ? undefined : liquidationCopy.receiverVaultAddressInvalid
	useEffect(() => {
		if (!showLiquidationModal || !delegatedReceiver || !hasValidReceiverVault || liquidationReceiverVaultSummaryResolved || liquidationReceiverVaultSummaryError !== undefined || loadingLiquidationReceiverVaultSummary) return
		onLoadLiquidationReceiverVaultSummary()
	}, [delegatedReceiver, hasValidReceiverVault, liquidationReceiverVaultSummaryError, liquidationReceiverVaultSummaryResolved, loadingLiquidationReceiverVaultSummary, onLoadLiquidationReceiverVaultSummary, showLiquidationModal])
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
	const liquidationTimeoutError = getStagedOperationTimeoutFieldError(liquidationTimeoutDisplayValue)
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined || liquidationTimeoutError !== undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
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
		liquidationApprovalDetails,
		liquidationApprovalError,
		liquidationApprovalId,
		loadingLiquidationApproval,
	})
	// The approval registry clamps a delegated request to its limits, so validation simulates the clamped amount.
	const simulatedLiquidationAmount = getApprovalClampedLiquidationAmount({ delegatedReceiver, liquidationAmountValue, liquidationApprovalDetails })
	const approvalClampedNotice =
		liquidationAmountValue !== undefined && simulatedLiquidationAmount !== undefined && simulatedLiquidationAmount > 0n && simulatedLiquidationAmount < liquidationAmountValue ? liquidationCopy.formatApprovalClampedNotice(formatCurrencyBalanceWithUnit(simulatedLiquidationAmount, commonCopy.eth)) : undefined
	const minLiquidationPriceDistanceBps = currentPoolOracleManagerDetails?.minLiquidationPriceDistanceBps
	const computedLiquidationMaxAmount = getMaxLiquidationAmount({
		minLiquidationPriceDistanceBps,
		repPerEthPrice: uiCalculationPrice,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const protocolLiquidationMaxAmount = getMaxLiquidationAmount({
		minLiquidationPriceDistanceBps,
		repPerEthPrice: hasUsableOraclePrice ? poolOraclePrice : undefined,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	// With a usable pool oracle price, Max uses the same price as the protocol guard; a queued liquidation can only estimate it with the UI price.
	const liquidationMaxActionAmount = hasUsableOraclePrice ? protocolLiquidationMaxAmount : computedLiquidationMaxAmount
	const liquidationMaxUnavailableReason = (() => {
		if (liquidationMaxActionAmount !== undefined) return liquidationCopy.maxTransferableNone
		return liquidationExecutionMode === 'queue' ? liquidationCopy.maxTransferableQueuedNeedsPrice : liquidationCopy.maxTransferableNeedsPrice
	})()
	const liquidationMaxUnavailable = liquidationMaxActionAmount === undefined || liquidationMaxActionAmount <= 0n
	const liquidationMaximumAmount = protocolLiquidationMaxAmount !== undefined && protocolLiquidationMaxAmount > 0n ? protocolLiquidationMaxAmount : undefined
	const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary: receiverVaultSummary,
		requestedDebtAttoEth: simulatedLiquidationAmount,
		totalUnderwritingLimitAttoEth: selectedPool?.totalUnderwritingLimitAttoEth,
		maxLiquidationDebtAttoEth: protocolLiquidationMaxAmount,
		minLiquidationPriceDistanceBps,
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
			requestedDebtAttoEth: simulatedLiquidationAmount,
			totalUnderwritingLimitAttoEth: selectedPool.totalUnderwritingLimitAttoEth,
			minimumReceiverHealthFactorBps: delegatedReceiver ? liquidationApprovalDetails?.params.minPostLiquidationHealthFactorBps : undefined,
			minLiquidationPriceDistanceBps,
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
	const liquidationLifecycleBlocker = getLiquidationLifecycleBlocker(poolState)
	const liquidationEnabled = liquidationLifecycleBlocker === undefined
	const walletGuard = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain })
	const canUseLiquidationAction = !walletGuard.blocked
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
	// The wallet prerequisite comes before every other blocker, so a disconnected wallet or wrong network offers its connect or switch fix.
	let disabledReasonElementId = !walletGuard.blocked && delegatedReceiver && loadingLiquidationReceiverVaultSummary ? 'liquidation-receiver-loading-status' : undefined
	if (!walletGuard.blocked && initialPriceError !== undefined && initialPrice.price !== '') disabledReasonElementId = `${initialPriceFieldId}-error`
	const liquidationActionReason = getOracleOperationTimingReason(currentPoolOracleManagerDetails, currentTimestamp, hasUsableOraclePrice) ?? initialPriceError ?? liquidationBlocker?.reason
	const liquidationButtonDisabledReason = walletGuard.reason ?? liquidationLifecycleBlocker ?? liquidationActionReason
	const liquidationKey = `${priceContextKey}:${liquidationDebtEthAmount}:${liquidationReceiverVault}:${liquidationApprovalId}:${liquidationTimeoutMinutes}:${proposedRepPerEthPrice}`
	const sendLiquidation = () => (liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? undefined : onQueueLiquidation(liquidationManagerAddress, liquidationSecurityPoolAddress, proposedRepPerEthPrice))
	const preparedLiquidation = usePreparedOracleOperation({
		key: liquidationKey,
		enabled: showLiquidationModal && liquidationExecutionMode === 'queue' && liquidationEnabled && canUseLiquidationAction && liquidationButtonDisabledReason === undefined,
		busy: securityPoolOverviewActiveAction !== undefined,
		onPrepare: sendLiquidation,
		onCompleted: securityPoolOverviewResult?.stagedExecution?.success !== false ? closeLiquidationModal : undefined,
	})
	const fieldsLocked = preparedLiquidation.sending || (securityPoolOverviewActiveAction !== undefined && !preparedLiquidation.preparing)
	const queuedLiquidationOperation = getQueuedLiquidationOperation({ currentPoolOracleManagerDetails, liquidationTargetVault, securityPoolOverviewResult })
	const queuedLiquidationStatus = getQueuedLiquidationStatus({ currentPoolOracleManagerDetails, currentTimestamp, loadingPoolOracleManager, queuedLiquidationOperation, securityPoolOverviewResult })
	return (
		<OperationModal embedTransactionSteps={false} isOpen={showLiquidationModal} closeDisabled={preparedLiquidation.workflow?.steps.some(step => step.phase === 'wallet') === true} onClose={closeLiquidationModal} title={getLiquidationModalTitle(currentPoolOracleManagerDetails, currentTimestamp)}>
			<fieldset disabled={fieldsLocked} className='transaction-form-fields'>
				<QueuedLiquidationStatusCard onViewInStagedOperations={() => onSelectedPoolViewChange('staged-operations')} queuedLiquidationOperation={queuedLiquidationOperation} queuedLiquidationStatus={queuedLiquidationStatus} securityPoolOverviewResult={securityPoolOverviewResult} />
				<RetryableNotice disabled={loadingPoolOracleManager} message={poolOracleManagerError} onRetry={liquidationManagerAddress === undefined ? undefined : () => onLoadPoolOracleManager(liquidationManagerAddress)} retryLabel={liquidationCopy.retryPriceStatus} />
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
						<UserMessage className='detail' detail={sameVaultWarning} />
					</WarningSurface>
				)}
				{delegatedReceiver ? (
					<WarningSurface as='section' surface='flat' variant='compact'>
						<div className='entity-card-header'>
							<div>
								<h4>{liquidationCopy.receiverLiabilityTitle}</h4>
							</div>
						</div>
						<UserMessage className='detail' detail={liquidationCopy.receiverLiabilityDetail} />
					</WarningSurface>
				) : null}
				<div className='form-grid'>
					<label className='field'>
						<span>{liquidationCopy.receiverVault}</span>
						<FormInput error={receiverVaultAddressError} placeholder={commonCopy.hexValuePlaceholder} spellcheck={false} value={liquidationReceiverVault} onInput={event => onLiquidationReceiverVaultChange(event.currentTarget.value)} />
					</label>
					{delegatedReceiver && loadingLiquidationReceiverVaultSummary ? <UserMessage className='detail' id='liquidation-receiver-loading-status' announcement='polite' detail={liquidationCopy.loadingReceiverVault} /> : null}
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
								{/* The unset approval ID is the zero ID; showing it would read as a filled-in value, so the field stays empty with a short placeholder. */}
								<FormInput
									hint={liquidationCopy.boundedApprovalIdHelp}
									placeholder={commonCopy.hexValuePlaceholder}
									spellcheck={false}
									value={liquidationApprovalId === ZERO_LIQUIDATION_APPROVAL_ID ? '' : liquidationApprovalId}
									onInput={event => onLiquidationApprovalIdChange(event.currentTarget.value.trim() === '' ? ZERO_LIQUIDATION_APPROVAL_ID : event.currentTarget.value)}
								/>
								<UserMessage placement='field' as='span' detail={liquidationCopy.receiverOperatorEconomics} />
							</label>
							{loadingLiquidationApproval ? <UserMessage className='detail' announcement='polite' detail={liquidationCopy.loadingBoundedApproval} /> : null}
							{liquidationApprovalError === undefined ? null : (
								<div className='actions'>
									<button className='secondary' type='button' onClick={onLoadLiquidationApproval} disabled={!hasValidApprovalId}>
										{liquidationCopy.retryBoundedApproval}
									</button>
								</div>
							)}
						</>
					) : null}
					<AmountField
						fillMax={{ amount: liquidationMaxActionAmount, unavailableReason: liquidationMaxUnavailableReason }}
						hint={(() => {
							if (liquidationMaximumAmount !== undefined) return liquidationCopy.formatMaxTransferableHint(formatCurrencyBalanceWithUnit(liquidationMaximumAmount, commonCopy.eth))
							// A disabled Max explains itself in visible text, not only in its tooltip.
							return liquidationMaxUnavailable ? liquidationMaxUnavailableReason : undefined
						})()}
						label={liquidationCopy.requestedLiquidationDebt}
						maximum={liquidationMaximumAmount}
						onChange={onLiquidationAmountChange}
						placeholder={commonCopy.zeroDecimalPlaceholder}
						unit={commonCopy.eth}
						value={liquidationDebtEthAmount}
					/>
					{liquidationExecutionMode === 'execute' ? null : (
						<label className='field'>
							<span>{commonCopy.manualExecutionTimeout}</span>
							<div className='field-inline'>
								<FormInput
									aria-describedby={liquidationTimeoutError === undefined ? undefined : timeoutErrorId}
									className='field-inline-input'
									inputMode='numeric'
									invalid={liquidationTimeoutError !== undefined}
									max={MAX_STAGED_OPERATION_TIMEOUT_MINUTES.toString()}
									min={MIN_STAGED_OPERATION_TIMEOUT_MINUTES.toString()}
									pattern='[0-9]*'
									step='1'
									value={liquidationTimeoutDisplayValue}
									onInput={event => onLiquidationTimeoutMinutesChange(event.currentTarget.value)}
								/>
								<span className='field-inline-action'>{commonCopy.minutes}</span>
							</div>
							{liquidationTimeoutError === undefined ? undefined : <UserMessage placement='field' tone='error' id={timeoutErrorId} detail={liquidationTimeoutError} />}
						</label>
					)}
				</div>
				{delegatedReceiver ? <ErrorNotice message={liquidationReceiverVaultSummaryError} /> : null}
				{delegatedReceiver ? <ErrorNotice message={liquidationApprovalError} /> : null}
				{!delegatedReceiver || liquidationApprovalDetails === undefined ? null : <LiquidationApprovalSummary approvalNonceInvalidated={approvalNonceInvalidated} currentTimestamp={currentTimestamp} liquidationApprovalDetails={liquidationApprovalDetails} />}
				{approvalClampedNotice === undefined ? null : <UserMessage tone='warning' announcement='polite' detail={approvalClampedNotice} />}
				{liquidationExecutionMode === 'execute' ? null : <UserMessage className='detail' detail={liquidationTimeoutHelpText} />}
				{needsInitialPrice ? <OracleInitialPriceFields managerAddress={liquidationManagerAddress} value={initialPrice} onChange={changeInitialPrice} disabled={fieldsLocked} fieldId={initialPriceFieldId} /> : undefined}
				{liquidationExecutionMode !== 'queue' || liquidationFundingPreviewError === undefined || initialPriceError !== undefined ? null : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={() => (liquidationManagerAddress === undefined ? undefined : onLoadLiquidationFundingPreview(liquidationManagerAddress, proposedRepPerEthPrice))} disabled={loadingLiquidationFundingPreview}>
							{liquidationCopy.retryQueueFunding}
						</button>
					</div>
				)}
			</fieldset>
			<OracleOperationActions
				prepared={preparedLiquidation}
				operationKey={liquidationKey}
				actionLabel={buttonLabels.idle}
				pendingLabel={buttonLabels.pending}
				requiresReportFunding={needsInitialPrice}
				directExecution={liquidationExecutionMode === 'execute'}
				busy={securityPoolOverviewActiveAction !== undefined}
				pending={securityPoolOverviewActiveAction === 'queueLiquidation'}
				reason={liquidationButtonDisabledReason}
				onExecute={sendLiquidation}
				onCancel={closeLiquidationModal}
				walletBlocker={walletGuard.walletBlocker}
				disabledReasonElementId={disabledReasonElementId}
				showDisabledReason={walletGuard.blocked || ((initialPriceError === undefined || initialPrice.price === '') && !(delegatedReceiver && loadingLiquidationReceiverVaultSummary))}
			/>
		</OperationModal>
	)
}
