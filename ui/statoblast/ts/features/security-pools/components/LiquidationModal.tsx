import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '@zoltar/ui-zoltar/copy/liquidation.js'
import { useEffect, useId, useRef } from 'preact/hooks'
import type { Address } from '@zoltar/shared/ethereum'
import { AddressInfo } from '@zoltar/ui-core-shared/components/AddressInfo.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { OpenOraclePriceValue } from '@zoltar/ui-zoltar/features/open-oracle/components/OpenOraclePriceValue.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { TransactionStatusCard } from '@zoltar/ui-core-shared/components/TransactionStatusCard.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/lib/inputs.js'
import { pickFirstReason } from '@zoltar/ui-core-shared/lib/actionAvailability.js'
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js'
import { formatCurrencyInputBalance, formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getDeterministicLiquidationFailureReason, getLiquidationExecutionFailureDetail, getLiquidationFailureReason, getMaxLiquidationAmount, simulateLiquidation } from '../lib/liquidation.js'
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js'
import { tryParseEthAmountInput } from '@zoltar/ui-core-shared/lib/formInputs.js'
import { getOracleRequestEthGuardMessage } from '@zoltar/ui-zoltar/features/open-oracle/lib/oracleRequestEth.js'
import { getRepPriceSourceCopy, renderRepPriceSourceLabel, type RepPriceSource } from '@zoltar/ui-zoltar/features/open-oracle/lib/repPriceSource.js'
import { getStagedOperationTimeoutSeconds, isOracleManagerPriceUsable } from '../lib/securityVault.js'
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js'
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js'
import type { SecurityPoolStateModel } from '../lib/securityPoolState.js'
import type { LiquidationApprovalDetails, LiquidationFundingPreview, ListedSecurityPool, OracleManagerDetails, SecurityPoolOverviewActionResult, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWrongNetworkReason } from '@zoltar/ui-core-shared/lib/network.js'
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
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceUrl: string | undefined
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

