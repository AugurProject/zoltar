import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '../../../copy/portfolioCapital.js'
import * as common from '@zoltar/ui-core-shared/copy/common.js'

export function PortfolioRetirementPreview({ snapshot, position }: { snapshot: PortfolioCapitalSnapshot; position: PortfolioCapitalSnapshot['positions'][number] }) {
	const preview = position.retirementPreview
	const closed = snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported
	const current = !closed && snapshot.priceValid
	let reason = copy.retirementPreviewUnavailable
	if (closed) reason = copy.retirementPreviewClosed
	else if (!snapshot.priceValid) reason = copy.retirementPreviewStale
	else if (preview !== undefined) reason = copy.retirementPreviewStatus[preview.status]
	return (
		<>
			<h4>{copy.retirementPreviewTitle}</h4>
			<UserMessage tone={current && preview?.status === 'ready' ? 'neutral' : 'warning'} detail={reason} />
			<MetricGrid>
				<MetricField label={copy.retirementSpare}>
					<CurrencyValue value={current ? preview?.spareCommitment : undefined} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.retirementAhead}>
					<CurrencyValue value={current ? preview?.queuedAheadCommitment : undefined} suffix={common.eth} />
				</MetricField>
				<MetricField label={copy.retirementReduction}>
					<CurrencyValue value={position.commitment - position.remainingCommitment} suffix={common.eth} />
				</MetricField>
			</MetricGrid>
			<UserMessage detail={copy.retirementPreviewHint} />
		</>
	)
}
