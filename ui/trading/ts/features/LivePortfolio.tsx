import { formatOutcomeAmount, formatShareAmount, formatUnits } from '../lib/format.js'
import { Status } from '../components/Status.js'
import { SecurityPoolAddressLink } from '../components/TradingAddress.js'
import type { LiveBalances, LiveMarket } from '../protocol/live.js'
import { maximumInsuredExit } from '@zoltar/shared/trading/positions'
import type { BalanceState, PortfolioBalanceEntry } from './live/liveTradingTypes.js'
import { BalanceLoadError } from './LiveTradingTransactionUi.js'
import * as portfolioCopy from '../copy/portfolio.js'

function LivePortfolioBalanceMetrics({ market, balances }: { market: LiveMarket; balances: LiveBalances }) {
	const yesClaim = market.lpTotalSupply === 0n ? 0n : (market.yesReserve * balances.lp) / market.lpTotalSupply
	const noClaim = market.lpTotalSupply === 0n ? 0n : (market.noReserve * balances.lp) / market.lpTotalSupply
	let coveredSets = balances.invalid
	if (yesClaim < coveredSets) coveredSets = yesClaim
	if (noClaim < coveredSets) coveredSets = noClaim
	const maximumYesExit = maximumInsuredExit({ longOutcome: 'YES', longBalance: balances.yes, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	const maximumNoExit = maximumInsuredExit({ longOutcome: 'NO', longBalance: balances.no, invalidBalance: balances.invalid, yesReserve: market.yesReserve, noReserve: market.noReserve, feeBps: market.feeBps })
	return (
		<>
			<dl class='metrics'>
				<div>
					<dt>{portfolioCopy.yes}</dt>
					<dd>{formatOutcomeAmount(balances.yes, portfolioCopy.yes)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.no}</dt>
					<dd>{formatOutcomeAmount(balances.no, portfolioCopy.no)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.invalid}</dt>
					<dd>{formatOutcomeAmount(balances.invalid, portfolioCopy.invalid)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.lpTokens}</dt>
					<dd>
						{formatUnits(balances.lp)} {portfolioCopy.lp}
					</dd>
				</div>
				<div>
					<dt>{portfolioCopy.lpYesClaim}</dt>
					<dd>{formatOutcomeAmount(yesClaim, portfolioCopy.yes)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.lpNoClaim}</dt>
					<dd>{formatOutcomeAmount(noClaim, portfolioCopy.no)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.claimCoveredByInvalid}</dt>
					<dd>{formatShareAmount(coveredSets)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.maximumInsuredYesExit}</dt>
					<dd>{formatOutcomeAmount(maximumYesExit, portfolioCopy.yes)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.maximumInsuredNoExit}</dt>
					<dd>{formatOutcomeAmount(maximumNoExit, portfolioCopy.no)}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.shareApproval}</dt>
					<dd>{balances.approved ? portfolioCopy.routerApproved : portfolioCopy.approvalRequiredForExit}</dd>
				</div>
				<div>
					<dt>{portfolioCopy.lpAllowance}</dt>
					<dd>
						{formatUnits(balances.lpAllowance)} {portfolioCopy.lp}
					</dd>
				</div>
			</dl>
			<p>{portfolioCopy.invalidOwnershipNotice}</p>
		</>
	)
}

function hasPortfolioBalance(balances: LiveBalances) {
	return balances.yes > 0n || balances.no > 0n || balances.invalid > 0n || balances.lp > 0n
}

export function LivePortfolio({ entries, balanceState, balanceError, retryBalances }: { entries: readonly PortfolioBalanceEntry[]; balanceState: BalanceState; balanceError: string | undefined; retryBalances(): Promise<void> }) {
	const visibleEntries = balanceState === 'ready' ? entries.filter(entry => entry.error !== undefined || (entry.balances !== undefined && hasPortfolioBalance(entry.balances))) : entries
	return (
		<div class='portfolio-groups' aria-busy={balanceState === 'loading'}>
			{balanceState === 'disconnected' ? <p>{portfolioCopy.disconnectedGuidance}</p> : null}
			{balanceState === 'loading' ? <p role='status'>{portfolioCopy.loadingPoolBalances}</p> : null}
			{balanceState === 'error' ? <BalanceLoadError message={balanceError ?? portfolioCopy.portfolioBalancesUnavailable} retry={retryBalances} /> : null}
			{balanceState === 'ready' && visibleEntries.length === 0 ? <p>{portfolioCopy.noPortfolioBalances}</p> : null}
			{visibleEntries.map(entry => (
				<article class='operation-block' data-portfolio-pool={entry.market.pool} key={entry.market.pool}>
					<div class='section-heading'>
						<div>
							<span class='section-kicker'>{portfolioCopy.securityPoolPosition}</span>
							<h3>{entry.market.title}</h3>
						</div>
						{entry.error === undefined ? null : <Status tone='warn'>{portfolioCopy.balanceUnavailable}</Status>}
					</div>
					<dl class='metrics'>
						<div>
							<dt>{portfolioCopy.securityPool}</dt>
							<dd>
								<SecurityPoolAddressLink value={entry.market.pool} />
							</dd>
						</div>
					</dl>
					{entry.error === undefined ? null : <BalanceLoadError message={portfolioCopy.poolBalancesUnavailable(entry.error)} retry={retryBalances} />}
					{entry.balances === undefined ? null : <LivePortfolioBalanceMetrics market={entry.market} balances={entry.balances} />}
				</article>
			))}
		</div>
	)
}
