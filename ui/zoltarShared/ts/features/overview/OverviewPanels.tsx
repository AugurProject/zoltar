import * as appCopy from '@zoltar/ui-core-shared/copy/app.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { useState } from 'preact/hooks'
import { HeaderToolbar } from '@zoltar/ui-core-shared/components/HeaderToolbar.js'
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { Badge } from '@zoltar/ui-core-shared/components/Badge.js'
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js'
import { HeaderMetricGroup, HeaderMetricStrip } from '@zoltar/ui-core-shared/components/HeaderMetricStrip.js'
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js'
import { ToolbarField } from '@zoltar/ui-core-shared/components/ToolbarField.js'
import { WalletChip, WalletChipLabel } from '@zoltar/ui-core-shared/components/WalletChip.js'
import { TimestampValue } from '@zoltar/ui-core-shared/components/TimestampValue.js'
import { WarningSurface } from '@zoltar/ui-core-shared/components/WarningSurface.js'
import { getChainDisplayLabel, getChainIdDecimalLabel, getKnownChainName, isActiveAppChain } from '@zoltar/ui-core-shared/wallet/network.js'
import { renderRepPriceSourceLabel } from '@zoltar/ui-core-shared/lib/repPriceSource.js'
import type { OverviewPanelsProps, RepPriceFailure } from '../types.js'
import { getActiveNetworkProfile } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getNetworkSwitchTarget } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { abbreviateAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { formatUniverseDisplayLabel, formatUniverseLabel } from '../universes/lib/universe.js'
import type { UserMessagePresentation } from '@zoltar/ui-core-shared/lib/userCopy.js'

function omitPresentationActionHint(presentation: UserMessagePresentation) {
	const { actionHint, ...presentationWithoutActionHint } = presentation
	void actionHint
	return presentationWithoutActionHint
}

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
	settingsMenu,
	applicationTitle,
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
	readBackendStatus,
	showRepPrices = true,
	repPerEthFailure,
	repPerEthPrice,
	repPerEthSource,
	repPerEthSourceLabel,
	repPerEthSourceUrl,
	repUsdcFailure,
	repUsdcPrice,
	repUsdcSource,
	repUsdcSourceUrl,
	universeForkTime,
	universeHasForked,
	universePresentation,
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
		return undefined
	})()
	const activeNetworkBadge = activeNetworkProfile.id === 'simulation' ? undefined : <Badge>{activeNetworkProfile.displayName}</Badge>
	const walletNetworkLabel = (() => {
		if (!walletOnActiveNetwork) return getWalletNetworkLabel(accountState.chainId)
		if (activeNetworkProfile.id === 'sepolia') return appCopy.sepoliaNetwork
		return appCopy.ethereumMainnet
	})()
	const walletControl = (() => {
		if (accountState.address === undefined)
			return (
				<button className='secondary wallet-button' type='button' onClick={onConnect} disabled={isConnectingWallet}>
					{isConnectingWallet ? <LoadingText>{appCopy.connecting}</LoadingText> : commonCopy.connectWallet}
				</button>
			)
		if (isBrowserSimulationReadBackend) return <WalletChip address={accountState.address} />
		return (
			<details className='account-menu'>
				<summary aria-label={appCopy.formatAccountMenuLabel(abbreviateAddress(accountState.address))}>
					<WalletChipLabel address={accountState.address} tone={hasWrongWalletNetwork ? 'danger' : 'ok'} />
				</summary>
				<div className='account-menu-popover'>
					<AddressValue address={accountState.address} />
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
	return (
		<section className='overview-shell'>
			{universeHasForked ? (
				<WarningSurface role='alert' surface='flat' className='universe-fork-notice'>
					<p>
						{appCopy.universeForkNoticeLead}
						{universeForkTime === undefined ? undefined : (
							<>
								{' '}
								{appCopy.forkedOnConnector} <TimestampValue timestamp={universeForkTime} />
							</>
						)}
						. {appCopy.migrateRepToContinueUsingAugur}
					</p>
				</WarningSurface>
			) : undefined}
			<article className={`overview-panel overview-wallet-panel${isBrowserSimulationReadBackend ? ' is-simulation' : ''}`}>
				<HeaderToolbar
					brand={
						<>
							<img src='./favicon.svg' alt='' width='28' height='28' />
							{applicationTitle}
						</>
					}
					badges={
						activeNetworkBadge === undefined && environmentBadge === undefined ? undefined : (
							<>
								{activeNetworkBadge}
								{environmentBadge}
							</>
						)
					}
					controls={
						<>
							{walletControl}
							<ToolbarField label={commonCopy.universe}>
								<span title={formatUniverseLabel(activeUniverseId)}>{formatUniverseDisplayLabel(activeUniverseId)}</span>
							</ToolbarField>
						</>
					}
					settings={settingsMenu}
				/>
				<HeaderMetricStrip expanded={showEnvironmentDetails}>
					<HeaderMetricGroup label={commonCopy.balances}>
						<MetricField className='overview-simulation-secondary' label={commonCopy.eth}>
							<CurrencyValue value={showAccountBalances ? accountState.ethBalanceAttoEth : undefined} loading={isWalletAddressLoading || (showAccountBalances && isRefreshing && accountState.ethBalanceAttoEth === undefined)} compactWhenOverflow />
						</MetricField>
						<MetricField className='overview-metric-secondary' label={commonCopy.weth}>
							<CurrencyValue value={showAccountBalances ? accountState.wethBalanceAttoEth : undefined} loading={isWalletAddressLoading || (showAccountBalances && isRefreshing && accountState.wethBalanceAttoEth === undefined)} compactWhenOverflow />
						</MetricField>
						<MetricField className='overview-simulation-secondary' label={commonCopy.rep}>
							<CurrencyValue value={showAccountBalances ? universeRepBalanceAttoRep : undefined} loading={isWalletAddressLoading || (showAccountBalances && isLoadingUniverseRepBalance)} compactWhenOverflow />
						</MetricField>
					</HeaderMetricGroup>
					{showRepPrices ? (
						<HeaderMetricGroup
							label={commonCopy.prices}
							secondary
							action={
								isRepPricingUnavailable ? undefined : (
									<button type='button' className='quiet metric-label-refresh' onClick={onRefreshRepPrices} disabled={isRefreshingRepPrices} aria-label={appCopy.refreshRepPrices} title={isRefreshingRepPrices ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
										↻
									</button>
								)
							}
						>
							<MetricField
								className='overview-metric-secondary'
								label={
									<>
										{appCopy.repPerEthCompact} {repPerEthSourceLabel ?? renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
									</>
								}
							>
								{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repPerEthPrice === undefined && !isLoadingRepPrices ? repPerEthFailure : undefined) ?? <CurrencyValue value={repPerEthPrice} loading={isLoadingRepPrices} copyable={false} compactWhenOverflow />)}
							</MetricField>
							<MetricField
								className='overview-metric-secondary'
								label={
									<>
										{appCopy.repUsdc} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
									</>
								}
							>
								{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repUsdcPrice === undefined && !isLoadingRepPrices ? repUsdcFailure : undefined) ?? <CurrencyValue value={repUsdcPrice} loading={isLoadingRepPrices} suffix={appCopy.usdc} units={6} compactWhenOverflow />)}
							</MetricField>
						</HeaderMetricGroup>
					) : undefined}
				</HeaderMetricStrip>
				<button className='overview-details-toggle secondary' type='button' aria-expanded={showEnvironmentDetails} onClick={() => setShowEnvironmentDetails(current => !current)}>
					{showEnvironmentDetails ? appCopy.hideEnvironmentDetails : appCopy.showEnvironmentDetails}
				</button>
				{universePresentation === undefined ? undefined : (
					<StateHint
						className='overview-universe-state'
						presentation={omitPresentationActionHint(universePresentation)}
						title={universePresentation.badgeLabel}
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
