import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import type { OverviewPanelsProps } from '../types/components.js'

export function OverviewPanels({ accountState, isConnectingWallet, isLoadingUniverseRepBalance, onConnect, onGoToGenesisUniverse, onRefresh, universeErrorMessage, universeLabel, universeRepBalance, isRefreshing, walletBootstrapComplete }: OverviewPanelsProps) {
	const isWalletLoading = isConnectingWallet || !walletBootstrapComplete
	const showAccountBalances = accountState.address !== undefined && !isWalletLoading

	return (
		<section className='overview-shell'>
			<article className='panel overview-panel overview-wallet-panel'>
				<div className='panel-header overview-wallet-header'>
					<div className='overview-wallet-summary'>
						<div className='overview-brand-lockup'>
							<h1 className='overview-app-title'>Augur PLACEHOLDER</h1>
						</div>
						<div className='overview-inline-metrics'>
							<div className='overview-address-metric'>
								<span className='metric-label'>Address</span>
								<strong>
									{isWalletLoading ? (
										<span className='loading-value'>
											<span className='spinner' aria-hidden='true' />
											Connecting...
										</span>
									) : accountState.address === undefined ? (
										'Not connected'
									) : (
										<AddressValue address={accountState.address} />
									)}
								</strong>
							</div>
							{showAccountBalances ? (
								<>
									<div>
										<span className='metric-label'>ETH</span>
										<strong>
											<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix='ETH' />
										</strong>
									</div>
									<div>
										<span className='metric-label'>REP</span>
										<strong>
											<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix='REP' />
										</strong>
									</div>
								</>
							) : undefined}
							<div>
								<span className='metric-label'>Universe</span>
								<strong className={universeErrorMessage === undefined ? undefined : 'overview-universe-error'}>{universeErrorMessage ?? universeLabel}</strong>
								{universeErrorMessage === undefined ? undefined : (
									<div className='overview-universe-actions'>
										<button className='secondary' onClick={onGoToGenesisUniverse}>
											Go to Genesis universe
										</button>
									</div>
								)}
							</div>
						</div>
					</div>
					<div className='actions overview-actions'>
						<button className='secondary' onClick={onRefresh} disabled={isRefreshing}>
							{isRefreshing ? 'Refreshing...' : 'Refresh'}
						</button>
						{accountState.address === undefined ? (
							<button onClick={onConnect} disabled={isWalletLoading}>
								{isWalletLoading ? 'Connecting...' : 'Connect Wallet'}
							</button>
						) : undefined}
					</div>
				</div>
			</article>
		</section>
	)
}
