import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { TransactionFundingActionsPlaceholder } from '@zoltar/ui-core-shared/components/TransactionFundingActionsPlaceholder.js'
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TransactionStepsContent } from '@zoltar/ui-core-shared/components/TransactionStepsContent.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as transactionCopy from '@zoltar/ui-core-shared/copy/transactionSteps.js'
import type { WalletActionBlocker } from '@zoltar/ui-core-shared/types/components.js'
import { withWalletBlocker } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import type { usePreparedOracleOperation } from '../hooks/usePreparedOracleOperation.js'

/** The same funding, approval, and final-send controls for every oracle-backed pool operation. */
export function OracleOperationActions({
	prepared,
	operationKey,
	actionLabel,
	pendingLabel,
	requiresReportFunding,
	directExecution = false,
	disabled = false,
	busy,
	pending,
	reason,
	onExecute,
	onCancel,
	walletBlocker,
	disabledReasonElementId,
	showDisabledReason = true,
}: {
	prepared: ReturnType<typeof usePreparedOracleOperation>
	operationKey: string
	actionLabel: string
	pendingLabel: string
	requiresReportFunding: boolean
	directExecution?: boolean
	disabled?: boolean
	busy: boolean
	pending: boolean
	reason: string | undefined
	onExecute: () => void | Promise<void>
	onCancel?: (() => void) | undefined
	walletBlocker?: WalletActionBlocker | undefined
	disabledReasonElementId?: string | undefined
	showDisabledReason?: boolean
}) {
	const review = prepared.workflow ?? prepared.retainedWorkflow
	const fundingApplies = requiresReportFunding || review?.steps.some(step => step.approval !== undefined) === true
	return (
		<>
			<ErrorNotice message={prepared.error} />
			{!directExecution && review !== undefined ? (
				<TransactionStepsContent
					actionsFirst
					includeWrapAction={fundingApplies}
					finalActionLabel={actionLabel}
					cancelable={onCancel !== undefined}
					onClose={onCancel}
					contextKey={operationKey}
					retainedWorkflow={prepared.retainedWorkflow}
					retryAction={prepared.retainedWorkflow?.steps.some(step => step.phase === 'failed') !== true ? undefined : { onClick: prepared.retry, availability: { disabled: disabled || busy || reason !== undefined, reason } }}
				/>
			) : (
				<div className='transaction-step-actions transaction-approval-editor'>
					<div className='tx-action-group'>
						<div className='tx-action-feedback' />
						<div className='actions'>
							{fundingApplies ? <TransactionFundingActionsPlaceholder actionLabel={actionLabel} loading={prepared.preparing} resetKey={operationKey} /> : undefined}
							<div className='transaction-plan-action transaction-plan-action-wide transaction-plan-action-final'>
								<TransactionActionButton
									idleLabel={actionLabel}
									pendingLabel={pendingLabel}
									pending={directExecution && pending}
									showDisabledReason={showDisabledReason}
									disabledReasonElementId={disabledReasonElementId}
									onClick={() => {
										if (directExecution && !disabled && !busy && reason === undefined) void onExecute()
									}}
									availability={withWalletBlocker({ disabled: disabled || !directExecution || busy || reason !== undefined, reason: reason ?? (!directExecution ? transactionCopy.prerequisitesRequired : undefined) }, walletBlocker)}
								/>
								{onCancel === undefined ? undefined : (
									<div className='actions transaction-step-close'>
										<button type='button' className='secondary' disabled={prepared.sending || (pending && !prepared.preparing)} onClick={onCancel}>
											{commonCopy.cancel}
										</button>
									</div>
								)}
							</div>
							{prepared.retryAvailable ? <TransactionActionButton idleLabel={commonCopy.retry} pendingLabel={commonCopy.retrying} onClick={prepared.retry} availability={{ disabled: disabled || busy || reason !== undefined, reason }} tone='secondary' /> : undefined}
						</div>
					</div>
				</div>
			)}
		</>
	)
}
