import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { useState } from 'preact/hooks'
import { RouteHeader } from '../../components/RouteHeader.js'
import { AddressValue } from '../../components/AddressValue.js'
import { Badge } from '../../components/Badge.js'
import { CurrencyValue } from '../../components/CurrencyValue.js'
import { DataGrid } from '../../components/DataGrid.js'
import { MetricField } from '../../components/MetricField.js'
import { LoadingText } from '../../components/LoadingText.js'
import { StateHint } from '../../components/StateHint.js'
import { TimestampValue } from '../../components/TimestampValue.js'
import { UniverseLink } from '../../features/universes/components/UniverseLink.js'
import { getChainDisplayLabel, getChainIdDecimalLabel, getKnownChainName, isMainnetChain } from '../../lib/network.js'
import { renderRepPriceSourceLabel } from '../../features/open-oracle/lib/repPriceSource.js'
import type { OverviewPanelsProps } from '../../features/types.js'

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

export function OverviewPanels({
	activeUniverseId,
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
	const shouldShowParentUniverse = parentUniverseId !== undefined && activeUniverseId !== 0n && parentUniverseId !== activeUniverseId
	const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation'
	const walletOnMainnet = isMainnetChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnMainnet && !isBrowserSimulationReadBackend
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork
	const environmentBadge = (() => {
		if (isBrowserSimulationReadBackend) return <Badge tone='warning'>{appCopy.simulation}</Badge>
		if (hasWrongWalletNetwork) return <Badge tone='danger'>{appCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(accountState.chainId) ?? appCopy.unknownNetwork)}</Badge>
		if (accountState.address === undefined) return <Badge tone='pending'>{appCopy.readOnly}</Badge>
		return <Badge tone='ok'>{appCopy.connected}</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return appCopy.simulationNetworkDisclaimer
		return undefined
	})()
	const walletNetworkLabel = walletOnMainnet ? appCopy.ethereumMainnet : getWalletNetworkLabel(accountState.chainId)
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
							{appCopy.switchToEthereumMainnet}
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
			<article className='overview-panel overview-wallet-panel'>
				<RouteHeader
					actions={accountActions}
					badge={
						<span className='environment-badge-row'>
							{environmentBadge}
							{universeHasForked ? <Badge tone='warning'>{commonCopy.forked}</Badge> : undefined}
						</span>
					}
					description={operationsHeaderDescription}
					eyebrow={appCopy.operations}
					title={appCopy.augurPlaceholderTitle}
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

							return <AddressValue address={accountState.address} />
						})()}
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField label={commonCopy.eth}>
								<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix={commonCopy.eth} compactWhenOverflow />
							</MetricField>
							<MetricField className='overview-metric-secondary' label={commonCopy.weth}>
								<CurrencyValue value={accountState.wethBalance} loading={isRefreshing && accountState.wethBalance === undefined} suffix={commonCopy.weth} compactWhenOverflow />
							</MetricField>
							<MetricField label={commonCopy.rep}>
								<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix={commonCopy.rep} compactWhenOverflow />
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
								<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isRefreshingRepPrices} aria-label={appCopy.refreshRepPrices} title={isRefreshingRepPrices ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
									↻
								</button>
							</span>
						}
					>
						<CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} />
					</MetricField>
					<MetricField
						className='overview-metric-secondary'
						label={
							<>
								{appCopy.repUsdc} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
							</>
						}
					>
						<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix={appCopy.usdc} units={6} />
					</MetricField>
					<MetricField label={commonCopy.universe}>{universeLabel}</MetricField>
					{shouldShowParentUniverse ? (
						<MetricField className='overview-metric-secondary' label={appCopy.parentUniverse}>
							<UniverseLink universeId={parentUniverseId} />
						</MetricField>
					) : undefined}
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
