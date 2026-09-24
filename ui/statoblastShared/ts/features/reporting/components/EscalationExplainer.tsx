import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import * as copy from '../../../copy/reporting.js'
import { escalationExplanationHref } from '../lib/reportingViewerStatus.js'

export function EscalationExplainer({ details }: { details: ReportingDetails }) {
	return (
		<ReadOnlyDetailAccordion title={copy.explainerTitle} defaultOpen={details.status === 'not-started'}>
			<ol>
				<li>{copy.explainerFirstReport(formatCurrencyBalance(details.startBondAttoRep))}</li>
				<li>{copy.explainerCompetition}</li>
				<li>{copy.explainerResolution}</li>
				<li>{copy.explainerFork(formatCurrencyBalance(details.nonDecisionThresholdAttoRep))}</li>
				<li>
					<a href={escalationExplanationHref} target='_blank' rel='noreferrer'>
						{copy.fullExplanation}
					</a>
				</li>
			</ol>
		</ReadOnlyDetailAccordion>
	)
}
