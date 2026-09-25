import type { UseOnchainStateDependencies } from '@zoltar/ui-core-shared/app/hooks/useOnchainState.js'
import { useProtocolOnchainRuntime } from '@zoltar/ui-core-shared/app/hooks/useProtocolOnchainRuntime.js'
import { getActiveSimulationController } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { invalidateAppData } from '@zoltar/ui-core-shared/lib/dataRefresh.js'
import { useDeploymentFlow } from '../../deployment/hooks/useDeploymentFlow.js'
import { buildDeploymentRouteContentProps } from '../../deployment/lib/deploymentRoute.js'
import type { OverviewPanelsProps } from '@zoltar/ui-core-shared/app/components/OverviewPanels.js'
import { shouldShowDeploymentTab } from '../lib/deploymentTab.js'

type InitializeEnvironmentOptions = { shouldCommit?: () => boolean }

type DeploymentRouteOptions = Pick<Parameters<typeof buildDeploymentRouteContentProps>[0], 'deploymentCompleteHref' | 'getSections'>

type UseProtocolAppShellParameters = {
	deploymentRoute?: DeploymentRouteOptions
	/** Re-reads the environment from the current location; the shell passes a commit guard while a transaction may be in flight. */
	initializeEnvironment: (options?: InitializeEnvironmentOptions) => Promise<unknown>
	isDeploymentRoute: boolean
	onchainStateDependencies: UseOnchainStateDependencies
	/** Runs whenever the environment is replaced, either by the wallet network coordinator or by an explicit refresh. */
	onEnvironmentCommitted?: () => void
	/** Extra work for the header refresh action after the on-chain state reloads, such as re-quoting prices. */
	onRefresh?: () => void
}

type OverviewWalletProps = Pick<OverviewPanelsProps, 'accountState' | 'isConnectingWallet' | 'isManagingWallet' | 'isRefreshing' | 'onChangeWallet' | 'onConnect' | 'onDisconnectWallet' | 'onSwitchNetwork' | 'readBackendStatus' | 'walletBootstrapComplete'>

/** The application shell Zoltar and Statoblast share on the protocol on-chain runtime: environment runtime, deployment flow, merged notices, and the header wallet controls. Trading keeps its own wallet session and composes the shared header panel directly. */
export function useProtocolAppShell({ deploymentRoute = {}, initializeEnvironment, isDeploymentRoute, onchainStateDependencies, onEnvironmentCommitted, onRefresh }: UseProtocolAppShellParameters) {
	const runtime = useProtocolOnchainRuntime({
		enableChainClock: !isDeploymentRoute,
		onchainStateDependencies,
		replaceEnvironment: async canCommit => {
			let commitAllowed = false
			await initializeEnvironment({
				shouldCommit: () => {
					commitAllowed = canCommit()
					return commitAllowed
				},
			})
			return commitAllowed
		},
		...(onEnvironmentCommitted === undefined ? {} : { onEnvironmentCommitted }),
	})
	const {
		accountState,
		activeEnvironmentNonce,
		applicationDeploymentComplete,
		baseHookConfig,
		canReadOnchainData,
		chainClockError,
		deploymentStatusError,
		deploymentStatuses,
		environmentReady,
		errorMessages: onchainErrorMessages,
		hasLoadedDeploymentStatuses,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		readBackendReady,
		refreshState,
		setActiveEnvironmentNonce,
		setDeploymentStatuses,
	} = runtime
	const deploymentFlow = useDeploymentFlow({ ...baseHookConfig, deploymentStatuses, environmentRefreshKey: activeEnvironmentNonce, setDeploymentStatuses })
	const simulationController = getActiveSimulationController()
	const refreshSimulationView = async () => {
		await refreshState()
		// Simulation controls change chain state without a transaction; visible lists refresh in place.
		invalidateAppData()
		onRefresh?.()
	}
	const refreshActiveEnvironment = async () => {
		await initializeEnvironment()
		setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
		onEnvironmentCommitted?.()
		await refreshSimulationView()
	}
	const errorMessages = [deploymentFlow.errorMessage, ...onchainErrorMessages.filter(message => message !== deploymentStatusError), chainClockError].filter((message): message is string => message !== undefined)
	const applicationDeploymentMissing = canReadOnchainData && applicationDeploymentComplete === false
	const showDeployTab = shouldShowDeploymentTab({ applicationDeploymentMissing, deploymentStatusError, deploymentStatuses, hasLoadedDeploymentStatuses })
	const routeContentBlocked = !isDeploymentRoute && (!readBackendReady || applicationDeploymentMissing)
	const deployRouteContentProps = buildDeploymentRouteContentProps({
		accountAddress: accountState.address,
		deploymentStateReady: hasLoadedDeploymentStatuses && environmentReady && readBackendReady,
		deploymentStatusError,
		deploymentStatuses,
		flow: deploymentFlow,
		isLoadingDeploymentStatuses,
		isOnActiveAppChain,
		onRetryDeploymentStatus: () => void refreshState({ loadChainClock: false, loadWalletState: false }),
		...deploymentRoute,
	})
	const overviewWalletProps: OverviewWalletProps = {
		accountState,
		isConnectingWallet: runtime.isConnectingWallet,
		isManagingWallet: runtime.isManagingWallet,
		isRefreshing: runtime.isRefreshing,
		onChangeWallet: () => void runtime.changeWallet(),
		onConnect: () => void runtime.connectWallet(),
		onDisconnectWallet: () => void runtime.disconnectWallet(),
		onSwitchNetwork: () => void runtime.switchNetwork(),
		readBackendStatus: runtime.readBackendStatus,
		walletBootstrapComplete: runtime.walletBootstrapComplete,
	}

	return {
		...runtime,
		applicationDeploymentMissing,
		deploymentFlow,
		deployRouteContentProps,
		errorMessages,
		overviewWalletProps,
		refreshActiveEnvironment,
		refreshSimulationView,
		routeContentBlocked,
		showDeployTab,
		simulationController,
	}
}
