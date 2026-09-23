import { TransactionActionButton, TransactionActionButtonLockProvider } from './TransactionActionButton.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import * as copy from '../copy/transactionSteps.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { AddressValue } from './AddressValue.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionObjectContext } from './TransactionObjectContext.js'
import type { GlobalTransactionPresentation, GlobalTransactionRow } from '../types/components.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { useEffect, useRef } from 'preact/hooks'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'
import { TransactionPresentationNotice } from './TransactionPresentationNotice.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { transactionSteps } from '../transactions/transactionSteps.js'
import { Badge } from './Badge.js'

/** Explains a step that has no token funding to summarize, using the enclosing operation's rows for the parameters being submitted. */
function TransactionStepReview({ contractAddress, contractLabel, description, rows = [] }: { contractAddress: Address | undefined; contractLabel: string | undefined; description: string | undefined; rows?: GlobalTransactionRow[] | undefined }) {
	return (
		<>
			{description === undefined ? undefined : <p className='detail'>{description}</p>}
			<TransactionObjectContext items={rows} />
			{contractAddress === undefined ? undefined : (
				<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
					<dl className='global-transaction-notice-rows'>
						<div className='global-transaction-notice-row'>
							<dt>{transactionCopy.contract}</dt>
							<dd>
								{contractLabel === undefined ? (
									<AddressValue address={contractAddress} copyable={false} />
								) : (
									<>
										{contractLabel} <AddressValue address={contractAddress} copyable={false} />
									</>
								)}
							</dd>
						</div>
					</dl>
				</ReadOnlyDetailAccordion>
			)}
		</>
	)
}

function getFailurePresentation(error: string | undefined, presentation: GlobalTransactionPresentation | undefined, stepTitle: string | undefined): GlobalTransactionPresentation | undefined {
	if (error === undefined) return undefined
	if (presentation !== undefined) return { ...presentation, detail: error }
	return { detail: error, title: stepTitle ?? error, tone: 'error' }
}

function useTransactionStepsState() {
	const presentation = useGlobalTransactionPresentation()
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : copy.requirementsFailed
	const error = operationFailed && (current?.error === undefined || current?.error === 'Transaction reverted.') ? operationError : current?.error
	// Failures use the same notice as the transaction tray and dialogs, including the technical rows needed to debug them.
	const failure = getFailurePresentation(error, operationFailed ? presentation : undefined, current?.title)
	const pending = error === undefined && (workflow?.steps.some(step => step.phase === 'pending') ?? false)
	return { current, error, failure, pending, presentation, workflow }
}

type TransactionStepsActionsProps = {
	/** False when the surrounding flow has no way back (the wallet is where the user declines); hides the Cancel/Dismiss control. */
	cancelable?: boolean
	contextKey: string
	/** Move focus into the actions when the review replaced the control the user activated. */
	focusOnMount?: boolean
	/** Keep the actions scrolled into view as they change state when the review sits in page flow under the transaction tray. */
	keepActionsVisible?: boolean
	onClose?: (() => void) | undefined
	/** Keep a completed multi-step result beside its initiating action until the user dismisses it. */
	showCompletedResult?: boolean
}

