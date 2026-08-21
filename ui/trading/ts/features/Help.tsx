import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'

export function Help() {
	return (
		<main class='route prose-route' id='main-content'>
			<RouteHeader eyebrow={appCopy.projectGuide} title={appCopy.marketGuide} />
			<section class='explanation-flow'>
				{appCopy.marketGuideSteps.map(step => (
					<article>
						<span>{step.number}</span>
						<h2>{step.title}</h2>
						<p>{step.description}</p>
					</article>
				))}
			</section>
			<section class='section prose'>
				<h2>{appCopy.priceMeaningTitle}</h2>
				<p>{appCopy.priceMeaningDescription}</p>
				<h2>{appCopy.remainingSharesTitle}</h2>
				<p>{appCopy.remainingSharesDescription}</p>
				<p>
					{commonCopy.developerDocumentation} <code>{commonCopy.developerDocumentationPath}</code>.
				</p>
			</section>
		</main>
	)
}
