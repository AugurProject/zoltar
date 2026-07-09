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
import { UI_STRINGS } from '../lib/uiStrings.js'
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
		if (isBrowserSimulationReadBackend) return <Badge tone='warning'>{UI_STRINGS.overviewPanels.simulationBadgeLabel}</Badge>
		if (hasWrongWalletNetwork) return <Badge tone='danger'>{UI_STRINGS.overviewPanels.wrongNetworkBadgeLabel}</Badge>
		if (accountState.address === undefined) return <Badge tone='pending'>{UI_STRINGS.overviewPanels.readOnlyBadgeLabel}</Badge>
		return <Badge tone='ok'>{UI_STRINGS.overviewPanels.connectedBadgeLabel}</Badge>
	})()
	const environmentDescription = (() => {
		if (isBrowserSimulationReadBackend) return UI_STRINGS.overviewPanels.simulationDescription
		return undefined
	})()
	const operationsHeaderDescription = (() => {
		const forkDescription = (() => {
			if (!universeHasForked) return undefined
			if (universeForkTime === undefined) return UI_STRINGS.overviewPanels.universeForkedDescription
			return (
				<>
					{UI_STRINGS.overviewPanels.universeForkedOnDetailPrefix} <TimestampValue timestamp={universeForkTime} />.
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
								{isConnectingWallet ? <LoadingText>{UI_STRINGS.overviewPanels.connectWalletPendingLabel}</LoadingText> : UI_STRINGS.overviewPanels.connectWalletIdleLabel}
							</button>
						) : undefined
					}
					badge={
						<span className='environment-badge-row'>
							{environmentBadge}
							{universeHasForked ? <Badge tone='warning'>{UI_STRINGS.overviewPanels.forkedBadgeLabel}</Badge> : undefined}
						</span>
					}
					description={operationsHeaderDescription}
					eyebrow={UI_STRINGS.overviewPanels.operationsEyebrow}
					title={UI_STRINGS.overviewPanels.augurPlaceholderTitle}
				/>
				<DataGrid className='overview-inline-metrics' columns='auto'>
					<MetricField className='overview-address-metric' label={UI_STRINGS.overviewPanels.addressLabel}>
						{(() => {
							if (isWalletAddressLoading)
								return (
									<span className='loading-value'>
										<span className='spinner' aria-hidden='true' />
										{UI_STRINGS.overviewPanels.connectingDetail}
									</span>
								)
							if (accountState.address === undefined) return UI_STRINGS.overviewPanels.notConnectedLabel

							return <AddressValue address={accountState.address} />
						})()}
					</MetricField>
					{showAccountBalances ? (
						<>
							<MetricField label={UI_STRINGS.overviewPanels.ethBalanceLabel}>
								<CurrencyValue value={accountState.ethBalance} loading={isRefreshing && accountState.ethBalance === undefined} suffix={UI_STRINGS.common.ethSuffix} compactWhenOverflow />
							</MetricField>
							<MetricField label={UI_STRINGS.overviewPanels.wethBalanceLabel}>
								<CurrencyValue value={accountState.wethBalance} loading={isRefreshing && accountState.wethBalance === undefined} suffix={UI_STRINGS.common.wethSuffix} compactWhenOverflow />
							</MetricField>
							<MetricField label={UI_STRINGS.overviewPanels.repBalanceLabel}>
								<CurrencyValue value={universeRepBalance} loading={isLoadingUniverseRepBalance} suffix={UI_STRINGS.common.repLabel} compactWhenOverflow />
							</MetricField>
						</>
					) : undefined}
					<MetricField
						label={
							<span className='metric-label-with-action'>
								<span>
									{UI_STRINGS.overviewPanels.repPerEthLabel} {renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
								</span>
								<button
									type='button'
									className='quiet metric-label-refresh'
									onClick={onRefreshRepPrices}
									disabled={isRefreshingRepPrices}
									aria-label={UI_STRINGS.overviewPanels.refreshRepPricesAriaLabel}
									title={isRefreshingRepPrices ? UI_STRINGS.overviewPanels.refreshRepPricesPendingTitle : UI_STRINGS.overviewPanels.refreshRepPricesIdleTitle}
								>
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
								{UI_STRINGS.overviewPanels.repUsdcLabel} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
							</>
						}
					>
						<CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix={UI_STRINGS.common.usdcSuffix} units={6} />
					</MetricField>
					<MetricField label={UI_STRINGS.overviewPanels.universeLabel}>{universeLabel}</MetricField>
					{shouldShowParentUniverse ? (
						<MetricField label={UI_STRINGS.overviewPanels.parentUniverseLabel}>
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
								{UI_STRINGS.overviewPanels.goToGenesisUniverseLabel}
							</button>
						}
					/>
				)}
			</article>
		</section>
	)
}
