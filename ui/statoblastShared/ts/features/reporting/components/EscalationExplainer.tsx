import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as copy from '../../../copy/reporting.js'
import * as glossaryCopy from '../../../copy/glossary.js'
import { protocolGuideHref } from '@zoltar/ui-core-shared/copy/app.js'

const escalationExplanationHref = new URL('explanation/escalation-game.html', protocolGuideHref).href

export function EscalationExplainer({ firstReportMinimum, nonDecisionThreshold }: { firstReportMinimum: bigint; nonDecisionThreshold: bigint }) {
	return (
		<ReadOnlyDetailAccordion title={copy.explainerTitle}>
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
