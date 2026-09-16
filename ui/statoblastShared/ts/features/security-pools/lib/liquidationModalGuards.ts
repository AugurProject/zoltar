import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { isOracleManagerPriceUsable } from './securityVault.js'
import type { LiquidationApprovalDetails, OracleManagerDetails, SecurityPoolOverviewActionResult } from '@zoltar/ui-core-shared/types/contracts.js'

export const ZERO_LIQUIDATION_APPROVAL_ID = `0x${'00'.repeat(32)}`

export type LiquidationExecutionMode = 'execute' | 'queue' | 'refreshing'

export type QueuedLiquidationOperationView = {
	amount: bigint | undefined
	isPendingSlot: boolean
	operationId: bigint
}

export type QueuedLiquidationStatus = 'executed' | 'failed' | 'manual-queued' | 'missing' | 'queued' | 'refreshing'

export type LiquidationBlocker = { loading?: boolean; reason: string | undefined }

export function formatHealthFactorBps(healthFactorBps: bigint) {
	const whole = healthFactorBps / 10_000n
	const fractional = (healthFactorBps % 10_000n).toString().padStart(4, '0').replace(/0+$/, '')
	return `${whole.toString()}${fractional === '' ? '' : `.${fractional}`}${liquidationCopy.protocolHealthSuffix}`
}

export function getApprovalStatus(revoked: boolean, nonceInvalidated: boolean, validAfter: bigint, validUntil: bigint, currentTimestamp: bigint | undefined) {
	if (revoked) return liquidationCopy.approvalRevoked
	if (nonceInvalidated) return liquidationCopy.approvalInvalidated
	if (currentTimestamp === undefined) return commonCopy.unavailable
	if (currentTimestamp < validAfter) return liquidationCopy.approvalPending
	if (currentTimestamp >= validUntil) return liquidationCopy.approvalExpired
	return liquidationCopy.approvalActive
}

export function getLiquidationExecutionMode(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined): LiquidationExecutionMode {
	if (currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp) ? 'execute' : 'queue'
}

