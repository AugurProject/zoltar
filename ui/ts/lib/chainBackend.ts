import { createPublicClient, createWalletClient, custom, getAddress, http, publicActions, type Account, type Address, type Hash, type Hex, type PublicActions, type Transport, type WalletClient } from 'viem'
import { getInjectedEthereum, type InjectedEthereum } from '../injectedEthereum.js'
import { MAINNET_NETWORK_PROFILE, type NetworkProfile } from './networkProfile.js'

const DEFAULT_RPC_URL = 'https://ethereum.dark.florist'

export type ReadClient = ReturnType<typeof createPublicClient>
export type WriteClient = WalletClient<Transport, NetworkProfile['chain'], Account> &
	PublicActions<Transport, NetworkProfile['chain']> & {
		installSimulationProxyDeployer?: (parameters: { address: Address; runtimeCode: Hex }) => Promise<void>
		patchSimulationGenesisRepToken?: (parameters: { repAddress: Address; zoltarAddress: Address }) => Promise<void>
	}

export type CreateWriteClientCallbacks = {
	onTransactionSubmitted?: (hash: Hash) => void
}

export type ChainBackend = {
	createReadClient(): ReadClient
	createWriteClient(accountAddress: Address, callbacks?: CreateWriteClientCallbacks): WriteClient
	getAccounts(): Promise<readonly Address[]>
	getChainId(): Promise<string>
	getProvider(): InjectedEthereum | undefined
	hasWallet(): boolean
	id: 'injected' | 'simulation'
	isBootstrapped?: boolean
	isBootstrapping?: boolean
	profile: NetworkProfile
	requestAccounts(): Promise<readonly Address[]>
	subscribeAccountsChanged(handler: () => void): () => void
	subscribeChainChanged(handler: () => void): () => void
	waitUntilReady?(): Promise<void>
}

function createReadClientForProfile(profile: NetworkProfile, ethereum?: InjectedEthereum): ReadClient {
	return createPublicClient({
		chain: profile.chain,
		transport: ethereum !== undefined ? custom(ethereum) : http(DEFAULT_RPC_URL, { batch: { wait: 100 } }),
	})
}

function withTransactionCallbacks(baseClient: WriteClient, callbacks: CreateWriteClientCallbacks): WriteClient {
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

export function normalizeAccount(value: unknown): Address | undefined {
	if (typeof value !== 'string') return undefined
	return getAddress(value)
}

export function createInjectedBackend(): ChainBackend {
	const getProvider = () => getInjectedEthereum()

	return {
		createReadClient: () => createReadClientForProfile(MAINNET_NETWORK_PROFILE, getProvider()),
		createWriteClient: (accountAddress, callbacks = {}) => {
			const ethereum = getProvider()
			if (ethereum === undefined) throw new Error('No injected wallet found')

			const baseClient = createWalletClient({
				account: accountAddress,
				chain: MAINNET_NETWORK_PROFILE.chain,
				transport: custom(ethereum),
			}).extend(publicActions) as WriteClient

			return withTransactionCallbacks(baseClient, callbacks)
		},
		getAccounts: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return []
			const result = await ethereum.request({ method: 'eth_accounts' }).catch(() => [])
			if (!Array.isArray(result)) return []
			return result.map(normalizeAccount).filter((address): address is Address => address !== undefined)
		},
		getChainId: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return MAINNET_NETWORK_PROFILE.chainIdHex
			const result = await ethereum.request({ method: 'eth_chainId' })
			return typeof result === 'string' ? result : MAINNET_NETWORK_PROFILE.chainIdHex
		},
		getProvider,
		hasWallet: () => getProvider() !== undefined,
		id: 'injected',
		profile: MAINNET_NETWORK_PROFILE,
		requestAccounts: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return []
			const result = await ethereum.request({ method: 'eth_requestAccounts' })
			if (!Array.isArray(result)) return []
			return result.map(normalizeAccount).filter((address): address is Address => address !== undefined)
		},
		subscribeAccountsChanged: handler => {
			const ethereum = getProvider()
			ethereum?.on?.('accountsChanged', handler)
			return () => {
				ethereum?.removeListener?.('accountsChanged', handler)
			}
		},
		subscribeChainChanged: handler => {
			const ethereum = getProvider()
			ethereum?.on?.('chainChanged', handler)
			return () => {
				ethereum?.removeListener?.('chainChanged', handler)
			}
		},
	}
}
