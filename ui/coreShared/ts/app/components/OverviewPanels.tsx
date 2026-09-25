import type { ComponentChildren } from 'preact'
import { WalletConnectionControl, WalletNetworkControl } from '../../components/WalletConnectionControl.js'
import * as appCopy from '../../copy/app.js'
import * as commonCopy from '../../copy/common.js'
import { Badge } from '../../components/Badge.js'
import { CurrencyValue } from '../../components/CurrencyValue.js'
import { HeaderMetricGroup } from '../../components/HeaderMetricStrip.js'
import { WalletBalanceGroup, type WalletBalanceMetric } from '../../components/WalletBalanceGroup.js'
import { MetricField } from '../../components/MetricField.js'
import { StateHint } from '../../components/StateHint.js'
import { ToolbarField } from '../../components/ToolbarField.js'
import { TimestampValue } from '../../components/TimestampValue.js'
import { WarningSurface } from '../../components/WarningSurface.js'
import { getChainDisplayLabel, isActiveAppChain } from '../../wallet/network.js'
import { renderRepPriceSourceLabel, type RepPriceFailure, type RepPriceSource } from '../../lib/repPriceSource.js'
import type { AccountState } from '../../types/app.js'
import type { ReadBackendStatus } from '../../wallet/chainBackend.js'
import { getActiveNetworkProfile } from '../../lib/activeEnvironment.js'
import { getNetworkSwitchTarget } from '../../wallet/networkProfile.js'
import { formatUniverseDisplayLabel, formatUniverseLabel } from '../../lib/universeLabels.js'
import type { UserMessagePresentation } from '../../lib/userCopy.js'
import { AccountMenu, AccountMenuNetworkFact } from './AccountMenu.js'
import { OverviewHeaderPanel } from './OverviewHeaderPanel.js'

/** The REP price group of the account popover; applications without price quotes omit it. */
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
	/** Primary navigation for the top bar, supplied by `AppHeaderShell`. */
	navigation?: ComponentChildren
	applicationTitle: string
	activeUniverseId: bigint
	accountState: AccountState
	isConnectingWallet: boolean
	isManagingWallet: boolean
	walletBootstrapComplete: boolean
	/** The connected account's REP balance in the active universe. */
	universeRepBalanceAttoRep: bigint | undefined
	isLoadingUniverseRepBalance: boolean
	universeForkTime?: bigint | undefined
	universeHasForked?: boolean | undefined
	/** Where the fork notice's "Migrate REP" action leads; each application links to its own migration flow. */
	migrateRepHref?: string | undefined
	universePresentation: UserMessagePresentation | undefined
	isRefreshing: boolean
	onConnect: () => void
	onChangeWallet: () => void
	onDisconnectWallet: () => void
	onGoToGenesisUniverse: () => void
	onSwitchNetwork: () => void
	readBackendStatus?: ReadBackendStatus
	repPrices?: OverviewRepPricesProps | undefined
	/** Lists the wallet's WETH balance; only applications that use WETH set it. */
	showWethBalance?: boolean
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
			action={
				isRepPricingUnavailable ? undefined : (
					<button type='button' className='quiet metric-label-refresh' onClick={onRefresh} disabled={isRefreshing} aria-label={appCopy.refreshRepPrices} title={isRefreshing ? appCopy.refreshingRepPrices : appCopy.refreshRepPrices}>
						↻
					</button>
				)
			}
		>
			<MetricField
				label={
					<>
						{appCopy.repPerEthCompact} {repPerEthSourceLabel ?? renderRepPriceSourceLabel(repPerEthSource, repPerEthSourceUrl)}
					</>
				}
			>
				{isRepPricingUnavailable ? repPricingUnavailableLabel : (renderRepPriceFailure(repPerEthPrice === undefined && !isLoading ? repPerEthFailure : undefined) ?? <CurrencyValue value={repPerEthPrice} loading={isLoading && repPerEthPrice === undefined} copyable={false} compactWhenOverflow />)}
			</MetricField>
			<MetricField
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

/** The forked-universe notice: when the universe forked and a direct action to migrate REP. */
function UniverseForkNotice({ forkTime, migrateRepHref }: { forkTime: bigint | undefined; migrateRepHref: string | undefined }) {
	return (
		<WarningSurface role='status' surface='flat' className='universe-fork-notice'>
			<p>
				<strong>
					{appCopy.universeForkedLead}
					{forkTime === undefined ? undefined : (
						<>
							{' '}
							{appCopy.forkedOnConnector} <TimestampValue timestamp={forkTime} />
						</>
					)}
					.
				</strong>{' '}
				{appCopy.migrateRepToChildUniverse}
			</p>
			{migrateRepHref === undefined ? undefined : (
				<a className='button-link secondary-link' href={migrateRepHref}>
					{appCopy.migrateRep}
				</a>
			)}
		</WarningSurface>
	)
}

