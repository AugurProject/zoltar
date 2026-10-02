import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { AmountField } from '@zoltar/ui-core-shared/components/AmountField.js'
import { formatAmountForDisplay } from '@zoltar/ui-core-shared/forms/amountInput.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { withWalletBlocker, withWalletGuardFirst, type WalletGuard } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { ReadinessAction } from '@zoltar/ui-core-shared/types/components.js'
import type { SecurityVaultDetails } from '../../../types/contracts.js'
import type { SecurityVaultSectionProps } from '../../types.js'
import type { VaultRepExitMode } from '../lib/securityVaultAvailability.js'

export function VaultDepositAmountField({
	disabled,
	onChange,
	repTokenSymbol,
	value,
	walletRepBalanceAttoRep,
	walletRepBalanceLoading,
}: {
	disabled: boolean
	onChange: (depositAmount: string) => void
	repTokenSymbol: string
	value: string
	walletRepBalanceAttoRep: bigint | undefined
	walletRepBalanceLoading: boolean
}) {
	// The balance is a hint only: the approval control already reports a shortfall with its exact amount.
	let hint: ComponentChildren = undefined
	if (walletRepBalanceLoading) hint = <LoadingText>{commonCopy.loading}</LoadingText>
	else if (walletRepBalanceAttoRep !== undefined) hint = commonCopy.formatAmountHint(commonCopy.balance, formatAmountForDisplay(walletRepBalanceAttoRep, 18, repTokenSymbol))
	return <AmountField disabled={disabled} fillMax={{ amount: walletRepBalanceAttoRep }} hint={hint} label={securityPoolCopy.repBackingLabel} onChange={onChange} unit={repTokenSymbol} value={value} />
}

export function VaultRepWithdrawAmountField({ disabled, maximumWithdrawableAttoRep, onChange, repTokenSymbol, value }: { disabled: boolean; maximumWithdrawableAttoRep: bigint | undefined; onChange: (repWithdrawAmount: string) => void; repTokenSymbol: string; value: string }) {
	// The field flags an amount above the withdrawable maximum inline; the action guard repeats it beside the disabled button.
	const maximum = maximumWithdrawableAttoRep !== undefined && maximumWithdrawableAttoRep > 0n ? maximumWithdrawableAttoRep : undefined
	return <AmountField disabled={disabled} label={securityPoolCopy.formatRepWithdrawAmount(repTokenSymbol)} fillMax={{ amount: maximumWithdrawableAttoRep }} maximum={maximum} onChange={onChange} unit={repTokenSymbol} value={value} />
}

