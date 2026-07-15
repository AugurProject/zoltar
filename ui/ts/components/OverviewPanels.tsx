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
import {
	UI_STRING_ADDRESS,
	UI_STRING_AUGUR_PLACEHOLDER_OVERVIEW_PANELS_AUGUR_PLACEHOLDER_TITLE,
	UI_STRING_CONNECT_WALLET,
	UI_STRING_CONNECTED,
	UI_STRING_CONNECTING,
	UI_STRING_ETH,
	UI_STRING_FORKED,
	UI_STRING_GO_TO_GENESIS_UNIVERSE,
	UI_STRING_NOT_CONNECTED,
	UI_STRING_OPERATIONS,
	UI_STRING_PARENT_UNIVERSE,
	UI_STRING_READ_ONLY,
	UI_STRING_REFRESH_REP_PRICES,
	UI_STRING_REFRESHING_REP_PRICES,
	UI_STRING_REP,
	UI_STRING_REP_PER_ETH_COMPACT,
	UI_STRING_REP_USDC,
	UI_STRING_SIMULATION,
	UI_STRING_SIMULATION_MODE_USES_BROWSER_LOCAL_CONTRACT_STATE_TRANSACTIONS_DO_NOT_AFFECT_A_PUBLIC_NETWORK,
	UI_STRING_THIS_UNIVERSE_HAS_FORKED,
	UI_STRING_UNIVERSE,
	UI_STRING_USDC,
	UI_STRING_WETH,
	UI_STRING_WRONG_NETWORK_OVERVIEW_PANELS_WRONG_NETWORK_BADGE_LABEL,
	UI_STRING_ZOLTAR_FORKED_ON,
} from '../lib/uiStrings.js'
import type { OverviewPanelsProps } from '../types/components.js'
export function OverviewPanels({
	activeUniverseId,
	accountState,
	isConnectingWallet,
	isLoadingRepPrices,
	isRefreshingRepPrices,
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
	const shouldShowParentUniverse = parentUniverseId !== undefined && activeUniverseId !== 0n && parentUniverseId !== activeUniverseId
	const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation'
	const walletOnMainnet = isMainnetChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnMainnet && !isBrowserSimulationReadBackend
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork
	const environmentBadge = (() => {
		if (isBrowserSimulationReadBackend) return <Badge tone='warning'>{UI_STRING_SIMULATION}</Badge>
		if (hasWrongWalletNetwork) return <Badge tone='danger'>{UI_STRING_WRONG_NETWORK_OVERVIEW_PANELS_WRONG_NETWORK_BADGE_LABEL}</Badge>
		if (accountState.address === undefined) return <Badge tone='pending'>{UI_STRING_READ_ONLY}</Badge>
		return <Badge tone='ok'>{UI_STRING_CONNECTED}</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return UI_STRING_SIMULATION_MODE_USES_BROWSER_LOCAL_CONTRACT_STATE_TRANSACTIONS_DO_NOT_AFFECT_A_PUBLIC_NETWORK
		return undefined
	})()
	const operationsHeaderDescription = (() => {
		const forkDescription = (() => {
			if (!universeHasForked) return undefined
			if (universeForkTime === undefined) return UI_STRING_THIS_UNIVERSE_HAS_FORKED
			return (
				<>
					{UI_STRING_ZOLTAR_FORKED_ON} <TimestampValue timestamp={universeForkTime} />.
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
								{isConnectingWallet ? <LoadingText>{UI_STRING_CONNECTING}</LoadingText> : UI_STRING_CONNECT_WALLET}
							</button>
						) : undefined
					}
					badge={
						<span className='environment-badge-row'>
							{environmentBadge}
							{universeHasForked ? <Badge tone='warning'>{UI_STRING_FORKED}</Badge> : undefined}
						</span>
					}
					description={operationsHeaderDescription}
					eyebrow={UI_STRING_OPERATIONS}
					title={UI_STRING_AUGUR_PLACEHOLDER_OVERVIEW_PANELS_AUGUR_PLACEHOLDER_TITLE}
				/>
				<DataGrid className='overview-inline-metrics' columns='auto'>
					<MetricField className='overview-address-metric' label={UI_STRING_ADDRESS}>
						{(() => {
							if (isWalletAddressLoading)
								return (
									<span className='loading-value'>
										<span className='spinner' aria-hidden='true' />
										{UI_STRING_CONNECTING}
									</span>
								)
							if (accountState.address === undefined) return UI_STRING_NOT_CONNECTED

							return <AddressValue address={accountState.address} />
						})()}
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField label={UI_STRING_ETH}>
								<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix={UI_STRING_ETH} compactWhenOverflow />
							</MetricField>
							<MetricField label={UI_STRING_WETH}>
								<CurrencyValue value={accountState.wethBalance} loading={isRefreshing && accountState.wethBalance === undefined} suffix={UI_STRING_WETH} compactWhenOverflow />
							</MetricField>
							<MetricField label={UI_STRING_REP}>
								<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix={UI_STRING_REP} compactWhenOverflow />
							</MetricField>
						</>
					) : undefined}
					<MetricField
						label={
							<span className='metric-label-with-action'>
								<span>
									{UI_STRING_REP_PER_ETH_COMPACT} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
								</span>
								<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isRefreshingRepPrices} aria-label={UI_STRING_REFRESH_REP_PRICES} title={isRefreshingRepPrices ? UI_STRING_REFRESHING_REP_PRICES : UI_STRING_REFRESH_REP_PRICES}>
									↻
								</button>
							</span>
						}
					>
						<CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} />
					</MetricField>
					<MetricField
						label={
							<>
								{UI_STRING_REP_USDC} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
							</>
						}
					>
						<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix={UI_STRING_USDC} units={6} />
					</MetricField>
					<MetricField label={UI_STRING_UNIVERSE}>{universeLabel}</MetricField>
					{shouldShowParentUniverse ? (
						<MetricField label={UI_STRING_PARENT_UNIVERSE}>
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
								{UI_STRING_GO_TO_GENESIS_UNIVERSE}
							</button>
						}
					/>
				)}
			</article>
		</section>
	)
}
