import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
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
	repEthPrice,
	repEthSource,
	repEthSourceUrl,
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
			<article className='panel overview-panel overview-wallet-panel'>
				<div className='panel-header overview-wallet-header'>
					<div className='overview-wallet-summary'>
						<div className='overview-brand-lockup'>
							<h1 className='overview-app-title'>Augur PLACEHOLDER</h1>
						</div>
						<div className='overview-inline-metrics'>
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
									<MetricField label='REP'>
										<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix='REP' />
									</MetricField>
								</>
							) : undefined}
							<MetricField label={<>REP/ETH {repEthSource === undefined ? undefined : renderSourceLink(repEthSource, repEthSourceUrl)}</>}>
								<CurrencyValue value={repEthPrice} loading={isLoadingRepPrices} suffix='ETH' />
							</MetricField>
							<MetricField label={<>REP/USDC {repUsdcSource === undefined ? undefined : renderSourceLink(repUsdcSource, repUsdcSourceUrl)}</>}>
								<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix='USDC' units={6} />
							</MetricField>
							<MetricField label='Universe' valueClassName={universePresentation === undefined ? undefined : 'overview-universe-error'}>
								{universePresentation === undefined ? universeLabel : <StateHint presentation={universePresentation} />}
								{universePresentation === undefined ? undefined : (
									<div className='overview-universe-actions'>
										<button className='secondary' onClick={onGoToGenesisUniverse}>
											Go to Genesis universe
										</button>
									</div>
								)}
							</MetricField>
						</div>
					</div>
					<div className='actions overview-actions'>
						{accountState.address === undefined ? (
							<button className='primary' onClick={onConnect} disabled={isConnectingWallet}>
								{isWalletLoading ? 'Connecting...' : 'Connect wallet'}
							</button>
						) : undefined}
					</div>
				</div>
			</article>
		</section>
	)
}
