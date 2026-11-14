import type { PortfolioAccountSnapshot } from '../../../protocol/securityPoolPortfolio.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '../../../copy/portfolioCapital.js'

export function PortfolioRetirementPreview({ snapshot, position }: { snapshot: PortfolioAccountSnapshot; position: PortfolioAccountSnapshot['positions'][number] }) {
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
					<CurrencyValue value={current ? preview?.spareCommitment : undefined} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.retirementAhead}>
					<CurrencyValue value={current ? preview?.queuedAheadCommitment : undefined} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.retirementReduction}>
					<CurrencyValue value={position.commitment - position.remainingCommitment} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
				</MetricField>
			</MetricGrid>
			<UserMessage detail={copy.retirementPreviewHint} />
		</>
	)
}
