import * as commonCopy from '../../../copy/common.js'
import type { LifecycleStagePresentation } from '../../types.js'
import { WarningSurface } from '../../../components/WarningSurface.js'

type LifecycleStageBannerProps = {
	stage: LifecycleStagePresentation | undefined
}

function renderStageActionGroup(label: string, items: string[], tone: 'available' | 'blocked') {
	if (items.length === 0) return undefined

	return (
		<div className='lifecycle-stage-banner-action-group'>
			<span className='panel-label'>{label}</span>
			<div className='lifecycle-stage-banner-action-row' role='list' aria-label={label}>
				{items.map(item => (
					<span className={`lifecycle-stage-banner-action-chip ${tone}`} key={`${label}-${item}`} role='listitem'>
						{item}
					</span>
				))}
			</div>
		</div>
	)
}

export function LifecycleStageBanner({ stage }: LifecycleStageBannerProps) {
	if (stage === undefined) return undefined
	const hasActions = stage.availableActions.length > 0 || stage.blockedActions.length > 0
	const actions = !hasActions ? undefined : (
		<div className='lifecycle-stage-banner-actions'>
			{renderStageActionGroup(commonCopy.availableNow, stage.availableActions, 'available')}
			{renderStageActionGroup(commonCopy.blocked, stage.blockedActions, 'blocked')}
		</div>
	)
	if (stage.tone === 'warning')
		return (
			<WarningSurface className='lifecycle-stage-banner'>
				<div className='lifecycle-stage-banner-main'>
					<h3>{stage.label}</h3>
					<p className='detail'>{stage.detail}</p>
				</div>
				{actions}
			</WarningSurface>
		)

	return (
		<section className={`lifecycle-stage-banner ${stage.tone}`}>
			<div className='lifecycle-stage-banner-main'>
				<h3>{stage.label}</h3>
				<p className='detail'>{stage.detail}</p>
			</div>
			{actions}
		</section>
	)
}
