import { TransactionActionButton, TransactionActionButtonLockProvider } from './TransactionActionButton.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import * as copy from '../copy/transactionSteps.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { AddressValue } from './AddressValue.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionObjectContext } from './TransactionObjectContext.js'
import type { GlobalTransactionRow } from '../types/components.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'
import { transactionSteps } from '../transactions/transactionSteps.js'

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

function useTransactionStepsState() {
	const presentation = useGlobalTransactionPresentation()
	const workflow = transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : copy.requirementsFailed
	const error = operationFailed && (current?.error === undefined || current?.error === 'Transaction reverted.') ? operationError : current?.error
	const pending = error === undefined && (workflow?.steps.some(step => step.phase === 'pending') ?? false)
	return { current, error, pending, presentation, workflow }
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
}

/** The review's confirm, approval, and cancel controls; a dialog form can host them in its own action row. */
export function TransactionStepsActions({ cancelable = true, contextKey, focusOnMount = false, keepActionsVisible = false, onClose }: TransactionStepsActionsProps) {
	const { error, pending, presentation, workflow } = useTransactionStepsState()
	const actionsRef = useRef<HTMLDivElement>(null)
	const pendingActionRef = useRef<HTMLDivElement>(null)
	const focusWasInActions = useRef(false)
	const completed = workflow?.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped') ?? false
	// Wait for the review layout before keeping the next action centered.
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
	useLayoutEffect(() => {
		if (!focusWasInActions.current) return
		const active = document.activeElement
		if (active instanceof HTMLElement && active !== document.body && active.isConnected && !active.matches(':disabled')) return
		pendingActionRef.current?.focus()
	}, [pending])
	if (workflow === undefined || workflow.steps[workflow.activeIndex] === undefined) return undefined
	const terminal = completed || error !== undefined
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? copy.transactionPending : fundingReason
	const completedSteps = workflow.steps.flatMap((step, index) => {
		if (index === workflow.steps.length - 1 && step.phase === 'confirmed') return []
		const approvalSatisfied = step.approval !== undefined && step.approval.approvedAmount !== undefined && step.approval.requiredAmount <= step.approval.approvedAmount
		if (approvalSatisfied && step.approval !== undefined && (step.phase === 'confirmed' || step.phase === 'skipped')) return [{ index, label: copy.formatTokenApproved(step.approval.tokenSymbol), approval: true }]
		if (step.phase === 'confirmed') return [{ index, label: step.title === copy.wrapEthIntoWeth ? copy.ethWrapped : step.title, approval: false }]
		return []
	})
	const completedIndices = new Set(completedSteps.map(step => step.index))
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider locked={false}>
				<div
					className='transaction-step-actions transaction-approval-editor'
					ref={actionsRef}
					onFocusIn={() => {
						focusWasInActions.current = true
					}}
					onFocusOut={event => {
						if (event.relatedTarget instanceof Node && event.relatedTarget !== document.body && !actionsRef.current?.contains(event.relatedTarget)) focusWasInActions.current = false
					}}
				>
					<div className='tx-action-group'>
						<div className='tx-action-feedback' />
						{completedSteps.length === 0 ? undefined : (
							<div className='transaction-completed-steps' aria-live='polite'>
								{completedSteps.map(step => (
									<div key={step.index} className={`transaction-step-completed${step.approval ? ' transaction-approval-satisfied' : ''}`}>
										<span>{step.label} ✓</span>
									</div>
								))}
							</div>
						)}
						<div className='actions'>
							{workflow.steps.map((step, index) => {
								if (completedIndices.has(index) || step.phase === 'confirmed') return undefined
								const active = index === workflow.activeIndex
								const final = index === workflow.steps.length - 1
								const ready = step.phase === 'review' && !pending && error === undefined
								const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, pending: undefined, confirmed: transactionCopy.confirmed, failed: copy.notCompleted }[step.phase]
								const detail = [step.phase === 'upcoming' || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
								return (
									<div key={index} className={`transaction-plan-action${step.approval === undefined || final ? ' transaction-plan-action-wide' : ''}${final ? ' transaction-plan-action-final' : ''}`} {...(active && pending ? { ref: pendingActionRef, tabIndex: -1 } : {})}>
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
										{final && cancelable && !terminal ? (
											<div className='actions transaction-step-close'>
												<button className='secondary' type='button' onClick={onClose ?? workflow.cancel} disabled={pending}>
													{commonCopy.cancel}
												</button>
											</div>
										) : undefined}
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

export function TransactionStepsContent({ actions = 'inline', cancelable = true, contextKey, focusOnMount = false, heading, keepActionsVisible = false, onClose }: TransactionStepsContentProps) {
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
			{actions === 'inline' ? <TransactionStepsActions cancelable={cancelable} contextKey={contextKey} focusOnMount={focusOnMount} keepActionsVisible={keepActionsVisible} onClose={onClose} /> : undefined}
		</>
	)
}
