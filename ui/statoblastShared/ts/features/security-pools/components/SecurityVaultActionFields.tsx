import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { ComponentChildren } from 'preact'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import * as workspaceCopy from '../../../copy/poolWorkspace.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import { TransactionActionButton, TransactionActionGroup } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import { withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { ReadinessAction } from '@zoltar/ui-core-shared/types/components.js'
import type { SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import type { SecurityVaultSectionProps } from '../../types.js'
import type { VaultRepExitMode } from '../lib/securityVaultAvailability.js'

export function VaultDepositAmountField({ disabled, onChange, value, walletRepBalanceAttoRep }: { disabled: boolean; onChange: (depositAmount: string) => void; value: string; walletRepBalanceAttoRep: bigint | undefined }) {
	return (
		<label className='field'>
			<span>{securityPoolCopy.repBackingLabel}</span>
			<div className='field-inline'>
				<FormInput className='field-inline-input' value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} />
				<button
					className='quiet field-inline-action'
					type='button'
					onClick={() => {
						if (walletRepBalanceAttoRep === undefined) return
						onChange(formatCurrencyInputBalance(walletRepBalanceAttoRep))
					}}
					disabled={walletRepBalanceAttoRep === undefined || disabled}
				>
					{commonCopy.max}
				</button>
			</div>
		</label>
	)
}

export function VaultRepWithdrawAmountField({ disabled, maximumWithdrawableAttoRep, onChange, value }: { disabled: boolean; maximumWithdrawableAttoRep: bigint | undefined; onChange: (repWithdrawAmount: string) => void; value: string }) {
	return (
		<label className='field'>
			<span>{securityPoolCopy.repWithdrawAmount}</span>
			<div className='field-inline'>
				<FormInput className='field-inline-input' value={value} onInput={event => onChange(event.currentTarget.value)} disabled={disabled} />
				<button
					className='quiet field-inline-action'
					type='button'
					onClick={() => {
						if (maximumWithdrawableAttoRep === undefined) return
						onChange(formatCurrencyInputBalance(maximumWithdrawableAttoRep))
					}}
					disabled={maximumWithdrawableAttoRep === undefined || disabled}
				>
					{commonCopy.max}
				</button>
			</div>
		</label>
	)
}

