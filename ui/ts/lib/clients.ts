import { createPublicClient, createWalletClient, custom, http, publicActions, getAddress, type Account, type Address, type Hash, type PublicActions, type Transport, type WalletClient } from 'viem'
import type { Chain } from 'viem/chains'
import { getInjectedEthereum, type InjectedEthereum } from '../injectedEthereum.js'
import { DEFAULT_NETWORK_KEY, createViemChain, getNetworkConfig, type SupportedNetworkKey } from '../shared/networkConfig.js'

const chainsByNetworkKey = new Map<SupportedNetworkKey, Chain>()

export type ReadClient = ReturnType<typeof createPublicClient>
export type WriteClient = WalletClient<Transport, Chain, Account> & PublicActions<Transport, Chain>

type CreateReadClientOptions = {
	ethereum?: InjectedEthereum
	walletChainId?: string | undefined
}

type CreateWriteClientCallbacks = {
	onTransactionSubmitted?: (hash: Hash) => void
}

function getChainForNetwork(networkKey: SupportedNetworkKey) {
	const existingChain = chainsByNetworkKey.get(networkKey)
	if (existingChain !== undefined) {
		return existingChain
	}

	const chain = createViemChain(networkKey)
	chainsByNetworkKey.set(networkKey, chain)
	return chain
}

function getProviderChainId(ethereum: InjectedEthereum | undefined) {
	if (ethereum === undefined || !('chainId' in ethereum) || typeof ethereum.chainId !== 'string') {
		return undefined
	}

	return ethereum.chainId
}

function createReadClient(networkKey: SupportedNetworkKey, ethereum?: InjectedEthereum): ReadClient {
	const chain = getChainForNetwork(networkKey)
	const networkConfig = getNetworkConfig(networkKey)
	return createPublicClient({
		chain,
		transport: ethereum !== undefined ? custom(ethereum) : http(networkConfig.defaultRpcUrl, { batch: { wait: 100 } }),
	})
}

export function createReadClientForNetwork(networkKey: SupportedNetworkKey, options: CreateReadClientOptions = {}): ReadClient {
	const ethereum = options.ethereum ?? getInjectedEthereum()
	const walletChainId = options.walletChainId ?? getProviderChainId(ethereum)
	const shouldUseInjectedProvider = ethereum !== undefined && walletChainId === getNetworkConfig(networkKey).chainIdHex
	return createReadClient(networkKey, shouldUseInjectedProvider ? ethereum : undefined)
}

export function createConnectedReadClient(networkKey: SupportedNetworkKey = DEFAULT_NETWORK_KEY, options: CreateReadClientOptions = {}): ReadClient {
	return createReadClientForNetwork(networkKey, options)
}

function createWriteClient(ethereum: InjectedEthereum, accountAddress: Address, networkKey: SupportedNetworkKey, callbacks: CreateWriteClientCallbacks = {}): WriteClient {
	const chain = getChainForNetwork(networkKey)
	const baseClient = createWalletClient({
		account: accountAddress,
		chain,
		transport: custom(ethereum),
	}).extend(publicActions)

	const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
		const hash = await baseClient.sendRawTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
		const hash = await baseClient.sendTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	const writeContract: typeof baseClient.writeContract = async parameters => {
		const hash = await baseClient.writeContract(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	return {
		...baseClient,
		sendRawTransaction,
		sendTransaction,
		writeContract,
	}
}

export function createWalletWriteClient(accountAddress: Address, networkKey: SupportedNetworkKey = DEFAULT_NETWORK_KEY, callbacks: CreateWriteClientCallbacks = {}): WriteClient {
	const ethereum = getRequiredInjectedEthereum()
	const providerChainId = getProviderChainId(ethereum)
	const expectedChainId = getNetworkConfig(networkKey).chainIdHex
	if (providerChainId !== undefined && providerChainId !== expectedChainId) {
		throw new Error(`Wallet is connected to ${providerChainId}, but ${expectedChainId} is required`)
	}
	return createWriteClient(ethereum, accountAddress, networkKey, callbacks)
}

export function getRequiredInjectedEthereum() {
	const ethereum = getInjectedEthereum()
	if (ethereum === undefined) throw new Error('No injected wallet found')
	return ethereum
}

export function normalizeAccount(value: unknown): Address | undefined {
	if (typeof value !== 'string') return undefined
	return getAddress(value)
}
