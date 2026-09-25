import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { OutcomeHolding } from './OutcomeHolding.js'
import { settlementAvailability } from '../protocol/settlement.js'
import * as payoutCopy from '../copy/payout.js'
import { formatCollateralEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity } from '../lib/shareValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { SecurityPoolLink } from '../components/SecurityPoolLink.js'
import type { LiveBalances, LiveMarket } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import type { BalanceState, PortfolioBalanceEntry } from './live/liveTradingTypes.js'
import { liveCopy } from '../copy/live.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { lpReserveClaims, portfolioOverview, type PortfolioValuation } from './portfolioModel.js'
import { PortfolioActionItems, PortfolioRowActions, PortfolioRowValue, PortfolioSummary } from './PortfolioOverview.js'

function LivePortfolioBalanceMetrics({ market, balances, valuation }: { market: LiveMarket; balances: LiveBalances; valuation: PortfolioValuation }) {
	const availability = settlementAvailability(market, balances)
	const { yes: yesClaim, no: noClaim } = lpReserveClaims(market, balances.lp)
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<>
			<div className='portfolio-position-summary'>
				<div className='portfolio-position-values'>
					<PortfolioRowValue valuation={valuation} />
					{availability.completeSets === 0n ? undefined : (
						<div className='portfolio-position-value is-secondary'>
							<span className='metric-label'>{availability.canRedeemCompleteSets ? payoutCopy.redemptionValue : payoutCopy.backingValue}</span>
							<strong>{market.loadError === undefined ? formatCollateralEth(availability.completeSets, market) : payoutCopy.unavailable}</strong>
							<small className='payout-caption'>{formatCompleteSetQuantity(availability.completeSets)}</small>
						</div>
					)}
				</div>
				<ul className='portfolio-holdings'>
					{balances.yes === 0n ? undefined : (
						<li className='portfolio-holding-yes'>
							<OutcomeHolding amount={balances.yes} outcome={portfolioCopy.yes} market={market} />
						</li>
					)}
					{balances.no === 0n ? undefined : (
						<li className='portfolio-holding-no'>
							<OutcomeHolding amount={balances.no} outcome={portfolioCopy.no} market={market} />
						</li>
					)}
					{balances.invalid === 0n ? undefined : (
						<li>
							<OutcomeHolding amount={balances.invalid} outcome={portfolioCopy.invalid} market={market} />
						</li>
					)}
					{balances.lp === 0n ? undefined : <li>{formatLpQuantity(balances.lp, 4, 'down')}</li>}
				</ul>
			</div>
			<ReadOnlyDetailAccordion title={portfolioCopy.positionDetails}>
				<SecurityPoolLink value={market.pool} />
				{balances.lp === 0n ? undefined : (
					<WorkflowSubsection title={portfolioCopy.lpClaims}>
						<DataGrid dense>
							<MetricField label={portfolioCopy.lpYesClaim}>{formatOutcomeQuantity(yesClaim, portfolioCopy.yes)}</MetricField>
							<MetricField label={portfolioCopy.lpNoClaim}>{formatOutcomeQuantity(noClaim, portfolioCopy.no)}</MetricField>
							<MetricField label={portfolioCopy.claimCoveredByInvalid}>{formatCompleteSetQuantity(coveredSets)}</MetricField>
						</DataGrid>
					</WorkflowSubsection>
				)}
				<WorkflowSubsection title={portfolioCopy.insuredExits}>
					<DataGrid dense>
						<MetricField label={portfolioCopy.maximumInsuredYesExit}>{formatCollateralEth(maximumYesExit, market, 'down')}</MetricField>
						<MetricField label={portfolioCopy.maximumInsuredNoExit}>{formatCollateralEth(maximumNoExit, market, 'down')}</MetricField>
					</DataGrid>
				</WorkflowSubsection>
			</ReadOnlyDetailAccordion>
			{market.questionOutcome === 3 && market.loadError === undefined ? (
				<p className='detail payout-note'>
					{payoutCopy.conditionalNote} {payoutCopy.holdingFeeNote}
				</p>
			) : null}
		</>
	)
}

