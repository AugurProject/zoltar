import { withReadTimeout } from '../lib/promise.js'
import { assertNetworkEnabled } from './networkAvailability.js'
import { bigintToSafeNumber, type Address, type EIP1193Provider } from '@zoltar/core-shared/evm/ethereum'
import { tryParseAddressInput } from '../forms/inputs.js'

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

const readOnlyRpcMethods = new Set([
	'eth_accounts',
	'eth_chainId',
	'eth_blockNumber',
	'eth_call',
	'eth_estimateGas',
	'eth_getBalance',
	'eth_getCode',
	'eth_getStorageAt',
	'eth_getBlockByNumber',
	'eth_getBlockByHash',
	'eth_getTransactionByHash',
	'eth_getTransactionReceipt',
	'eth_getTransactionCount',
	'eth_getLogs',
	'eth_gasPrice',
	'eth_maxPriorityFeePerGas',
	'eth_feeHistory',
	'net_version',
])

export function requestWalletRpc(provider: InjectedEthereum, parameters: Parameters<InjectedEthereum['request']>[0]) {
	const response = provider.request(parameters)
	return readOnlyRpcMethods.has(parameters.method) ? withReadTimeout(response) : response
}

export async function readInjectedAccounts(provider: InjectedEthereum, method: 'eth_accounts' | 'eth_requestAccounts' = 'eth_accounts') {
	const result = await requestWalletRpc(provider, { method, params: [] })
	if (!Array.isArray(result)) return []
	return result.map(normalizeInjectedAccount).filter((account): account is Address => account !== undefined)
}

export async function requireInjectedAccount(provider: InjectedEthereum, method: 'eth_accounts' | 'eth_requestAccounts' = 'eth_accounts') {
	const account = (await readInjectedAccounts(provider, method))[0]
	if (account === undefined) throw new Error(method === 'eth_requestAccounts' ? 'Wallet returned no account' : 'Wallet returned no connected account')
	return account
}

/** Prompts the wallet for access and returns the account it exposes. */
export function requestInjectedAccount(provider: InjectedEthereum) {
	return requireInjectedAccount(provider, 'eth_requestAccounts')
}

export function parseInjectedChainId(result: unknown) {
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('Wallet returned an invalid chain ID.')
	return result
}

async function readInjectedChainId(provider: InjectedEthereum) {
	return parseInjectedChainId(await requestWalletRpc(provider, { method: 'eth_chainId', params: [] }))
}

/** The wallet chain as a number for callers that compare against `chain.id` style deployment configuration. */
export async function readInjectedChainIdNumber(provider: InjectedEthereum) {
	return bigintToSafeNumber(BigInt(await readInjectedChainId(provider)), 'Wallet chain ID')
}

export function formatChainIdHex(chainId: number) {
	if (!Number.isSafeInteger(chainId) || chainId < 0) throw new Error('Requested wallet chain ID is invalid')
	return `0x${chainId.toString(16)}`
}

export async function switchInjectedChain(provider: InjectedEthereum, chainId: string | number) {
	const chainIdHex = typeof chainId === 'number' ? formatChainIdHex(chainId) : chainId
	if (!/^0x[0-9a-fA-F]+$/.test(chainIdHex)) throw new Error('Requested wallet chain ID is invalid')
	assertNetworkEnabled(chainIdHex)
	await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] })
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
