import { useState } from 'preact/hooks'
import type { ComponentChildren } from 'preact'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import type { WalletSummaryState } from '../lib/walletSummaryState.js'
import * as copy from '../copy/app.js'

export function WalletSummary({ summary, onRetry, children, simulation = false }: { summary: WalletSummaryState; onRetry?(): void; children?: ComponentChildren; simulation?: boolean }) {
	const [expanded, setExpanded] = useState(false)
	const loading = summary.status === 'loading'
	const ready = summary.status === 'ready'
	return (
		<section class='trading-wallet-summary' aria-label={copy.connectedWalletBalances} aria-busy={loading}>
			<DataGrid className={`overview-inline-metrics${expanded ? ' mobile-expanded' : ''}`} columns='auto'>
				<MetricField className='overview-address-metric' label={copy.connectedAccount}>
					{summary.account === undefined ? copy.notConnected : <AddressValue address={summary.account} responsiveAbbreviation />}
				</MetricField>
				{summary.account === undefined ? null : (
					<>
						<MetricField className='overview-simulation-secondary' label={copy.eth}>
							<span data-wallet-asset='ETH'>
								<CurrencyValue value={ready ? summary.ethAttoEth : undefined} loading={loading} suffix={copy.eth} compactWhenOverflow exactWhenRoundedToZero />
							</span>
						</MetricField>
						<MetricField className='overview-simulation-secondary' label={copy.rep}>
							<span data-wallet-asset='REP'>
								<CurrencyValue value={ready ? summary.repAttoRep : undefined} loading={loading} suffix={copy.rep} compactWhenOverflow exactWhenRoundedToZero />
							</span>
						</MetricField>
					</>
				)}
				{children}
			</DataGrid>
			{simulation && summary.account !== undefined ? (
				<button class='overview-details-toggle secondary' type='button' aria-expanded={expanded} onClick={() => setExpanded(current => !current)}>
					{expanded ? copy.hideEnvironmentDetails : copy.showEnvironmentDetails}
				</button>
			) : null}
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
