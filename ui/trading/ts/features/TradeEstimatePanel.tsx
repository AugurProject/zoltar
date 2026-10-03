import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { formatScaledPercentage, formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { ProbabilityBar } from '../components/ProbabilityBar.js'
import { TradeSettingsPanel } from '../components/TradeSettingsPanel.js'
import { formatRoundedUnits } from '../lib/format.js'
import { averagePriceBps, formatCollateralEth, formatCompleteSetQuantity, formatOutcomeQuantity, shareOutcome } from '../lib/shareValue.js'
import { formatSlippagePercent, type TradeSettings } from '../lib/tradeSettings.js'
import type { LiveBalances, LiveMarket } from '../protocol/live.js'
import * as ticketCopy from '../copy/tradeTicket.js'
import * as payoutCopy from '../copy/payout.js'
import * as settingsCopy from '../copy/tradeSettings.js'
import { buyReturn, holdingAfterTrade, poolFeeAttoEth, probabilityPercent, type PriceImpactTier, type TradeEstimate } from './live/tradeTicketModel.js'

// Six digits keep small trades' estimate and slippage minimum distinguishable.
const ESTIMATE_DIGITS = 6

function formatImpactPercent(impactBps: bigint) {
	return formatTrimmedUnits(impactBps, 2, 2)
}

function ImpactNotice({ tier, impactBps, acknowledged, disabled, onAcknowledge }: { tier: PriceImpactTier; impactBps: bigint; acknowledged: boolean; disabled: boolean; onAcknowledge(value: boolean): void }) {
	const percent = formatImpactPercent(impactBps)
	if (tier === 'low') return null
	// The percentage follows every debounced estimate, so these stay quiet; the panel's tier announcement speaks for them.
	if (tier === 'caution') return <UserMessage tone='warning' className='trade-impact-notice trade-impact-notice--caution' detail={ticketCopy.priceImpactCaution(percent)} />
	return (
		<WarningSurface surface='flat' variant='compact' className={`trade-impact-warning trade-impact-warning--${tier}`}>
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

function absolute(value: bigint) {
	return value < 0n ? -value : value
}

/** The gain or loss against the ETH paid, with the same figure as a return on that ETH. */
function formatProfit({ profitAttoEth, returnBps }: { profitAttoEth: bigint; returnBps: bigint }) {
	const format = profitAttoEth < 0n ? payoutCopy.loss : payoutCopy.profit
	return format(`${formatRoundedUnits(absolute(profitAttoEth), 18, ESTIMATE_DIGITS)} ETH`, formatScaledPercentage(absolute(returnBps), 2, 1))
}

/** The approximate fee, or the smallest shown amount as an upper bound when the fee rounds to nothing. */
function formatFeeEth(feeAttoEth: bigint) {
	const formatted = formatRoundedUnits(feeAttoEth, 18, ESTIMATE_DIGITS)
	return feeAttoEth > 0n && formatted === '0' ? `<${formatTrimmedUnits(1n, ESTIMATE_DIGITS, ESTIMATE_DIGITS)}` : `≈ ${formatted}`
}

/**
 * The live estimate. Always visible: how the trade moves the odds, what it costs and returns, its average price, the
 * worst case the slippage setting allows, the holding it leaves, and what a buy pays and gains if its outcome wins.
 * Price impact joins them once it is worth a caution. Fees, share mechanics, and the slippage setting sit behind disclosures.
 */
export function TradeEstimatePanel({
	estimate,
	market,
	settings,
	balances,
	impactTier,
	impactAcknowledged,
	disabled,
	onAcknowledgeImpact,
	onSettingsChange,
}: {
	estimate: TradeEstimate
	market: LiveMarket
	settings: TradeSettings
	/** The wallet's shares, for the holding the trade leaves; omitted while they are unknown. */
	balances?: LiveBalances | undefined
	impactTier: PriceImpactTier
	impactAcknowledged: boolean
	disabled: boolean
	onAcknowledgeImpact(value: boolean): void
	/** Present when slippage and validity can be changed here; otherwise the estimate points to the Settings menu. */
	onSettingsChange?: ((settings: TradeSettings) => void) | undefined
}) {
	const { side, quote } = estimate
	const opposite = side === 'YES' ? 'NO' : 'YES'
	const primary =
		estimate.kind === 'entry'
			? [{ label: ticketCopy.youReceiveEstimate, value: formatOutcomeQuantity(quote.totalLongShares, side, ESTIMATE_DIGITS) }]
			: [
					{ label: ticketCopy.youSellEstimate, value: formatOutcomeQuantity(quote.totalLongShares, side, ESTIMATE_DIGITS) },
					{ label: ticketCopy.youReceiveEstimate, value: `${formatRoundedUnits(estimate.receiveAttoEth, 18, ESTIMATE_DIGITS)} ETH` },
				]
	const average = averagePriceBps(estimate.kind === 'entry' ? estimate.payAttoEth : estimate.receiveAttoEth, quote.totalLongShares, market)
	const holdingAfter = holdingAfterTrade(estimate, balances)
	const impactRow = { label: ticketCopy.priceImpact, value: <span className={`trade-impact-value trade-impact-value--${impactTier}`}>{formatImpactPercent(estimate.impactBps)}%</span> }
	const protection = settingsCopy.protectionTitle(formatSlippagePercent(settings.slippageBps), settings.validityMinutes)
	const detailRows = [
		// A low price impact needs no attention, so it waits here until it reaches the caution tier.
		...(impactTier === 'low' ? [impactRow] : []),
		{ label: ticketCopy.poolFee, value: ticketCopy.poolFeeValue(formatScaledPercentage(market.feeBps, 2), formatFeeEth(poolFeeAttoEth(estimate, market))) },
		...(estimate.kind === 'entry' ? [{ label: ticketCopy.invalidInsurance, value: formatOutcomeQuantity(estimate.quote.invalidInsurance, shareOutcome.invalid) }] : []),
		{ label: ticketCopy.completeSets, value: formatCompleteSetQuantity(quote.completeSetShares) },
		estimate.kind === 'entry' ? { label: ticketCopy.swapped(opposite), value: formatOutcomeQuantity(estimate.quote.oppositeSharesSwapped, opposite) } : { label: ticketCopy.swapped(side), value: formatOutcomeQuantity(estimate.quote.longSharesSwapped, side) },
	]
	return (
		<section className='trade-estimate' aria-label={ticketCopy.estimateHeading}>
			{/* The reading column shows the resting odds; the estimate adds the bar to preview how this trade moves them. */}
			<ProbabilityBar yesPercent={probabilityPercent(quote.conditionalYesBpsAfter)} beforePercent={probabilityPercent(quote.conditionalYesBpsBefore)} />
			<TransactionReview
				variant='inline'
				primary={primary}
				details={[
					{ label: ticketCopy.averagePrice, value: average === undefined ? '—' : formatScaledPercentage(average, 2) },
					{ label: ticketCopy.minimumReceived, value: estimate.kind === 'entry' ? formatOutcomeQuantity(estimate.minimumLongShares, side, ESTIMATE_DIGITS, 'down') : `${formatTrimmedUnits(estimate.minimumAttoEth, 18, ESTIMATE_DIGITS)} ETH` },
					// A sale spends Invalid shares, so what it uses stays in view; the Invalid a buy adds is a detail.
					...(estimate.kind === 'exit' ? [{ label: ticketCopy.invalidUsed, value: formatOutcomeQuantity(estimate.quote.invalidRequired, shareOutcome.invalid) }] : []),
					...(impactTier === 'low' ? [] : [impactRow]),
					...(holdingAfter === undefined ? [] : [{ label: ticketCopy.holdingAfter(side), value: formatOutcomeQuantity(holdingAfter, side) }]),
				]}
			/>
			<p className='visually-hidden' role='status'>
				{ticketCopy.priceImpactTierAnnouncement(impactTier)}
			</p>
			<ImpactNotice tier={impactTier} impactBps={estimate.impactBps} acknowledged={impactAcknowledged} disabled={disabled} onAcknowledge={onAcknowledgeImpact} />
			{estimate.kind === 'entry' ? (
				<UserMessage
					className='detail payout-note'
					detail={
						<>
							<strong>{payoutCopy.conditionalPayout(formatCollateralEth(quote.totalLongShares, market), side)}</strong>
							{' · '}
							{formatProfit(buyReturn(estimate, market))}
							{' · '}
							{payoutCopy.otherwiseZero}
						</>
					}
				/>
			) : null}
			<ReadOnlyDetailAccordion title={ticketCopy.moreDetails}>
				<DataGrid dense>
					{detailRows.map(row => (
						<MetricField key={row.label} label={row.label}>
							{row.value}
						</MetricField>
					))}
				</DataGrid>
				<div className='trade-estimate-notes'>
					<UserMessage className='detail trade-estimate-note' detail={estimate.kind === 'entry' ? ticketCopy.invalidInsuranceNote : ticketCopy.invalidUsedNote} />
					{estimate.kind === 'entry' ? <UserMessage className='detail trade-estimate-note' detail={payoutCopy.holdingFeeNote} /> : null}
					<UserMessage
						className='detail trade-estimate-note'
						detail={
							onSettingsChange === undefined ? (
								<>
									{ticketCopy.estimateNote} {settingsCopy.protectionSummary(formatSlippagePercent(settings.slippageBps), settings.validityMinutes, 'question')}
								</>
							) : (
								ticketCopy.estimateNote
							)
						}
					/>
				</div>
			</ReadOnlyDetailAccordion>
			{onSettingsChange === undefined ? null : (
				<ReadOnlyDetailAccordion title={protection}>
					<TradeSettingsPanel embedded settings={settings} onChange={onSettingsChange} />
					<div className='trade-estimate-notes'>
						<UserMessage className='detail trade-estimate-note' detail={settingsCopy.validityEndsAtQuestionClose} />
					</div>
				</ReadOnlyDetailAccordion>
			)}
		</section>
	)
}
