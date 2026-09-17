import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { ReadinessAction } from '@zoltar/ui-core-shared/types/components.js'
import { getVaultLauncherVaultOwnerReason, getVaultLauncherWalletReason, type VaultLauncherAction, type VaultRepExitMode } from './securityPoolLabels.js'
import type { SecurityPoolStateModel } from './securityPoolState.js'
import { getVaultDepositGuardMessage } from './securityVaultGuards.js'

export type { VaultLauncherAction, VaultRepExitMode }
export type VaultActionModal = 'claim-fees' | 'deposit-rep' | 'withdraw-rep' | 'adjust-backing'

export function getVaultLifecycleBlocker(poolState: SecurityPoolStateModel | undefined) {
	if (poolState?.lifecycleState === 'ended') return securityPoolCopy.vaultActionsEndedDetail
	if (poolState?.lifecycleState === 'poolForked' || poolState?.lifecycleState === 'forkMigration') return securityPoolCopy.vaultActionsForkMigrationDetail
	if (poolState?.lifecycleState === 'forkTruthAuction') return securityPoolCopy.vaultActionsTruthAuctionDetail
	if (poolState?.vaultAdmissionClosed) return securityPoolCopy.vaultDepositAdmissionClosedDetail
	return undefined
}

export function getVaultRepExitAmountLabel(repExitMode: VaultRepExitMode, hasValidOraclePrice: boolean) {
	if (repExitMode === 'redeem') return securityPoolCopy.redeemableAttoRep
	if (hasValidOraclePrice) return securityPoolCopy.withdrawableAttoRep
	return securityPoolCopy.repAvailableToQueue
}

export function getMaximumWithdrawableAttoRep({ disputeStakedAttoRep, repPerEthPrice, vaultAttoRepBacking, withdrawableRepAmountAttoRep }: { disputeStakedAttoRep: bigint | undefined; repPerEthPrice: bigint | undefined; vaultAttoRepBacking: bigint | undefined; withdrawableRepAmountAttoRep: bigint | undefined }) {
	if (disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n) return 0n
	if (repPerEthPrice !== undefined) return withdrawableRepAmountAttoRep
	return vaultAttoRepBacking
}

export function getVaultDepositAmountNotice({ depositAmount, isDepositBelowMinimum, minimumVaultRepDepositAttoRep, walletRepShortfallAttoRep }: { depositAmount: bigint | undefined; isDepositBelowMinimum: boolean; minimumVaultRepDepositAttoRep: bigint; walletRepShortfallAttoRep: bigint | undefined }) {
	if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(walletRepShortfallAttoRep))
	if (isDepositBelowMinimum) return getVaultDepositGuardMessage({ approvalSatisfied: true, depositAmount, isDepositBelowMinimum, minimumVaultRepDepositAttoRep, walletRepShortfallAttoRep: undefined })
	return undefined
}

export function getVaultActionsLoadBlocker({ autoLoadVault, hasLoadedSelectedVaultDetails, loadingSecurityVault, securityVaultError }: { autoLoadVault: boolean; hasLoadedSelectedVaultDetails: boolean; loadingSecurityVault: boolean; securityVaultError: string | undefined }) {
	if (hasLoadedSelectedVaultDetails || loadingSecurityVault) return undefined
	if (autoLoadVault && securityVaultError === undefined) return undefined
	return securityVaultError === undefined ? securityPoolCopy.refreshVaultActionsDetail : securityPoolCopy.retryVaultActionsDetail
}

export type VaultLauncherBlockerContext = {
	accountAddress: Address | undefined
	hasLoadedSelectedVaultDetails: boolean
	isOnActiveAppChain: boolean
	loadedVaultMissingBlocker: string | undefined
	repExitMode: VaultRepExitMode
	selectedVaultIsOwnedByAccount: boolean
	vaultActionsLoadBlocker: string | undefined
	vaultExistsOnchain: boolean
	walletRepBalanceAttoRep: bigint | undefined
}

export function getVaultLauncherBlocker(action: VaultLauncherAction, context: VaultLauncherBlockerContext) {
	const walletGuardState = getWalletActiveAppChainGuardState({
		accountAddress: context.accountAddress,
		isOnActiveAppChain: context.isOnActiveAppChain,
		walletRequiredReason: getVaultLauncherWalletReason(action, context.repExitMode),
	})
	if (walletGuardState.blocked) return walletGuardState.reason
	if (!context.selectedVaultIsOwnedByAccount) return getVaultLauncherVaultOwnerReason(action, context.repExitMode)
	if (!context.hasLoadedSelectedVaultDetails) return context.vaultActionsLoadBlocker
	if (action === 'deposit-rep') {
		if (!context.vaultExistsOnchain && context.walletRepBalanceAttoRep !== undefined && context.walletRepBalanceAttoRep <= 0n) return securityPoolCopy.missingVaultRepBalanceReason
		return undefined
	}
	return context.loadedVaultMissingBlocker
}

export function getVaultActionDisabledReasonId({
	lifecycleActionEnabled,
	refreshVaultActionsDescriptionId,
	showSharedRefreshVaultBlocker,
	vaultLifecycleBlocker,
	vaultLifecycleBlockerId,
}: {
	lifecycleActionEnabled: boolean
	refreshVaultActionsDescriptionId: string
	showSharedRefreshVaultBlocker: boolean
	vaultLifecycleBlocker: string | undefined
	vaultLifecycleBlockerId: string
}) {
	if (vaultLifecycleBlocker !== undefined && !lifecycleActionEnabled) return vaultLifecycleBlockerId
	if (showSharedRefreshVaultBlocker) return refreshVaultActionsDescriptionId
	return undefined
}

