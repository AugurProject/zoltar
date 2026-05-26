import { RouteHeader } from './RouteHeader.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { MetricField } from './MetricField.js'
import { StateHint } from './StateHint.js'
import { TransactionActionButton } from './TransactionActionButton.js'
import { renderRepPriceSourceLabel } from '../lib/repPriceSource.js'
import type { OverviewPanelsProps } from '../types/components.js'
export function OverviewPanels({
	accountState,
	isConnectingWallet,
	isLoadingRepPrices,
	isLoadingUniverseRepBalance,
	onConnect,
	onGoToGenesisUniverse,
	onRefreshRepPrices,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	repUsdcPrice,
	repUsdcSource,
	repUsdcSourceUrl,
	universePresentation,
	universeLabel,
	universeRepBalance,
	isRefreshing,
	walletBootstrapComplete,
}: OverviewPanelsProps) {
	const isWalletBootstrapLoading = !walletBootstrapComplete && accountState.address === undefined
	const isWalletAddressLoading = isConnectingWallet || isWalletBootstrapLoading
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined
	return (
		<section className='overview-shell'>
			<article className='overview-panel overview-wallet-panel'>
				<RouteHeader eyebrow='Operations' title='Augur PLACEHOLDER' actions={accountState.address === undefined ? <TransactionActionButton idleLabel='Connect wallet' pendingLabel='Connecting...' onClick={onConnect} pending={isConnectingWallet} /> : undefined} />
				<DataGrid className='overview-inline-metrics' columns='auto'>
					<MetricField className='overview-address-metric' label='Address'>
						{(() => {
							if (isWalletAddressLoading)
								return (
									<span className='loading-value'>
										<span className='spinner' aria-hidden='true' />
										Connecting...
									</span>
								)
							if (accountState.address === undefined) return 'Not connected'

							return <AddressValue address={accountState.address} />
						})()}
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField label='ETH'>
								<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix='ETH' compactWhenOverflow />
							</MetricField>
							<MetricField label='WETH'>
								<CurrencyValue value={accountState.wethBalance} loading={isRefreshing && accountState.wethBalance === undefined} suffix='WETH' compactWhenOverflow />
							</MetricField>
							<MetricField label='REP'>
								<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix='REP' compactWhenOverflow />
							</MetricField>
						</>
					) : undefined}
					<MetricField
						label={
							<span className='metric-label-with-action'>
								<span>REP/ETH {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}</span>
								<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isLoadingRepPrices} aria-label='Refresh REP prices' title={isLoadingRepPrices ? 'Refreshing REP prices...' : 'Refresh REP prices'}>
									↻
								</button>
							</span>
						}
					>
						<CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} />
					</MetricField>
					<MetricField label={<>REP/USDC {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}</>}>
						<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix='USDC' units={6} />
					</MetricField>
					<MetricField label='Universe'>{universeLabel}</MetricField>
				</DataGrid>
				{universePresentation === undefined ? undefined : (
					<StateHint
						className='overview-universe-state'
						presentation={universePresentation}
						actions={
							<button className='secondary' onClick={onGoToGenesisUniverse}>
								Go to Genesis universe
							</button>
						}
					/>
				)}
			</article>
		</section>
	)
}
