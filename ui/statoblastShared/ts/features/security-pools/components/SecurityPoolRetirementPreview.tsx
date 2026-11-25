import type { SecurityPoolAccountSnapshot } from '../../../protocol/securityPool.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { MetricGrid } from '@zoltar/ui-core-shared/components/MetricGrid.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { formatRoundedCurrencyBalance, formatValueWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
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
	if (redesigned) {
		const { decimals, symbol } = snapshot.collateral
		const free = preview?.spareCommitment ?? 0n
		return (
			<>
				<div className='statoblast-queue-totals'>
					<span>{copy.queueCommitment}</span>
					<strong>
						{value(position.commitment)} <span>→</span> {value(position.remainingCommitment)}
					</strong>
				</div>
				{current && preview !== undefined && total > 0n && (
					<>
						<div className='statoblast-retirement-queue' aria-hidden='true'>
							<div style={{ inlineSize: `${percentage(preview.queuedAheadCommitment)}%` }} />
							<span style={{ insetInlineStart: `min(calc(100% - 2px), ${percentage(preview.spareCommitment)}%)` }} />
						</div>
						<p className='detail statoblast-queue-marker-label'>{copy.queueFreeNow(formatValueWithUnit(formatRoundedCurrencyBalance(free, decimals), symbol), free >= total ? formatRoundedCurrencyBalance(total, decimals) : undefined)}</p>
						<div className='statoblast-queue-totals'>
							<span>
								{copy.queueAhead} <strong>{value(preview.queuedAheadCommitment)}</strong>
							</span>
							<span>
								{copy.queueYourReduction} <strong>{value(reduction)}</strong>
							</span>
						</div>
					</>
				)}
				{current && preview?.status === 'ready' && <Badge tone='ok'>{copy.readyToRelease}</Badge>}
				{(!current || preview?.status !== 'ready') && reason !== copy.waitingForFreeCapacity && <UserMessage tone='warning' detail={reason} />}
			</>
		)
	}
	return (
		<>
			<h4>{copy.retirementPreviewTitle}</h4>
			<UserMessage tone={current && preview?.status === 'ready' ? 'neutral' : 'warning'} detail={reason} />
			<MetricGrid>
				<MetricField label={copy.reductionFreeCapacity}>
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
