import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useState } from 'preact/hooks'
import { RouteHeader } from '@zoltar/ui-core-shared/components/RouteHeader.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { getChainDisplayLabel, getChainIdDecimalLabel, getKnownChainName, isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js'
import { renderRepPriceSourceLabel } from '../../features/open-oracle/lib/repPriceSource.js'
import type { OverviewPanelsProps, RepPriceFailure } from '../../features/types.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getNetworkSwitchTarget } from '@zoltar/ui-core-shared/lib/networkProfile.js'

function getWalletNetworkLabel(chainId: string | undefined) {
	if (chainId === undefined) return appCopy.unknownNetwork
	if (chainId === '0xaa36a7') return appCopy.sepoliaNetwork
	const chainLabel = getChainDisplayLabel(chainId)
	if (chainLabel === undefined) return appCopy.unknownNetwork
	const chainName = getKnownChainName(chainId)
	if (chainName === undefined) return chainLabel
	const decimalChainId = getChainIdDecimalLabel(chainId)
	return decimalChainId === undefined ? chainName : appCopy.formatNetworkWithChainId(chainName, decimalChainId)
}

function renderRepPriceFailure(failure: RepPriceFailure | undefined) {
	if (failure === undefined) return undefined
	return (
		<span className='currency-value unavailable rep-price-failure' role='status'>
			{failure === 'rpc-error' ? appCopy.repPriceRequestFailed : appCopy.repPriceNoLiquidity}
		</span>
	)
}

