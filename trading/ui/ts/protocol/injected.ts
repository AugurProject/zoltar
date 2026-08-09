import type { EIP1193Provider } from '@zoltar/shared/ethereum'

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

declare global {
	interface Window {
		ethereum?: InjectedEthereum
	}
}

export function getInjectedEthereum() {
	return window.ethereum
}
