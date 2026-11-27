import { TransactionActionButton, TransactionActionButtonLockProvider, unlockedTransactionActions } from './TransactionActionButton.js'
import { TokenApprovalControl } from './TokenApprovalControl.js'
import * as copy from '../copy/transactionSteps.js'
import * as commonCopy from '../copy/common.js'
import * as transactionCopy from '../copy/transaction.js'
import { AddressValue } from './AddressValue.js'
import { ReadOnlyDetailAccordion } from './ReadOnlyDetailAccordion.js'
import { TransactionObjectContext } from './TransactionObjectContext.js'
import { TransactionDetailText } from './TransactionPresentationNotice.js'
import { TransactionHashLink } from './TransactionHashLink.js'
import { SkeletonList } from './Skeleton.js'
import { LoadingText } from './LoadingText.js'
import { UserMessage, type UserMessageTone } from './UserMessage.js'
import type { ComponentChildren } from 'preact'
import type { ActionAvailability, GlobalTransactionRow } from '../types/components.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { GlobalTransactionPresentationProvider, useGlobalTransactionPresentation } from './GlobalTransactionPresentationContext.js'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { EthAmount, TransactionFundingSummary } from './TransactionFundingSummary.js'
import { isTransactionStepInFlight, transactionSteps } from '../transactions/transactionSteps.js'
import { stopTrackingTransactionActivity, transactionActivity } from '../transactions/transactionActivityStore.js'
import { formatDuration } from '../lib/formatters.js'
import { getActiveBackend } from '../lib/activeEnvironment.js'
import * as activityCopy from '../copy/transactionActivity.js'

/** Explains a step that has no token funding to summarize, using the enclosing operation's rows for the parameters being submitted. */
function TransactionStepReview({ contractAddress, contractLabel, description, rows = [], technicalRows }: { contractAddress: Address | undefined; contractLabel: string | undefined; description: string | undefined; rows?: GlobalTransactionRow[] | undefined; technicalRows?: GlobalTransactionRow[] | undefined }) {
	let details: ComponentChildren
	if (technicalRows !== undefined) {
		details = (
			<ReadOnlyDetailAccordion title={transactionCopy.transactionDetails}>
				<TransactionObjectContext items={technicalRows.map(row => (typeof row.value === 'string' ? { ...row, value: <TransactionDetailText value={row.value} longAbbreviation /> } : row))} />
			</ReadOnlyDetailAccordion>
		)
	} else if (contractAddress !== undefined) {
		details = (
			<ReadOnlyDetailAccordion title={commonCopy.technicalDetails}>
				<dl className='global-transaction-notice-rows'>
					<div className='global-transaction-notice-row transaction-review-contract-row'>
						<dt>{transactionCopy.contract}</dt>
						<dd>
							{contractLabel === undefined ? undefined : <span>{contractLabel} </span>}
							<AddressValue address={contractAddress} longAbbreviation />
						</dd>
					</div>
				</dl>
			</ReadOnlyDetailAccordion>
		)
	}
	return (
		<>
			{description === undefined ? undefined : (
				<p className='detail'>
					<TransactionDetailText value={description} longAbbreviation />
				</p>
			)}
			<TransactionObjectContext items={rows.map(row => (typeof row.value === 'string' ? { ...row, value: <TransactionDetailText value={row.value} longAbbreviation /> } : row))} />
			{details}
		</>
	)
}

type Workflow = NonNullable<typeof transactionSteps.value>

