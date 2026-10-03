import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
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

/**
 * Operational → Escalation → Fork / Migration → Truth auction → Settled as a compact segmented bar under the current
 * stage's name. Each segment keeps its stage name for assistive technology and as a hover title, and the current one is
 * marked with `aria-current`.
 */
export function PoolLifecycleStepper({ step }: { step: PoolLifecycleStep | undefined }) {
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
					const state = getStepState(index, currentIndex)
					return (
						<li key={candidate} className={state} aria-current={state === 'current' ? 'step' : undefined} title={copy.lifecycleStepLabels[candidate]}>
							<span className='visually-hidden'>{copy.lifecycleStepLabels[candidate]}</span>
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

/** The label, amount, and deadline of one action row; `context` adds a line such as the pool the action belongs to. */
function PoolActionRow({ context, control, currentTimestamp, item }: { context?: ComponentChildren; control: ComponentChildren; currentTimestamp: bigint | undefined; item: PoolActionItem }) {
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

/** Next actions retain position, deadline, and exception context even when their tab is open. */
export function PoolActionCard({ currentTimestamp, currentView, items, onChange }: { currentTimestamp: bigint | undefined; currentView: SelectedPoolView | undefined; items: readonly PoolActionItem[]; onChange: (view: SelectedPoolView) => void }) {
	const visibleItems = items.filter(item => item.id !== 'manageVault' || item.tab !== currentView)
	if (visibleItems.length === 0 && items.length > 0) return undefined
	return (
		<section className='pool-action-card' aria-labelledby='pool-action-card-heading'>
			<h3 id='pool-action-card-heading'>{copy.nextActions}</h3>
			{visibleItems.length === 0 ? (
				<UserMessage className='detail' detail={copy.nothingToDoNow} />
			) : (
				<ul className='pool-action-list'>
					{visibleItems.map(item => {
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
						return <PoolActionRow control={control} currentTimestamp={currentTimestamp} item={item} key={item.id} />
					})}
				</ul>
			)}
		</section>
	)
}
