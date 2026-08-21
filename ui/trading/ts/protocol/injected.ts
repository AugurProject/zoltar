import type { EIP1193Provider } from '@zoltar/shared/ethereum'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'

type EthereumEventHandler = (...args: unknown[]) => void

export type InjectedEthereumEventSource = {
	on?: (eventName: string, handler: EthereumEventHandler) => void
	removeListener?: (eventName: string, handler: EthereumEventHandler) => void
}

export type InjectedEthereum = EIP1193Provider & InjectedEthereumEventSource

export type WalletContextChangeEvent = 'accountsChanged' | 'chainChanged'

export function subscribeToWalletContextChanges(eventSource: InjectedEthereumEventSource, onChange: (eventName: WalletContextChangeEvent) => void) {
	const handleAccountsChanged: EthereumEventHandler = () => onChange('accountsChanged')
	const handleChainChanged: EthereumEventHandler = () => onChange('chainChanged')
	eventSource.on?.('accountsChanged', handleAccountsChanged)
	eventSource.on?.('chainChanged', handleChainChanged)
	return () => {
		eventSource.removeListener?.('accountsChanged', handleAccountsChanged)
		eventSource.removeListener?.('chainChanged', handleChainChanged)
	}
}

export function createWalletContextSubscription(onChange: (eventName: WalletContextChangeEvent) => void) {
	let eventSource: InjectedEthereumEventSource | undefined
	let unsubscribe: (() => void) | undefined
	return {
		bind(nextEventSource: InjectedEthereumEventSource | undefined) {
			if (nextEventSource === eventSource) return
			unsubscribe?.()
			eventSource = nextEventSource
			unsubscribe = nextEventSource === undefined ? undefined : subscribeToWalletContextChanges(nextEventSource, onChange)
		},
		dispose() {
			unsubscribe?.()
			unsubscribe = undefined
			eventSource = undefined
		},
	}
}

declare global {
	interface Window {
		ethereum?: InjectedEthereum
	}
}

export function getInjectedEthereum() {
	return getActiveBackend().getProvider() ?? window.ethereum
}
