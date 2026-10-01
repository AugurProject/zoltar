import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
export { createWalletContextSubscription, subscribeToWalletContextChanges } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'
export type { InjectedEthereum, WalletContextChangeEvent } from '@zoltar/ui-core-shared/wallet/injectedEthereum.js'

/** Returns the active chain backend's provider, falling back to the browser-injected wallet. */
export function getActiveInjectedProvider() {
	return getActiveBackend().getProvider() ?? window.ethereum
}
