import type { ComponentChildren } from 'preact'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as copy from '../../../copy/poolWorkspace.js'
import type { PoolActionItem } from '../lib/poolActions.js'
import { POOL_LIFECYCLE_STEPS, type PoolLifecycleStep } from '../lib/poolLifecycle.js'
import type { SelectedPoolView } from '../lib/securityPoolWorkflow.js'

function getStepState(index: number, currentIndex: number) {
	if (index < currentIndex) return 'completed'
	return index === currentIndex ? 'current' : 'upcoming'
}

/** Operational → Escalation → Fork / Migration → Truth auction → Settled, with the current stage marked for assistive technology. */
export function PoolLifecycleStepper({ step }: { step: PoolLifecycleStep | undefined }) {
	if (step === undefined) return undefined
	const currentIndex = POOL_LIFECYCLE_STEPS.indexOf(step)
	const currentLabel = copy.lifecycleStepLabels[step]
	return (
		<nav className='pool-lifecycle' aria-label={copy.poolStage}>
			<ol className='pool-lifecycle-steps'>
				{POOL_LIFECYCLE_STEPS.map((candidate, index) => {
					const state = getStepState(index, currentIndex)
					return (
						<li key={candidate} className={state} aria-current={state === 'current' ? 'step' : undefined}>
							<span className='pool-lifecycle-marker' aria-hidden='true'>
								{state === 'completed' ? '✓' : (index + 1).toString()}
							</span>
							<span className='pool-lifecycle-label'>{copy.lifecycleStepLabels[candidate]}</span>
						</li>
					)
				})}
			</ol>
			<p className='pool-lifecycle-mobile'>{copy.lifecycleStepProgress(currentIndex + 1, POOL_LIFECYCLE_STEPS.length, currentLabel)}</p>
		</nav>
	)
}

function getActionLabel(item: PoolActionItem) {
	if (item.id === 'reviewStagedOperations' && item.count !== undefined) return copy.stagedOperationCount(item.count)
	return copy.actionLabels[item.id]
}

/** The label, amount, and deadline of one action row; `context` adds a line such as the pool the action belongs to. */
export function PoolActionRow({ context, control, currentTimestamp, item }: { context?: ComponentChildren; control: ComponentChildren; currentTimestamp: bigint | undefined; item: PoolActionItem }) {
	return (
		<li className={`pool-action-item ${item.tone}`}>
			<div className='pool-action-copy'>
				<span className='pool-action-label'>{getActionLabel(item)}</span>
				{item.amount === undefined ? undefined : <CurrencyValue className='pool-action-amount' value={item.amount.value} suffix={item.amount.unit} />}
				{item.deadline === undefined ? undefined : (
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

/** The pool page's "What you can do now" surface: each action row switches to the tab that holds it or opens the pending report. */
export function PoolActionCard({ currentTimestamp, currentView, items, onChange, onViewReport }: { currentTimestamp: bigint | undefined; currentView: SelectedPoolView; items: readonly PoolActionItem[]; onChange: (view: SelectedPoolView) => void; onViewReport: (reportId: bigint) => void }) {
	return (
		<section className='pool-action-card' aria-labelledby='pool-action-card-heading'>
			<h3 id='pool-action-card-heading'>{copy.whatYouCanDoNow}</h3>
			{items.length === 0 ? (
				<p className='detail'>{copy.nothingToDoNow}</p>
			) : (
				<ul className='pool-action-list'>
					{items.map(item => {
						const { reportId, tab } = item
						let control: ComponentChildren = undefined
						if (reportId !== undefined)
							control = (
								<button type='button' className='link' onClick={() => onViewReport(reportId)}>
									{copy.viewReport}
								</button>
							)
						// A row for the open tab needs no control: its work is already on screen below.
						else if (tab !== undefined && tab !== currentView)
							control = (
								<button type='button' className='link' onClick={() => onChange(tab)}>
									{copy.actionButtonLabels[tab]}
								</button>
							)
						return <PoolActionRow control={control} currentTimestamp={currentTimestamp} item={item} key={item.id} />
					})}
				</ul>
			)}
		</section>
	)
}
