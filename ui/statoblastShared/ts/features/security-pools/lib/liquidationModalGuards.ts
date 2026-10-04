import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as liquidationCopy from '../../../copy/liquidation.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { tryParseAddressInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { isOracleManagerPriceUsable } from './securityVault.js'
import type { SecurityPoolStateModel } from './securityPoolState.js'
import type { LiquidationApprovalDetails, OracleManagerDetails, SecurityPoolOverviewActionResult } from '../../../types/contracts.js'

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
	return `${formatMultiplier(healthFactorBps, 4)}${liquidationCopy.protocolMinimumTail}`
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
			return liquidationCopy.executeVaultLiquidation
		case 'queue':
			return liquidationCopy.queueLiquidation
		case 'refreshing':
			return liquidationCopy.liquidateVault
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

/** Only a valid address other than the connected account delegates the liquidation; unfinished or invalid text stays an input error instead. */
export function isDelegatedLiquidationReceiver(accountAddress: Address | undefined, liquidationReceiverVault: string) {
	const receiverVault = tryParseAddressInput(liquidationReceiverVault)
	return accountAddress !== undefined && receiverVault !== undefined && !sameAddress(accountAddress, receiverVault)
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
	if (liquidationApprovalDetails.revoked || liquidationApprovalDetails.availableDebtAttoEth === 0n || liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth === 0n) return liquidationCopy.approvalUnavailable
	if (currentTimestamp !== undefined && currentTimestamp < liquidationApprovalDetails.params.validAfter) return liquidationCopy.approvalNotActive
	if (approvalLatestExecutionTimestamp !== undefined && approvalLatestExecutionTimestamp > liquidationApprovalDetails.params.validUntil) return liquidationCopy.approvalExpiresBeforeExecution
	return undefined
}

/**
 * The amount a delegated liquidation actually reserves: `LiquidationApprovalRegistry.reserve` clamps the
 * requested commitment to the per-liquidation limit and the available quota instead of rejecting it.
 */
export function getApprovalClampedLiquidationAmount({ delegatedReceiver, liquidationAmountValue, liquidationApprovalDetails }: { delegatedReceiver: boolean; liquidationAmountValue: bigint | undefined; liquidationApprovalDetails: LiquidationApprovalDetails | undefined }) {
	if (!delegatedReceiver || liquidationAmountValue === undefined || liquidationApprovalDetails === undefined) return liquidationAmountValue
	let clampedAmount = liquidationAmountValue
	if (clampedAmount > liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth) clampedAmount = liquidationApprovalDetails.params.maxDebtPerLiquidationAttoEth
	if (clampedAmount > liquidationApprovalDetails.availableDebtAttoEth) clampedAmount = liquidationApprovalDetails.availableDebtAttoEth
	return clampedAmount
}

export function getLiquidationLifecycleBlocker(poolState: SecurityPoolStateModel | undefined) {
	if (poolState === undefined || poolState.actions.queueLiquidation.enabled) return undefined
	switch (poolState.lifecycleState) {
		case 'ended':
			return liquidationCopy.liquidationUnavailableEndedReason
		case 'poolForked':
		case 'forkMigration':
			return liquidationCopy.liquidationUnavailableForkMigrationReason
		case 'forkTruthAuction':
			return liquidationCopy.liquidationUnavailableTruthAuctionReason
		case 'operational':
		case undefined:
			return liquidationCopy.liquidationUnavailableReason
		default:
			return assertNever(poolState.lifecycleState)
	}
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
		{ loading: true, reason: liquidationManagerAddress === undefined || liquidationSecurityPoolAddress === undefined ? liquidationCopy.selectedPoolDetailsLoading : undefined },
		{ reason: trimmedLiquidationTargetVault === '' ? liquidationCopy.targetVaultRequired : undefined },
		{ reason: trimmedLiquidationReceiverVault === '' ? liquidationCopy.receiverVaultRequired : undefined },
		{ reason: trimmedLiquidationReceiverVault !== '' && tryParseAddressInput(trimmedLiquidationReceiverVault) === undefined ? liquidationCopy.receiverVaultAddressInvalid : undefined },
		{ loading: delegatedReceiver && loadingLiquidationApproval, reason: delegatedApprovalReason },
		{ loading: true, reason: delegatedReceiver && loadingLiquidationReceiverVaultSummary ? liquidationCopy.loadingReceiverVault : undefined },
		{ reason: delegatedReceiver ? liquidationReceiverVaultSummaryError : undefined },
		{ reason: delegatedReceiver && !liquidationReceiverVaultSummaryResolved ? liquidationCopy.receiverVaultRequiredBeforeSubmission : undefined },
		{ reason: sameVaultWarning },
		{ reason: liquidationDebtEthAmount.trim() === '' ? liquidationCopy.liquidationAmountRequired : undefined },
		{ reason: liquidationExecutionMode === 'queue' && (liquidationTimeoutSeconds === undefined || liquidationTimeoutSeconds > 300n) ? securityPoolCopy.executionWindowRangeError : undefined },
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
	if (currentPoolOracleManagerDetails?.pendingOperation?.operation === 'liquidation' && sameAddress(currentPoolOracleManagerDetails.pendingOperation.targetVault, liquidationTargetVault)) {
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

/** Why the Liquidate vault launcher is unavailable for a vault the connected wallet does not own; the owned vault never offers it. */
export function getVaultLiquidationLauncherBlocker({
	hasWallet,
	isOnActiveAppChain,
	liquidationEnabled,
	notLiquidatableReason,
	vaultExistsOnchain,
	vaultLoaded,
	wrongNetworkReason,
}: {
	hasWallet: boolean
	isOnActiveAppChain: boolean
	liquidationEnabled: boolean
	notLiquidatableReason: string | undefined
	vaultExistsOnchain: boolean
	vaultLoaded: boolean
	wrongNetworkReason: string
}) {
	if (!hasWallet) return securityPoolCopy.liquidationWalletRequiredReason
	if (!isOnActiveAppChain) return wrongNetworkReason
	if (!vaultLoaded) return securityPoolCopy.loadingVault
	if (!vaultExistsOnchain) return securityPoolCopy.missingVaultDetail
	if (!liquidationEnabled) return liquidationCopy.liquidationUnavailableReason
	return notLiquidatableReason
}
