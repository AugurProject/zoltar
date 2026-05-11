import type { WorkflowOutcomePresentation } from '../types/components.js'

type ResultBannerProps = {
	outcome: WorkflowOutcomePresentation | undefined
}

export function ResultBanner({ outcome }: ResultBannerProps) {
	if (outcome === undefined) return undefined

	return (
		<section className='result-banner'>
			<h3>{outcome.title}</h3>
			<p className='detail'>{outcome.detail}</p>
			{outcome.nextStep === undefined ? undefined : <p className='detail'>Next: {outcome.nextStep}</p>}
		</section>
	)
}