/** The review's confirm, approval, and cancel controls; a dialog form can host them in its own action row. */
export function TransactionStepsActions({ cancelable = true, contextKey, focusOnMount = false, keepActionsVisible = false, onClose, showCompletedResult = false }: TransactionStepsActionsProps) {
	const { error, failure, pending, presentation, workflow } = useTransactionStepsState()
	const errorRef = useRef<HTMLDivElement>(null)
	const successRef = useRef<HTMLDivElement>(null)
	const actionsRef = useRef<HTMLDivElement>(null)
	const completed = workflow?.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped') ?? false
	const success = showCompletedResult && completed && (presentation?.tone === 'success' || presentation?.tone === 'warning') && presentation.hash !== undefined && workflow?.steps.at(-1)?.hash === presentation.hash ? presentation : undefined
	const awaitingResult = showCompletedResult && completed && success === undefined && presentation?.tone !== 'error'
	useEffect(() => {
		if (error !== undefined) errorRef.current?.scrollIntoView?.({ block: 'nearest' })
	}, [error])
	useEffect(() => {
		if (success !== undefined) successRef.current?.scrollIntoView?.({ block: 'center' })
	}, [success?.hash])
	// The tray grows with each presentation update, so wait for that layout and center rather than edge-align.
	useEffect(() => {
		if (!keepActionsVisible || typeof requestAnimationFrame !== 'function') return
		let frame: number | undefined
		frame = requestAnimationFrame(() => {
			frame = requestAnimationFrame(() => actionsRef.current?.scrollIntoView?.({ block: 'center' }))
		})
		return () => {
			if (frame !== undefined) cancelAnimationFrame(frame)
		}
	}, [keepActionsVisible, pending, presentation])
	useEffect(() => {
		if (!focusOnMount) return
		const actions = actionsRef.current
		if (actions === null || actions.contains(document.activeElement)) return
		actions.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')?.focus()
	}, [focusOnMount])
	if (workflow === undefined || workflow.steps[workflow.activeIndex] === undefined) return undefined
	const terminal = completed || error !== undefined
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? copy.transactionPending : fundingReason
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<div className='transaction-step-actions transaction-approval-editor' ref={actionsRef}>
					<div className='tx-action-group'>
						<div className='tx-action-feedback' ref={errorRef}>
							{failure === undefined ? undefined : <TransactionPresentationNotice className='transaction-step-failure' transaction={failure} />}
						</div>
						<div className='actions'>
							{workflow.steps.map((step, index) => {
								const active = index === workflow.activeIndex
								const final = index === workflow.steps.length - 1
								const showAction = !final || success === undefined
								const ready = step.phase === 'review' && !pending && error === undefined
								const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, pending: undefined, confirmed: transactionCopy.confirmed, failed: copy.notCompleted }[step.phase]
								const detail = [step.phase === 'upcoming' || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
								return (
									<div key={index} className={`transaction-plan-action${step.approval === undefined || final ? ' transaction-plan-action-wide' : ''}${final ? ' transaction-plan-action-final' : ''}${final && success !== undefined ? ' transaction-plan-action-complete' : ''}`}>
										{!final || success === undefined ? undefined : (
											<div className='transaction-step-success-feedback' ref={successRef}>
												<TransactionPresentationNotice className='transaction-step-success' transaction={success} />
											</div>
										)}
										{showAction &&
											(step.approval !== undefined ? (
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
											))}
										{step.approval === undefined || step.phase !== 'confirmed' ? undefined : (
											<div className='transaction-step-confirmed'>
												<Badge tone='ok'>{transactionCopy.confirmed}</Badge>
											</div>
										)}
										{final && cancelable ? (
											<div className='actions transaction-step-close'>
												<button className={terminal ? 'primary' : 'secondary'} type='button' onClick={onClose ?? workflow.cancel} disabled={pending || awaitingResult}>
													{terminal ? transactionCopy.dismiss : commonCopy.cancel}
												</button>
											</div>
										) : undefined}
										{final && success !== undefined ? undefined : <div className='transaction-step-hash'>{step.hash === undefined ? undefined : <TransactionHashLink hash={step.hash} />}</div>}
									</div>
								)
							})}
						</div>
					</div>
				</div>
			</TransactionActionButtonLockProvider>
		</GlobalTransactionPresentationProvider>
	)
}

type TransactionStepsContentProps = TransactionStepsActionsProps & {
	/** `external` when a dialog form hosts the actions in its own row through `ReviewActionsSlotContext`. */
	actions?: 'inline' | 'external'
	heading?: string | undefined
}

export function TransactionStepsContent({ actions = 'inline', cancelable = true, contextKey, focusOnMount = false, heading, keepActionsVisible = false, onClose, showCompletedResult = false }: TransactionStepsContentProps) {
	const { current, presentation, workflow } = useTransactionStepsState()
	if (workflow === undefined || current === undefined) return undefined
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n)
	return (
		<>
			{heading === undefined ? undefined : (
				<div className='transaction-review-header'>
					<h4>{heading}</h4>
				</div>
			)}
			<div className='transaction-step-content'>
				{funding.length === 0 ? <TransactionStepReview contractAddress={current.contractAddress} contractLabel={current.contractLabel} description={completed ? undefined : current.description} rows={presentation?.rows} /> : <TransactionFundingSummary funding={funding} totalAttoEth={totalEth} outcome={outcome} />}
				{funding.length === 0 || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
			</div>
			{actions === 'inline' ? <TransactionStepsActions cancelable={cancelable} contextKey={contextKey} focusOnMount={focusOnMount} keepActionsVisible={keepActionsVisible} onClose={onClose} showCompletedResult={showCompletedResult} /> : undefined}
		</>
	)
}