export function VaultRepExitActionButton({
	canUseLoadedVaultActions,
	hasPositiveWithdrawAmount,
	hasWithdrawableRep,
	onRedeemRepFromVault,
	onWithdrawRep,
	repExitActionLabel,
	repExitEnabled,
	repExitGuardMessage,
	repExitMode,
	securityVaultActiveAction,
}: {
	canUseLoadedVaultActions: boolean
	hasPositiveWithdrawAmount: boolean
	hasWithdrawableRep: boolean
	onRedeemRepFromVault: () => void
	onWithdrawRep: () => void
	repExitActionLabel: string
	repExitEnabled: boolean
	repExitGuardMessage: string | undefined
	repExitMode: VaultRepExitMode
	securityVaultActiveAction: SecurityVaultSectionProps['securityVaultActiveAction']
}) {
	return (
		<TransactionActionButton
			idleLabel={repExitActionLabel}
			pendingLabel={repExitMode === 'redeem' ? securityPoolCopy.redeemingRep : securityPoolCopy.withdrawingRep}
			onClick={repExitMode === 'redeem' ? onRedeemRepFromVault : onWithdrawRep}
			pending={repExitMode === 'redeem' ? securityVaultActiveAction === 'redeemRepFromVault' : securityVaultActiveAction === 'queueWithdrawRep'}
			availability={{
				disabled: !repExitEnabled || !canUseLoadedVaultActions || (repExitMode === 'withdraw' && (!hasPositiveWithdrawAmount || !hasWithdrawableRep)) || repExitGuardMessage !== undefined,
				reason: canUseLoadedVaultActions ? repExitGuardMessage : undefined,
			}}
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
}) {
	const renderDepositActions = (approvalButton: ComponentChildren, approvalNotice: string | undefined, noticeId: string) => (
		<TransactionActionGroup id={noticeId} message={approvalNotice ?? (canUseLoadedVaultActions ? depositActionGuardMessage : undefined)}>
			{approvalButton}
			<TransactionActionButton
				idleLabel={depositRepActionLabel}
				pendingLabel={securityPoolCopy.formatDepositingRep(repTokenSymbol)}
				onClick={onDepositRepToVault}
				pending={securityVaultActiveAction === 'depositRepToVault'}
				availability={{ disabled: !depositRepToVaultEnabled || !canUseLoadedVaultActions || !hasPositiveDepositAmount || depositGuardMessage !== undefined, reason: canUseLoadedVaultActions ? depositActionGuardMessage : undefined }}
			/>
			{onCancel === undefined ? undefined : (
				<button className='secondary' type='button' onClick={onCancel}>
					{commonCopy.cancel}
				</button>
			)}
		</TransactionActionGroup>
	)
	return (
		<TokenApprovalControl
			renderActions={({ button, notice, noticeId }) => renderDepositActions(button, notice, noticeId)}
			actionLabel={depositRepActionLabel}
			allowanceError={securityVaultRepApproval.error}
			allowanceLoading={securityVaultRepApproval.loading}
			approvedAmount={securityVaultRepApproval.value}
			guardMessage={depositAmountNotice}
			onApprove={amount => onApproveRep(amount)}
			pending={securityVaultActiveAction === 'approveRep'}
			pendingLabel={commonCopy.formatApprovingToken(repTokenSymbol)}
			requiredAmount={depositAmount}
			resetKey={`${currentSelectedVaultDetails?.repToken ?? ''}:${currentSelectedVaultDetails?.securityPoolAddress ?? ''}:${depositAmount?.toString() ?? ''}`}
			tokenSymbol={repTokenSymbol}
			tokenUnits={18}
			disabled={!approveRepEnabled || !canUseLoadedVaultActions || !depositRepToVaultEnabled}
		/>
	)
}

export function VaultActionLaunchers({
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
				<ActionLauncherButton
					describedBy={action.disabledReasonId}
					idleLabel={action.actionLabel}
					pendingLabel={commonCopy.opening}
					onClick={() => action.onAction?.()}
					tone={action.key === 'deposit-rep' ? 'primary' : 'secondary'}
					availability={withWalletBlocker({ disabled: action.readiness === 'blocked' || action.onAction === undefined || action.blocker !== undefined, reason: action.blocker }, action.walletBlocker)}
				/>
				{action.description === undefined ? undefined : <p className='detail'>{action.description}</p>}
			</div>
		)
	}
	const isAdvanced = (action: Omit<ReadinessAction, 'title'>) => action.key === 'adjust-backing' || action.key === 'liquidate-vault'
	return (
		<>
			<SectionBlock title={securityPoolCopy.vaultActions} variant='plain'>
				{showMissingVaultNotice ? <StateHint presentation={{ key: 'not_found', badgeLabel: securityPoolCopy.vaultMissing, badgeTone: 'muted', detail: securityPoolCopy.missingVaultDepositDetail }} /> : undefined}
				{vaultLifecycleBlocker === undefined ? undefined : (
					<p className='notice warning' id={vaultLifecycleBlockerId}>
						{vaultLifecycleBlocker}
					</p>
				)}
				{showSharedRefreshVaultBlocker ? (
					<p className='detail' id={refreshVaultActionsDescriptionId}>
						{vaultActionsLoadBlocker}
					</p>
				) : undefined}
				<div className='vault-primary-actions'>{vaultReadinessActions.filter(action => !isAdvanced(action)).map(renderAction)}</div>
				<details className='vault-more-actions'>
					<summary>{workspaceCopy.moreActions}</summary>
					<div className='vault-primary-actions'>{vaultReadinessActions.filter(isAdvanced).map(renderAction)}</div>
				</details>
			</SectionBlock>
			<ErrorNotice message={securityVaultError} />
			<ErrorNotice message={walletRepBalanceError} />
		</>
	)
}
