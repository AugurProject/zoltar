import { TransactionActionButton, TransactionActionButtonLockProvider, unlockedTransactionActions } from './TransactionActionButton.js'
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
import { isTransactionStepInFlight, transactionSteps } from '../transactions/transactionSteps.js'

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
	// A reverted receipt is explained by the operation's diagnosed failure when there is one.
	const error = operationFailed && (current?.failure === undefined || current.failure.kind === 'reverted') ? operationError : current?.failure?.message
	const pending = error === undefined && (workflow?.steps.some(isTransactionStepInFlight) ?? false)
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

/** The review's confirm, approval, and cancel controls. */
function TransactionStepsActions({ cancelable = true, contextKey, focusOnMount = false, keepActionsVisible = false, onClose }: TransactionStepsActionsProps) {
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
	const prerequisiteReason = pending ? copy.transactionPending : copy.prerequisitesRequired
	// Finished steps stay in place, disabled and labelled with their result, so the plan never loses a row as it advances.
	const getCompletedLabel = (step: (typeof workflow.steps)[number]) => {
		const approvalSatisfied = step.approval !== undefined && step.approval.approvedAmount !== undefined && step.approval.requiredAmount <= step.approval.approvedAmount
		if (approvalSatisfied && step.approval !== undefined && (step.phase === 'confirmed' || step.phase === 'skipped')) return copy.formatStepCompleted(copy.formatTokenApproved(step.approval.tokenSymbol))
		if (step.phase === 'confirmed') return copy.formatStepCompleted(step.title === copy.wrapEthIntoWeth ? copy.ethWrapped : step.title)
		return undefined
	}
	return (
		<GlobalTransactionPresentationProvider transaction={undefined}>
			<TransactionActionButtonLockProvider lock={unlockedTransactionActions}>
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
						<div className='actions' aria-live='polite'>
							{workflow.steps.map((step, index) => {
								const completedLabel = getCompletedLabel(step)
								const active = index === workflow.activeIndex
								const final = index === workflow.steps.length - 1
								const ready = step.phase === 'review' && !pending && error === undefined
								const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, wallet: undefined, pending: undefined, confirmed: transactionCopy.confirmed, failed: copy.notCompleted }[step.phase]
								const detail = [step.phase === 'upcoming' || step.spender !== undefined || step.paidFrom !== undefined || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
								return (
									<div key={index} className={`transaction-plan-action${step.approval === undefined || final ? ' transaction-plan-action-wide' : ''}${final ? ' transaction-plan-action-final' : ''}`} {...(active && pending ? { ref: pendingActionRef, tabIndex: -1 } : {})}>
										{step.approval !== undefined ? (
											<TokenApprovalControl
												compact
												completedLabel={completedLabel}
												showRequirementNotice={false}
												actionLabel={copy.fundReport}
												allowanceError={undefined}
												allowanceLoading={false}
												approvedAmount={step.approval.approvedAmount}
												guardMessage={step.phase === 'upcoming' && completedLabel === undefined ? prerequisiteReason : undefined}
												disabled={!ready}
												onApprove={amount => workflow.confirmStep(index, amount)}
												pending={isTransactionStepInFlight(step)}
												pendingLabel={commonCopy.formatApprovingToken(step.approval.tokenSymbol)}
												requiredAmount={step.approval.requiredAmount}
												resetKey={`${contextKey}:${index}`}
												tokenSymbol={step.approval.tokenSymbol}
												tokenUnits={step.approval.tokenUnits}
											/>
										) : (
											<TransactionActionButton
												className={completedLabel === undefined ? '' : 'tx-action-completed'}
												idleLabel={
													completedLabel ?? (
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
													)
												}
												pendingLabel={copy.formatPendingAction(step.title)}
												pending={active && pending}
												onClick={() => {
													if (ready) workflow.confirmStep(index)
												}}
												availability={{ disabled: !ready, reason: completedLabel ?? (step.phase === 'upcoming' ? blockedReason : status) }}
												showDisabledReason={final && step.phase === 'upcoming'}
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
	heading?: string | undefined
}

export function TransactionStepsContent({ cancelable = true, contextKey, focusOnMount = false, heading, keepActionsVisible = false, onClose }: TransactionStepsContentProps) {
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
				{funding.length === 0 ? (
					<TransactionStepReview
						contractAddress={current.contractAddress}
						contractLabel={current.contractLabel}
						description={completed ? undefined : current.description}
						rows={[
							...(current.paidFrom === undefined
								? []
								: [
										{ label: transactionCopy.amount, value: current.amount },
										{ label: transactionCopy.paidFrom, value: current.paidFrom },
									]),
							...(presentation?.rows ?? []),
						]}
					/>
				) : (
					<TransactionFundingSummary funding={funding} totalAttoEth={totalEth} outcome={outcome} />
				)}
				{funding.length === 0 || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
			</div>
			<TransactionStepsActions cancelable={cancelable} contextKey={contextKey} focusOnMount={focusOnMount} keepActionsVisible={keepActionsVisible} onClose={onClose} />
		</>
	)
}
