import type { ComponentChildren } from 'preact'
import { WalletConnectionControl, WalletNetworkControl } from '../../components/WalletConnectionControl.js'
import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { AddressValue } from '../../components/AddressValue.js'
import { Badge } from '../../components/Badge.js'
import { CurrencyValue } from '../../components/CurrencyValue.js'
import { HeaderMetricGroup } from '../../components/HeaderMetricStrip.js'
import { WalletBalanceGroup } from '../../components/WalletBalanceGroup.js'
import { MetricField } from '../../components/MetricField.js'
import { StateHint } from '../../components/StateHint.js'
import { ToolbarField } from '../../components/ToolbarField.js'
import { WalletChip, WalletChipLabel } from '../../components/WalletChip.js'
import { TimestampValue } from '../../components/TimestampValue.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import { getChainDisplayLabel, isActiveAppChain } from '../../wallet/network.js'
import { renderRepPriceSourceLabel, type RepPriceFailure, type RepPriceSource } from '../../lib/repPriceSource.js'
import type { AccountState } from '../../types/app.js'
import type { ReadBackendStatus } from '../../wallet/chainBackend.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { getNetworkSwitchTarget } from '../../wallet/networkProfile.js'
import { abbreviateAddress } from '../../lib/address.js'
import { formatUniverseDisplayLabel, formatUniverseLabel } from '../../lib/universeLabels.js'
import type { UserMessagePresentation } from '../../lib/userCopy.js'
import { OverviewHeaderPanel } from './OverviewHeaderPanel.js'

/** The REP price group of the header strip; applications without price quotes omit it. */
export type OverviewRepPricesProps = {
	isLoading: boolean
	isRefreshing: boolean
	onRefresh: () => void
	repPerEthFailure: RepPriceFailure | undefined
	repPerEthPrice: bigint | undefined
	repPerEthSource: RepPriceSource | undefined
	repPerEthSourceLabel?: ComponentChildren
	repPerEthSourceUrl: string | undefined
	repUsdcFailure: RepPriceFailure | undefined
	repUsdcPrice: bigint | undefined
	repUsdcSource: RepPriceSource | undefined
	repUsdcSourceUrl: string | undefined
}

export type OverviewPanelsProps = {
	settingsMenu?: ComponentChildren
	applicationTitle: string
	activeUniverseId: bigint
	accountState: AccountState
	isConnectingWallet: boolean
	isManagingWallet: boolean
	walletBootstrapComplete: boolean
	universeRepBalanceAttoRep: bigint | undefined
	isLoadingUniverseRepBalance: boolean
	universeForkTime?: bigint | undefined
	universeHasForked?: boolean | undefined
	universePresentation: UserMessagePresentation | undefined
	isRefreshing: boolean
	onConnect: () => void
	onChangeWallet: () => void
	onDisconnectWallet: () => void
	onGoToGenesisUniverse: () => void
	onSwitchNetwork: () => void
	readBackendStatus?: ReadBackendStatus
	repPrices?: OverviewRepPricesProps | undefined
}

function omitPresentationActionHint(presentation: UserMessagePresentation) {
	const { actionHint, ...presentationWithoutActionHint } = presentation
	void actionHint
	return presentationWithoutActionHint
}

function renderRepPriceFailure(failure: RepPriceFailure | undefined) {
	if (failure === undefined) return undefined
	return (
		<span className='currency-value unavailable rep-price-failure' role='status'>
			{failure === 'rpc-error' ? appCopy.repPriceRequestFailed : appCopy.repPriceNoLiquidity}
		</span>
	)
}

function RepPriceGroup({ isLoading, isRefreshing, onRefresh, repPerEthFailure, repPerEthPrice, repPerEthSource, repPerEthSourceLabel, repPerEthSourceUrl, repUsdcFailure, repUsdcPrice, repUsdcSource, repUsdcSourceUrl }: OverviewRepPricesProps) {
	const activeNetworkProfile = getActiveNetworkProfile()
	const isRepPricingUnavailable = activeNetworkProfile.repPricingMode === 'unavailable'
	const repPricingUnavailableLabel = appCopy.formatRepPricingUnavailable(activeNetworkProfile.displayName)
	return (
		<HeaderMetricGroup
			label={commonCopy.prices}
			secondary
			action={
				isRepPricingUnavailable ? undefined : (
					<button type='button' className='quiet metric-label-refresh' onClick={onRefresh} disabled={isRefreshing} aria-label={appCopy.refreshRepPrices} title={isRefreshing ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
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
				{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repPerEthPrice === undefined && !isLoading ? repPerEthFailure : undefined) ?? <CurrencyValue value={repPerEthPrice} loading={isLoading && repPerEthPrice === undefined} copyable={false} compactWhenOverflow />)}
			</MetricField>
			<MetricField
				className='overview-metric-secondary'
				label={
					<>
						{appCopy.repUsdc} {renderRepPriceSourceLabel(repUsdcSource, repUsdcSourceUrl)}
					</>
				}
			>
				{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repUsdcPrice === undefined && !isLoading ? repUsdcFailure : undefined) ?? <CurrencyValue value={repUsdcPrice} loading={isLoading && repUsdcPrice === undefined} suffix={appCopy.usdc} units={6} compactWhenOverflow />)}
			</MetricField>
		</HeaderMetricGroup>
	)
}

