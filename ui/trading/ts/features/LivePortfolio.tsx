import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import * as availabilityCopy from '../copy/availability.js'
import type { ComponentChildren } from 'preact'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { OutcomeHolding } from './OutcomeHolding.js'
import { settlementAvailability } from '../protocol/settlement.js'
import * as payoutCopy from '../copy/payout.js'
import { formatCollateralEth, formatCompleteSetQuantity, formatLpQuantity, formatOutcomeQuantity, shareOutcome } from '../lib/shareValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { TradingSecurityPoolLink } from '../components/TradingSecurityPoolLink.js'
import type { LiveBalances, LiveMarket } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/trading-shared/trading/positions'
import type { BalanceState, PortfolioBalanceEntry } from './live/liveTradingTypes.js'
import { liveCopy } from '../copy/live.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { lpReserveClaims, portfolioOverview, type PortfolioValuation } from './portfolioModel.js'
import { PortfolioActionItems, PortfolioRowActions, PortfolioRowValue, PortfolioSummary } from './PortfolioOverview.js'

function PortfolioHoldings({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	return (
		<ul className='portfolio-holdings'>
			{balances.yes === 0n ? undefined : (
				<li className='portfolio-holding-yes'>
					<OutcomeHolding amount={balances.yes} outcome={shareOutcome.yes} market={market} />
				</li>
			)}
			{balances.no === 0n ? undefined : (
				<li className='portfolio-holding-no'>
					<OutcomeHolding amount={balances.no} outcome={shareOutcome.no} market={market} />
				</li>
			)}
			{balances.invalid === 0n ? undefined : (
				<li>
					<OutcomeHolding amount={balances.invalid} outcome={shareOutcome.invalid} market={market} />
				</li>
			)}
			{balances.lp === 0n ? undefined : <li>{formatLpQuantity(balances.lp, 4, 'down')}</li>}
		</ul>
	)
}

function PortfolioValues({ market, balances, valuation }: { market: LiveMarket; balances: LiveBalances; valuation: PortfolioValuation }) {
	const availability = settlementAvailability(market, balances)
	return (
		<div className='portfolio-position-values'>
			<PortfolioRowValue valuation={valuation} />
			{availability.completeSets === 0n ? undefined : (
				<div className='portfolio-position-value is-secondary'>
					<span className='metric-label'>{availability.canRedeemCompleteSets ? payoutCopy.redemptionValue : payoutCopy.backingValue}</span>
					<strong>{formatCompleteSetQuantity(availability.completeSets)}</strong>
					<small className='payout-caption'>({market.loadError === undefined ? formatCollateralEth(availability.completeSets, market) : payoutCopy.unavailable})</small>
				</div>
			)}
		</div>
	)
}

function PortfolioPositionDetails({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	const { yes: yesClaim, no: noClaim } = lpReserveClaims(market, balances.lp)
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<ReadOnlyDetailAccordion title={portfolioCopy.positionDetails}>
			<TradingSecurityPoolLink value={market.pool} />
			{balances.lp === 0n ? undefined : (
				<WorkflowSubsection title={portfolioCopy.lpClaims}>
					<DataGrid dense>
						<MetricField label={portfolioCopy.lpYesClaim}>{formatOutcomeQuantity(yesClaim, shareOutcome.yes)}</MetricField>
						<MetricField label={portfolioCopy.lpNoClaim}>{formatOutcomeQuantity(noClaim, shareOutcome.no)}</MetricField>
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
	)
}

/** Unresolved markets price outcome shares at their current backing; the note applies to every such row, so it is said once under the list. */
function showsConditionalPayoutNote(entry: PortfolioBalanceEntry) {
	return entry.balances !== undefined && entry.market.questionOutcome === 3 && entry.market.loadError === undefined
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

type PortfolioWalletAction = Readonly<{ label: ComponentChildren; disabled: boolean; onClick(): void }>

export function LivePortfolio({
	entries,
	balanceState,
	balanceError,
	retryBalances,
	discoveryComplete = true,
	nowSeconds,
	walletAction,
}: {
	entries: readonly PortfolioBalanceEntry[]
	balanceState: BalanceState
	balanceError: string | undefined
	retryBalances(): Promise<void>
	discoveryComplete?: boolean
	nowSeconds: bigint
	/** Inline connect or switch-network control for the disconnected state. */
	walletAction?: PortfolioWalletAction | undefined
}) {
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	const overview = portfolioOverview(visibleEntries, nowSeconds)
	const showSummary = discoveryComplete && balanceState === 'ready' && visibleEntries.length > 0
	return (
		<div className='portfolio-positions' aria-busy={balanceState === 'loading'}>
			{balanceState === 'disconnected' ? (
				<EmptyState
					title={portfolioCopy.disconnectedGuidance}
					actions={
						walletAction === undefined ? undefined : <ActionLauncherButton idleLabel={walletAction.label} pendingLabel={walletAction.label} availability={{ disabled: walletAction.disabled, reason: walletAction.disabled ? availabilityCopy.transactionInProgressReason : undefined }} onClick={walletAction.onClick} />
					}
				/>
			) : null}
			{balanceState === 'loading' ? <EmptyState live title={portfolioCopy.loadingPoolBalances} /> : null}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? portfolioCopy.portfolioBalancesUnavailable} retry={retryBalances} /> : null}
			{balanceState === 'ready' && visibleEntries.length === 0 ? <EmptyState title={portfolioCopy.noPortfolioBalances} /> : null}
			{showSummary ? <PortfolioSummary overview={overview} /> : null}
			{showSummary ? <PortfolioActionItems items={overview.actionItems} nowSeconds={nowSeconds} /> : null}
			{visibleEntries.length === 0 ? null : (
				<ul className='portfolio-position-list' aria-label={portfolioCopy.positions}>
					{overview.rows.map(row => {
						const { market, balances, error } = row.entry
						return (
							<li key={market.pool} className='portfolio-position-row' data-portfolio-pool={market.pool}>
								<div className='portfolio-position-market'>
									<h3>
										<a href={getTradingRouteHref(`#/market/${market.pool}`)}>{market.title}</a>
									</h3>
									{renderPortfolioStatus(row.entry)}
									{market.loadError === undefined ? (
										<p className='detail'>
											{liveCopy.questionEnd}: <TimestampValue timestamp={market.endTime} relative={false} />
										</p>
									) : undefined}
									{balances === undefined ? <TradingSecurityPoolLink value={market.pool} /> : undefined}
								</div>
								{balances === undefined ? null : <PortfolioHoldings market={market} balances={balances} />}
								{balances === undefined ? null : <PortfolioValues market={market} balances={balances} valuation={row.valuation} />}
								{row.canSell || row.canRedeem ? (
									<div className='portfolio-position-actions'>
										<PortfolioRowActions row={row} />
									</div>
								) : null}
								{error === undefined && balances === undefined ? null : (
									<div className='portfolio-position-extra'>
										{error === undefined ? null : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(error)} retry={retryBalances} />}
										{balances === undefined ? null : <PortfolioPositionDetails market={market} balances={balances} />}
									</div>
								)}
							</li>
						)
					})}
				</ul>
			)}
			{overview.rows.some(row => showsConditionalPayoutNote(row.entry)) ? (
				<UserMessage
					className='detail payout-note'
					detail={
						<>
							{payoutCopy.conditionalNote} {payoutCopy.holdingFeeNote}
						</>
					}
				/>
			) : null}
		</div>
	)
}
