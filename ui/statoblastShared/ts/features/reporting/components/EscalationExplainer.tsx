import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/reporting.js'
import * as glossaryCopy from '../../../copy/glossary.js'
import { escalationExplanationHref } from '../lib/reportingViewerStatus.js'

export function EscalationExplainer({ firstReportMinimum, nonDecisionThreshold, defaultOpen = false }: { firstReportMinimum: bigint; nonDecisionThreshold: bigint; defaultOpen?: boolean }) {
	return (
		<ReadOnlyDetailAccordion title={copy.explainerTitle} defaultOpen={defaultOpen}>
			<ol>
				<li>{copy.explainerFirstReport(formatCurrencyBalance(firstReportMinimum))}</li>
				<li>{copy.explainerCompetition}</li>
				<li>{copy.explainerResolution}</li>
				<li>
					{copy.explainerForkLead}
					{glossaryCopy.nonDecisionThresholdTerm.toLowerCase()}
					{copy.formatExplainerForkThresholdSeparator(formatCurrencyBalance(nonDecisionThreshold))}
					{glossaryCopy.universeForkTerm.toLowerCase()}
					{copy.explainerForkTail}
				</li>
				<li>
					<a href={escalationExplanationHref} target='_blank' rel='noreferrer'>
						{copy.fullExplanation}
					</a>
				</li>
			</ol>
		</ReadOnlyDetailAccordion>
	)
}
