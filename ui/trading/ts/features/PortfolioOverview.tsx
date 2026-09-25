import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { getTradingRouteHref } from '../lib/routing.js'
import type { PortfolioActionItem, PortfolioOverview, PortfolioRow, PortfolioValuation } from './portfolioModel.js'

function formatPortfolioEth(attoEth: bigint) {
	return portfolioCopy.ethAmount(formatTrimmedUnits(attoEth, 18, 4))
}

function valuationCaption(valuation: PortfolioValuation) {
	if (valuation.kind !== 'unavailable') return valuation.kind === 'exit' ? portfolioCopy.exitValueBasis : portfolioCopy.redemptionValueBasis
	if (valuation.reason === 'settlement-required') return portfolioCopy.settlementValueReason
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

/** Totals across every listed position; profit and loss stay unavailable because entry costs are not recorded per account. */
export function PortfolioSummary({ overview }: { overview: PortfolioOverview }) {
	return (
		<section className='portfolio-summary' aria-label={portfolioCopy.summaryLabel}>
			<DataGrid className='portfolio-summary-grid'>
				<MetricField label={portfolioCopy.totalValue}>
					{formatPortfolioEth(overview.totalValueAttoEth)}
					<small className='payout-caption'>{overview.unvaluedCount === 0 ? portfolioCopy.totalValueBasis : portfolioCopy.excludedFromTotal(overview.unvaluedCount)}</small>
				</MetricField>
				<MetricField label={portfolioCopy.profitLoss}>
					{portfolioCopy.profitLossUnavailable}
					<small className='payout-caption'>{portfolioCopy.costBasisUnavailableReason}</small>
				</MetricField>
				<MetricField label={portfolioCopy.positions}>{overview.positionCount.toString()}</MetricField>
				<MetricField label={portfolioCopy.actionItemCount}>{overview.actionItems.length === 0 ? portfolioCopy.nothingNeedsAttention : overview.actionItems.length.toString()}</MetricField>
			</DataGrid>
		</section>
	)
}

function actionItemPresentation(item: PortfolioActionItem) {
	if (item.kind === 'redeem') return { label: portfolioCopy.actionRedeem, tone: 'ok' as const, action: portfolioCopy.redeem, href: `#/market/${item.pool}` }
	if (item.kind === 'settle') return { label: portfolioCopy.actionSettle, tone: 'warning' as const, action: portfolioCopy.settle, href: `#/market/${item.pool}` }
	if (item.kind === 'withdraw-liquidity') return { label: portfolioCopy.actionWithdrawLiquidity, tone: 'muted' as const, action: portfolioCopy.withdrawLiquidity, href: `#/liquidity/${item.pool}` }
	return { label: portfolioCopy.actionTradingCloses, tone: 'warning' as const, action: portfolioCopy.sell, href: `#/market/${item.pool}` }
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
							<a className='button-link secondary-link' href={getTradingRouteHref(presentation.href)} aria-label={portfolioCopy.actionFor(presentation.action, item.title)}>
								{presentation.action}
							</a>
						</li>
					)
				})}
			</ul>
		</section>
	)
}

/** Sell while the market trades; Redeem once it has closed and something is redeemable. Both open the market workspace. */
export function PortfolioRowActions({ row }: { row: PortfolioRow }) {
	const { pool, title } = row.entry.market
	if (!row.canSell && !row.canRedeem) return null
	return (
		<>
			{row.canSell ? (
				<a className='button-link primary' href={getTradingRouteHref(`#/market/${pool}`)} aria-label={portfolioCopy.actionFor(portfolioCopy.sell, title)}>
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
