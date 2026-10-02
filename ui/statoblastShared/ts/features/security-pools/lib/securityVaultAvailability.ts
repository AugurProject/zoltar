import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { ReadinessAction, WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
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

/**
 * The withdrawal ceiling offered to the user. It comes only from the coverage calculation, which needs a price whenever a
 * commitment locks REP; without one the ceiling stays unknown rather than falling back to the whole backing.
 */
export function getMaximumWithdrawableAttoRep({ disputeStakedAttoRep, withdrawableRepAmountAttoRep }: { disputeStakedAttoRep: bigint | undefined; withdrawableRepAmountAttoRep: bigint | undefined }) {
	if (disputeStakedAttoRep !== undefined && disputeStakedAttoRep > 0n) return 0n
	return withdrawableRepAmountAttoRep
}

/** Queued withdrawals execute at the oracle price, so a valid oracle price wins; otherwise the selected UI price gives an estimate. */
export function getVaultWithdrawalRepPerEthPrice({ executionRepPerEthPrice, estimateRepPerEthPrice }: { executionRepPerEthPrice: bigint | undefined; estimateRepPerEthPrice: bigint | undefined }) {
	if (executionRepPerEthPrice !== undefined && executionRepPerEthPrice > 0n) return { isEstimate: false, repPerEthPrice: executionRepPerEthPrice }
	if (estimateRepPerEthPrice !== undefined && estimateRepPerEthPrice > 0n) return { isEstimate: true, repPerEthPrice: estimateRepPerEthPrice }
	return { isEstimate: true, repPerEthPrice: undefined }
}

export function getVaultDepositAmountNotice({
	currentVaultRepBackingAttoRep,
	depositAmount,
	isDepositBelowMinimum,
	minimumVaultRepDepositAttoRep,
	repTokenSymbol,
	walletRepShortfallAttoRep,
}: {
	currentVaultRepBackingAttoRep?: bigint | undefined
	depositAmount: bigint | undefined
	isDepositBelowMinimum: boolean
	minimumVaultRepDepositAttoRep: bigint | undefined
	repTokenSymbol?: string | undefined
	walletRepShortfallAttoRep: bigint | undefined
}) {
	if (walletRepShortfallAttoRep !== undefined && walletRepShortfallAttoRep > 0n) return securityPoolCopy.formatInsufficientRepBalanceDetail(formatCurrencyBalance(walletRepShortfallAttoRep), repTokenSymbol)
	if (isDepositBelowMinimum) return getVaultDepositGuardMessage({ approvalSatisfied: true, currentVaultRepBackingAttoRep, depositAmount, isDepositBelowMinimum, minimumVaultRepDepositAttoRep, walletRepShortfallAttoRep: undefined })
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
	/** Describes a lifecycle blocker for the commitment action, which stays available after deposits close. */
	adjustmentDisabledReasonId: string | undefined
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
	/** The wallet prerequisite behind the launcher blockers, which the launchers offer to fix in place. */
	walletBlocker: WalletActionBlocker | undefined
}

export function buildVaultReadinessActions({
	adjustmentBlocker,
	adjustmentDisabledReasonId,
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
	walletBlocker,
}: VaultReadinessActionInput): Omit<ReadinessAction, 'title'>[] {
	// Attach wallet recovery only to blockers produced by the wallet-first launcher checks.
	const withBlocker = (blocker: string | undefined) => (blocker === undefined ? {} : { blocker, ...(walletBlocker === undefined ? {} : { walletBlocker }) })
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
			...(depositRepToVaultEnabled ? withBlocker(visibleDepositLauncherBlocker) : {}),
		},
		{
			actionLabel: securityPoolCopy.setVaultUnderwritingLimit,
			description: securityPoolCopy.setVaultUnderwritingLimitDescription,
			key: 'adjust-backing',
			...(adjustmentReady ? { onAction: () => onOpenModal('adjust-backing') } : {}),
			readiness: adjustmentReady ? 'ready' : 'blocked',
			...(adjustmentDisabledReasonId === undefined ? {} : { disabledReasonId: adjustmentDisabledReasonId }),
			...(showSharedRefreshVaultBlocker ? {} : withBlocker(adjustmentBlocker)),
		},
		{
			actionLabel: repExitActionLabel,
			description: repExitMode === 'redeem' ? securityPoolCopy.repRedemptionDescription : securityPoolCopy.repWithdrawalDescription,
			key: 'rep-exit',
			...(repExitReady ? { onAction: () => onOpenModal('withdraw-rep') } : {}),
			readiness: repExitReady ? 'ready' : 'blocked',
			...(repExitDisabledReasonId === undefined ? {} : { disabledReasonId: repExitDisabledReasonId }),
			...(repExitEnabled ? withBlocker(visibleRepExitLauncherBlocker) : {}),
			...(!repExitEnabled && repExitDisabledReasonId === undefined ? { blocker: securityPoolCopy.withdrawalUnavailableReason } : {}),
		},
		{
			actionLabel: securityPoolCopy.claimFees,
			description: securityPoolCopy.claimFeesDescription,
			key: 'claim-fees',
			...(claimFeesReady ? { onAction: () => onOpenModal('claim-fees') } : {}),
			readiness: claimFeesReady ? 'ready' : 'blocked',
			...(claimFeesDisabledReasonId === undefined ? {} : { disabledReasonId: claimFeesDisabledReasonId }),
			...withBlocker(claimFeesAvailabilityBlocker),
		},
	]
}

export function getVaultRepExitActionLabel(repExitMode: VaultRepExitMode, repTokenSymbol: string) {
	return repExitMode === 'redeem' ? securityPoolCopy.formatRedeemRepFromVault(repTokenSymbol) : securityPoolCopy.formatWithdrawRep(repTokenSymbol)
}

export function getVaultLookupActionLabel(securityVaultError: string | undefined) {
	return securityVaultError === undefined ? commonCopy.refresh : commonCopy.retry
}
