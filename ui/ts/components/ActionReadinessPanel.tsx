import { ActionLauncherCard } from './ActionLauncherCard.js'
import type { ReadinessAction } from '../types/components.js'
import { countReadyActions } from '../lib/actionReadiness.js'

type ActionReadinessPanelProps = {
	actions: ReadinessAction[]
	title: string
}

export function ActionReadinessPanel({ actions, title }: ActionReadinessPanelProps) {
	return (
		<section className='action-readiness-panel'>
			<div className='action-readiness-panel-header'>
				<div>
					<p className='panel-label'>Action Readiness</p>
					<h3>{title}</h3>
				</div>
				<strong>{countReadyActions(actions)} ready</strong>
			</div>
			<div className='action-readiness-grid'>
				{actions.map(action => (
					<ActionLauncherCard key={action.key} action={action} />
				))}
			</div>
		</section>
	)
}