/** The protocol application header: wallet session, active universe, balances, optional REP prices, and universe state. */
export function OverviewPanels({
	settingsMenu,
	applicationTitle,
	activeUniverseId,
	accountState,
	isConnectingWallet,
	isManagingWallet,
	isLoadingUniverseRepBalance,
	onConnect,
	onChangeWallet,
	onDisconnectWallet,
	onGoToGenesisUniverse,
	onSwitchNetwork,
	readBackendStatus,
	repPrices,
	universeForkTime,
	universeHasForked,
	universePresentation,
	universeRepBalanceAttoRep,
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
	const isBrowserSimulationReadBackend = effectiveReadBackendStatus.rpcUrl === 'browser-simulation'
	const activeNetworkProfile = getActiveNetworkProfile()
	const walletOnActiveNetwork = isActiveAppChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnActiveNetwork
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork
	const switchNetworkLabel = appCopy.formatSwitchToNetwork(getNetworkSwitchTarget(activeNetworkProfile))
	const wrongNetworkBadge = hasWrongWalletNetwork ? <Badge tone='danger'>{appCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(accountState.chainId) ?? appCopy.unknownNetwork)}</Badge> : undefined
	const environmentBadge = isBrowserSimulationReadBackend ? <Badge tone='warning'>{appCopy.simulation}</Badge> : undefined
	const activeNetworkBadge = activeNetworkProfile.id === 'simulation' ? undefined : <Badge>{activeNetworkProfile.displayName}</Badge>
	const walletControl = (() => {
		if (accountState.address === undefined) return <WalletConnectionControl onClick={onConnect} pending={isConnectingWallet} pendingLabel={appCopy.connecting} label={commonCopy.connectWallet} />
		if (isBrowserSimulationReadBackend) {
			if (!hasWrongWalletNetwork) return <WalletChip address={accountState.address} />
			return (
				<>
					<WalletChip address={accountState.address} tone='danger' />
					<WalletNetworkControl className='secondary wallet-button' onClick={onSwitchNetwork} disabled={isManagingWallet} label={switchNetworkLabel} />
				</>
			)
		}
		return (
			<details className='account-menu'>
				<summary aria-label={appCopy.formatAccountMenuLabel(abbreviateAddress(accountState.address))}>
					<WalletChipLabel address={accountState.address} tone={hasWrongWalletNetwork ? 'danger' : 'ok'} />
				</summary>
				<div className='account-menu-popover'>
					<AddressValue address={accountState.address} />
					<WalletConnectionControl className='secondary' onClick={onChangeWallet} disabled={isManagingWallet} label={appCopy.changeWallet} />
					{hasWrongWalletNetwork ? <WalletNetworkControl className='primary' onClick={onSwitchNetwork} disabled={isManagingWallet} label={switchNetworkLabel} /> : undefined}
					<WalletConnectionControl className='quiet' onClick={onDisconnectWallet} disabled={isManagingWallet} label={isManagingWallet ? appCopy.managingWallet : appCopy.disconnectWallet} />
				</div>
			</details>
		)
	})()
	return (
		<OverviewHeaderPanel
			applicationTitle={applicationTitle}
			simulation={isBrowserSimulationReadBackend}
			settingsMenu={settingsMenu}
			badges={
				activeNetworkBadge === undefined && environmentBadge === undefined && wrongNetworkBadge === undefined ? undefined : (
					<>
						{activeNetworkBadge}
						{environmentBadge}
						{wrongNetworkBadge}
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
			notices={
				universeHasForked ? (
					<WarningSurface role='alert' surface='flat' variant='prominent' className='universe-fork-notice'>
						<strong className='notice-title'>
							{appCopy.universeForkNoticeLead}
							{universeForkTime === undefined ? undefined : (
								<>
									{' '}
									{appCopy.forkedOnConnector} <TimestampValue timestamp={universeForkTime} />
								</>
							)}
						</strong>
						<p>{appCopy.migrateRepToContinueUsingAugur}</p>
					</WarningSurface>
				) : undefined
			}
			metrics={
				<>
					<WalletBalanceGroup
						balances={[
							{ asset: commonCopy.eth, loading: isWalletAddressLoading || (showAccountBalances && isRefreshing && accountState.ethBalanceAttoEth === undefined), value: showAccountBalances ? accountState.ethBalanceAttoEth : undefined },
							{ asset: commonCopy.weth, className: 'overview-metric-secondary', loading: isWalletAddressLoading || (showAccountBalances && isRefreshing && accountState.wethBalanceAttoEth === undefined), value: showAccountBalances ? accountState.wethBalanceAttoEth : undefined },
							{ asset: commonCopy.rep, loading: isWalletAddressLoading || (showAccountBalances && isLoadingUniverseRepBalance), value: showAccountBalances ? universeRepBalanceAttoRep : undefined },
						]}
					/>
					{repPrices === undefined ? undefined : <RepPriceGroup {...repPrices} />}
				</>
			}
			footer={
				universePresentation === undefined ? undefined : (
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
				)
			}
		/>
	)
}