export type VaultReadinessActionInput = {
	adjustmentBlocker: string | undefined
	canUseLoadedVaultActions: boolean
	claimFeesAvailabilityBlocker: string | undefined
	claimFeesDisabledReasonId: string | undefined
	claimFeesEnabled: boolean
	claimFeesLauncherBlocker: string | undefined
	depositDisabledReasonId: string | undefined
	depositRepActionLabel: string
	depositRepToVaultEnabled: boolean
	hasClaimableFees: boolean
	onOpenModal: (modal: VaultActionModal) => void
	repExitActionLabel: string
	repExitDisabledReasonId: string | undefined
	repExitEnabled: boolean
	repExitMode: VaultRepExitMode
	showSharedRefreshVaultBlocker: boolean
	vaultExistsOnchain: boolean
	visibleDepositLauncherBlocker: string | undefined
	visibleRepExitLauncherBlocker: string | undefined
}

export function buildVaultReadinessActions({
	adjustmentBlocker,
	canUseLoadedVaultActions,
	claimFeesAvailabilityBlocker,
	claimFeesDisabledReasonId,
	claimFeesEnabled,
	claimFeesLauncherBlocker,
	depositDisabledReasonId,
	depositRepActionLabel,
	depositRepToVaultEnabled,
	hasClaimableFees,
	onOpenModal,
	repExitActionLabel,
	repExitDisabledReasonId,
	repExitEnabled,
	repExitMode,
	showSharedRefreshVaultBlocker,
	vaultExistsOnchain,
	visibleDepositLauncherBlocker,
	visibleRepExitLauncherBlocker,
}: VaultReadinessActionInput): Omit<ReadinessAction, 'title'>[] {
	const depositReady = depositRepToVaultEnabled && canUseLoadedVaultActions
	const repExitReady = repExitEnabled && vaultExistsOnchain && canUseLoadedVaultActions
	const claimFeesReady = claimFeesEnabled && hasClaimableFees && claimFeesLauncherBlocker === undefined && vaultExistsOnchain && canUseLoadedVaultActions
	const adjustmentReady = adjustmentBlocker === undefined && canUseLoadedVaultActions
	return [
		{
			actionLabel: depositRepActionLabel,
			description: securityPoolCopy.depositRepToVaultDescription,
			key: 'deposit-rep',
			...(depositReady ? { onAction: () => onOpenModal('deposit-rep') } : {}),
			readiness: depositReady ? 'ready' : 'blocked',
			...(depositDisabledReasonId === undefined ? {} : { disabledReasonId: depositDisabledReasonId }),
			...(visibleDepositLauncherBlocker === undefined || !depositRepToVaultEnabled ? {} : { blocker: visibleDepositLauncherBlocker }),
		},
		{
			actionLabel: repExitActionLabel,
			description: repExitMode === 'redeem' ? securityPoolCopy.repRedemptionDescription : securityPoolCopy.repWithdrawalDescription,
			key: 'rep-exit',
			...(repExitReady ? { onAction: () => onOpenModal('withdraw-rep') } : {}),
			readiness: repExitReady ? 'ready' : 'blocked',
			...(repExitDisabledReasonId === undefined ? {} : { disabledReasonId: repExitDisabledReasonId }),
			...(visibleRepExitLauncherBlocker === undefined || !repExitEnabled ? {} : { blocker: visibleRepExitLauncherBlocker }),
		},
		{
			actionLabel: securityPoolCopy.claimFees,
			description: securityPoolCopy.claimFeesDescription,
			key: 'claim-fees',
			...(claimFeesReady ? { onAction: () => onOpenModal('claim-fees') } : {}),
			readiness: claimFeesReady ? 'ready' : 'blocked',
			...(claimFeesDisabledReasonId === undefined ? {} : { disabledReasonId: claimFeesDisabledReasonId }),
			...(claimFeesAvailabilityBlocker === undefined ? {} : { blocker: claimFeesAvailabilityBlocker }),
		},
		{
			actionLabel: securityPoolCopy.adjustVaultBackingFactor,
			description: securityPoolCopy.adjustVaultBackingFactorDescription,
			key: 'adjust-backing',
			...(adjustmentReady ? { onAction: () => onOpenModal('adjust-backing') } : {}),
			readiness: adjustmentReady ? 'ready' : 'blocked',
			...(depositDisabledReasonId === undefined ? {} : { disabledReasonId: depositDisabledReasonId }),
			...(showSharedRefreshVaultBlocker || adjustmentBlocker === undefined ? {} : { blocker: adjustmentBlocker }),
		},
	]
}

export function getVaultRepExitActionLabel(repExitMode: VaultRepExitMode, repTokenSymbol: string) {
	return repExitMode === 'redeem' ? securityPoolCopy.formatRedeemRepFromVault(repTokenSymbol) : securityPoolCopy.formatWithdrawRep(repTokenSymbol)
}

export function getVaultLookupActionLabel(securityVaultError: string | undefined) {
	return securityVaultError === undefined ? commonCopy.refresh : commonCopy.retry
}
