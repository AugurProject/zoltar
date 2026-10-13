import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as copy from '../../../copy/poolWorkspace.js'
import type { PoolActionItem } from '../lib/poolActions.js'
import { POOL_LIFECYCLE_STEPS, type PoolLifecycleStep } from '../lib/poolLifecycle.js'
import type { SelectedPoolView } from '../lib/securityPoolWorkflow.js'

function getStepState(index: number, currentIndex: number, skipped: boolean) {
	if (index < currentIndex) return skipped ? 'skipped' : 'completed'
	return index === currentIndex ? 'current' : 'upcoming'
}

/**
 * Operational → Escalation → Fork / Migration → Truth auction → Settled as a segmented bar under the current stage's
 * name. Above full desktop width (80rem) each stage is named under its segment so the whole lifecycle reads at a glance;
 * narrower segments keep the name as a hover title. The current stage is marked with `aria-current`. Stages the pool
 * passed over (`skippedSteps`), such as the fork stages of a pool that settled without a fork, are drawn hollow rather
 * than filled, so the bar never claims the pool went through them.
 */
export function PoolLifecycleStepper({ skippedSteps = [], step }: { skippedSteps?: readonly PoolLifecycleStep[]; step: PoolLifecycleStep | undefined }) {
	if (step === undefined) return undefined
	const currentIndex = POOL_LIFECYCLE_STEPS.indexOf(step)
	const currentLabel = copy.lifecycleStepLabels[step]
	return (
		<nav className='pool-lifecycle' aria-label={copy.poolStage}>
			<p className='pool-lifecycle-summary' aria-hidden='true'>
				<span className='pool-lifecycle-summary-label'>{copy.poolStage}</span>
				<span className='pool-lifecycle-summary-value'>
					<strong>{currentLabel}</strong> <span className='pool-lifecycle-position'>{copy.lifecycleStepPosition(currentIndex + 1, POOL_LIFECYCLE_STEPS.length)}</span>
				</span>
			</p>
			<ol className='pool-lifecycle-steps'>
				{POOL_LIFECYCLE_STEPS.map((candidate, index) => {
					const state = getStepState(index, currentIndex, skippedSteps.includes(candidate))
					const label = copy.lifecycleStepLabels[candidate]
					return (
						<li key={candidate} className={state} title={state === 'skipped' ? copy.formatSkippedLifecycleStep(label) : label} aria-current={state === 'current' ? 'step' : undefined}>
							<span className='pool-lifecycle-step-label'>
								{label}
								{state === 'skipped' ? <span className='visually-hidden'> ({copy.lifecycleStepSkipped})</span> : undefined}
							</span>
						</li>
					)
				})}
			</ol>
		</nav>
	)
}

function getActionLabel(item: PoolActionItem) {
	if (item.id === 'reviewStagedOperations' && item.count !== undefined) return copy.stagedOperationCount(item.count)
	return copy.actionLabels[item.id]
}

/** The label, amount, and deadline of one action row; `context` adds a line such as the pool the action belongs to. A deadline the header strip already shows is not repeated. */
function PoolActionRow({ context, control, currentTimestamp, deadlineShownInStrip, item }: { context?: ComponentChildren; control: ComponentChildren; currentTimestamp: bigint | undefined; deadlineShownInStrip?: bigint | undefined; item: PoolActionItem }) {
	return (
		<li className={`pool-action-item ${item.tone}`}>
			<div className='pool-action-copy'>
				<span className='pool-action-label'>{getActionLabel(item)}</span>
				{item.amount === undefined ? undefined : <CurrencyValue className='pool-action-amount' value={item.amount.value} suffix={item.amount.unit} />}
				{item.deadline === undefined || item.deadline === deadlineShownInStrip ? undefined : (
					<span className='pool-action-deadline'>
						{`${copy.deadlineLabel} `}
						<TimestampValue timestamp={item.deadline} {...(currentTimestamp === undefined ? {} : { currentTimestamp })} />
					</span>
				)}
				{context === undefined ? undefined : <span className='pool-action-context'>{context}</span>}
			</div>
			{control === undefined ? undefined : <div className='pool-action-control'>{control}</div>}
		</li>
	)
}

/** Next actions retain position, deadline, and exception context even when their tab is open: every row stays, so the card never changes height between tabs. */
export function PoolActionCard({ currentTimestamp, currentView, deadlineShownInStrip, items, onChange }: { currentTimestamp: bigint | undefined; currentView: SelectedPoolView | undefined; deadlineShownInStrip?: bigint | undefined; items: readonly PoolActionItem[]; onChange: (view: SelectedPoolView) => void }) {
	return (
		<section className='pool-action-card' aria-labelledby='pool-action-card-heading'>
			<h3 id='pool-action-card-heading'>{copy.nextActions}</h3>
			{items.length === 0 ? (
				<UserMessage className='detail' detail={copy.nothingToDoNow} />
			) : (
				<ul className='pool-action-list'>
					{items.map(item => {
						const { tab } = item
						let control: ComponentChildren = undefined
						// A row for the open tab keeps its control slot, marked as already shown below, so rows do not jump when tabs change.
						if (tab !== undefined && tab === currentView) control = <span className='pool-action-current'>{copy.actionShownBelow}</span>
						else if (tab !== undefined)
							control = (
								<button type='button' className='secondary pool-action-open' onClick={() => onChange(tab)}>
									<span>{copy.actionButtonLabels[tab]}</span>
									<span aria-hidden='true'>→</span>
								</button>
							)
						return <PoolActionRow control={control} currentTimestamp={currentTimestamp} deadlineShownInStrip={deadlineShownInStrip} item={item} key={item.id} />
					})}
				</ul>
			)}
		</section>
	)
}
