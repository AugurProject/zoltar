import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js'
import { WalletChip, WalletChipPlaceholder } from '@zoltar/ui-core-shared/components/WalletChip.js'
import type { DeploymentWalletState } from '../features/TradingDeploymentSetup.js'
import { TradingAddressValue } from './TradingAddress.js'
import * as appCopy from '../copy/app.js'

export type TradingWalletControlsProps = Readonly<{
	account: `0x${string}` | undefined
	deploymentSetupActive: boolean
	deploymentWalletState: DeploymentWalletState
	liveDeploymentStatus: 'loading' | 'verified' | 'unavailable'
	onDeploymentWalletRequest(): void
	onWalletConnectRequest(): void
	routeOwnsLiveWallet: boolean
	simulation: boolean
	workflowLocked: boolean
}>

function deploymentWalletLabel(state: DeploymentWalletState) {
	if (state.connecting) return appCopy.connectingWallet
	if (state.account === undefined) return appCopy.connectWallet
	return <TradingAddressValue value={state.account} />
}

type TradingWalletSlotState = Pick<TradingWalletControlsProps, 'deploymentSetupActive' | 'liveDeploymentStatus' | 'routeOwnsLiveWallet'>

/** Whether the toolbar wallet slot has anything to show on the current route and deployment state. */
export function hasTradingWalletControls({ deploymentSetupActive, liveDeploymentStatus, routeOwnsLiveWallet }: TradingWalletSlotState) {
	return deploymentSetupActive || (routeOwnsLiveWallet && liveDeploymentStatus !== 'unavailable')
}

/** Toolbar wallet slot: the deployment wallet button, a reserved slot while the deployment is checked, or the live account chip and its actions. */
export function TradingWalletControls({ account, deploymentSetupActive, deploymentWalletState, liveDeploymentStatus, onDeploymentWalletRequest, onWalletConnectRequest, routeOwnsLiveWallet, simulation, workflowLocked }: TradingWalletControlsProps) {
	const liveWalletVisible = liveDeploymentStatus === 'verified' && routeOwnsLiveWallet
	const reservesSlot = liveDeploymentStatus === 'loading' && routeOwnsLiveWallet
	const showsConnectAction = liveWalletVisible && (!simulation || account === undefined)
	if (!hasTradingWalletControls({ deploymentSetupActive, liveDeploymentStatus, routeOwnsLiveWallet })) return null
	return (
		<div class='trading-wallet-actions'>
			{deploymentSetupActive ? (
				<button
					class='secondary wallet-button'
					type='button'
					disabled={workflowLocked || deploymentWalletState.connecting || !deploymentWalletState.ready}
					aria-busy={deploymentWalletState.connecting}
					aria-label={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWalletLabel(deploymentWalletState.account)}
					title={deploymentWalletState.account === undefined ? undefined : appCopy.disconnectWallet}
					onClick={onDeploymentWalletRequest}
				>
					{deploymentWalletLabel(deploymentWalletState)}
				</button>
			) : null}
			{reservesSlot ? (
				<WalletChipPlaceholder>
					<LoadingText announce={false}>{appCopy.loadingWithEllipsis}</LoadingText>
				</WalletChipPlaceholder>
			) : null}
			{liveWalletVisible && account !== undefined ? <WalletChip address={account} /> : null}
			{showsConnectAction ? (
				<button class={account === undefined ? 'secondary wallet-button' : 'quiet wallet-button'} type='button' disabled={workflowLocked} onClick={onWalletConnectRequest}>
					{account === undefined ? appCopy.connectWallet : appCopy.changeWallet}
				</button>
			) : null}
		</div>
	)
}
