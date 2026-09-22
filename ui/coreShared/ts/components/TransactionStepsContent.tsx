import { TransactionActionButton, TransactionActionButtonLockProvider } from './TransactionActionButton.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import * as copy from '../copy/transactionSteps.js'
import * as commonCopy from '../copy/common.js'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { useEffect, useRef } from 'preact/hooks'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'
import { InlineHint } from './InlineHint.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { transactionSteps } from '../transactions/transactionSteps.js'

export function TransactionStepsContent({ contextKey, onClose, onBack }: { contextKey: string; onClose?: () => void; onBack?: () => void }) {
	const presentation = useGlobalTransactionPresentation()
	const errorRef = useRef<HTMLDivElement>(null)
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : copy.requirementsFailed
	const error = operationFailed && (current?.error === undefined || current?.error === 'Transaction reverted.') ? operationError : current?.error
	useEffect(() => {
		if (error !== undefined) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
	}, [error])
	if (workflow === undefined || current === undefined) return undefined
	const pending = error === undefined && workflow.steps.some(step => step.phase === 'pending')
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? copy.transactionPending : fundingReason
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n)
	const renderTransactionActions = () => (
		<div className='tx-action-group'>
			<div className='tx-action-feedback' ref={errorRef}>
				{error === undefined ? undefined : <InlineHint message={error} role='alert' />}
			</div>
			<div className='actions'>
				{workflow.steps.map((step, index) => {
					const active = index === workflow.activeIndex
					const final = index === workflow.steps.length - 1
					const ready = step.phase === 'review' && !pending && error === undefined
					const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, pending: undefined, confirmed: undefined, failed: copy.notCompleted }[step.phase]
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
									{error !== undefined && onBack !== undefined ? (
										<button className='secondary' type='button' onClick={onBack}>
											{copy.backToForm}
										</button>
									) : (
										<button className='secondary' type='button' onClick={onClose ?? workflow.cancel} disabled={pending}>
											{completed || error !== undefined ? commonCopy.close : commonCopy.cancel}
										</button>
									)}
								</div>
							) : undefined}
							<div className='transaction-step-hash'>{step.hash === undefined ? undefined : <TransactionHashLink hash={step.hash} />}</div>
						</div>
					)
				})}
			</div>
		</div>
	)
	const content = (
		<>
			{funding.length === 0 ? undefined : (
				<div className='transaction-step-content'>
					<TransactionFundingSummary funding={funding} totalAttoEth={totalEth} outcome={outcome} />
					{completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
				</div>
			)}
			<div className={`transaction-step-actions transaction-approval-editor${funding.length === 0 ? ' transaction-step-actions-standalone' : ''}`}>{renderTransactionActions()}</div>
		</>
	)
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>{content}</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}