/** The protocol application top bar: brand, navigation, active universe, the account popover with balances and optional REP prices, and universe state. */
export function OverviewPanels({
	settingsMenu,
	navigation,
	applicationTitle,
	activeUniverseId,
	accountState,
	isConnectingWallet,
	isManagingWallet,
	isLoadingUniverseRepBalance,
	migrateRepHref,
	onConnect,
	onChangeWallet,
	onDisconnectWallet,
	onGoToGenesisUniverse,
	onSwitchNetwork,
	readBackendStatus,
	repPrices,
	showWethBalance = false,
	universeForkTime,
	universeHasForked,
	universePresentation,
	universeRepBalanceAttoRep,
	isRefreshing,
	walletBootstrapComplete,
}: OverviewPanelsProps) {
	const isBrowserSimulationReadBackend = readBackendStatus?.rpcUrl === 'browser-simulation'
	const activeNetworkProfile = getActiveNetworkProfile()
	const walletOnActiveNetwork = isActiveAppChain(accountState.chainId)
	const hasWrongWalletNetwork = accountState.address !== undefined && !walletOnActiveNetwork
	const showAccountBalances = walletBootstrapComplete && accountState.address !== undefined && !hasWrongWalletNetwork
	const switchNetworkLabel = appCopy.formatSwitchToNetwork(getNetworkSwitchTarget(activeNetworkProfile))
	const wrongNetworkBadge = hasWrongWalletNetwork ? <Badge tone='danger'>{appCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(accountState.chainId) ?? appCopy.unknownNetwork)}</Badge> : undefined
	// The simulation strip already names the simulated network, so only a public network earns a badge.
	const activeNetworkBadge = activeNetworkProfile.id === 'simulation' ? undefined : <Badge>{activeNetworkProfile.displayName}</Badge>
	const balances: WalletBalanceMetric[] = [
		{ asset: commonCopy.eth, loading: showAccountBalances && isRefreshing && accountState.ethBalanceAttoEth === undefined, value: showAccountBalances ? accountState.ethBalanceAttoEth : undefined },
		...(showWethBalance ? [{ asset: commonCopy.weth, loading: showAccountBalances && isRefreshing && accountState.wethBalanceAttoEth === undefined, value: showAccountBalances ? accountState.wethBalanceAttoEth : undefined }] : []),
		{ asset: commonCopy.rep, loading: showAccountBalances && isLoadingUniverseRepBalance, value: showAccountBalances ? universeRepBalanceAttoRep : undefined },
	]
	const accountControl = (() => {
		if (accountState.address === undefined) return <WalletConnectionControl onClick={onConnect} pending={isConnectingWallet} pendingLabel={appCopy.connecting} label={commonCopy.connectWallet} />
		// The simulation harness owns the simulated wallet session, so its popover lists balances without wallet actions.
		const actions = isBrowserSimulationReadBackend ? undefined : (
			<>
				<WalletConnectionControl className='secondary' onClick={onChangeWallet} disabled={isManagingWallet} label={appCopy.changeWallet} />
				<WalletConnectionControl className='quiet' onClick={onDisconnectWallet} disabled={isManagingWallet} label={isManagingWallet ? appCopy.managingWallet : appCopy.disconnectWallet} />
			</>
		)
		return (
			<>
				{/* Network recovery stays on the bar: a wallet on the wrong network blocks every action until it switches. */}
				{hasWrongWalletNetwork ? <WalletNetworkControl className='primary wallet-button' onClick={onSwitchNetwork} disabled={isManagingWallet} label={switchNetworkLabel} /> : undefined}
				<AccountMenu
					address={accountState.address}
					tone={hasWrongWalletNetwork ? 'danger' : 'ok'}
					network={
						<>
							<AccountMenuNetworkFact label={appCopy.network}>{activeNetworkProfile.displayName}</AccountMenuNetworkFact>
							{readBackendStatus?.blockNumber === undefined ? undefined : <AccountMenuNetworkFact label={appCopy.latestBlock}>{readBackendStatus.blockNumber.toString()}</AccountMenuNetworkFact>}
						</>
					}
					metrics={
						<>
							<WalletBalanceGroup balances={balances} />
							{repPrices === undefined ? undefined : <RepPriceGroup {...repPrices} />}
						</>
					}
					actions={actions}
				/>
			</>
		)
	})()
	return (
		<OverviewHeaderPanel
			applicationTitle={applicationTitle}
			settingsMenu={settingsMenu}
			navigation={navigation}
			badges={
				activeNetworkBadge === undefined && wrongNetworkBadge === undefined ? undefined : (
					<>
						{activeNetworkBadge}
						{wrongNetworkBadge}
					</>
				)
			}
			controls={
				<>
					<ToolbarField label={commonCopy.universe}>
						<span title={formatUniverseLabel(activeUniverseId)}>{formatUniverseDisplayLabel(activeUniverseId)}</span>
					</ToolbarField>
					{accountControl}
				</>
			}
			notices={universeHasForked ? <UniverseForkNotice forkTime={universeForkTime} migrateRepHref={migrateRepHref} /> : undefined}
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
