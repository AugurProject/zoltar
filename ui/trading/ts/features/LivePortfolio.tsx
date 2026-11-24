import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { ActionLauncherButton } from '@zoltar/ui-core-shared/components/ActionLauncherButton.js'
import * as availabilityCopy from '../copy/availability.js'
import type { ComponentChildren } from 'preact'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { LockedCaption, LpHolding, OutcomeHoldingItem } from './OutcomeHolding.js'
import { settlementAvailability } from '../protocol/settlement.js'
import * as payoutCopy from '../copy/payout.js'
import { formatCollateralEth, formatCompleteSetQuantity, formatCompleteSetWithValue, formatOutcomeWithValue, shareOutcome } from '../lib/shareValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { EmptyState } from '@zoltar/ui-core-shared/components/EmptyState.js'
import { formatRootUniverseName, formatUniverseDisplayLabel } from '@zoltar/ui-core-shared/lib/universeLabels.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js'
import { ReadOnlyDetailAccordion } from '@zoltar/ui-core-shared/components/ReadOnlyDetailAccordion.js'
import { getTradingRouteHref } from '../lib/routing.js'
import { TradingQuestionLedgerLink } from '../components/TradingQuestionLedgerLink.js'
import { marketAcceptsNewRisk, OUTCOME_BALANCE_KEYS, type LiveBalances, type LiveMarket } from '../protocol/live.js'
import { maximumInsuredSellEstimate } from './live/tradeTicketModel.js'
import { DEFAULT_TRADE_SETTINGS, type TradeSettings } from '../lib/tradeSettings.js'
import type { BalanceState, PortfolioBalanceEntry } from './live/liveTradingTypes.js'
import { liveCopy } from '../copy/live.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import * as appCopy from '../copy/app.js'
import * as blockerCopy from '../copy/marketBlockers.js'
import * as portfolioCopy from '../copy/portfolio.js'
import { marketsCopy } from '../copy/markets.js'
import { lpReserveClaims, portfolioOverview, type PortfolioValuation } from './portfolioModel.js'
import { PortfolioActionItems, PortfolioRowActions, PortfolioRowValue, PortfolioSummary } from './PortfolioOverview.js'

/** A row's holdings; when redemption is blocked, the row's value caption already says why (migrate after a fork, or the pool is inactive), so no holding repeats it. */
function PortfolioHoldings({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	return (
		<ul className='portfolio-holdings'>
			{OUTCOME_BALANCE_KEYS.map(key =>
				balances[key] === 0n ? undefined : (
					<OutcomeHoldingItem key={key} amount={balances[key]} outcome={shareOutcome[key]} market={market} noteRedemption={false}>
						<LockedCaption balances={balances} outcome={shareOutcome[key]} />
					</OutcomeHoldingItem>
				),
			)}
			{balances.lp === 0n ? undefined : (
				<li>
					<LpHolding amount={balances.lp} market={market} rounding='down' />
				</li>
			)}
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
					<strong>{formatCompleteSetQuantity(availability.completeSets, 4, 'nearest', market)}</strong>
					<small className='payout-caption'>({market.loadError === undefined ? formatCollateralEth(availability.completeSets, market) : payoutCopy.unavailable})</small>
				</div>
			)}
		</div>
	)
}

function PortfolioPositionDetails({ market, balances, settings, nowSeconds }: { market: LiveMarket; balances: LiveBalances; settings: TradeSettings; nowSeconds: bigint }) {
	const { yes: yesClaim, no: noClaim } = lpReserveClaims(market, balances.lp)
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const canExit = market.loadError === undefined && market.pair !== undefined && market.lpTotalSupply > 0n && marketAcceptsNewRisk(market, nowSeconds)
	const maximumYesExit = canExit ? (maximumInsuredSellEstimate(market, 'YES', balances, settings.slippageBps)?.quote.completeSetShares ?? 0n) : 0n
	const maximumNoExit = canExit ? (maximumInsuredSellEstimate(market, 'NO', balances, settings.slippageBps)?.quote.completeSetShares ?? 0n) : 0n
	return (
		<ReadOnlyDetailAccordion title={portfolioCopy.positionDetails}>
			<TradingQuestionLedgerLink value={market.pool} />
			{balances.lp === 0n ? undefined : (
				<WorkflowSubsection title={portfolioCopy.lpClaims}>
					<DataGrid dense>
						<MetricField label={portfolioCopy.lpYesClaim}>{formatOutcomeWithValue(yesClaim, shareOutcome.yes, market, 4, 'nearest', { noteRedemption: false })}</MetricField>
						<MetricField label={portfolioCopy.lpNoClaim}>{formatOutcomeWithValue(noClaim, shareOutcome.no, market, 4, 'nearest', { noteRedemption: false })}</MetricField>
						<MetricField label={portfolioCopy.claimInsuredByInvalid}>{formatCompleteSetWithValue(coveredSets, market)}</MetricField>
					</DataGrid>
				</WorkflowSubsection>
			)}
			{canExit ? (
				<WorkflowSubsection title={portfolioCopy.insuredExits}>
					<DataGrid dense>
						<MetricField label={portfolioCopy.maximumInsuredYesExit}>{formatCollateralEth(maximumYesExit, market, 'down')}</MetricField>
						<MetricField label={portfolioCopy.maximumInsuredNoExit}>{formatCollateralEth(maximumNoExit, market, 'down')}</MetricField>
					</DataGrid>
				</WorkflowSubsection>
			) : undefined}
		</ReadOnlyDetailAccordion>
	)
}

