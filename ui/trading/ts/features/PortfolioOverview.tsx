import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { marketsCopy } from '../copy/markets.js'
import { formatEthAmount } from '../copy/outcomes.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { formatRoundedUnits } from '../lib/format.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { marketTicketHref } from '../lib/routeState.js'
import type { PortfolioActionGroup, PortfolioActionItem, PortfolioOverview, PortfolioRow, PortfolioValuation } from './portfolioModel.js'

function formatPortfolioEth(attoEth: bigint) {
	return formatEthAmount(formatRoundedUnits(attoEth, 18, 4))
}

function valuationCaption(valuation: PortfolioValuation) {
	if (valuation.kind === 'exit') return valuation.pendingResolution ? portfolioCopy.exitValuePendingBasis : portfolioCopy.exitValueBasis
	if (valuation.kind === 'complete-sets') return valuation.pendingResolution ? portfolioCopy.completeSetsPendingBasis : portfolioCopy.completeSetsBasis
	if (valuation.kind === 'redemption') return portfolioCopy.redemptionValueBasis
	if (valuation.reason === 'settlement-required') return portfolioCopy.migrationValueReason
	if (valuation.reason === 'pool-inactive') return portfolioCopy.poolInactiveValueReason
	return valuation.reason === 'market-unavailable' ? portfolioCopy.marketValueReason : portfolioCopy.balanceValueReason
}

/** A value that cannot be priced shows a quiet dash, read aloud as unavailable, so it never looks like a headline figure. */
function UnpricedValue() {
	return (
		<>
			<span aria-hidden='true'>{commonCopy.metricUnavailablePlaceholder}</span>
			<span className='visually-hidden'>{portfolioCopy.valueUnavailable}</span>
		</>
	)
}

export function PortfolioRowValue({ valuation }: { valuation: PortfolioValuation }) {
	return (
		<div className={valuation.kind === 'unavailable' ? 'portfolio-position-value is-unpriced' : 'portfolio-position-value'}>
			<span className='metric-label'>{portfolioCopy.valueNow}</span>
			<strong>{valuation.kind === 'unavailable' ? <UnpricedValue /> : formatPortfolioEth(valuation.attoEth)}</strong>
			<small className='payout-caption'>{valuationCaption(valuation)}</small>
		</div>
	)
}

/** Every reason the total leaves something out, or the pricing basis when it leaves nothing out. */
function totalValueCaptions(overview: PortfolioOverview) {
	const captions = [...(overview.unvaluedCount > 0 ? [portfolioCopy.excludedFromTotal(overview.unvaluedCount)] : []), ...(overview.pendingResolutionCount > 0 ? [portfolioCopy.pendingResolutionExcluded] : [])]
	return captions.length === 0 ? [portfolioCopy.totalValueBasis] : captions
}

/** Current value, position count, and action items across every listed position. With no priced position the total is a dash, not a misleading 0 ETH. */
export function PortfolioSummary({ overview }: { overview: PortfolioOverview }) {
	const noPricedPosition = overview.positionCount > 0 && overview.unvaluedCount === overview.positionCount
	return (
		<section className='portfolio-summary' aria-label={portfolioCopy.summaryLabel}>
			<DataGrid className='portfolio-summary-grid'>
				<MetricField label={portfolioCopy.totalValue} valueClassName={noPricedPosition ? 'is-unpriced' : ''}>
					{noPricedPosition ? <UnpricedValue /> : formatPortfolioEth(overview.totalValueAttoEth)}
					{totalValueCaptions(overview).map(caption => (
						<small key={caption} className='payout-caption'>
							{caption}
						</small>
					))}
				</MetricField>
				<MetricField label={portfolioCopy.positions}>{overview.positionCount.toString()}</MetricField>
				<MetricField label={portfolioCopy.needsAttention}>{overview.actionGroups.length === 0 ? portfolioCopy.nothingNeedsAttention : overview.actionGroups.length.toString()}</MetricField>
			</DataGrid>
		</section>
	)
}

function actionBadge(item: PortfolioActionItem) {
	if (item.kind === 'redeem') return { label: portfolioCopy.actionRedeem, tone: 'ok' as const }
	if (item.kind === 'settle') return { label: portfolioCopy.actionMigrate, tone: 'warning' as const }
	if (item.kind === 'withdraw-liquidity') return { label: portfolioCopy.actionRemoveLiquidity, tone: 'muted' as const }
	return { label: marketsCopy.closingSoon, tone: 'warning' as const }
}

function actionLink(item: PortfolioActionItem) {
	if (item.action === 'withdraw-liquidity') return { action: portfolioCopy.removeLiquidity, href: getTradingRouteHref(`#/liquidity/${item.pool}`) }
	if (item.action === 'redeem') return { action: portfolioCopy.redeem, href: getTradingRouteHref(`#/market/${item.pool}`) }
	if (item.action === 'settle') return { action: portfolioCopy.migrate, href: getTradingRouteHref(`#/market/${item.pool}`) }
	return { action: portfolioCopy.sell, href: marketTicketHref(item.pool, { mode: 'exit', side: item.sellSide }) }
}

function actionItemPresentation(item: PortfolioActionItem) {
	return { ...actionBadge(item), ...actionLink(item) }
}

/** Each market that needs the account's attention, soonest deadline first: its states as badges and the action that resolves each one. */
export function PortfolioActionItems({ groups, nowSeconds }: { groups: readonly PortfolioActionGroup[]; nowSeconds: bigint }) {
	if (groups.length === 0) return null
	return (
		<section className='portfolio-action-items' aria-labelledby='portfolio-action-items-heading'>
			<h3 id='portfolio-action-items-heading'>{portfolioCopy.needsAttention}</h3>
			<ul>
				{groups.map(group => {
					const presentations = group.items.map(item => ({ item, ...actionItemPresentation(item) }))
					return (
						<li key={group.pool}>
							<div className='portfolio-action-item-subject'>
								<span className='portfolio-action-item-title'>{group.title}</span>
								{presentations.map(({ item, label, tone }) => (
									<Badge key={item.kind} tone={tone}>
										{label}
									</Badge>
								))}
							</div>
							<span className='portfolio-action-item-deadline'>{group.deadline === undefined ? portfolioCopy.noDeadline : <TimestampValue timestamp={group.deadline} currentTimestamp={nowSeconds} />}</span>
							<div className='portfolio-action-item-links'>
								{presentations.map(({ action, href, item }) => (
									<a key={item.kind} className='button-link secondary-link' href={href} aria-label={portfolioCopy.actionFor(action, group.title)}>
										{action}
									</a>
								))}
							</div>
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
