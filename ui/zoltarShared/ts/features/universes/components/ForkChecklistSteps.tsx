import type { ComponentChildren } from 'preact'
import * as zoltarCopy from '../../../copy/zoltar.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import type { BadgeTone } from '@zoltar/ui-core-shared/types/components.js'
import type { ForkChecklistStep, ForkChecklistStepKey, ForkChecklistStepStatus } from '../lib/forkChecklist.js'

export type ForkChecklistItem = {
	content?: ComponentChildren
	/** Replaces the status badge label, such as `Ready` for a submittable final step. */
	statusLabel?: string | undefined
	step: ForkChecklistStep
	title: string
}

const STATUS_PRESENTATION: Record<ForkChecklistStepStatus, { label: string; marker: string | undefined; tone: BadgeTone }> = {
	blocked: { label: zoltarCopy.forkStepBlocked, marker: '!', tone: 'blocked' },
	done: { label: zoltarCopy.forkStepDone, marker: '✓', tone: 'ok' },
	pending: { label: zoltarCopy.forkStepPending, marker: undefined, tone: 'pending' },
}

/** The element ID of a step's reason, so a disabled action can reference the step that blocks it. */
export function getForkChecklistReasonId(key: ForkChecklistStepKey) {
	return `fork-checklist-${key}-reason`
}

/** Numbered fork prerequisites: each row shows its status badge, the reason, and the controls that complete it. */
export function ForkChecklistSteps({ items }: { items: readonly ForkChecklistItem[] }) {
	const currentIndex = items.findIndex(item => item.step.status !== 'done')
	return (
		<ol aria-label={zoltarCopy.forkChecklistLabel} className='fork-checklist'>
			{items.map((item, index) => {
				const presentation = STATUS_PRESENTATION[item.step.status]
				return (
					<li aria-current={index === currentIndex ? 'step' : undefined} className={`fork-checklist-step ${item.step.status}`} data-step={item.step.key} key={item.step.key}>
						<span aria-hidden='true' className='fork-checklist-marker'>
							{presentation.marker ?? index + 1}
						</span>
						<div className='fork-checklist-body'>
							<div className='fork-checklist-heading'>
								<h3>{item.title}</h3>
								<Badge tone={presentation.tone}>{item.statusLabel ?? presentation.label}</Badge>
							</div>
							<p className='detail fork-checklist-reason' id={getForkChecklistReasonId(item.step.key)}>
								{item.step.reason}
							</p>
							{item.content === undefined ? undefined : <div className='fork-checklist-content'>{item.content}</div>}
						</div>
					</li>
				)
			})}
		</ol>
	)
}
