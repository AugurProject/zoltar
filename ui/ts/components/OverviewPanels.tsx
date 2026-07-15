import * as appCopy from '../copy/app.js'
import * as commonCopy from '../copy/common.js'
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
import { useState } from 'preact/hooks'
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
		if (hasWrongWalletNetwork) return <Badge tone='danger'>{appCopy.wrongNetworkBadgeLabel}</Badge>
		if (accountState.address === undefined) return <Badge tone='pending'>{appCopy.readOnly}</Badge>
		return <Badge tone='ok'>{appCopy.connected}</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return appCopy.simulationNetworkDisclaimer
		return undefined
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
					actions={
						accountState.address === undefined ? (
							<button className='secondary' type='button' onClick={onConnect} disabled={isConnectingWallet}>
								{isConnectingWallet ? <LoadingText>{appCopy.connecting}</LoadingText> : commonCopy.connectWallet}
							</button>
						) : undefined
					}
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
