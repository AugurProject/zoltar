import { formatUnits, shortAddress } from '../lib/format.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

export function WalletSummary({ summary, onRetry }: { summary: WalletSummaryState; onRetry?(): void }) {
	if (summary.account === undefined) return null
	let ethDisplay = '…'
	let repBalance = '…'
	if (summary.status === 'error') {
		ethDisplay = '—'
		repBalance = '—'
	} else if (summary.status === 'ready') {
		if (summary.ethAttoEth !== undefined) ethDisplay = formatUnits(summary.ethAttoEth, 18, 18)
		if (summary.repAttoRep !== undefined) repBalance = formatUnits(summary.repAttoRep, 18, 18)
	}
	return (
		<details class={`wallet-summary wallet-summary--${summary.status}`} aria-label={copy.connectedWalletBalances} aria-busy={summary.status === 'loading'} open={summary.status === 'error'}>
			<summary class='wallet-summary__trigger'>
				<code class='wallet-summary__address wallet-summary__address--full'>{summary.account}</code>
				<code class='wallet-summary__address wallet-summary__address--compact'>{shortAddress(summary.account)}</code>
				<span class='wallet-summary__compact-loading'>{copy.loadingBalances}</span>
				<div class='wallet-summary__balances'>
					<span data-wallet-asset='ETH'>
						<small>{copy.eth}</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span data-wallet-asset='REP'>
						<small>{copy.rep}</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
			</summary>
			<div class='wallet-summary__details'>
				<div class='wallet-summary__identity'>
					<span>{copy.connectedAccount}</span>
					<code>{summary.account}</code>
				</div>
				<div class='wallet-summary__detail-balances' aria-label={copy.walletBalances}>
					<span>
						<small>{copy.eth}</small>
						<strong>{ethDisplay}</strong>
					</span>
					<span>
						<small>{copy.rep}</small>
						<strong>{repBalance}</strong>
					</span>
				</div>
				{summary.status === 'error' ? (
					<span class='wallet-summary__failure'>
						<span class='wallet-summary__error' role='alert' title={summary.error} aria-label={copy.walletBalanceError(summary.errorLabel, summary.error)}>
							{summary.errorLabel ?? copy.balancesUnavailable}
						</span>
						{onRetry === undefined ? null : (
							<button class='wallet-summary__retry' type='button' onClick={onRetry}>
								{copy.retry}
							</button>
						)}
					</span>
				) : null}
			</div>
			{summary.status === 'loading' ? (
				<span class='visually-hidden' role='status'>
					{copy.loadingWalletBalances}
				</span>
			) : null}
		</details>
	)
}
