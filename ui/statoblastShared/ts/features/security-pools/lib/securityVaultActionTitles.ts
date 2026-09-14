import type { SecurityVaultActionResult } from '@zoltar/ui-core-shared/types/contracts.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

export const getPendingTitle = (actionName: SecurityVaultActionResult['action']) => {
	switch (actionName) {
		case 'adjustVaultBackingFactor':
			return 'Adjusting backing factor'
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
export const getSuccessTitle = (actionName: SecurityVaultActionResult['action']) => {
	switch (actionName) {
		case 'adjustVaultBackingFactor':
			return 'Backing factor adjusted'
		case 'approveRep':
			return 'REP approved'
		case 'depositRepToVault':
			return 'REP deposited'
		case 'queueWithdrawRep':
			return 'REP withdrawal queued'
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
		case 'adjustVaultBackingFactor':
			return 'Backing factor adjustment failed'
		case 'approveRep':
			return 'REP approval failed'
		case 'depositRepToVault':
			return 'REP deposit failed'
		case 'queueWithdrawRep':
			return 'REP withdrawal failed'
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
