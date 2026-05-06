import { RouteHeader } from './RouteHeader.js'
import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { MetricField } from './MetricField.js'
import { StateHint } from './StateHint.js'
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
	const isWalletLoading = isConnectingWallet || (!walletBootstrapComplete && accountState.address === undefined)
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined
	const renderSourceLink = (source: 'v3' | 'v4', sourceUrl: string | undefined) => {
		const label = `u${source === 'v4' ? '4' : '3'}`
		if (sourceUrl === undefined) return `(${label})`
		return (
			<a href={sourceUrl} title={source === 'v4' ? 'Price from Uniswap V4' : 'Price from Uniswap V3'} target='_blank' rel='noreferrer'>
				{`(${label})`}
			</a>
		)
	}

	return (
		<section className='overview-shell'>
			<article className='overview-panel overview-wallet-panel'>
				<RouteHeader
					eyebrow='Operations'
					title='Augur PLACEHOLDER'
					actions={
						accountState.address === undefined ? (
							<button className='primary' onClick={onConnect} disabled={isConnectingWallet}>
								{isWalletLoading ? 'Connecting...' : 'Connect wallet'}
							</button>
						) : undefined
					}
				/>
				<DataGrid className='overview-inline-metrics' columns='auto'>
					<MetricField className='overview-address-metric' label='Address'>
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
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField label='ETH'>
								<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix='ETH' />
							</MetricField>
							<MetricField label='WETH'>
								<CurrencyValue value={accountState.wethBalance} loading={isRefreshing && accountState.wethBalance === undefined} suffix='WETH' />
							</MetricField>
							<MetricField label='REP'>
								<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix='REP' />
							</MetricField>
						</>
					) : undefined}
					<MetricField
						label={
							<span className='metric-label-with-action'>
								<span>REP/ETH {repPerEthSource === undefined ? undefined : renderSourceLink(repPerEthSource, repPerEthSourceUrl)}</span>
								<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isLoadingRepPrices} aria-label='Refresh Uniswap prices' title={isLoadingRepPrices ? 'Refreshing Uniswap prices...' : 'Refresh Uniswap prices'}>
									↻
								</button>
							</span>
						}
					>
						<CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} />
					</MetricField>
					<MetricField label={<>REP/USDC {repUsdcSource === undefined ? undefined : renderSourceLink(repUsdcSource, repUsdcSourceUrl)}</>}>
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
