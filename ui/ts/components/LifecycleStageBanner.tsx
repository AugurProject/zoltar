import type { LifecycleStagePresentation } from '../types/components.js'
import { WarningSurface } from './WarningSurface.js'

type LifecycleStageBannerProps = {
	stage: LifecycleStagePresentation | undefined
}

export function LifecycleStageBanner({ stage }: LifecycleStageBannerProps) {
	if (stage === undefined) return undefined
	if (stage.tone === 'warning')
		return (
			<WarningSurface className='lifecycle-stage-banner'>
				<div className='lifecycle-stage-banner-main'>
					<h3>{stage.label}</h3>
					<p className='detail'>{stage.detail}</p>
				</div>
			</WarningSurface>
		)

	return (
		<section className={`lifecycle-stage-banner ${stage.tone}`}>
			<div className='lifecycle-stage-banner-main'>
				<h3>{stage.label}</h3>
				<p className='detail'>{stage.detail}</p>
			</div>
		</section>
	)
}
