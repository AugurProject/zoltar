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

function LivePortfolioBalanceMetrics({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	const availability = settlementAvailability(market, balances)
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * balances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * balances.lp) / market.lpTotalSupply
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<>
			<div class='portfolio-position-summary'>
				{availability.completeSets === 0n ? undefined : (
					<div class='portfolio-position-value'>
						<span class='metric-label'>{availability.canRedeemCompleteSets ? payoutCopy.redemptionValue : payoutCopy.backingValue}</span>
						<strong>{market.loadError === undefined ? formatCollateralEth(availability.completeSets, market) : payoutCopy.unavailable}</strong>
						<small class='payout-caption'>{formatCompleteSetQuantity(availability.completeSets)}</small>
					</div>
				)}
				<ul class='portfolio-holdings'>
					{balances.yes === 0n ? undefined : (
						<li class='portfolio-holding-yes'>
							<OutcomeHolding amount={balances.yes} outcome={portfolioCopy.yes} market={market} />
						</li>
					)}
					{balances.no === 0n ? undefined : (
						<li class='portfolio-holding-no'>
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
				<p class='detail payout-note'>
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

export function LivePortfolio({ entries, balanceState, balanceError, retryBalances }: { entries: readonly PortfolioBalanceEntry[]; balanceState: BalanceState; balanceError: string | undefined; retryBalances(): Promise<void> }) {
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	return (
		<div class='portfolio-positions' aria-busy={balanceState === 'loading'}>
			{balanceState === 'disconnected' ? <EmptyState title={portfolioCopy.disconnectedGuidance} /> : null}
			{balanceState === 'loading' ? <EmptyState live title={portfolioCopy.loadingPoolBalances} /> : null}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? portfolioCopy.portfolioBalancesUnavailable} retry={retryBalances} /> : null}
			{balanceState === 'ready' && visibleEntries.length === 0 ? <EmptyState title={portfolioCopy.noPortfolioBalances} /> : null}
			{visibleEntries.length === 0 ? null : (
				<div class='entity-card-list'>
					{visibleEntries.map(entry => (
						<EntityCard
							surface='card'
							className='portfolio-record'
							headerActions={
								<a class='button-link primary' href={getTradingRouteHref(`#/market/${entry.market.pool}`)}>
									{portfolioCopy.openPosition}
								</a>
							}
							key={entry.market.pool}
							dataAttributes={{ 'data-portfolio-pool': entry.market.pool }}
							title={entry.market.title}
						>
							{renderPortfolioStatus(entry)}
							{entry.market.loadError === undefined ? (
								<p class='detail'>
									{liveCopy.questionEnd}: <TimestampValue timestamp={entry.market.endTime} relative={false} />
								</p>
							) : undefined}
							{entry.balances === undefined ? <SecurityPoolLink value={entry.market.pool} /> : undefined}
							{entry.error === undefined ? null : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(entry.error)} retry={retryBalances} />}
							{entry.balances === undefined ? null : <LivePortfolioBalanceMetrics market={entry.market} balances={entry.balances} />}
						</EntityCard>
					))}
				</div>
			)}
		</div>
	)
}