export function getLiquidationModalTitle(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined) {
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

export function getLiquidationButtonLabels(currentPoolOracleManagerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined) {
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

export function isValidLiquidationApprovalId(liquidationApprovalId: string) {
	return /^0x[0-9a-fA-F]{64}$/.test(liquidationApprovalId) && liquidationApprovalId !== ZERO_LIQUIDATION_APPROVAL_ID
}

export function isDelegatedLiquidationReceiver(accountAddress: Address | undefined, liquidationReceiverVault: string) {
	return accountAddress !== undefined && liquidationReceiverVault.trim() !== '' && !sameAddress(accountAddress, liquidationReceiverVault.trim())
}

export function isLiquidationApprovalRouteMismatch({
	accountAddress,
	liquidationApprovalDetails,
	liquidationSecurityPoolAddress,
	trimmedLiquidationReceiverVault,
	trimmedLiquidationTargetVault,
}: {
	accountAddress: Address | undefined
	liquidationApprovalDetails: LiquidationApprovalDetails | undefined
	liquidationSecurityPoolAddress: Address | undefined
	trimmedLiquidationReceiverVault: string
	trimmedLiquidationTargetVault: string
}) {
	if (liquidationApprovalDetails === undefined || accountAddress === undefined || liquidationSecurityPoolAddress === undefined) return false
	return (
		!sameAddress(liquidationApprovalDetails.params.securityPool, liquidationSecurityPoolAddress) ||
		!sameAddress(liquidationApprovalDetails.params.receiverVault, trimmedLiquidationReceiverVault) ||
		!sameAddress(liquidationApprovalDetails.params.operator, accountAddress) ||
		(liquidationApprovalDetails.params.targetVault !== '0x0000000000000000000000000000000000000000' && !sameAddress(liquidationApprovalDetails.params.targetVault, trimmedLiquidationTargetVault))
	)
}

export function isLiquidationApprovalNonceInvalidated(liquidationApprovalDetails: LiquidationApprovalDetails | undefined) {
	return liquidationApprovalDetails !== undefined && liquidationApprovalDetails.params.nonce < liquidationApprovalDetails.minimumValidNonce
}

export function getDelegatedLiquidationApprovalReason({
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
}: {
	approvalLatestExecutionTimestamp: bigint | undefined
	approvalNonceInvalidated: boolean
	approvalRouteMismatch: boolean
	currentTimestamp: bigint | undefined
	delegatedReceiver: boolean
	liquidationAmountValue: bigint | undefined
	liquidationApprovalDetails: LiquidationApprovalDetails | undefined
	liquidationApprovalError: string | undefined
	liquidationApprovalId: string
	loadingLiquidationApproval: boolean
}) {
	if (!delegatedReceiver) return undefined
	if (liquidationApprovalId === ZERO_LIQUIDATION_APPROVAL_ID) return liquidationCopy.delegatedApprovalRequired
	if (!isValidLiquidationApprovalId(liquidationApprovalId)) return liquidationCopy.invalidDelegatedApprovalId
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
}

export function getLiquidationBlockers({
	delegatedApprovalReason,
	delegatedReceiver,
	deterministicLiquidationReason,
	directLiquidationReason,
	liquidationDebtEthAmount,
	liquidationExecutionMode,
	liquidationFundingPreviewError,
	liquidationFundingPreviewLoaded,
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
}: {
	delegatedApprovalReason: string | undefined
	delegatedReceiver: boolean
	deterministicLiquidationReason: string | undefined
	directLiquidationReason: string | undefined
	liquidationDebtEthAmount: string
	liquidationExecutionMode: LiquidationExecutionMode
	liquidationFundingPreviewError: string | undefined
	liquidationFundingPreviewLoaded: boolean
	liquidationManagerAddress: Address | undefined
	liquidationReceiverVaultSummaryError: string | undefined
	liquidationReceiverVaultSummaryResolved: boolean
	liquidationSecurityPoolAddress: Address | undefined
	liquidationTimeoutSeconds: bigint | undefined
	loadingLiquidationApproval: boolean
	loadingLiquidationFundingPreview: boolean
	loadingLiquidationReceiverVaultSummary: boolean
	queueLiquidationEthGuardMessage: string | undefined
	sameVaultWarning: string | undefined
	trimmedLiquidationReceiverVault: string
	trimmedLiquidationTargetVault: string
}): LiquidationBlocker[] {
	return [
		{ loading: true, reason: liquidationExecutionMode === 'refreshing' ? liquidationCopy.refreshingPriceValidity : undefined },
		{ loading: true, reason: liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? liquidationCopy.liquidationPoolReloadRequired : undefined },
		{ reason: trimmedLiquidationTargetVault === '' ? liquidationCopy.targetVaultRequired : undefined },
		{ reason: trimmedLiquidationReceiverVault === '' ? liquidationCopy.receiverVaultRequired : undefined },
		{ loading: delegatedReceiver && loadingLiquidationApproval, reason: delegatedApprovalReason },
		{ loading: true, reason: delegatedReceiver && loadingLiquidationReceiverVaultSummary ? liquidationCopy.loadingReceiverVault : undefined },
		{ reason: delegatedReceiver ? liquidationReceiverVaultSummaryError : undefined },
		{ reason: delegatedReceiver && !liquidationReceiverVaultSummaryResolved ? liquidationCopy.receiverVaultRequiredBeforeSubmission : undefined },
		{ reason: sameVaultWarning },
		{ reason: liquidationDebtEthAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined },
		{ reason: liquidationExecutionMode === 'queue' && liquidationTimeoutSeconds === undefined ? liquidationCopy.liquidationTimeoutMinimumReason : undefined },
		{ loading: true, reason: liquidationExecutionMode === 'queue' && loadingLiquidationFundingPreview ? liquidationCopy.loadingQueueFunding : undefined },
		{ reason: liquidationExecutionMode === 'queue' && liquidationFundingPreviewError !== undefined ? liquidationFundingPreviewError : undefined },
		{ loading: true, reason: liquidationExecutionMode === 'queue' && !liquidationFundingPreviewLoaded ? liquidationCopy.loadingQueueFunding : undefined },
		{ reason: deterministicLiquidationReason },
		{ reason: directLiquidationReason },
		{ reason: queueLiquidationEthGuardMessage },
	]
}

export function getQueuedLiquidationOperation({
	currentPoolOracleManagerDetails,
	liquidationTargetVault,
	securityPoolOverviewResult,
}: {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	liquidationTargetVault: string
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}): QueuedLiquidationOperationView | undefined {
	if (securityPoolOverviewResult?.action !== 'queueLiquidation') return undefined
	if (currentPoolOracleManagerDetails?.pendingOperation?.operation === 'liquidation' && currentPoolOracleManagerDetails.pendingOperation.targetVault === liquidationTargetVault) {
		return {
			amount: currentPoolOracleManagerDetails.pendingOperation.amount,
			isPendingSlot: true,
			operationId: currentPoolOracleManagerDetails.pendingOperation.operationId,
		}
	}
	if (securityPoolOverviewResult.queuedOperation?.operation !== 'liquidation') return undefined
	return {
		amount: undefined,
		isPendingSlot: securityPoolOverviewResult.queuedOperation.isPendingSlot,
		operationId: securityPoolOverviewResult.queuedOperation.operationId,
	}
}

export function getQueuedLiquidationStatus({
	currentPoolOracleManagerDetails,
	currentTimestamp,
	loadingPoolOracleManager,
	queuedLiquidationOperation,
	securityPoolOverviewResult,
}: {
	currentPoolOracleManagerDetails: OracleManagerDetails | undefined
	currentTimestamp: bigint | undefined
	loadingPoolOracleManager: boolean
	queuedLiquidationOperation: QueuedLiquidationOperationView | undefined
	securityPoolOverviewResult: SecurityPoolOverviewActionResult | undefined
}): QueuedLiquidationStatus | undefined {
	if (securityPoolOverviewResult?.action !== 'queueLiquidation') return undefined
	if (securityPoolOverviewResult.stagedExecution !== undefined) return securityPoolOverviewResult.stagedExecution.success ? 'executed' : 'failed'
	if (queuedLiquidationOperation !== undefined) return queuedLiquidationOperation.isPendingSlot ? 'queued' : 'manual-queued'
	if (loadingPoolOracleManager || currentPoolOracleManagerDetails === undefined) return 'refreshing'
	return isOracleManagerPriceUsable(currentPoolOracleManagerDetails, currentTimestamp) ? 'executed' : 'missing'
}
