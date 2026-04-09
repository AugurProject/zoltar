import { AddressValue } from './AddressValue.js'
import { CurrencyValue } from './CurrencyValue.js'
import type { OverviewPanelsProps } from '../types/components.js'

const UNISWAP_EXPLORE = 'https://app.uniswap.org/explore/pools/ethereum'
const REP_ETH_V3_POOL_URL = `${UNISWAP_EXPLORE}/0xb055103b7633b61518CD806D95beeB2d4Cd217E7`
const REP_USDC_V4_POOL_URL = `${UNISWAP_EXPLORE}/0x75d479eb83b7c9008ab854e74625a01841e5b3e06af40a89c10998ad2664f356`

export function OverviewPanels({
	accountState,
	isConnectingWallet,
	isLoadingRepPrices,
	isLoadingUniverseRepBalance,
	onConnect,
	onGoToGenesisUniverse,
	onRefresh,
	repEthPrice,
	repEthSource,
	repUsdcPrice,
	repUsdcSource,
	universeErrorMessage,
	universeLabel,
	universeRepBalance,
	isRefreshing,
	walletBootstrapComplete,
}: OverviewPanelsProps) {
	const isWalletLoading = isConnectingWallet || (!walletBootstrapComplete && accountState.address === undefined)
	const showAccountBalances = accountState.address !== undefined

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
								<span className='metric-label'>
									REP/ETH{' '}
									{repEthSource === undefined ? undefined : (
										<a href={repEthSource === 'v4' ? undefined : REP_ETH_V3_POOL_URL} title={repEthSource === 'v4' ? 'Price from Uniswap V4' : 'Price from Uniswap V3 (REP/WETH pool)'} target='_blank' rel='noreferrer'>
											{`(u${repEthSource === 'v4' ? '4' : '3'})`}
										</a>
									)}
								</span>
								<strong>
									<CurrencyValue value={repEthPrice} loading={isLoadingRepPrices} suffix='ETH' />
								</strong>
							</div>
							<div>
								<span className='metric-label'>
									REP/USDC{' '}
									{repUsdcSource === undefined ? undefined : (
										<a href={repUsdcSource === 'v4' ? REP_USDC_V4_POOL_URL : undefined} title={repUsdcSource === 'v4' ? 'Price from Uniswap V4 (REP/USDC pool)' : 'Price from Uniswap V3 (REP/USDC pool)'} target='_blank' rel='noreferrer'>
											{`(u${repUsdcSource === 'v4' ? '4' : '3'})`}
										</a>
									)}
								</span>
								<strong>
									<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix='USDC' units={6} />
								</strong>
							</div>
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
							<button className='primary' onClick={onConnect} disabled={isConnectingWallet}>
								{isWalletLoading ? 'Connecting...' : 'Connect Wallet'}
							</button>
						) : undefined}
					</div>
				</div>
			</article>
		</section>
	)
}
