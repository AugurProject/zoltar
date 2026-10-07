import type { MutableRef } from 'preact/hooks'
import { type ChainBackend, unsupportedWalletActionMessages } from '../../wallet/chainBackend.js'
import { getNetworkSwitchTarget } from '../../wallet/networkProfile.js'

type RunWalletManagementAction = (action: (backend: ChainBackend) => Promise<void>, fallbackMessage: string) => Promise<void>

/** Starts a wallet action and returns whether it is still the newest one of its kind in the environment it started in. */
export function beginWalletAction(generation: MutableRef<number>, context: MutableRef<{ activeEnvironmentNonce: number; backend: ChainBackend }>, activeEnvironmentNonce: number, backend: ChainBackend) {
	generation.current += 1
	const requestGeneration = generation.current
	return () => requestGeneration === generation.current && activeEnvironmentNonce === context.current.activeEnvironmentNonce && backend === context.current.backend
}

/** The header's wallet management actions; a wallet without the request method gets an explanation of what to do in the wallet instead. */
export function createWalletManagementActions(run: RunWalletManagementAction) {
	return {
		changeWallet: async () =>
			await run(async backend => {
				if (backend.requestAccountSelection === undefined) throw new Error(unsupportedWalletActionMessages.accountSelection)
				await backend.requestAccountSelection()
			}, 'Wallet account change failed'),
		disconnectWallet: async () =>
			await run(async backend => {
				if (backend.disconnectWallet === undefined) throw new Error(unsupportedWalletActionMessages.disconnect)
				await backend.disconnectWallet()
			}, 'Wallet disconnect failed'),
		switchNetwork: async () =>
			await run(async backend => {
				if (backend.switchNetwork === undefined) throw new Error(unsupportedWalletActionMessages.formatNetworkSwitch(getNetworkSwitchTarget(backend.profile)))
				await backend.switchNetwork()
			}, 'Network switch failed'),
	}
}
