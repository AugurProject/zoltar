import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { InjectedEthereum } from '@zoltar/ui-core-shared/injectedEthereum.js'
export { createWalletContextSubscription, subscribeToWalletContextChanges } from '@zoltar/ui-core-shared/injectedEthereum.js'
export type { InjectedEthereum, WalletContextChangeEvent } from '@zoltar/ui-core-shared/injectedEthereum.js'

declare global {
	interface Window {
		ethereum?: InjectedEthereum
	}
}

export function getInjectedEthereum() {
	return getActiveBackend().getProvider() ?? window.ethereum
}
