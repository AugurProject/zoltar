import type { SecurityVaultActionResult } from '../../../types/contracts.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'

export const getPendingTitle = (actionName: SecurityVaultActionResult['action']) => {
	switch (actionName) {
		case 'setVaultUnderwritingLimit':
			return securityPoolCopy.settingCommitmentLimit
		case 'approveRep':
			return 'Approving REP'
		case 'depositRepToVault':
			return 'Depositing REP'
		case 'queueWithdrawRep':
			return 'Withdrawing REP'
		case 'redeemFees':
			return 'Claiming fees'
		case 'redeemRepFromVault':
			return 'Redeeming REP'
		case 'updateVaultFees':
			return 'Refreshing vault fees'
		default:
			return assertNever(actionName)
	}
}
/** `executedImmediately` marks a withdrawal that ran in its own transaction instead of waiting in the queue. */
export const getSuccessTitle = (actionName: SecurityVaultActionResult['action'], executedImmediately = false) => {
	switch (actionName) {
		case 'setVaultUnderwritingLimit':
			return securityPoolCopy.commitmentLimitChangeSubmitted
		case 'approveRep':
			return 'REP approved'
		case 'depositRepToVault':
			return 'REP deposited'
		case 'queueWithdrawRep':
			return executedImmediately ? securityPoolCopy.repWithdrawalExecuted : securityPoolCopy.repWithdrawalQueued
		case 'redeemFees':
			return 'Fees claimed'
		case 'redeemRepFromVault':
			return 'REP redeemed'
		case 'updateVaultFees':
			return 'Vault fees refreshed'
		default:
			return assertNever(actionName)
	}
}
export const getFailureTitle = (actionName: SecurityVaultActionResult['action']) => {
	switch (actionName) {
		case 'setVaultUnderwritingLimit':
			return securityPoolCopy.commitmentLimitChangeFailed
		case 'approveRep':
			return 'REP approval failed'
		case 'depositRepToVault':
			return 'REP deposit failed'
		case 'queueWithdrawRep':
			return securityPoolCopy.repWithdrawalFailed
		case 'redeemFees':
			return 'Fee claim failed'
		case 'redeemRepFromVault':
			return 'REP redemption failed'
		case 'updateVaultFees':
			return 'Vault fee refresh failed'
		default:
			return assertNever(actionName)
	}
}

/**
 * The reason a vault operation failed. Only an execution attempted in the submitting transaction was rejected immediately;
 * an operation that failed after waiting in the queue reports its own execution result.
 */
export function getQueuedVaultOperationFailureDetail(result: Pick<SecurityVaultActionResult, 'stagedExecution' | 'queuedOperationState'>, immediateRejectionDetail: string | undefined) {
	if (result.stagedExecution !== undefined) return result.stagedExecution.errorMessage ?? immediateRejectionDetail
	return result.queuedOperationState?.execution?.errorMessage
}