function TransactionStepLifecycle({ current, detail, close }: { current: Workflow['steps'][number]; detail: string | undefined; close: () => void }) {
	const hash = current.hash
	const dropped = hash !== undefined && transactionActivity.value.entries.some(entry => entry.hash === hash && entry.status === 'failed' && entry.failureKind === 'dropped')
	const [now, setNow] = useState(Date.now)
	const [showTracking, setShowTracking] = useState(false)
	const stateRef = useRef<HTMLDivElement>(null)
	useLayoutEffect(() => {
		if (document.activeElement === document.body) stateRef.current?.focus()
	}, [current.phase, dropped])
	useEffect(() => {
		if (current.phase !== 'pending') return
		const interval = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(interval)
	}, [current.phase])
	if (current.phase === 'wallet') {
		const simulation = getActiveBackend().id === 'simulation'
		const message = simulation ? transactionCopy.simulationSubmissionDetail : (detail ?? transactionCopy.walletConfirmationInstruction)
		return (
			<div className='transaction-lifecycle-state' ref={stateRef} tabIndex={-1}>
				<UserMessage placement='section' announcement='polite' detail={<LoadingText announce={false}>{message}</LoadingText>} actionHint={simulation ? undefined : copy.rejectInWallet} />
			</div>
		)
	}
	if (current.phase === 'pending' && hash !== undefined && !dropped) {
		const elapsed = current.submittedAt === undefined ? undefined : formatDuration(BigInt(Math.max(0, Math.floor((now - current.submittedAt) / 1000))))
		return (
			<div className='transaction-step-content transaction-lifecycle-state' ref={stateRef} tabIndex={-1}>
				<strong>{copy.formatStepCompleted(copy.signed)}</strong>
				<div role='status'>
					<LoadingText announce={false}>{copy.waitingForConfirmation}</LoadingText>
					{elapsed === undefined ? undefined : <span aria-hidden='true'> · {elapsed}</span>}
				</div>
				{current.repriced ? <small>{copy.spedUp}</small> : undefined}
				<TransactionHashLink hash={hash} />
				<p className='detail'>{copy.safeToClose}</p>
				<details open={showTracking} onToggle={event => setShowTracking(event.currentTarget.open)}>
					<summary>{copy.takingTooLong}</summary>
					<p className='detail'>{copy.stillCanConfirm}</p>
					<p className='detail'>{copy.speedUpOrCancel}</p>
					<div className='actions'>
						<button className='secondary' type='button' onClick={() => setShowTracking(false)}>
							{activityCopy.keepTracking}
						</button>
						<button className='secondary' type='button' onClick={() => stopTrackingTransactionActivity(hash)}>
							{activityCopy.stopTracking}
						</button>
					</div>
				</details>
			</div>
		)
	}
	if (current.phase === 'confirmed' && hash !== undefined) {
		return (
			<div className='transaction-step-content transaction-lifecycle-state' ref={stateRef} tabIndex={-1}>
				<UserMessage placement='section' tone='success' announcement='polite' detail={transactionCopy.confirmed} />
				<TransactionHashLink hash={hash} />
				<TransactionObjectContext items={current.reviewRows?.map(row => ({ ...row, value: <TransactionDetailText value={row.value} longAbbreviation /> })) ?? []} />
			</div>
		)
	}
	const canceled = current.failure?.kind === 'rejected'
	const replaced = current.failure?.kind === 'replaced'
	let reason = detail ?? transactionCopy.failureReasonUnavailable
	if (dropped) reason = copy.stoppedTracking
	else if (canceled) reason = copy.walletCanceled
	else if (replaced) reason = copy.walletReplaced
	let terminalTone: UserMessageTone = 'error'
	if (canceled || replaced) terminalTone = 'neutral'
	else if (dropped || hash === undefined) terminalTone = 'warning'
	return (
		<div className='transaction-step-content transaction-lifecycle-state' ref={stateRef} tabIndex={-1}>
			<UserMessage placement='section' tone={terminalTone} announcement='polite' detail={reason} />
			{hash === undefined ? undefined : <TransactionHashLink hash={hash} />}
			<div className='actions'>
				<button className='secondary' type='button' onClick={close}>
					{commonCopy.close}
				</button>
			</div>
		</div>
	)
}

function useTransactionStepsState(retainedWorkflow?: Workflow) {
	const presentation = useGlobalTransactionPresentation()
	const workflow = retainedWorkflow ?? transactionSteps.value
	const current = workflow?.steps[workflow.activeIndex]
	const operationFailed = presentation?.tone === 'error'
	const operationError = typeof presentation?.detail === 'string' ? presentation.detail : transactionCopy.failureReasonUnavailable
	// A reverted receipt is explained by the operation's diagnosed failure when there is one.
	const error = operationFailed && (current?.failure === undefined || current.failure.kind === 'reverted') ? operationError : current?.failure?.message
	const pending = error === undefined && (workflow?.steps.some(isTransactionStepInFlight) ?? false)
	return { current, error, pending, presentation, workflow }
}

type TransactionStepsActionsProps = {
	/** False when the surrounding flow has no way back (the wallet is where the user declines); hides the Cancel/Dismiss control. */
	cancelable?: boolean
	contextKey: string
	includeWrapAction?: boolean
	finalActionLabel?: string | undefined
	/** Move focus into the actions when the review replaced the control the user activated. */
	focusOnMount?: boolean
	/** Keep the actions scrolled into view as they change state when the review sits in page flow under the transaction tray. */
	keepActionsVisible?: boolean
	onClose?: (() => void) | undefined
	/** A detached failed plan stays visible, but cannot send transactions through its old controller. */
	retainedWorkflow?: Workflow | undefined
	retryAction?: { onClick: () => void; availability: ActionAvailability } | undefined
}

