import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { LockedCaption, LpHolding, OUTCOME_HOLDING_CLASS, OutcomeHolding } from './OutcomeHolding.js'
import { OUTCOME_BALANCE_KEYS, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { marketsCopy } from '../copy/markets.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as workflowCopy from '../copy/workflows.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BackingDetails } from './BackingDetails.js'
import { isUnresolvedRedemptionBlocked, shareOutcome } from '../lib/shareValue.js'
import * as payoutCopy from '../copy/payout.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import type { TicketBalances, TicketWallet } from './LivePositionControls.js'

function walletBalanceLabel(value: bigint | undefined, outcome: ShareOutcome, balanceState: BalanceState, market: LiveMarket) {
	if (value !== undefined) return <OutcomeHolding amount={value} outcome={outcome} market={market} noteRedemption={false} />
	// One loading line under the list speaks for all three cells.
	if (balanceState === 'loading') return commonCopy.metricUnavailablePlaceholder
	if (balanceState === 'error') return appCopy.unavailable
	return commonCopy.metricUnavailablePlaceholder
}

/**
 * The wallet's Yes, No, and Invalid shares in this market, and its LP tokens once it holds some, shown in the reading
 * column so every ticket view keeps them in sight. Each quantity names its outcome, so no caption repeats it; a balance a
 * fork migration locked says so. `ownsBalanceError` is false while the open ticket view (liquidity or settlement)
 * already reports a failed balance read with its retry.
 */
export function MarketPosition({ market, holdings, wallet, disabled, ownsBalanceError }: { market: LiveMarket; holdings: TicketBalances; wallet: Pick<TicketWallet, 'networkMismatchReason'>; disabled: boolean; ownsBalanceError: boolean }) {
	const lp = holdings.balances?.lp ?? 0n
	const holdsOutcomeShares = OUTCOME_BALANCE_KEYS.some(key => (holdings.balances?.[key] ?? 0n) > 0n)
	return (
		<section className='market-position' aria-labelledby='market-position-heading' aria-busy={holdings.balanceState === 'loading'}>
			<h3 id='market-position-heading'>{marketsCopy.yourPosition}</h3>
			{/* Blocked redemption applies to every share alike, so it is said once, under the heading, and only to a wallet that holds shares. */}
			{holdsOutcomeShares && isUnresolvedRedemptionBlocked(market) ? <UserMessage className='market-position-note' tone='warning' detail={payoutCopy.redemptionUnavailable} /> : undefined}
			{/* Without a wallet there is no position to show; the ticket's primary button offers to connect. */}
			{holdings.balanceState === 'disconnected' && holdings.balances === undefined ? (
				<UserMessage className='market-position-disconnected' detail={marketsCopy.connectToSeePosition} />
			) : (
				<ul className='portfolio-holdings market-holdings'>
					{OUTCOME_BALANCE_KEYS.map(key => (
						<li key={key} className={OUTCOME_HOLDING_CLASS[shareOutcome[key]]} data-outcome={key}>
							<span className='holding-quantity'>{walletBalanceLabel(holdings.balances?.[key], shareOutcome[key], holdings.balanceState, market)}</span>
							<LockedCaption balances={holdings.balances} outcome={shareOutcome[key]} />
						</li>
					))}
					{lp === 0n ? undefined : (
						<li data-outcome='lp'>
							<span className='holding-quantity'>
								<LpHolding amount={lp} market={market} rounding='down' />
							</span>
						</li>
					)}
				</ul>
			)}
			{holdings.balanceState === 'loading' ? <LoadingText>{appCopy.loadingBalances}</LoadingText> : undefined}
			{ownsBalanceError && holdings.balanceState === 'error' && wallet.networkMismatchReason === undefined ? <BalanceLoadError message={appCopy.formatWalletBalancesUnavailable(holdings.balanceError ?? workflowCopy.balanceRefreshFailed)} retry={holdings.retry} disabled={disabled} /> : null}
			<BackingDetails market={market} balances={holdings.balances} />
		</section>
	)
}
