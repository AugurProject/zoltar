import { WalletConnectionControl, WalletNetworkControl } from '@zoltar/ui-core-shared/components/WalletConnectionControl.js'
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import * as coreAppCopy from '@zoltar/ui-core-shared/copy/app.js'
import { getChainDisplayLabel } from '@zoltar/ui-core-shared/wallet/network.js'
import { WalletChipPlaceholder } from '@zoltar/ui-core-shared/components/WalletChip.js'
import { AccountMenu, AccountMenuNetworkFact } from '@zoltar/ui-core-shared/app/components/AccountMenu.js'
import type { ComponentChildren } from 'preact'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import * as appCopy from '../copy/app.js'
import { formatSwitchNetworkAction } from '../copy/availability.js'

/** The subset of the deployment wallet session the toolbar button presents. */
type DeploymentWalletState = Readonly<{ account: string | undefined; connecting: boolean; ready: boolean }>

export type TradingWalletControlsProps = Readonly<{
	account: `0x${string}` | undefined
	/** Balances listed in the live account popover. */
	accountMetrics?: ComponentChildren
	/** The deployment network named in the live account popover. */
	networkName?: string | undefined
	deploymentSetupActive: boolean
	deploymentWalletState: DeploymentWalletState
	liveDeploymentStatus: 'loading' | 'verified' | 'missing' | 'unreachable'
	onDeploymentWalletRequest(): void
	onWalletConnectRequest(): void
	/** Present when the injected wallet reports another chain; the switch action re-requests the deployment chain. */
	onSwitchNetwork?(): void
	requiredNetworkName?: string | undefined
	/** The chain the wallet reported while it mismatched the deployment chain; named in the wrong-network badge. */
	walletChainId?: number | undefined
	routeOwnsLiveWallet: boolean
	simulation: boolean
	workflowLocked: boolean
}>

function deploymentWalletLabel(state: DeploymentWalletState) {
	if (state.connecting) return appCopy.connectingWallet
	if (state.account === undefined) return appCopy.connectWallet
	return <ReadOnlyAddressValue address={state.account} responsiveAbbreviation />
}

type TradingWalletSlotState = Pick<TradingWalletControlsProps, 'deploymentSetupActive' | 'liveDeploymentStatus' | 'routeOwnsLiveWallet'>

/** Whether the toolbar wallet slot has anything to show on the current route and deployment state. */
export function hasTradingWalletControls({ deploymentSetupActive, liveDeploymentStatus, routeOwnsLiveWallet }: TradingWalletSlotState) {
	return deploymentSetupActive || (routeOwnsLiveWallet && (liveDeploymentStatus === 'loading' || liveDeploymentStatus === 'verified'))
}

/** Toolbar wallet slot: the deployment wallet button, a reserved slot while the deployment is checked, or the live account chip and its actions. */
export function TradingWalletControls({
	account,
	accountMetrics,
	networkName,
	deploymentSetupActive,
	deploymentWalletState,
	liveDeploymentStatus,
	onDeploymentWalletRequest,
	onSwitchNetwork,
	onWalletConnectRequest,
	requiredNetworkName,
	routeOwnsLiveWallet,
	simulation,
	walletChainId,
	workflowLocked,
}: TradingWalletControlsProps) {
	const liveWalletVisible = liveDeploymentStatus === 'verified' && routeOwnsLiveWallet
	const reservesSlot = liveDeploymentStatus === 'loading' && routeOwnsLiveWallet
	const showsSwitchNetworkAction = liveWalletVisible && account === undefined && requiredNetworkName !== undefined && onSwitchNetwork !== undefined
	const showsConnectAction = liveWalletVisible && !showsSwitchNetworkAction && account === undefined
	// The simulation harness owns the simulated wallet, so its popover offers no wallet change.
	const showsChangeWalletAction = liveWalletVisible && account !== undefined && !simulation
	if (!hasTradingWalletControls({ deploymentSetupActive, liveDeploymentStatus, routeOwnsLiveWallet })) return null
	return (
		<div className='trading-wallet-actions'>
			{deploymentSetupActive ? (
				<WalletConnectionControl
					label={deploymentWalletLabel(deploymentWalletState)}
					pendingLabel={appCopy.connectingWallet}
					pending={deploymentWalletState.connecting}
					disabled={workflowLocked || !deploymentWalletState.ready}
					ariaLabel={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWalletLabel(deploymentWalletState.account)}
					title={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWallet}
					onClick={onDeploymentWalletRequest}
				/>
			) : null}
			{reservesSlot ? (
				<WalletChipPlaceholder>
					<LoadingText announce={false}>{appCopy.loadingWithEllipsis}</LoadingText>
				</WalletChipPlaceholder>
			) : null}
			{liveWalletVisible && account !== undefined ? (
				<AccountMenu
					address={account}
					metrics={accountMetrics}
					network={networkName === undefined ? undefined : <AccountMenuNetworkFact label={coreAppCopy.network}>{networkName}</AccountMenuNetworkFact>}
					actions={showsChangeWalletAction ? <WalletConnectionControl className='secondary wallet-button' disabled={workflowLocked} onClick={onWalletConnectRequest} label={appCopy.changeWallet} /> : undefined}
				/>
			) : null}
			{showsSwitchNetworkAction ? <WalletNetworkControl badge={coreAppCopy.formatWrongNetworkBadgeLabel(getChainDisplayLabel(walletChainId?.toString()) ?? coreAppCopy.unknownNetwork)} label={formatSwitchNetworkAction(requiredNetworkName)} disabled={workflowLocked} onClick={onSwitchNetwork} /> : null}
			{showsConnectAction ? <WalletConnectionControl className='secondary wallet-button' disabled={workflowLocked} onClick={onWalletConnectRequest} label={appCopy.connectWallet} /> : null}
		</div>
	)
}
