import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import * as appCopy from '../copy/app.js'

export function Help() {
	return (
		<div className='route-view-flow'>
			<RouteHeader title={appCopy.marketGuide} description={appCopy.marketGuideDescription} />
			<SectionBlock title={appCopy.marketGuideStepsTitle}>
				<ol className='guide-steps'>
					{appCopy.marketGuideSteps.map(step => (
						<li key={step.number}>
							<strong>{step.title}</strong>
							<p className='detail'>{step.description}</p>
						</li>
					))}
				</ol>
			</SectionBlock>
			<SectionBlock>
				<WorkflowSubsection title={appCopy.priceMeaningTitle}>
					<p className='detail'>{appCopy.priceMeaningDescription}</p>
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.shareValueTitle}>
					<p className='detail'>{appCopy.shareValueDescription}</p>
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.remainingSharesTitle}>
					<p className='detail'>{appCopy.remainingSharesDescription}</p>
				</WorkflowSubsection>
			</SectionBlock>
		</div>
	)
}
