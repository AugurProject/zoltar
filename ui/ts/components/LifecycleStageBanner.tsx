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
		</section>
	)
}
