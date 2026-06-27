import { createPublicClient, createWalletClient, custom, http, publicActions, type Account, type Address, type Hash, type Hex, type PublicActions, type Transport, type WalletClient } from 'viem'
import { getInjectedEthereum, type InjectedEthereum } from '../injectedEthereum.js'
import { hasErrorCode, hasErrorMessage } from './errors.js'
import { tryParseAddressInput } from './inputs.js'
import { MAINNET_NETWORK_PROFILE, type NetworkProfile } from './networkProfile.js'
import { resolveConfiguredRpcConfig, type ConfiguredRpcSource, type RejectedRpcOverride } from './rpcConfig.js'

export type ReadClient = ReturnType<typeof createPublicClient>
export type WriteClient = WalletClient<Transport, NetworkProfile['chain'], Account> &
	PublicActions<Transport, NetworkProfile['chain']> & {
		installSimulationProxyDeployer?: (parameters: { address: Address; runtimeCode: Hex }) => Promise<void>
		onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined
		patchSimulationGenesisRepToken?: (parameters: { repAddress: Address; zoltarAddress: Address }) => Promise<void>
	}

export type CreateWriteClientCallbacks = {
	onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined
	onTransactionSubmitted?: (hash: Hash) => void
}

export type TransactionRequestPreview = {
	account: Account | Address | undefined
	args: readonly unknown[] | undefined
	chainName: string | undefined
	contractAddress?: Address | undefined
	data?: Hex | undefined
	dataLabel?: string | undefined
	functionName: string
	requiresWalletConfirmation?: boolean | undefined
	to?: Address | undefined
	value: bigint | undefined
}

type ReadTransportMode = 'provider' | 'rpc'

export type ReadBackendStatus = {
	blockNumber: bigint | undefined
	blockTimestamp: bigint | undefined
	rejectedRpcOverride?: RejectedRpcOverride | undefined
	rpcSource: ConfiguredRpcSource
	rpcUrl: string
	transportMode: ReadTransportMode
}

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
	getReadBackendStatus?(): ReadBackendStatus
	hasWallet(): boolean
	id: 'injected' | 'simulation'
	isBootstrapped?: boolean
	isBootstrapping?: boolean
	profile: NetworkProfile
	requestAccounts(): Promise<readonly Address[]>
	setReadBackendBlock?: (block: { number: bigint | undefined; timestamp: bigint | undefined }) => void
	setReadTransportMode?: (mode: ReadTransportMode) => void
	subscribe: ((handler: () => void) => () => void) | undefined
	subscribeAccountsChanged(handler: () => void): () => void
	subscribeChainChanged(handler: () => void): () => void
	waitUntilReady?(): Promise<void>
}

function createReadClientForProfile(profile: NetworkProfile, transportMode: ReadTransportMode, rpcUrl: string, ethereum?: InjectedEthereum): ReadClient {
	return createPublicClient({
		chain: profile.chain,
		transport: transportMode === 'provider' && ethereum !== undefined ? custom(ethereum) : http(rpcUrl, { batch: { wait: 100 } }),
	})
}

function withTransactionCallbacks(baseClient: WriteClient, callbacks: CreateWriteClientCallbacks, validateBeforeSend?: () => Promise<void>): WriteClient {
	const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
		await validateBeforeSend?.()
		const hash = await baseClient.sendRawTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
		await validateBeforeSend?.()
		const hash = await baseClient.sendTransaction(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	const writeContract: typeof baseClient.writeContract = async parameters => {
		await validateBeforeSend?.()
		const hash = await baseClient.writeContract(parameters)
		callbacks.onTransactionSubmitted?.(hash)
		return hash
	}

	return {
		...baseClient,
		onTransactionPrepared: callbacks.onTransactionPrepared,
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

async function readProviderAccounts(ethereum: InjectedEthereum | undefined) {
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
}

async function readProviderChainId(ethereum: InjectedEthereum | undefined) {
	if (ethereum === undefined) throw new Error('Unable to verify wallet network because no injected wallet was found.')
	let result: unknown
	try {
		result = await ethereum.request({ method: 'eth_chainId' })
	} catch (error) {
		if (!isProviderRequestError(error)) throw error
		throw new Error('Unable to verify wallet network.')
	}
	if (typeof result !== 'string') throw new Error('Wallet returned an invalid chain ID.')
	return result
}

export function createInjectedBackend({ rpcUrl }: { rpcUrl?: string } = {}): ChainBackend {
	const getProvider = () => getInjectedEthereum()
	let readTransportMode: ReadTransportMode = 'provider'
	let readBackendBlockNumber: bigint | undefined
	let readBackendBlockTimestamp: bigint | undefined
	const configuredRpc = resolveConfiguredRpcConfig(rpcUrl === undefined ? {} : { overrideRpcUrl: rpcUrl })

	return {
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		createReadClient: () => createReadClientForProfile(MAINNET_NETWORK_PROFILE, readTransportMode, configuredRpc.url, getProvider()),
		createWriteClient: (accountAddress, callbacks = {}) => {
			const ethereum = getProvider()
			if (ethereum === undefined) throw new Error('No injected wallet found')

			const baseClient = createWalletClient({
				account: accountAddress,
				chain: MAINNET_NETWORK_PROFILE.chain,
				transport: custom(ethereum),
			}).extend(publicActions) as WriteClient

			return withTransactionCallbacks(baseClient, callbacks, async () => {
				const currentAccounts = await readProviderAccounts(ethereum)
				const currentAccount = currentAccounts[0]
				if (currentAccount === undefined) throw new Error('Wallet account is no longer connected. Reconnect your wallet and try again.')
				if (currentAccount.toLowerCase() !== accountAddress.toLowerCase()) throw new Error('Wallet account changed. Review the action with the connected account and try again.')
				const currentChainId = await readProviderChainId(ethereum)
				if (currentChainId !== MAINNET_NETWORK_PROFILE.chainIdHex) throw new Error('Wallet network changed. Switch to Ethereum mainnet and try again.')
			})
		},
		getAccounts: async () => await readProviderAccounts(getProvider()),
		getChainId: async () => {
			return await readProviderChainId(getProvider())
		},
		getProvider,
		getReadBackendStatus: () => ({
			blockNumber: readBackendBlockNumber,
			blockTimestamp: readBackendBlockTimestamp,
			rejectedRpcOverride: configuredRpc.rejectedOverride,
			rpcSource: configuredRpc.source,
			rpcUrl: configuredRpc.url,
			transportMode: readTransportMode,
		}),
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
		setReadBackendBlock: (block: { number: bigint | undefined; timestamp: bigint | undefined }) => {
			readBackendBlockNumber = block.number
			readBackendBlockTimestamp = block.timestamp
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
