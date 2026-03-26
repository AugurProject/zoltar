import type { EIP1193Provider } from 'viem'

type EthereumEventHandler = (...args: unknown[]) => void

export type InjectedEthereum = EIP1193Provider & {
	on?: (eventName: string, handler: EthereumEventHandler) => void
	removeListener?: (eventName: string, handler: EthereumEventHandler) => void
}

declare global {
	interface Window {
		ethereum?: InjectedEthereum
	}
}

export function getInjectedEthereum(): InjectedEthereum | undefined {
	return window.ethereum
}