/** The review's confirm, approval, and cancel controls. */
function TransactionStepsActions({ cancelable = true, contextKey, includeWrapAction = false, finalActionLabel, focusOnMount = false, keepActionsVisible = false, onClose, retainedWorkflow, retryAction }: TransactionStepsActionsProps) {
	const { error, pending, presentation, workflow } = useTransactionStepsState(retainedWorkflow)
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
	const reviewCheck = workflow.reviewCheck
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const fundingReason = funding.length > 0 ? copy.fundingRequired : copy.prerequisitesRequired
	const blockedReason = pending ? undefined : fundingReason
	const prerequisiteReason = pending ? undefined : copy.prerequisitesRequired
	const approvalBlockedReason = retainedWorkflow === undefined ? prerequisiteReason : copy.notCompleted
	// Finished steps stay in place, disabled and labelled with their result, so the plan never loses a row as it advances.
	const getCompletedLabel = (step: (typeof workflow.steps)[number]) => {
		const approvalSatisfied = step.approval !== undefined && step.approval.approvedAmount !== undefined && step.approval.requiredAmount <= step.approval.approvedAmount
		if (approvalSatisfied && step.approval !== undefined && (step.phase === 'confirmed' || step.phase === 'skipped')) return copy.formatStepCompleted(copy.formatTokenApproved(step.approval.tokenSymbol))
		if (step.phase === 'confirmed') return copy.formatStepCompleted(transactionCopy.completedAction(step.title))
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
							{includeWrapAction && !workflow.steps.some(step => step.title === copy.wrapEthIntoWeth) ? (
								<div className='transaction-plan-action transaction-plan-action-wide'>
									<TransactionActionButton idleLabel={copy.wrapEthIntoWeth} pendingLabel={copy.formatPendingAction(copy.wrapEthIntoWeth)} availability={{ disabled: true, reason: copy.skipped }} onClick={() => undefined} tone='secondary' />
								</div>
							) : undefined}
							{workflow.steps.map((step, index) => {
								const completedLabel = getCompletedLabel(step)
								const active = index === workflow.activeIndex
								const final = index === workflow.steps.length - 1
								const ready = retainedWorkflow === undefined && step.phase === 'review' && !pending && error === undefined && reviewCheck === undefined
								const retry = final ? retryAction : undefined
								const approvalBlocked = completedLabel === undefined && (retainedWorkflow !== undefined || step.phase === 'upcoming')
								const status = { skipped: copy.skipped, upcoming: step.optional ? copy.ifNeeded : undefined, review: undefined, wallet: undefined, pending: undefined, confirmed: transactionCopy.confirmed, failed: copy.notCompleted }[step.phase]
								let stepReason = step.phase === 'upcoming' ? blockedReason : status
								if (active && reviewCheck !== undefined) stepReason = reviewCheck.status === 'checking' ? copy.checkingCurrentState : reviewCheck.message
								let approvalReason = approvalBlocked ? approvalBlockedReason : undefined
								if (workflow.showLifecycle && active && reviewCheck !== undefined) approvalReason = stepReason
								const retryReason = retry === undefined ? undefined : (retry.availability.reason ?? copy.notCompleted)
								// Plans derive unnamed approvals from an oracle report's token funding; a named one, such as a vault deposit, can unlock
								// any step, so its shortfall hint uses neutral wording.
								const approvalActionLabel = step.approval?.purpose === undefined ? copy.fundReport : copy.continuing
								const detail = [step.phase === 'upcoming' || step.spender !== undefined || step.paidFrom !== undefined || step.approval !== undefined ? undefined : step.amount, status].filter(value => value !== undefined).join(' · ')
								return (
									<div key={index} className={`transaction-plan-action${step.approval === undefined || final ? ' transaction-plan-action-wide' : ''}${final ? ' transaction-plan-action-final' : ''}`} {...(active && pending ? { ref: pendingActionRef, tabIndex: -1 } : {})}>
										{step.approval !== undefined ? (
											<TokenApprovalControl
												approvalPurpose={step.approval.purpose}
												compact
												completedLabel={completedLabel}
												showRequirementNotice={false}
												actionLabel={approvalActionLabel}
												allowanceError={undefined}
												allowanceLoading={false}
												approvedAmount={step.approval.approvedAmount}
												guardMessage={approvalReason}
												disabled={!ready}
												onApprove={amount => workflow.confirmStep(index, amount)}
												pending={isTransactionStepInFlight(step)}
												pendingLabel={commonCopy.formatApprovingToken(step.approval.tokenSymbol)}
												requiredAmount={step.approval.requiredAmount}
												recommendedAmount={step.approval.recommendedAmount}
												resetKey={`${contextKey}:${index}`}
												tokenSymbol={step.approval.tokenSymbol}
												tokenUnits={step.approval.tokenUnits}
											/>
										) : (
											<TransactionActionButton
												ariaLabel={completedLabel ?? (final ? finalActionLabel : undefined) ?? step.title}
												className={completedLabel === undefined ? '' : 'tx-action-completed'}
												idleLabel={
													completedLabel ?? (
														<>
															{(final ? finalActionLabel : undefined) ?? step.title}
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
												availability={{ disabled: !ready, reason: completedLabel ?? retryReason ?? stepReason }}
												showDisabledReason={(workflow.showLifecycle && !ready && completedLabel === undefined && reviewCheck?.status !== 'failed' && reviewCheck?.status !== 'changed') || (final && (step.phase === 'upcoming' || retry?.availability.disabled === true))}
												tone={step.approval === undefined ? 'primary' : 'secondary'}
											/>
										)}
										{final && (retry !== undefined || (cancelable && !terminal)) ? (
											<div className='actions transaction-step-close'>
												{retry === undefined ? undefined : <TransactionActionButton idleLabel={commonCopy.retry} pendingLabel={commonCopy.retrying} availability={retry.availability} onClick={retry.onClick} tone='secondary' />}
												{cancelable ? (
													<button className='secondary' type='button' onClick={onClose ?? workflow.cancel} disabled={pending}>
														{commonCopy.cancel}
													</button>
												) : undefined}
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
	actionsFirst?: boolean

	heading?: string | undefined
}

export function TransactionStepsContent({ actionsFirst = false, cancelable = true, contextKey, includeWrapAction = false, finalActionLabel, focusOnMount = false, heading, keepActionsVisible = false, onClose, retainedWorkflow, retryAction }: TransactionStepsContentProps) {
	const { current, error, presentation, workflow } = useTransactionStepsState(retainedWorkflow)
	if (workflow === undefined || current === undefined) return undefined
	const completed = workflow.steps.every(step => step.phase === 'confirmed' || step.phase === 'skipped')
	if (workflow.showLifecycle && (current.phase === 'wallet' || current.phase === 'pending' || current.phase === 'failed' || (completed && current.phase === 'confirmed'))) {
		return <TransactionStepLifecycle current={current} detail={current.phase === 'wallet' && presentation?.tone === 'awaiting-wallet' && typeof presentation.detail === 'string' ? presentation.detail : error} close={onClose ?? workflow.cancel} />
	}
	const funding = workflow.steps.flatMap(step => step.tokenFunding ?? [])
	const outcome = workflow.steps.find(step => step.oracleOutcome !== undefined)?.oracleOutcome
	const totalEth = workflow.steps.reduce((sum, step) => sum + (step.phase === 'skipped' ? 0n : (step.ethValueAttoEth ?? 0n)), 0n)
	const { reviewCheck } = workflow
	let reviewContent: ComponentChildren
	if (reviewCheck?.status === 'checking') {
		reviewContent = <SkeletonList label={copy.checkingCurrentState} rows={Math.max(3, current.reviewRows?.length ?? 0)} />
	} else if (reviewCheck !== undefined) {
		reviewContent = (
			<UserMessage
				placement='section'
				tone='warning'
				announcement='polite'
				detail={reviewCheck.message}
				actions={
					<button className='secondary' type='button' onClick={reviewCheck.retry}>
						{reviewCheck.status === 'changed' ? copy.reviewAgain : copy.tryAgain}
					</button>
				}
			/>
		)
	} else if (funding.length === 0) {
		reviewContent = (
			<TransactionStepReview
				contractAddress={current.contractAddress}
				contractLabel={current.contractLabel}
				description={completed ? undefined : current.description}
				technicalRows={current.technicalRows}
				rows={[
					...(current.paidFrom === undefined
						? []
						: [
								{ label: commonCopy.amount, value: current.amount },
								{ label: transactionCopy.paidFrom, value: current.paidFrom },
							]),
					...(current.reviewRows ?? []),
					...(presentation?.rows ?? []),
				]}
			/>
		)
	} else {
		reviewContent = <TransactionFundingSummary funding={funding} totalAttoEth={totalEth} outcome={outcome} />
	}
	const actions = (
		<TransactionStepsActions
			cancelable={cancelable}
			contextKey={contextKey}
			includeWrapAction={includeWrapAction || funding.some(token => token.tokenSymbol === commonCopy.weth)}
			finalActionLabel={finalActionLabel}
			focusOnMount={focusOnMount}
			keepActionsVisible={keepActionsVisible}
			onClose={onClose}
			retainedWorkflow={retainedWorkflow}
			retryAction={retryAction}
		/>
	)
	return (
		<>
			{heading === undefined ? undefined : (
				<div className='transaction-review-header'>
					<h4>{heading}</h4>
				</div>
			)}
			{actionsFirst ? actions : undefined}
			<div className='transaction-step-content'>
				{reviewContent}
				{funding.length === 0 || completed ? undefined : <p className='detail transaction-funding-note'>{copy.fundingDetail}</p>}
			</div>
			{actionsFirst ? undefined : actions}
		</>
	)
}
