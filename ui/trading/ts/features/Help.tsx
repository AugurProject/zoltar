import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import * as appCopy from '../copy/app.js'

export function Help() {
	return (
		<div class='route'>
			<RouteHeader title={appCopy.marketGuide} description={appCopy.marketGuideDescription} />
			<SectionBlock title={appCopy.marketGuideStepsTitle}>
				<ol class='guide-steps'>
					{appCopy.marketGuideSteps.map(step => (
						<li key={step.number}>
							<strong>{step.title}</strong>
							<p class='detail'>{step.description}</p>
						</li>
					))}
				</ol>
			</SectionBlock>
			<SectionBlock>
				<WorkflowSubsection title={appCopy.priceMeaningTitle}>
					<p class='detail'>{appCopy.priceMeaningDescription}</p>
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.shareValueTitle}>
					<p class='detail'>{appCopy.shareValueDescription}</p>
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.remainingSharesTitle}>
					<p class='detail'>{appCopy.remainingSharesDescription}</p>
				</WorkflowSubsection>
			</SectionBlock>
		</div>
	)
}
