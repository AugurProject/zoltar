type WorkflowSummaryStripProps = {
	currentStep: string
	steps: string[]
	title: string
}

export function WorkflowSummaryStrip({ currentStep, steps, title }: WorkflowSummaryStripProps) {
	return (
		<section className='workflow-summary-strip'>
			<p className='panel-label'>{title}</p>
			<div className='workflow-summary-strip-steps'>
				{steps.map(step => (
					<span key={step} className={step === currentStep ? 'current' : undefined}>
						{step}
					</span>
				))}
			</div>
		</section>
	)
}
