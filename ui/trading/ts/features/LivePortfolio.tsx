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
import { SecurityPoolLink } from '../components/SecurityPoolLink.js'
import type { LiveBalances, LiveMarket } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import type { BalanceState, PortfolioBalanceEntry } from './live/liveTradingTypes.js'
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
			<DataGrid columns={3} dense>
				<MetricField label={portfolioCopy.yes}>
					<OutcomeHolding amount={balances.yes} outcome={portfolioCopy.yes} market={market} />
				</MetricField>
				<MetricField label={portfolioCopy.no}>
					<OutcomeHolding amount={balances.no} outcome={portfolioCopy.no} market={market} />
				</MetricField>
				<MetricField label={portfolioCopy.invalid}>
					<OutcomeHolding amount={balances.invalid} outcome={portfolioCopy.invalid} market={market} />
				</MetricField>
			</DataGrid>
			<WorkflowSubsection title={portfolioCopy.lpClaims}>
				<DataGrid dense>
					<MetricField label={portfolioCopy.lpTokens}>{formatLpQuantity(balances.lp, 4, 'down')}</MetricField>
					<MetricField label={portfolioCopy.lpYesClaim}>{formatOutcomeQuantity(yesClaim, portfolioCopy.yes)}</MetricField>
					<MetricField label={portfolioCopy.lpNoClaim}>{formatOutcomeQuantity(noClaim, portfolioCopy.no)}</MetricField>
					<MetricField label={portfolioCopy.claimCoveredByInvalid}>{formatCompleteSetQuantity(coveredSets)}</MetricField>
				</DataGrid>
			</WorkflowSubsection>
			<WorkflowSubsection title={portfolioCopy.insuredExits}>
				<DataGrid dense>
					<MetricField label={portfolioCopy.maximumInsuredYesExit}>{formatCollateralEth(maximumYesExit, market, 'down')}</MetricField>
					<MetricField label={portfolioCopy.maximumInsuredNoExit}>{formatCollateralEth(maximumNoExit, market, 'down')}</MetricField>
					{availability.completeSets === 0n ? undefined : (
						<MetricField label={availability.canRedeemCompleteSets ? payoutCopy.redemptionValue : payoutCopy.backingValue}>
							{market.loadError === undefined ? formatCollateralEth(availability.completeSets, market) : payoutCopy.unavailable}
							<small class='payout-caption'>{formatCompleteSetQuantity(availability.completeSets)}</small>
						</MetricField>
					)}
				</DataGrid>
			</WorkflowSubsection>
			{market.questionOutcome === 3 && market.loadError === undefined ? (
				<p class='detail payout-note'>
					{payoutCopy.conditionalNote} {payoutCopy.holdingFeeNote}
				</p>
			) : null}
		</>
	)
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
						<div data-portfolio-pool={entry.market.pool} key={entry.market.pool}>
							<EntityCard title={entry.market.title} badge={entry.error === undefined ? undefined : <Badge tone='warning'>{portfolioCopy.balanceUnavailable}</Badge>}>
								<DataGrid dense>
									<MetricField label={portfolioCopy.securityPool}>
										<SecurityPoolLink value={entry.market.pool} />
									</MetricField>
								</DataGrid>
								{entry.error === undefined ? null : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(entry.error)} retry={retryBalances} />}
								{entry.balances === undefined ? null : <LivePortfolioBalanceMetrics market={entry.market} balances={entry.balances} />}
							</EntityCard>
						</div>
					))}
				</div>
			)}
		</div>
	)
}