export function OverviewPanels({
	applicationTitle,
	accountState,
	isConnectingWallet,
	isManagingWallet,
	isLoadingRepPrices,
	isRefreshingRepPrices,
	isLoadingUniverseRepBalance,
	onConnect,
	onChangeWallet,
	onDisconnectWallet,
	onGoToGenesisUniverse,
	onRefreshRepPrices,
	onSwitchNetwork,
	readBackendStatus,
	repPerEthFailure,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceUrl,
	repUsdcFailure,
	repUsdcPrice,
	repUsdcSource,
	repUsdcSourceUrl,
	universeForkTime,
	universeHasForked,
	universePresentation,
	universeLabel,
	universeRepBalanceAttoRep,
	isRefreshing,
	walletBootstrapComplete,
}: OverviewPanelsProps) {
	const [showEnvironmentDetails, setShowEnvironmentDetails] = useState(false)
	const effectiveReadBackendStatus = readBackendStatus ?? {
		blockNumber: undefined,
		blockTimestamp: undefined,
		rpcSource: 'default' as const,
		rpcUrl: 'Unavailable',
		transportMode: 'provider' as const,
	}
	const isWalletBootstrapLoading = !walletBootstrapComplete && accountState.address === undefined
	const isWalletAddressLoading = isConnectingWallet || isWalletBootstrapLoading
	const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation'
	const activeNetworkProfile = getActiveNetworkProfile()
	const isRepPricingUnavailable = activeNetworkProfile.repPricingMode === 'unavailable'
	const repPricingUnavailableLabel = appCopy.formatRepPricingUnavailable(activeNetworkProfile.displayName)
	const walletOnActiveNetwork = isActiveAppChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnActiveNetwork && !isBrowserSimulationReadBackend
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork
	const environmentBadge = (() => {
		if (isBrowserSimulationReadBackend) return <Badge tone='warning'>{appCopy.simulation}</Badge>
		if (hasWrongWalletNetwork) return <Badge tone='danger'>{appCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(accountState.chainId) ?? appCopy.unknownNetwork)}</Badge>
		if (accountState.address === undefined) return undefined
		return <Badge tone='ok'>{appCopy.connected}</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return appCopy.simulationNetworkDisclaimer
		return undefined
	})()
	const activeNetworkBadge = activeNetworkProfile.id === 'simulation' ? undefined : <Badge>{activeNetworkProfile.displayName}</Badge>
	const walletNetworkLabel = (() => {
		if (!walletOnActiveNetwork) return getWalletNetworkLabel(accountState.chainId)
		if (activeNetworkProfile.id === 'sepolia') return appCopy.sepoliaNetwork
		return appCopy.ethereumMainnet
	})()
	const accountActions = (() => {
		if (accountState.address === undefined)
			return (
				<button className='secondary' type='button' onClick={onConnect} disabled={isConnectingWallet}>
					{isConnectingWallet ? <LoadingText>{appCopy.connecting}</LoadingText> : commonCopy.connectWallet}
				</button>
			)
		if (isBrowserSimulationReadBackend) return undefined
		return (
			<details className='account-menu'>
				<summary className='secondary'>{appCopy.accountMenu}</summary>
				<div className='account-menu-popover'>
					<p className='account-menu-network'>
						<span>{appCopy.currentNetwork}</span>
						<strong>{walletNetworkLabel}</strong>
					</p>
					<button className='secondary' type='button' onClick={onChangeWallet} disabled={isManagingWallet}>
						{appCopy.changeWallet}
					</button>
					{hasWrongWalletNetwork ? (
						<button className='primary' type='button' onClick={onSwitchNetwork} disabled={isManagingWallet}>
							{appCopy.formatSwitchToNetwork(getNetworkSwitchTarget(getActiveNetworkProfile()))}
						</button>
					) : undefined}
					<button className='quiet' type='button' onClick={onDisconnectWallet} disabled={isManagingWallet}>
						{isManagingWallet ? appCopy.managingWallet : appCopy.disconnectWallet}
					</button>
				</div>
			</details>
		)
	})()
	const operationsHeaderDescription = (() => {
		const forkDescription = (() => {
			if (!universeHasForked) return undefined
			if (universeForkTime === undefined) return appCopy.universeForkedDetail
			return (
				<>
					{appCopy.zoltarForkedOn} <TimestampValue timestamp={universeForkTime} />.
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
			<article className={`overview-panel overview-wallet-panel${isBrowserSimulationReadBackend ? ' is-simulation' : ''}`}>
				<RouteHeader
					actions={accountActions}
					badge={
						<span className='environment-badge-row'>
							{activeNetworkBadge}
							{environmentBadge}
							{universeHasForked ? <Badge tone='warning'>{commonCopy.forked}</Badge> : undefined}
						</span>
					}
					description={operationsHeaderDescription}
					eyebrow={appCopy.operations}
					title={applicationTitle}
				/>
				<DataGrid className={`overview-inline-metrics ${showEnvironmentDetails ? 'mobile-expanded' : ''}`.trim()} columns='auto'>
					<MetricField className='overview-address-metric' label={appCopy.address}>
						{(() => {
							if (isWalletAddressLoading)
								return (
									<span className='loading-value'>
										<span className='spinner' aria-hidden='true' />
										{appCopy.connecting}
									</span>
								)
							if (accountState.address === undefined) return appCopy.notConnected

							return <AddressValue address={accountState.address} responsiveAbbreviation />
						})()}
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField className='overview-simulation-secondary' label={commonCopy.eth}>
								<CurrencyValue value={accountState.ethBalanceAttoEth} loading={isRefreshing && accountState.ethBalanceAttoEth === undefined} suffix={commonCopy.eth} compactWhenOverflow />
							</MetricField>
							<MetricField className='overview-metric-secondary' label={commonCopy.weth}>
								<CurrencyValue value={accountState.wethBalanceAttoEth} loading={isRefreshing && accountState.wethBalanceAttoEth === undefined} suffix={commonCopy.weth} compactWhenOverflow />
							</MetricField>
							<MetricField className='overview-simulation-secondary' label={commonCopy.rep}>
								<CurrencyValue value={universeRepBalanceAttoRep} loading={isLoadingUniverseRepBalance} suffix={commonCopy.rep} compactWhenOverflow />
							</MetricField>
						</>
					) : undefined}
					<MetricField
						className='overview-metric-secondary'
						label={
							<span className='metric-label-with-action'>
								<span>
									{appCopy.repPerEthCompact} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
								</span>
								{isRepPricingUnavailable ? undefined : (
									<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isRefreshingRepPrices} aria-label={appCopy.refreshRepPrices} title={isRefreshingRepPrices ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
										↻
									</button>
								)}
							</span>
						}
					>
						{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repPerEthPrice === undefined && !isLoadingRepPrices ? repPerEthFailure : undefined) ?? <CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} />)}
					</MetricField>
					<MetricField
						className='overview-metric-secondary'
						label={
							<>
								{appCopy.repUsdc} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
							</>
						}
					>
						{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repUsdcPrice === undefined && !isLoadingRepPrices ? repUsdcFailure : undefined) ?? <CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix={appCopy.usdc} units={6} />)}
					</MetricField>
					<MetricField className='overview-universe-metric' label={commonCopy.universe}>
						{universeLabel}
					</MetricField>
				</DataGrid>
				<button className='overview-details-toggle secondary' type='button' aria-expanded={showEnvironmentDetails} onClick={() => setShowEnvironmentDetails(current => !current)}>
					{showEnvironmentDetails ? appCopy.hideEnvironmentDetails : appCopy.showEnvironmentDetails}
				</button>
				{universePresentation === undefined ? undefined : (
					<StateHint
						className='overview-universe-state'
						presentation={universePresentation}
						actions={
							<button className='secondary' onClick={onGoToGenesisUniverse}>
								{commonCopy.goToGenesisUniverse}
							</button>
						}
					/>
				)}
			</article>
		</section>
	)
}
