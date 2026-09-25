import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { formatRoundedUnits } from '../lib/format.js'
import { averagePriceBps, formatCollateralEth, formatCompleteSetQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import { formatSlippagePercent, type TradeSettings } from '../lib/tradeSettings.js'
import type { LiveMarket } from '../protocol/live.js'
import * as ticketCopy from '../copy/tradeTicket.js'
import * as payoutCopy from '../copy/payout.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import type { PriceImpactTier, TradeEstimate } from './live/tradeTicketModel.js'

// Six digits keep small trades' estimate and slippage minimum distinguishable.
const ESTIMATE_DIGITS = 6

function formatImpactPercent(impactBps: bigint) {
	return formatTrimmedUnits(impactBps, 2, 2)
}

function ImpactNotice({ tier, impactBps, acknowledged, disabled, onAcknowledge }: { tier: PriceImpactTier; impactBps: bigint; acknowledged: boolean; disabled: boolean; onAcknowledge(value: boolean): void }) {
	const percent = formatImpactPercent(impactBps)
	if (tier === 'low') return null
	if (tier === 'caution')
		return (
			<p className='trade-impact-notice trade-impact-notice--caution' role='status'>
				{ticketCopy.priceImpactCaution(percent)}
			</p>
		)
	return (
		<WarningSurface role='alert' surface='flat' variant='compact' className={`trade-impact-warning trade-impact-warning--${tier}`}>
			<p>{tier === 'blocked' ? ticketCopy.priceImpactBlocked(percent) : ticketCopy.priceImpactWarning(percent)}</p>
			{tier === 'warning' ? (
				<label className='trade-impact-acknowledge'>
					<input type='checkbox' checked={acknowledged} disabled={disabled} onChange={event => onAcknowledge(event.currentTarget.checked)} />
					<span>{ticketCopy.acknowledgeImpact(percent)}</span>
				</label>
			) : null}
		</WarningSurface>
	)
}

/**
 * The live estimate: what the trade costs and returns, the worst case the slippage setting allows, and the price
 * impact, always visible. Detailed share mechanics sit behind one disclosure.
 */
export function TradeEstimatePanel({
	estimate,
	market,
	settings,
	impactTier,
	impactAcknowledged,
	disabled,
	onAcknowledgeImpact,
}: {
	estimate: TradeEstimate
	market: LiveMarket
	settings: TradeSettings
	impactTier: PriceImpactTier
	impactAcknowledged: boolean
	disabled: boolean
	onAcknowledgeImpact(value: boolean): void
}) {
	const { side } = estimate
	const opposite = side === 'YES' ? 'NO' : 'YES'
	const impact = `${formatImpactPercent(estimate.impactBps)}%`
	const primary =
		estimate.kind === 'entry'
			? [
					{ label: ticketCopy.youPay, value: `${formatRoundedUnits(estimate.payAttoEth)} ETH` },
					{ label: ticketCopy.youReceiveEstimate, value: formatOutcomeQuantity(estimate.quote.totalLongShares, side, ESTIMATE_DIGITS) },
				]
			: [
					{ label: ticketCopy.youSellEstimate, value: formatOutcomeQuantity(estimate.quote.totalLongShares, side, ESTIMATE_DIGITS) },
					{ label: ticketCopy.youReceiveEstimate, value: `${formatRoundedUnits(estimate.receiveAttoEth, 18, ESTIMATE_DIGITS)} ETH` },
				]
	const average = estimate.kind === 'entry' ? averagePriceBps(estimate.payAttoEth, estimate.quote.totalLongShares, market) : undefined
	const detailRows = [
		{ label: ticketCopy.completeSets, value: formatCompleteSetQuantity(estimate.quote.completeSetShares) },
		...(estimate.kind === 'entry'
			? [
					{ label: ticketCopy.swapped(opposite), value: formatOutcomeQuantity(estimate.quote.oppositeSharesSwapped, opposite) },
					{ label: ticketCopy.averagePrice, value: average === undefined ? '—' : `${formatTrimmedUnits(average, 2, 2)}%` },
				]
			: [{ label: ticketCopy.swapped(side), value: formatOutcomeQuantity(estimate.quote.longSharesSwapped, side) }]),
		{ label: ticketCopy.poolFeePaid, value: formatOutcomeQuantity(estimate.quote.feeAmount, estimate.kind === 'entry' ? opposite : side, 8) },
	]
	return (
		<section className='trade-estimate' aria-label={ticketCopy.estimateHeading}>
			<TransactionReview
				variant='inline'
				primary={primary}
				details={[
					{ label: ticketCopy.minimumReceived, value: estimate.kind === 'entry' ? formatOutcomeQuantity(estimate.minimumLongShares, side, ESTIMATE_DIGITS, 'down') : `${formatTrimmedUnits(estimate.minimumAttoEth, 18, ESTIMATE_DIGITS)} ETH` },
					{ label: ticketCopy.priceImpact, value: <span className={`trade-impact-value trade-impact-value--${impactTier}`}>{impact}</span> },
					{ label: estimate.kind === 'entry' ? ticketCopy.invalidInsurance : ticketCopy.invalidUsed, value: formatOutcomeQuantity(estimate.kind === 'entry' ? estimate.quote.invalidInsurance : estimate.quote.invalidRequired, 'INVALID') },
					{ label: ticketCopy.poolFee, value: `${formatTrimmedUnits(market.feeBps, 2, 2)}%` },
				]}
			/>
			<ImpactNotice tier={impactTier} impactBps={estimate.impactBps} acknowledged={impactAcknowledged} disabled={disabled} onAcknowledge={onAcknowledgeImpact} />
			{estimate.kind === 'entry' ? (
				<p className='detail payout-note'>
					<strong>{payoutCopy.conditionalPayout(formatCollateralEth(estimate.quote.totalLongShares, market), side)}</strong>
					{' · '}
					{payoutCopy.otherwiseZero}
				</p>
			) : null}
			<p className='detail trade-estimate-note'>
				{ticketCopy.estimateNote} {settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes)}
			</p>
			<ReadOnlyDetailAccordion title={ticketCopy.moreDetails}>
				<DataGrid dense>
					{detailRows.map(row => (
						<MetricField key={row.label} label={row.label}>
							{row.value}
						</MetricField>
					))}
				</DataGrid>
			</ReadOnlyDetailAccordion>
		</section>
	)
}