function formatHealthFactorBps(healthFactorBps: bigint) {
	const whole = healthFactorBps / 10_000n
	const fractional = (healthFactorBps % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fractional === '' ? '' : `.${fractional}`}${liquidationCopy.protocolHealthSuffix}`
}

function getApprovalStatus(revoked: boolean, nonceInvalidated: boolean, validAfter: bigint, validUntil: bigint, currentTimestamp: bigint | undefined) {
	if (revoked) return liquidationCopy.approvalRevoked
	if (nonceInvalidated) return liquidationCopy.approvalInvalidated
	if (currentTimestamp === undefined) return commonCopy.unavailable
	if (currentTimestamp < validAfter) return liquidationCopy.approvalPending
	if (currentTimestamp >= validUntil) return liquidationCopy.approvalExpired
	return liquidationCopy.approvalActive
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
							<MetricField label={liquidationCopy.requestedLiquidationDebt}>
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
	liquidationApprovalId = `0x${'00'.repeat(32)}`,
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
	const delegatedReceiver = accountAddress !== undefined && liquidationReceiverVault.trim() !== '' && !sameAddress(accountAddress, liquidationReceiverVault.trim())
	const zeroApprovalId = `0x${'00'.repeat(32)}`
	const hasValidApprovalId = /^0x[0-9a-fA-F]{64}$/.test(liquidationApprovalId) && liquidationApprovalId !== zeroApprovalId
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
	const poolOracleSettlementTimestamp = currentPoolOracleManagerDetails?.lastSettlementTimestamp ?? selectedPool?.lastOracleSettlementTimestamp ?? 0n
	const repPriceSourceCopy = getRepPriceSourceCopy(repPerEthSource)
	const liquidationExecutionMode = getLiquidationExecutionMode(currentPoolOracleManagerDetails, currentTimestamp)
	const buttonLabels = getLiquidationButtonLabels(currentPoolOracleManagerDetails, currentTimestamp)
	const hasUsableOraclePrice = currentPoolOracleManagerDetails !== undefined && isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp)
	const trimmedLiquidationTargetVault = liquidationTargetVault.trim()
	const trimmedLiquidationReceiverVault = liquidationReceiverVault.trim()
	const liquidationTimeoutDisplayValue = liquidationTimeoutMinutes === '' ? '' : liquidationTimeoutMinutes
	const liquidationTimeoutSeconds = getStagedOperationTimeoutSeconds(tryParseBigIntInput(liquidationTimeoutDisplayValue))
	const liquidationTimeoutHelpText = liquidationTimeoutSeconds === undefined ? liquidationCopy.stagedOperationTimeoutHelpText : liquidationCopy.formatTimeoutHelpTextResolved(formatDuration(liquidationTimeoutSeconds))
	const sameVaultWarning = trimmedLiquidationReceiverVault === '' || trimmedLiquidationTargetVault === '' || !sameAddress(trimmedLiquidationReceiverVault, trimmedLiquidationTargetVault) ? undefined : liquidationCopy.distinctTargetVaultRequired
	const approvalRouteMismatch =
		liquidationApprovalDetails === undefined || accountAddress === undefined || liquidationSecurityPoolAddress === undefined
			? false
			: !sameAddress(liquidationApprovalDetails.params.securityPool, liquidationSecurityPoolAddress) ||
				!sameAddress(liquidationApprovalDetails.params.receiverVault, trimmedLiquidationReceiverVault) ||
				!sameAddress(liquidationApprovalDetails.params.operator, accountAddress) ||
				(liquidationApprovalDetails.params.targetVault !== '0x0000000000000000000000000000000000000000' && !sameAddress(liquidationApprovalDetails.params.targetVault, trimmedLiquidationTargetVault))
	const approvalLatestExecutionTimestamp = currentTimestamp === undefined || liquidationTimeoutSeconds === undefined || currentPoolOracleManagerDetails?.settlementTime === undefined ? undefined : currentTimestamp + currentPoolOracleManagerDetails.settlementTime + liquidationTimeoutSeconds
	const approvalNonceInvalidated = liquidationApprovalDetails !== undefined && liquidationApprovalDetails.params.nonce < liquidationApprovalDetails.minimumValidNonce
	const delegatedApprovalReason = (() => {
		if (!delegatedReceiver) return undefined
		if (liquidationApprovalId === zeroApprovalId) return liquidationCopy.delegatedApprovalRequired
		if (!hasValidApprovalId) return liquidationCopy.invalidDelegatedApprovalId
		if (loadingLiquidationApproval) return liquidationCopy.loadingBoundedApproval
		if (liquidationApprovalError !== undefined) return liquidationApprovalError
		if (liquidationApprovalDetails === undefined) return liquidationCopy.boundedApprovalRequiredBeforeSubmission
		if (approvalRouteMismatch) return liquidationCopy.approvalRouteMismatch
		if (approvalNonceInvalidated) return liquidationCopy.approvalNonceInvalidated
		if (liquidationApprovalDetails.revoked || liquidationApprovalDetails.availableDebtAttoEth === 0n) return liquidationCopy.approvalUnavailable
		if (currentTimestamp !== undefined && currentTimestamp < liquidationApprovalDetails.params.validAfter) return liquidationCopy.approvalNotActive
		if (approvalLatestExecutionTimestamp !== undefined && approvalLatestExecutionTimestamp > liquidationApprovalDetails.params.validUntil) return liquidationCopy.approvalExpiresBeforeExecution
		if (liquidationAmountValue !== undefined && (liquidationAmountValue > liquidationApprovalDetails.availableDebtAttoEth || liquidationAmountValue > liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth)) return liquidationCopy.approvalQuotaTooLow
		return undefined
	})()
	const liquidationSimulation =
		targetVaultSummary === undefined || poolOraclePrice === undefined || selectedPool?.statoblastSecurityMultiplierBps === undefined || liquidationAmountValue === undefined
			? undefined
			: simulateLiquidation({
					callerVaultSummary: receiverVaultSummary,
					requestedDebtAttoEth: liquidationAmountValue,
					totalCapacityOwnershipAttoRep: selectedPool.totalCapacityOwnershipAttoRep,
					minimumVaultRepDepositAttoRep: selectedPool.minimumVaultRepDepositAttoRep,
					repPerEthPrice: poolOraclePrice,
					settlementCollateralAttoEth: selectedPool.settlementCollateralAttoEth,
					statoblastSecurityMultiplierBps: selectedPool.statoblastSecurityMultiplierBps,
					targetVaultSummary,
				})
	const computedLiquidationMaxAmount = getMaxLiquidationAmount({
		repPerEthPrice: poolOraclePrice,
		statoblastSecurityMultiplierBps: selectedPool?.statoblastSecurityMultiplierBps,
		targetVaultSummary,
	})
	const liquidationMaxActionAmount = hasUsableOraclePrice ? (computedLiquidationMaxAmount ?? maximumLiquidationDebtAttoEth) : maximumLiquidationDebtAttoEth
	const deterministicLiquidationReason = getDeterministicLiquidationFailureReason({
		callerVaultSummary: receiverVaultSummary,
		requestedDebtAttoEth: liquidationAmountValue,
		totalCapacityOwnershipAttoRep: selectedPool?.totalCapacityOwnershipAttoRep,
		maxLiquidationDebtAttoEth: hasUsableOraclePrice ? computedLiquidationMaxAmount : undefined,
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
		trimmedLiquidationReceiverVault === '' ? liquidationCopy.receiverVaultRequired : undefined,
		delegatedApprovalReason,
		delegatedReceiver && loadingLiquidationReceiverVaultSummary ? liquidationCopy.loadingReceiverVault : undefined,
		delegatedReceiver ? liquidationReceiverVaultSummaryError : undefined,
		delegatedReceiver && !liquidationReceiverVaultSummaryResolved ? liquidationCopy.receiverVaultRequiredBeforeSubmission : undefined,
		sameVaultWarning,
		liquidationDebtEthAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined,
		liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? liquidationCopy.liquidationTimeoutMinimumReason : undefined,
		liquidationExecutionMode === 'queue' && loadingLiquidationFundingPreview ? liquidationCopy.loadingQueueFunding : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreviewError !== undefined ? liquidationFundingPreviewError : undefined,
		liquidationExecutionMode === 'queue' && liquidationFundingPreview === undefined ? liquidationCopy.loadingQueueFunding : undefined,
		deterministicLiquidationReason,
		directLiquidationReason,
		queueLiquidationEthGuardMessage,
	)
	const liquidationButtonDisabledReason = (() => {
		if (!isOnActiveAppChain) return getWrongNetworkReason()
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
					<MetricField label={liquidationCopy.operator}>{accountAddress === undefined ? commonCopy.connectWallet : <AddressValue address={accountAddress} />}</MetricField>
					<MetricField label={liquidationCopy.receiverVault}>{trimmedLiquidationReceiverVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationReceiverVault} />}</MetricField>
					<MetricField label={commonCopy.targetVault}>{trimmedLiquidationTargetVault === '' ? commonCopy.noneSelected : <AddressValue address={trimmedLiquidationTargetVault} />}</MetricField>
					<MetricField label={commonCopy.openOraclePrice} valueTagName='span'>
						<OpenOraclePriceValue currentTimestamp={currentTimestamp} lastPrice={poolOraclePrice} lastSettlementTimestamp={poolOracleSettlementTimestamp} priceValidUntilTimestamp={currentPoolOracleManagerDetails?.priceValidUntilTimestamp} />
					</MetricField>
					<MetricField label={liquidationCopy.targetCapacityOwnershipAttoRep}>
						<CurrencyValue value={targetVaultSummary?.capacityOwnershipAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.targetVaultRepBackingAttoRep}>
						<CurrencyValue value={targetVaultSummary?.vaultAttoRepBacking} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.targetDisputeStakedAttoRep}>
						<CurrencyValue value={targetVaultSummary?.disputeStakedAttoRep} suffix={commonCopy.rep} />
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
					<MetricField label={liquidationCopy.callerCapacityOwnershipAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.capacityOwnershipAttoRep} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.callerVaultRepBackingAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.vaultAttoRepBacking} suffix={commonCopy.rep} />
					</MetricField>
					<MetricField label={liquidationCopy.callerDisputeStakedAttoRep}>
						<CurrencyValue value={receiverVaultSummary?.disputeStakedAttoRep} suffix={commonCopy.rep} />
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
				{!delegatedReceiver || liquidationApprovalDetails === undefined ? null : (
					<DataGrid className='modal-summary-grid' columns={2}>
						<MetricField label={liquidationCopy.availableApproval}>
							<CurrencyValue value={liquidationApprovalDetails.availableDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={liquidationCopy.reservedApproval}>
							<CurrencyValue value={liquidationApprovalDetails.reservedDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={liquidationCopy.consumedApproval}>
							<CurrencyValue value={liquidationApprovalDetails.consumedDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={liquidationCopy.perLiquidationLimit}>
							<CurrencyValue value={liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={liquidationCopy.totalApprovalLimit}>
							<CurrencyValue value={liquidationApprovalDetails.params.maxCumulativeDebtAttoEth} suffix={commonCopy.eth} />
						</MetricField>
						<MetricField label={liquidationCopy.approvalValidAfter}>
							<TimestampValue timestamp={liquidationApprovalDetails.params.validAfter} />
						</MetricField>
						<MetricField label={liquidationCopy.approvalExpiration}>
							<TimestampValue timestamp={liquidationApprovalDetails.params.validUntil} />
						</MetricField>
						<MetricField label={liquidationCopy.minimumPostLiquidationHealth}>{formatHealthFactorBps(liquidationApprovalDetails.params.minPostLiquidationHealthFactorBps)}</MetricField>
						<MetricField label={liquidationCopy.approvalStatus}>{getApprovalStatus(liquidationApprovalDetails.revoked, approvalNonceInvalidated, liquidationApprovalDetails.params.validAfter, liquidationApprovalDetails.params.validUntil, currentTimestamp)}</MetricField>
					</DataGrid>
				)}
				{liquidationExecutionMode === 'execute' ? null : <p className='detail'>{liquidationTimeoutHelpText}</p>}
				{liquidationExecutionMode !== 'queue' || liquidationFundingPreviewError === undefined ? null : (
					<div className='actions'>
						<button className='secondary' type='button' onClick={() => (liquidationManagerAddress === undefined ? undefined : onLoadLiquidationFundingPreview(liquidationManagerAddress))} disabled={loadingLiquidationFundingPreview}>
							{liquidationCopy.retryQueueFunding}
						</button>
					</div>
				)}
				<TransactionReview
					context={[{ label: commonCopy.question, value: selectedPool?.marketDetails.title ?? commonCopy.unavailable }]}
					primary={[
						{ label: liquidationCopy.securityBondDebtMoved, value: <CurrencyValue value={liquidationSimulation?.debtMovedAttoEth} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.capacityOwnershipMoved, value: <CurrencyValue value={liquidationSimulation?.capacityOwnershipMovedAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.residualBadDebt, value: <CurrencyValue value={liquidationSimulation?.badDebtAttoEth} suffix={commonCopy.eth} /> },
						{ label: liquidationCopy.grossRepAwardAttoRep, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.grossRepAwardAttoRep} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.repMoved, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.vaultAttoRepBackingToTransfer} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.targetAccruedFeesRetained, value: <CurrencyValue compactWhenOverflow value={liquidationSimulation?.targetAccruedFeesRetained} suffix={commonCopy.eth} /> },
						...(liquidationExecutionMode === 'queue' ? [{ label: liquidationCopy.totalWalletEthRequiredAttoEth, value: <CurrencyValue value={liquidationFundingPreview?.totalWalletEthRequiredAttoEth} suffix={commonCopy.eth} /> }] : []),
					]}
					details={[
						{ label: liquidationCopy.resultingCallerRep, value: <CurrencyValue value={liquidationSimulation?.callerAfter.vaultAttoRepBacking} suffix={commonCopy.rep} /> },
						{ label: liquidationCopy.resultingReceiverCapacityOwnership, value: <CurrencyValue value={liquidationSimulation?.callerAfter.capacityOwnershipAttoRep} suffix={commonCopy.rep} /> },
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
				/>
				<div className='actions liquidation-modal-actions'>
					<button className='secondary' onClick={closeLiquidationModal}>
						{commonCopy.cancel}
					</button>
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
							reason: liquidationButtonDisabledReason,
						}}
						showDisabledReason={!(delegatedReceiver && loadingLiquidationReceiverVaultSummary)}
					/>
				</div>
			</section>
		</div>
	)
}