/** Unresolved markets price outcome shares at their current backing; the note applies to every such row, so it is said once under the list. */
function showsConditionalPayoutNote(entry: PortfolioBalanceEntry) {
	return entry.balances !== undefined && entry.market.questionOutcome === 3 && entry.market.loadError === undefined
}

function renderPortfolioStatus(entry: PortfolioBalanceEntry) {
	if (entry.error !== undefined) return <Badge tone='warning'>{portfolioCopy.balancesUnavailable}</Badge>
	if (entry.market.loadError !== undefined) return <Badge tone='warning'>{liveCopy.marketDataUnavailable}</Badge>
	if (entry.market.systemState === 0 && entry.market.questionOutcome !== 3) return <Badge tone='muted'>{marketsCopy.resolved}</Badge>
	if (entry.market.universeForkTime !== 0n) return <Badge tone='warning'>{blockerCopy.universeForked}</Badge>
	if (entry.market.systemState !== 0) return <Badge tone='warning'>{blockerCopy.poolInactive}</Badge>
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
	universeId,
	settings = DEFAULT_TRADE_SETTINGS,
}: {
	entries: readonly PortfolioBalanceEntry[]
	balanceState: BalanceState
	balanceError: string | undefined
	retryBalances(): Promise<void>
	discoveryComplete?: boolean
	nowSeconds: bigint
	settings?: TradeSettings
	/** Inline connect or switch-network control for the disconnected state. */
	walletAction?: PortfolioWalletAction | undefined
	/** The universe the positions were read from; the empty state names it and offers to switch. */
	universeId?: bigint | undefined
}) {
	// Saved pools are listed while their balances load; once every read has answered, only pools with a balance or an error remain.
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	const overview = portfolioOverview(visibleEntries, nowSeconds)
	const showSummary = discoveryComplete && balanceState === 'ready' && visibleEntries.length > 0
	return (
		<div className='portfolio-positions' aria-busy={balanceState === 'loading'}>
			{balanceState === 'disconnected' ? (
				<EmptyState
					title={portfolioCopy.disconnectedTitle}
					actions={
						walletAction === undefined ? undefined : <ActionLauncherButton idleLabel={walletAction.label} pendingLabel={walletAction.label} availability={{ disabled: walletAction.disabled, reason: walletAction.disabled ? availabilityCopy.transactionInProgressReason : undefined }} onClick={walletAction.onClick} />
					}
				/>
			) : undefined}
			{balanceState === 'loading' ? <EmptyState live title={appCopy.loadingBalances} /> : undefined}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? portfolioCopy.portfolioBalancesUnavailable} retry={retryBalances} /> : undefined}
			{balanceState === 'ready' && visibleEntries.length === 0 ? (
				<EmptyState
					title={universeId === undefined ? portfolioCopy.noPositions : portfolioCopy.noPositionsInUniverse(universeId === 0n ? formatRootUniverseName() : formatUniverseDisplayLabel(universeId))}
					detail={portfolioCopy.noPortfolioBalances}
					actions={
						<>
							<a className='button-link primary' href={getTradingRouteHref('#/market')}>
								{portfolioCopy.browseMarkets}
							</a>
							{universeId === undefined ? undefined : (
								<a className='button-link secondary-link' href={getTradingRouteHref('#/universe')}>
									{marketsCopy.switchUniverse}
								</a>
							)}
						</>
					}
				/>
			) : undefined}
			{showSummary ? <PortfolioSummary overview={overview} /> : undefined}
			{showSummary ? <PortfolioActionItems groups={overview.actionGroups} nowSeconds={nowSeconds} /> : undefined}
			{visibleEntries.length === 0 ? undefined : (
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
									{balances === undefined ? <TradingQuestionLedgerLink value={market.pool} /> : undefined}
								</div>
								{balances === undefined ? undefined : <PortfolioHoldings market={market} balances={balances} />}
								{balances === undefined ? undefined : <PortfolioValues market={market} balances={balances} valuation={row.valuation} />}
								{row.canSell || row.canRedeem ? (
									<div className='portfolio-position-actions'>
										<PortfolioRowActions row={row} />
									</div>
								) : undefined}
								{error === undefined && balances === undefined ? undefined : (
									<div className='portfolio-position-extra'>
										{error === undefined ? undefined : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(error)} retry={retryBalances} />}
										{balances === undefined ? undefined : <PortfolioPositionDetails market={market} balances={balances} settings={settings} nowSeconds={nowSeconds} />}
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
			) : undefined}
		</div>
	)
}
