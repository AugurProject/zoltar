import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { UserMessage } from '@zoltar/ui-core-shared/components/UserMessage.js'
import { OutcomeHolding } from './OutcomeHolding.js'
import type { LiveMarket, ShareOutcome } from '../protocol/live.js'
import * as appCopy from '../copy/app.js'
import { marketsCopy } from '../copy/markets.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as workflowCopy from '../copy/workflows.js'
import type { BalanceState } from './live/liveTradingTypes.js'
import { BackingDetails } from './BackingDetails.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import type { TicketBalances, TicketWallet } from './LivePositionControls.js'

function walletBalanceLabel(value: bigint | undefined, outcome: ShareOutcome, balanceState: BalanceState, market: LiveMarket) {
	if (value !== undefined) return <OutcomeHolding amount={value} outcome={outcome} market={market} />
	// One loading line under the list speaks for all three cells.
	if (balanceState === 'loading') return commonCopy.metricUnavailablePlaceholder
	if (balanceState === 'error') return appCopy.unavailable
	return commonCopy.metricUnavailablePlaceholder
}

/**
 * The wallet's Yes, No, and Invalid shares in this market, shown in the reading column so every ticket view keeps them in sight.
 * `ownsBalanceError` is false while the open ticket view (liquidity or settlement) already reports a failed balance read with its retry.
 */
export function MarketPosition({ market, holdings, wallet, disabled, ownsBalanceError }: { market: LiveMarket; holdings: TicketBalances; wallet: Pick<TicketWallet, 'networkMismatchReason'>; disabled: boolean; ownsBalanceError: boolean }) {
	const outcomes = [
		{ outcome: 'yes', className: 'portfolio-holding-yes', value: holdings.balances?.yes, quantityOutcome: 'YES', caption: workflowCopy.walletYes },
		{ outcome: 'no', className: 'portfolio-holding-no', value: holdings.balances?.no, quantityOutcome: 'NO', caption: workflowCopy.walletNo },
		{ outcome: 'invalid', className: undefined, value: holdings.balances?.invalid, quantityOutcome: 'INVALID' as const, caption: workflowCopy.walletInvalid },
	] as const
	return (
		<section className='market-position' aria-labelledby='market-position-heading' aria-busy={holdings.balanceState === 'loading'}>
			<h3 id='market-position-heading'>{marketsCopy.yourPosition}</h3>
			{/* Without a wallet there is no position to show; the ticket's primary button offers to connect. */}
			{holdings.balanceState === 'disconnected' && holdings.balances === undefined ? (
				<UserMessage className='market-position-disconnected' detail={marketsCopy.connectToSeePosition} />
			) : (
				<ul className='portfolio-holdings market-holdings'>
					{outcomes.map(item => (
						<li key={item.outcome} className={item.className} data-outcome={item.outcome}>
							<span className='holding-quantity'>{walletBalanceLabel(item.value, item.quantityOutcome, holdings.balanceState, market)}</span>
							<small className='payout-caption'>{item.caption}</small>
						</li>
					))}
				</ul>
			)}
			{holdings.balanceState === 'loading' ? <LoadingText>{appCopy.loadingBalances}</LoadingText> : undefined}
			{ownsBalanceError && holdings.balanceState === 'error' && wallet.networkMismatchReason === undefined ? <BalanceLoadError message={appCopy.formatWalletBalancesUnavailable(holdings.balanceError ?? workflowCopy.balanceRefreshFailed)} retry={holdings.retry} disabled={disabled} /> : null}
			<BackingDetails market={market} balances={holdings.balances} />
		</section>
	)
}
