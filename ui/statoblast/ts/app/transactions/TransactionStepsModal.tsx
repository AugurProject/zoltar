import { TransactionActionButton, TransactionActionGroup, TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js'
import * as copy from '../../copy/transactionSteps.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { useEffect } from 'preact/hooks'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js'
import { signal } from '@preact/signals'
import { transactionSteps } from './transactionSteps.js'

export const embeddedTransactionSteps = signal<AbortSignal | undefined>(undefined)

export function TransactionStepsModal({ contextKey }: { contextKey: string }) {
	useEffect(() => () => transactionSteps.peek()?.cancel(), [contextKey])
	const presentation = useGlobalTransactionPresentation()
	useEffect(() => {
		if (presentation?.tone === 'success') transactionSteps.value?.finish()
	}, [presentation?.tone, presentation?.hash])
	if (transactionSteps.value?.reviewSignal?.aborted) return undefined
	if (embeddedTransactionSteps.value !== undefined && transactionSteps.value?.reviewSignal === embeddedTransactionSteps.value) return undefined
	return <TransactionStepsContent contextKey={contextKey} />
}

export function TransactionStepsContent({ contextKey, inline = false, onClose }: { contextKey: string; inline?: boolean; onClose?: () => void }) {
	const presentation = useGlobalTransactionPresentation()
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	if (workflow === undefined || current === undefined) return undefined
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : copy.requirementsFailed
	const error = current.error ?? (operationFailed ? operationError : undefined)
	const pending = error === undefined && workflow.steps.some(step => step.phase === 'pending')
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? copy.transactionPending : fundingReason
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n)
	const renderTransactionActions = () => (
		<TransactionActionGroup message={undefined}>
			{workflow.steps.map((step, index) => {
				const active = index === workflow.activeIndex
				const final = index === workflow.steps.length - 1
				const ready = step.phase === 'review' && !pending && error === undefined
				const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, pending: undefined, confirmed: copy.confirmed, failed: copy.notCompleted }[step.phase]
				const detail = [step.phase === 'upcoming' || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
				return (
					<div key={index} className={`transaction-plan-action${step.approval === undefined || final ? ' transaction-plan-action-wide' : ''}${final ? ' transaction-plan-action-final' : ''}`}>
						{step.approval !== undefined ? (
							<TokenApprovalControl
								compact
								showRequirementNotice={false}
								actionLabel={copy.fundReport}
								allowanceError={undefined}
								allowanceLoading={false}
								approvedAmount={step.approval.approvedAmount}
								guardMessage={undefined}
								disabled={!ready}
								onApprove={amount => workflow.confirmStep(index, amount)}
								pending={step.phase === 'pending'}
								pendingLabel={commonCopy.formatApprovingToken(step.approval.tokenSymbol)}
								requiredAmount={step.approval.requiredAmount}
								resetKey={`${contextKey}:${index}`}
								tokenSymbol={step.approval.tokenSymbol}
								tokenUnits={step.approval.tokenUnits}
							/>
						) : (
							<TransactionActionButton
								idleLabel={
									<>
										{step.title}
										{(step.ethValueAttoEth ?? 0n) === 0n ? undefined : (
											<>
												{' '}
												· <EthAmount value={step.ethValueAttoEth} />
											</>
										)}
										{detail === '' ? undefined : <span className='transaction-action-detail'>{detail}</span>}
									</>
								}
								pendingLabel={copy.formatPendingAction(step.title)}
								pending={active && pending}
								onClick={() => {
									if (ready) workflow.confirmStep(index)
								}}
								availability={{ disabled: !ready, reason: step.phase === 'upcoming' ? blockedReason : status }}
								showDisabledReason={false}
								tone={step.approval === undefined ? 'primary' : 'secondary'}
							/>
						)}
						{final ? (
							<div className='actions transaction-step-close'>
								<button className='secondary' type='button' onClick={onClose ?? workflow.cancel} disabled={pending}>
									{completed || error !== undefined ? commonCopy.close : commonCopy.cancel}
								</button>
							</div>
						) : undefined}
					</div>
				)
			})}
		</TransactionActionGroup>
	)
	const content = (
		<>
			<div className='transaction-step-content'>
				{funding.length === 0 ? undefined : <TransactionFundingSummary funding={funding} totalAttoEth={totalEth} outcome={outcome} />}

				{funding.length === 0 || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
				{error === undefined ? undefined : <ErrorNotice message={error} />}
			</div>
			<div className='transaction-step-actions transaction-approval-editor'>{renderTransactionActions()}</div>
		</>
	)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				{inline ? (
					content
				) : (
					<OperationModal isOpen closeDisabled={pending} title={workflow.steps.at(-1)?.title ?? current.title} onClose={onClose ?? workflow.cancel}>
						{content}
					</OperationModal>
				)}
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
