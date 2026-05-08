import type { LifecycleStagePresentation } from '../types/components.js'

type LifecycleStageBannerProps = {
	stage: LifecycleStagePresentation | undefined
}

export function LifecycleStageBanner({ stage }: LifecycleStageBannerProps) {
	if (stage === undefined) return undefined

	return (
		<section className={`lifecycle-stage-banner ${stage.tone}`}>
			<div className='lifecycle-stage-banner-main'>
				<p className='panel-label'>Stage</p>
				<h3>{stage.label}</h3>
				<p className='detail'>{stage.detail}</p>
			</div>
			<div className='lifecycle-stage-banner-lists'>
				<div>
					<p className='panel-label'>Available</p>
					<ul className='stage-list'>{stage.availableActions.length === 0 ? <li>None</li> : stage.availableActions.map(action => <li key={action}>{action}</li>)}</ul>
				</div>
				<div>
					<p className='panel-label'>Blocked</p>
					<ul className='stage-list'>{stage.blockedActions.length === 0 ? <li>None</li> : stage.blockedActions.map(action => <li key={action}>{action}</li>)}</ul>
				</div>
			</div>
		</section>
	)
}
