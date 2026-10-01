import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { formatRoundedUnits } from '../lib/format.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { marketTicketHref } from '../lib/routeState.js'
import type { PortfolioActionItem, PortfolioOverview, PortfolioRow, PortfolioValuation } from './portfolioModel.js'

function formatPortfolioEth(attoEth: bigint) {
	return portfolioCopy.ethAmount(formatRoundedUnits(attoEth, 18, 4))
}

function valuationCaption(valuation: PortfolioValuation) {
	if (valuation.kind === 'exit') return valuation.pendingResolution ? portfolioCopy.exitValuePendingBasis : portfolioCopy.exitValueBasis
	if (valuation.kind === 'complete-sets') return valuation.pendingResolution ? portfolioCopy.completeSetsPendingBasis : portfolioCopy.completeSetsBasis
	if (valuation.kind === 'redemption') return portfolioCopy.redemptionValueBasis
	if (valuation.reason === 'settlement-required') return portfolioCopy.settlementValueReason
	if (valuation.reason === 'pool-inactive') return portfolioCopy.poolInactiveValueReason
	return valuation.reason === 'market-unavailable' ? portfolioCopy.marketValueReason : portfolioCopy.balanceValueReason
}

export function PortfolioRowValue({ valuation }: { valuation: PortfolioValuation }) {
	return (
		<div className='portfolio-position-value'>
			<span className='metric-label'>{portfolioCopy.valueNow}</span>
			<strong>{valuation.kind === 'unavailable' ? portfolioCopy.valueUnavailable : formatPortfolioEth(valuation.attoEth)}</strong>
			<small className='payout-caption'>{valuationCaption(valuation)}</small>
		</div>
	)
}

/** Every reason the total leaves something out, or the pricing basis when it leaves nothing out. */
function totalValueCaptions(overview: PortfolioOverview) {
	const captions = [...(overview.unvaluedCount > 0 ? [portfolioCopy.excludedFromTotal(overview.unvaluedCount)] : []), ...(overview.pendingResolutionCount > 0 ? [portfolioCopy.pendingResolutionExcluded] : [])]
	return captions.length === 0 ? [portfolioCopy.totalValueBasis] : captions
}

/** Current value, position count, and action items across every listed position. */
export function PortfolioSummary({ overview }: { overview: PortfolioOverview }) {
	return (
		<section className='portfolio-summary' aria-label={portfolioCopy.summaryLabel}>
			<DataGrid className='portfolio-summary-grid'>
				<MetricField label={portfolioCopy.totalValue}>
					{formatPortfolioEth(overview.totalValueAttoEth)}
					{totalValueCaptions(overview).map(caption => (
						<small key={caption} className='payout-caption'>
							{caption}
						</small>
					))}
				</MetricField>
				<MetricField label={portfolioCopy.positions}>{overview.positionCount.toString()}</MetricField>
				<MetricField label={portfolioCopy.actionItemCount}>{overview.actionItems.length === 0 ? portfolioCopy.nothingNeedsAttention : overview.actionItems.length.toString()}</MetricField>
			</DataGrid>
		</section>
	)
}

function actionBadge(item: PortfolioActionItem) {
	if (item.kind === 'redeem') return { label: portfolioCopy.actionRedeem, tone: 'ok' as const }
	if (item.kind === 'settle') return { label: portfolioCopy.actionSettle, tone: 'warning' as const }
	if (item.kind === 'withdraw-liquidity') return { label: portfolioCopy.actionWithdrawLiquidity, tone: 'muted' as const }
	return { label: portfolioCopy.actionTradingCloses, tone: 'warning' as const }
}

function actionLink(item: PortfolioActionItem) {
	if (item.action === 'withdraw-liquidity') return { action: portfolioCopy.withdrawLiquidity, href: getTradingRouteHref(`#/liquidity/${item.pool}`) }
	if (item.action === 'redeem') return { action: portfolioCopy.redeem, href: getTradingRouteHref(`#/market/${item.pool}`) }
	if (item.action === 'settle') return { action: portfolioCopy.settle, href: getTradingRouteHref(`#/market/${item.pool}`) }
	return { action: portfolioCopy.sell, href: marketTicketHref(item.pool, { mode: 'exit', side: item.sellSide }) }
}

function actionItemPresentation(item: PortfolioActionItem) {
	return { ...actionBadge(item), ...actionLink(item) }
}

/** What needs the account's attention, soonest deadline first, each with the action that resolves it. */
export function PortfolioActionItems({ items, nowSeconds }: { items: readonly PortfolioActionItem[]; nowSeconds: bigint }) {
	if (items.length === 0) return null
	return (
		<section className='portfolio-action-items' aria-labelledby='portfolio-action-items-heading'>
			<h3 id='portfolio-action-items-heading'>{portfolioCopy.needsAttention}</h3>
			<ul>
				{items.map(item => {
					const presentation = actionItemPresentation(item)
					return (
						<li key={`${item.kind}:${item.pool}`}>
							<Badge tone={presentation.tone}>{presentation.label}</Badge>
							<span className='portfolio-action-item-title'>{item.title}</span>
							<span className='portfolio-action-item-deadline'>{item.deadline === undefined ? portfolioCopy.noDeadline : <TimestampValue timestamp={item.deadline} currentTimestamp={nowSeconds} />}</span>
							<a className='button-link secondary-link' href={presentation.href} aria-label={portfolioCopy.actionFor(presentation.action, item.title)}>
								{presentation.action}
							</a>
						</li>
					)
				})}
			</ul>
		</section>
	)
}

/** Sell while the market trades, opening the ticket in Sell mode on the held outcome; Redeem once it has closed and something is redeemable. */
export function PortfolioRowActions({ row }: { row: PortfolioRow }) {
	const { pool, title } = row.entry.market
	if (!row.canSell && !row.canRedeem) return null
	return (
		<>
			{row.canSell ? (
				<a className='button-link primary' href={marketTicketHref(pool, { mode: 'exit', side: row.sellSide })} aria-label={portfolioCopy.actionFor(portfolioCopy.sell, title)}>
					{portfolioCopy.sell}
				</a>
			) : null}
			{row.canRedeem ? (
				<a className='button-link primary' href={getTradingRouteHref(`#/market/${pool}`)} aria-label={portfolioCopy.actionFor(portfolioCopy.redeem, title)}>
					{portfolioCopy.redeem}
				</a>
			) : null}
		</>
	)
}
