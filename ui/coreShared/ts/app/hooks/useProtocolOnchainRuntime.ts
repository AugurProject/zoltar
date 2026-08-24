import { getWalletScopedAccountAddress, isSupportedAppChain } from '../../lib/network.js'
import { useOnchainState, type UseOnchainStateDependencies } from './useOnchainState.js'
import { buildProtocolHookConfigs, useProtocolAppRuntime } from './useProtocolAppRuntime.js'

type CommitGuard = () => boolean

export function useProtocolOnchainRuntime({ enableChainClock, onEnvironmentCommitted, onchainStateDependencies, replaceEnvironment }: { enableChainClock: boolean; onEnvironmentCommitted?(): void; onchainStateDependencies: UseOnchainStateDependencies; replaceEnvironment(canCommit: CommitGuard): Promise<boolean> }) {
	const runtime = useProtocolAppRuntime({ replaceEnvironment, ...(onEnvironmentCommitted === undefined ? {} : { onEnvironmentCommitted }) })
	const onchain = useOnchainState(
		{
			activeEnvironmentNonce: runtime.activeEnvironmentNonce,
			enableChainClock,
			...(runtime.followSupportedWalletNetwork ? { onSupportedNetworkChange: () => void runtime.supportedNetworkChangeCoordinator.handleSupportedNetworkChange() } : {}),
		},
		onchainStateDependencies,
	)
	const readBackendReady = onchain.readBackendValidated && onchain.readBackendMessage === undefined
	const canReadOnchainData = onchain.environmentReady && readBackendReady && onchain.hasLoadedDeploymentStatuses
	const isOnActiveAppChain = isSupportedAppChain(onchain.accountState.chainId)
	const walletScopedAccountAddress = getWalletScopedAccountAddress(onchain.accountState.address, onchain.accountState.chainId)
	const hookConfigs = buildProtocolHookConfigs({ accountAddress: onchain.accountState.address, walletScopedAccountAddress, refreshState: onchain.refreshState, transactionTray: runtime.transactionTray })

	return {
		...runtime,
		...onchain,
		...hookConfigs,
		canReadOnchainData,
		isOnActiveAppChain,
		readBackendReady,
		walletScopedAccountAddress,
	}
}