export function VaultRepExitActionButton({
	disabledReasonElementId,
	canUseLoadedVaultActions,
	hasPositiveWithdrawAmount,
	hasWithdrawableRep,
	onRedeemRepFromVault,
	onWithdrawRep,
	repExitActionLabel,
	repExitEnabled,
	repExitGuardMessage,
	repExitMode,
	repTokenSymbol,
	securityVaultActiveAction,
	walletGuard,
}: {
	disabledReasonElementId?: string | undefined
	canUseLoadedVaultActions: boolean
	hasPositiveWithdrawAmount: boolean
	hasWithdrawableRep: boolean
	onRedeemRepFromVault: () => void
	onWithdrawRep: () => void
	repExitActionLabel: string
	repExitEnabled: boolean
	repExitGuardMessage: string | undefined
	repExitMode: VaultRepExitMode
	repTokenSymbol: string
	securityVaultActiveAction: SecurityVaultSectionProps['securityVaultActiveAction']
	walletGuard: WalletGuard
}) {
	// A blocking wallet is the reason shown, so its fix takes the reason slot instead of the price field's error.
	const describedByElementId = walletGuard.walletBlocker === undefined ? disabledReasonElementId : undefined
	const unavailableReason = (() => {
		if (!canUseLoadedVaultActions) return securityPoolCopy.selectOwnVaultToWithdrawRep
		if (repExitGuardMessage !== undefined) return repExitGuardMessage
		if (!repExitEnabled) return securityPoolCopy.withdrawalUnavailableReason
		if (repExitMode === 'withdraw' && !hasWithdrawableRep) return securityPoolCopy.noWithdrawableRepReason
		if (repExitMode === 'withdraw' && !hasPositiveWithdrawAmount) return commonCopy.positiveAmountRequired
		return undefined
	})()
	return (
		<TransactionActionButton
			disabledReasonElementId={describedByElementId}
			showDisabledReason={describedByElementId === undefined}
			idleLabel={repExitActionLabel}
			pendingLabel={repExitMode === 'redeem' ? securityPoolCopy.formatRedeemingRep(repTokenSymbol) : securityPoolCopy.formatWithdrawingRep(repTokenSymbol)}
			onClick={repExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep}
			pending={repExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep'}
			availability={withWalletGuardFirst(
				{
					disabled: !repExitEnabled || !canUseLoadedVaultActions || (repExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
					reason: unavailableReason,
				},
				walletGuard,
			)}
		/>
	)
}

export function VaultDepositApprovalControl({
	approveRepEnabled,
	canUseLoadedVaultActions,
	currentSelectedVaultDetails,
	depositActionGuardMessage,
	depositAmount,
	depositAmountNotice,
	depositGuardMessage,
	depositRepActionLabel,
	depositRepToVaultEnabled,
	hasPositiveDepositAmount,
	onApproveRep,
	onCancel,
	onDepositRepToVault,
	repTokenSymbol,
	securityVaultActiveAction,
	securityVaultRepApproval,
	walletGuard,
}: {
	approveRepEnabled: boolean
	canUseLoadedVaultActions: boolean
	currentSelectedVaultDetails: SecurityVaultDetails | undefined
	depositActionGuardMessage: string | undefined
	depositAmount: bigint | undefined
	depositAmountNotice: string | undefined
	depositGuardMessage: string | undefined
	depositRepActionLabel: string
	depositRepToVaultEnabled: boolean
	hasPositiveDepositAmount: boolean
	onApproveRep: SecurityVaultSectionProps['onApproveRep']
	onCancel?: (() => void) | undefined
	onDepositRepToVault: () => void
	repTokenSymbol: string
	securityVaultActiveAction: SecurityVaultSectionProps['securityVaultActiveAction']
	securityVaultRepApproval: SecurityVaultSectionProps['securityVaultRepApproval']
	walletGuard: WalletGuard
}) {
	const renderDepositActions = (approvalButton: ComponentChildren, approvalNotice: string | undefined, noticeId: string) => (
		<TransactionActionGroup id={noticeId} message={approvalNotice ?? (canUseLoadedVaultActions ? depositActionGuardMessage : undefined)}>
			{approvalButton}
			<TransactionActionButton
				idleLabel={depositRepActionLabel}
				pendingLabel={securityPoolCopy.formatDepositingRep(repTokenSymbol)}
				onClick={onDepositRepToVault}
				pending={securityVaultActiveAction === 'depositRepToVault'}
				availability={withWalletGuardFirst({ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined }, walletGuard)}
			/>
			{onCancel === undefined ? undefined : (
				<button className='secondary' type='button' disabled={securityVaultActiveAction !== undefined} onClick={onCancel}>
					{commonCopy.cancel}
				</button>
			)}
		</TransactionActionGroup>
	)
	return (
		<TokenApprovalControl
			renderActions={({ button, notice, noticeId }) => renderDepositActions(button, notice, noticeId)}
			actionLabel={depositRepActionLabel}
			customAmountDisclosureLabel={securityPoolCopy.customApprovalAmountDisclosure}
			allowanceError={securityVaultRepApproval.error}
			allowanceLoading={securityVaultRepApproval.loading}
			approvedAmount={securityVaultRepApproval.value}
			guardMessage={depositAmountNotice}
			onApprove={amount => onApproveRep(amount)}
			pending={securityVaultActiveAction === 'approveRep'}
			pendingLabel={commonCopy.formatApprovingToken(repTokenSymbol)}
			// Without a positive deposit nothing is required yet, so the approved amount is not shown as satisfying it.
			requiredAmount={hasPositiveDepositAmount ? depositAmount : undefined}
			resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
			tokenSymbol={repTokenSymbol}
			tokenUnits={18}
			disabled={!approveRepEnabled || !canUseLoadedVaultActions || !depositRepToVaultEnabled}
		/>
	)
}

export function VaultActionLaunchers({
	claimingFees = false,
	hasVaultRepBacking,
	redeemRepAction,
	refreshVaultActionsDescriptionId,
	securityVaultError,
	showMissingVaultNotice,
	showSharedRefreshVaultBlocker,
	vaultActionsLoadBlocker,
	vaultLifecycleBlocker,
	vaultLifecycleBlockerId,
	vaultReadinessActions,
	walletRepBalanceError,
}: {
	claimingFees?: boolean
	hasVaultRepBacking: boolean
	redeemRepAction?: ComponentChildren
	refreshVaultActionsDescriptionId: string
	securityVaultError: string | undefined
	showMissingVaultNotice: boolean
	showSharedRefreshVaultBlocker: boolean
	vaultActionsLoadBlocker: string | undefined
	vaultLifecycleBlocker: string | undefined
	vaultLifecycleBlockerId: string
	vaultReadinessActions: Omit<ReadinessAction, 'title'>[]
	walletRepBalanceError: string | undefined
}) {
	const renderAction = (action: Omit<ReadinessAction, 'title'>) => {
		if (action.onAction === undefined && action.blocker === undefined && action.readiness !== 'blocked') return undefined
		return (
			<div key={action.key} className='vault-action-launcher'>
				{action.key === 'rep-exit' && redeemRepAction !== undefined ? (
					redeemRepAction
				) : (
					<ActionLauncherButton
						describedBy={action.disabledReasonId}
						idleLabel={action.actionLabel}
						pending={action.key === 'claim-fees' && claimingFees}
						pendingLabel={action.key === 'claim-fees' ? securityPoolCopy.claimingFees : commonCopy.opening}
						onClick={() => action.onAction?.()}
						tone={action.key === 'deposit-rep' || (action.key === 'adjust-backing' && hasVaultRepBacking) ? 'primary' : 'secondary'}
						availability={withWalletBlocker({ disabled: action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined, reason: action.blocker }, action.walletBlocker)}
					/>
				)}
				{action.description === undefined ? undefined : <UserMessage className='detail' detail={action.description} />}
			</div>
		)
	}
	return (
		<>
			<SectionBlock title={securityPoolCopy.vaultActions} variant='plain'>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} /> : undefined}
				{vaultLifecycleBlocker === undefined ? undefined : <UserMessage tone='warning' id={vaultLifecycleBlockerId} detail={vaultLifecycleBlocker} />}
				{showSharedRefreshVaultBlocker ? <UserMessage className='detail' id={refreshVaultActionsDescriptionId} detail={vaultActionsLoadBlocker} /> : undefined}
				<div className='vault-primary-actions'>{vaultReadinessActions.map(renderAction)}</div>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<ErrorNotice message={walletRepBalanceError} />
		</>
	)
}
