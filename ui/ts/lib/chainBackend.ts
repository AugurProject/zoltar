import { createPublicClient, createWalletClient, custom, http, publicActions, type Account, type Address, type Hash, type Hex, type PublicActions, type Transport, type WalletClient } from 'viem'
import { getInjectedEthereum, type InjectedEthereum } from '../injectedEthereum.js'
import { hasErrorCode, hasErrorMessage } from './errors.js'
import { tryParseAddressInput } from './inputs.js'
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

type ReadTransportMode = 'provider' | 'rpc'

export type ChainBackend = {
	bootstrapError: string | undefined
	bootstrapLabel: string | undefined
	bootstrapProgress: number | undefined
	createReadClient(): ReadClient
	createWriteClient(accountAddress: Address, callbacks?: CreateWriteClientCallbacks): WriteClient
	currentTimestamp?: bigint
	getAccounts(): Promise<readonly Address[]>
	getChainId(): Promise<string>
	getProvider(): InjectedEthereum | undefined
	hasWallet(): boolean
	id: 'injected' | 'simulation'
	isBootstrapped?: boolean
	isBootstrapping?: boolean
	profile: NetworkProfile
	requestAccounts(): Promise<readonly Address[]>
	setReadTransportMode?: (mode: ReadTransportMode) => void
	subscribe: ((handler: () => void) => () => void) | undefined
	subscribeAccountsChanged(handler: () => void): () => void
	subscribeChainChanged(handler: () => void): () => void
	waitUntilReady?(): Promise<void>
}

function createReadClientForProfile(profile: NetworkProfile, transportMode: ReadTransportMode, ethereum?: InjectedEthereum): ReadClient {
	return createPublicClient({
		chain: profile.chain,
		transport: transportMode === 'provider' && ethereum !== undefined ? custom(ethereum) : http(DEFAULT_RPC_URL, { batch: { wait: 100 } }),
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
	return typeof value === 'string' ? tryParseAddressInput(value) : undefined
}

function isProviderRequestError(error: unknown) {
	return hasErrorCode(error) || hasErrorMessage(error)
}

export function createInjectedBackend(): ChainBackend {
	const getProvider = () => getInjectedEthereum()
	let readTransportMode: ReadTransportMode = 'provider'

	return {
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		createReadClient: () => createReadClientForProfile(MAINNET_NETWORK_PROFILE, readTransportMode, getProvider()),
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
			let result: unknown
			try {
				result = await ethereum.request({ method: 'eth_accounts' })
			} catch (error) {
				if (!isProviderRequestError(error)) throw error
				return []
			}
			if (!Array.isArray(result)) return []
			return result.map(normalizeAccount).filter((address): address is Address => address !== undefined)
		},
		getChainId: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return MAINNET_NETWORK_PROFILE.chainIdHex
			let result: unknown
			try {
				result = await ethereum.request({ method: 'eth_chainId' })
			} catch (error) {
				if (!isProviderRequestError(error)) throw error
				return MAINNET_NETWORK_PROFILE.chainIdHex
			}
			return typeof result === 'string' ? result : MAINNET_NETWORK_PROFILE.chainIdHex
		},
		getProvider,
		hasWallet: () => getProvider() !== undefined,
		id: 'injected',
		profile: MAINNET_NETWORK_PROFILE,
		requestAccounts: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return []
			let result: unknown
			try {
				result = await ethereum.request({ method: 'eth_requestAccounts' })
			} catch (error) {
				if (!isProviderRequestError(error)) throw error
				return []
			}
			if (!Array.isArray(result)) return []
			return result.map(normalizeAccount).filter((address): address is Address => address !== undefined)
		},
		setReadTransportMode: mode => {
			readTransportMode = mode
		},
		subscribe: undefined,
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
