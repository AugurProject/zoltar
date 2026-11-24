import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import * as copy from '../../../copy/securityPoolCapital.js'

export function SecurityPoolRetirementPreview({ snapshot, position, redesigned = false }: { snapshot: SecurityPoolAccountSnapshot; position: SecurityPoolAccountSnapshot['positions'][number]; redesigned?: boolean }) {
	const preview = position.retirementPreview
	const closed = snapshot.forkTime !== 0n || snapshot.frozen || snapshot.importing || snapshot.exported
	const current = !closed && snapshot.priceValid
	const reduction = position.commitment - position.remainingCommitment
	const total = (preview?.queuedAheadCommitment ?? 0n) + reduction
	const percentage = (amount: bigint) => (total <= 0n ? 0 : Number(((amount >= total ? total : amount) * 10_000n) / total) / 100)
	const value = (amount: bigint) => <CurrencyValue value={amount} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
	let reason = copy.retirementPreviewUnavailable
	if (closed) reason = copy.retirementPreviewClosed
	else if (!snapshot.priceValid) reason = copy.retirementPreviewStale
	else if (preview !== undefined) reason = copy.retirementPreviewStatus[preview.status]
	return (
		<>
			<h4>{copy.retirementPreviewTitle}</h4>
			<UserMessage tone={current && preview?.status === 'ready' ? 'neutral' : 'warning'} detail={reason} />
			{redesigned && (
				<div>
					<strong>{copy.positionCommitment}</strong> {value(position.commitment)} <span aria-hidden='true'>→</span> {value(position.remainingCommitment)}
					{current && preview !== undefined && total > 0n && (
						<div className='statoblast-retirement-queue' aria-hidden='true'>
							<div style={{ inlineSize: `${percentage(preview.queuedAheadCommitment)}%` }} />
							<span title={copy.queueCapacity} style={{ insetInlineStart: `${Math.min(99, percentage(preview.spareCommitment))}%` }} />
						</div>
					)}
				</div>
			)}
			<MetricGrid>
				<MetricField label={copy.retirementSpare}>
					<CurrencyValue value={current ? preview?.spareCommitment : undefined} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.retirementAhead}>
					<CurrencyValue value={current ? preview?.queuedAheadCommitment : undefined} suffix={snapshot.collateral.symbol} units={snapshot.collateral.decimals} />
				</MetricField>
				<MetricField label={copy.retirementReduction}>{value(reduction)}</MetricField>
			</MetricGrid>
			<UserMessage detail={copy.retirementPreviewHint} />
		</>
	)
}
