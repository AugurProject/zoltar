import { RouteHeader } from './RouteHeader.js'
import { AddressValue } from './AddressValue.js'
import { Badge } from './Badge.js'
import { CurrencyValue } from './CurrencyValue.js'
import { DataGrid } from './DataGrid.js'
import { MetricField } from './MetricField.js'
import { LoadingText } from './LoadingText.js'
import { StateHint } from './StateHint.js'
import { TimestampValue } from './TimestampValue.js'
import { UniverseLink } from './UniverseLink.js'
import { isMainnetChain } from '../lib/network.js'
import { renderRepPriceSourceLabel } from '../lib/repPriceSource.js'
import type { OverviewPanelsProps } from '../types/components.js'
export function OverviewPanels({
	activeUniverseId,
	accountState,
	isConnectingWallet,
	isLoadingRepPrices,
	isLoadingUniverseRepBalance,
	onConnect,
	onGoToGenesisUniverse,
	onRefreshRepPrices,
	parentUniverseId,
	readBackendStatus,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	repUsdcPrice,
	repUsdcSource,
	repUsdcSourceUrl,
	universeForkTime,
	universeHasForked,
	universePresentation,
	universeLabel,
	universeRepBalance,
	isRefreshing,
	walletBootstrapComplete,
}: OverviewPanelsProps) {
	const effectiveReadBackendStatus = readBackendStatus ?? {
		blockNumber: undefined,
		blockTimestamp: undefined,
		rpcSource: 'default' as const,
		rpcUrl: 'Unavailable',
		transportMode: 'provider' as const,
	}
	const isWalletBootstrapLoading = !walletBootstrapComplete && accountState.address === undefined
	const isWalletAddressLoading = isConnectingWallet || isWalletBootstrapLoading
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined
	const shouldShowParentUniverse = parentUniverseId !== undefined && activeUniverseId !== 0n && parentUniverseId !== activeUniverseId
	const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation'
	const isProviderReadBackend = effectiveReadBackendStatus.transportMode === 'provider' && !isBrowserSimulationReadBackend
	const walletOnMainnet = isMainnetChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnMainnet && !isBrowserSimulationReadBackend
	const readBackendHost = (() => {
		if (isBrowserSimulationReadBackend) return 'browser simulation'
		if (isProviderReadBackend) return 'wallet provider'
		try {
			return new URL(effectiveReadBackendStatus.rpcUrl).host
		} catch (error) {
			if (!(error instanceof TypeError)) throw error
			return effectiveReadBackendStatus.rpcUrl
		}
	})()
	const readBackendLabel = isProviderReadBackend ? 'wallet provider reads' : `${effectiveReadBackendStatus.transportMode} via ${effectiveReadBackendStatus.rpcSource}`
	const readBackendTitle = isProviderReadBackend ? `Reads are using the connected wallet provider. Configured fallback RPC: ${effectiveReadBackendStatus.rpcUrl}` : effectiveReadBackendStatus.rpcUrl
	const readBackendSummary = isProviderReadBackend ? readBackendLabel : `${readBackendHost} · ${readBackendLabel}`
	const writeNetworkLabel = (() => {
		if (isBrowserSimulationReadBackend) return 'Browser simulation'
		if (accountState.address === undefined) return 'No wallet connected'
		if (walletOnMainnet) return 'Ethereum mainnet'
		return `Wallet chain ${accountState.chainId ?? 'unknown'}`
	})()
	const environmentBadge = (() => {
		if (isBrowserSimulationReadBackend) return <Badge tone='warning'>Simulation</Badge>
		if (hasWrongWalletNetwork) return <Badge tone='danger'>Wrong Network</Badge>
		if (accountState.address === undefined) return <Badge tone='pending'>Read-only</Badge>
		return <Badge tone='ok'>Connected</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return 'Simulation mode uses browser-local contract state. Transactions do not affect a public network.'
		if (hasWrongWalletNetwork) return 'Wallet is connected to a non-mainnet chain. You can inspect configured read state, but transaction controls stay disabled until the wallet switches to Ethereum mainnet.'
		if (accountState.address === undefined) return 'Read-only mode shows contract state. Connect a wallet before submitting transactions.'
		return undefined
	})()
	const operationsHeaderDescription = (() => {
		const forkDescription = (() => {
			if (!universeHasForked) return undefined
			if (universeForkTime === undefined) return 'Zoltar has forked.'
			return (
				<>
					Zoltar forked on <TimestampValue timestamp={universeForkTime} />.
				</>
			)
		})()
		if (environmentDescription === undefined) return forkDescription
		if (forkDescription === undefined) return environmentDescription
		return (
			<>
				{environmentDescription} {forkDescription}
			</>
		)
	})()
	return (
		<section className='overview-shell'>
			<article className='overview-panel overview-wallet-panel'>
				<RouteHeader
					actions={
						accountState.address === undefined ? (
							<button className='secondary' type='button' onClick={onConnect} disabled={isConnectingWallet}>
								{isConnectingWallet ? <LoadingText>Connecting...</LoadingText> : 'Connect wallet'}
							</button>
						) : undefined
					}
					badge={
						<span className='environment-badge-row'>
							{environmentBadge}
							{universeHasForked ? <Badge tone='warning'>Forked</Badge> : undefined}
						</span>
					}
					description={operationsHeaderDescription}
					eyebrow='Operations'
					title='Augur Placeholder'
				/>
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
					<MetricField label='Write Network'>{writeNetworkLabel}</MetricField>
					<MetricField label='Read Source'>
						<span title={readBackendTitle}>
							{readBackendSummary}
							{effectiveReadBackendStatus.blockNumber === undefined ? '' : ` @ ${effectiveReadBackendStatus.blockNumber.toString()}`}
						</span>
					</MetricField>
					{shouldShowParentUniverse ? (
						<MetricField label='Parent Universe'>
							<UniverseLink universeId={parentUniverseId} />
						</MetricField>
					) : undefined}
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