function renderPortfolioStatus(entry: PortfolioBalanceEntry) {
	if (entry.error !== undefined) return <Badge tone='warning'>{portfolioCopy.balanceUnavailable}</Badge>
	if (entry.market.loadError !== undefined) return <Badge tone='warning'>{portfolioCopy.marketUnavailable}</Badge>
	if (entry.market.universeForkTime !== 0n || entry.market.systemState !== 0) return <Badge tone='warning'>{portfolioCopy.settlementRequired}</Badge>
	if (entry.market.questionOutcome !== 3) return <Badge tone='muted'>{portfolioCopy.resolved}</Badge>
	return undefined
}

function hasPortfolioBalance(balances: LiveBalances) {
	return balances.yes > 0n || balances.no > 0n || balances.invalid > 0n || balances.lp > 0n
}

type PortfolioWalletAction = Readonly<{ label: string; disabled: boolean; onClick(): void }>

export function LivePortfolio({
	entries,
	balanceState,
	balanceError,
	retryBalances,
	nowSeconds,
	walletAction,
}: {
	entries: readonly PortfolioBalanceEntry[]
	balanceState: BalanceState
	balanceError: string | undefined
	retryBalances(): Promise<void>
	nowSeconds: bigint
	/** Inline connect or switch-network control for the disconnected state. */
	walletAction?: PortfolioWalletAction | undefined
}) {
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	const overview = portfolioOverview(visibleEntries, nowSeconds)
	const showSummary = balanceState === 'ready' && visibleEntries.length > 0
	return (
		<div className='portfolio-positions' aria-busy={balanceState === 'loading'}>
			{balanceState === 'disconnected' ? (
				<EmptyState
					title={portfolioCopy.disconnectedGuidance}
					actions={
						walletAction === undefined ? undefined : (
							<button className='primary' type='button' disabled={walletAction.disabled} onClick={walletAction.onClick}>
								{walletAction.label}
							</button>
						)
					}
				/>
			) : null}
			{balanceState === 'loading' ? <EmptyState live title={portfolioCopy.loadingPoolBalances} /> : null}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? portfolioCopy.portfolioBalancesUnavailable} retry={retryBalances} /> : null}
			{balanceState === 'ready' && visibleEntries.length === 0 ? <EmptyState title={portfolioCopy.noPortfolioBalances} /> : null}
			{showSummary ? <PortfolioSummary overview={overview} /> : null}
			{showSummary ? <PortfolioActionItems items={overview.actionItems} nowSeconds={nowSeconds} /> : null}
			{visibleEntries.length === 0 ? null : (
				<div className='entity-card-list'>
					{overview.rows.map(row => (
						<EntityCard
							surface='card'
							className='portfolio-record'
							headerActions={row.canSell || row.canRedeem ? <PortfolioRowActions row={row} /> : undefined}
							key={row.entry.market.pool}
							dataAttributes={{ 'data-portfolio-pool': row.entry.market.pool }}
							title={<a href={getTradingRouteHref(`#/market/${row.entry.market.pool}`)}>{row.entry.market.title}</a>}
						>
							{renderPortfolioStatus(row.entry)}
							{row.entry.market.loadError === undefined ? (
								<p className='detail'>
									{liveCopy.questionEnd}: <TimestampValue timestamp={row.entry.market.endTime} relative={false} />
								</p>
							) : undefined}
							{row.entry.balances === undefined ? <SecurityPoolLink value={row.entry.market.pool} /> : undefined}
							{row.entry.error === undefined ? null : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(row.entry.error)} retry={retryBalances} />}
							{row.entry.balances === undefined ? null : <LivePortfolioBalanceMetrics market={row.entry.market} balances={row.entry.balances} valuation={row.valuation} />}
						</EntityCard>
					))}
				</div>
			)}
		</div>
	)
}
