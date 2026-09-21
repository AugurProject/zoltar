import { useState } from 'preact/hooks'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { EnvironmentDetailsToggle, HeaderMetricStrip } from '@zoltar/ui-core-shared/components/HeaderMetricStrip.js'
import { WalletBalanceGroup } from '@zoltar/ui-core-shared/components/WalletBalanceGroup.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

export function WalletSummary({ summary, onRetry, simulation = false }: { summary: WalletSummaryState; onRetry?(): void; simulation?: boolean }) {
	const [expanded, setExpanded] = useState(false)
	const loading = summary.status === 'loading'
	const ready = summary.status === 'ready'
	return (
		<section class='trading-wallet-summary' aria-label={copy.connectedWalletBalances} aria-busy={loading}>
			<HeaderMetricStrip expanded={expanded}>
				<WalletBalanceGroup
					balances={[
						{ asset: commonCopy.eth, exactWhenRoundedToZero: true, loading, value: ready ? summary.ethAttoEth : undefined },
						{ asset: commonCopy.rep, exactWhenRoundedToZero: true, loading, value: ready ? summary.repAttoRep : undefined },
					]}
				/>
			</HeaderMetricStrip>
			{simulation && summary.account !== undefined ? <EnvironmentDetailsToggle expanded={expanded} onToggle={() => setExpanded(current => !current)} /> : null}
			{summary.status === 'error' ? (
				<div class='trading-wallet-error'>
					<span class='error' role='alert' title={summary.error} aria-label={copy.walletBalanceError(summary.errorLabel, summary.error)}>
						{summary.errorLabel ?? copy.balancesUnavailable}
					</span>
					{onRetry === undefined ? null : (
						<button class='secondary' type='button' onClick={onRetry}>
							{copy.retry}
						</button>
					)}
				</div>
			) : null}
			{loading ? (
				<span class='visually-hidden' role='status'>
					{copy.loadingWalletBalances}
				</span>
			) : null}
		</section>
	)
}
