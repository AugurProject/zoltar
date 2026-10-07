import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import * as appCopy from '../copy/app.js'
import { createMarketGuideHref, findMarketGuideHref, handleForkGuideHref, handleResolutionGuideHref } from '../lib/docsLinks.js'

function GuideLink({ href, label }: { href: string; label: string }) {
	return (
		<a href={href} target='_blank' rel='noreferrer'>
			{label}
		</a>
	)
}

/** The trade model in four numbered steps, what prices and payouts mean, and where each other task starts, with its guide. */
export function Help() {
	return (
		<div className='route-view-flow help-guide'>
			<RouteHeader title={appCopy.help} description={appCopy.marketGuideDescription} />
			<SectionBlock title={appCopy.marketGuideStepsTitle}>
				<ol className='guide-steps'>
					{appCopy.marketGuideSteps.map(step => (
						<li key={step.number}>
							<div className='guide-step'>
								<strong>{step.title}</strong>
								<p className='detail'>{step.description}</p>
							</div>
						</li>
					))}
				</ol>
			</SectionBlock>
			<SectionBlock title={appCopy.pricesAndPayoutsTitle}>
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
			<SectionBlock title={appCopy.tasksTitle}>
				<WorkflowSubsection title={appCopy.findMarketTitle}>
					<p className='detail'>{appCopy.findMarketDescription}</p>
					<GuideLink href={findMarketGuideHref} label={appCopy.findMarketLink} />
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.createMarketTitle}>
					<p className='detail'>{appCopy.createMarketDescription}</p>
					<GuideLink href={createMarketGuideHref} label={appCopy.createMarketLink} />
				</WorkflowSubsection>
				<WorkflowSubsection title={appCopy.afterTradingTitle}>
					<p className='detail'>{appCopy.afterTradingDescription}</p>
					<p className='help-guide-links'>
						<GuideLink href={handleResolutionGuideHref} label={appCopy.resolutionLink} />
						<GuideLink href={handleForkGuideHref} label={appCopy.forkLink} />
					</p>
				</WorkflowSubsection>
			</SectionBlock>
		</div>
	)
}
