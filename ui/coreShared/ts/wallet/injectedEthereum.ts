import type { Address, EIP1193Provider } from '@zoltar/shared/ethereum'
import { tryParseAddressInput } from './lib/inputs.js'

type EthereumEventHandler = (...args: unknown[]) => void

export type InjectedEthereumEventSource = {
	on?: (eventName: string, handler: EthereumEventHandler) => void
	removeListener?: (eventName: string, handler: EthereumEventHandler) => void
}

export type InjectedEthereum = EIP1193Provider & InjectedEthereumEventSource

export type WalletContextChangeEvent = 'accountsChanged' | 'chainChanged'

export function normalizeInjectedAccount(value: unknown): Address | undefined {
	return typeof value === 'string' ? tryParseAddressInput(value) : undefined
}

export async function readInjectedAccounts(provider: InjectedEthereum, method: 'eth_accounts' | 'eth_requestAccounts' = 'eth_accounts') {
	const result = await provider.request({ method, params: [] })
	if (!Array.isArray(result)) return []
	return result.map(normalizeInjectedAccount).filter((account): account is Address => account !== undefined)
}

export async function requireInjectedAccount(provider: InjectedEthereum, method: 'eth_accounts' | 'eth_requestAccounts' = 'eth_accounts') {
	const account = (await readInjectedAccounts(provider, method))[0]
	if (account === undefined) throw new Error(method === 'eth_requestAccounts' ? 'Wallet returned no account' : 'Wallet returned no connected account')
	return account
}

export function parseInjectedChainId(result: unknown) {
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Wallet returned an invalid chain ID.')
	return result
}

export async function readInjectedChainId(provider: InjectedEthereum) {
	return parseInjectedChainId(await provider.request({ method: 'eth_chainId', params: [] }))
}

export async function switchInjectedChain(provider: InjectedEthereum, chainId: string) {
	if (!/^0x[0-9a-fA-F]+$/.test(chainId)) throw new Error('Requested wallet chain ID is invalid')
	await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] })
}

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

export function getInjectedEthereum(): InjectedEthereum | undefined {
	if (typeof window === 'undefined') return undefined
	return window.ethereum
}
