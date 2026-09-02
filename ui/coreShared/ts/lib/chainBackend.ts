import { createPublicClient, createWalletClient, custom, http, publicActions, type Account, type Address, type Hash, type Hex, type PublicActions, type Transport, type WalletClient } from '@zoltar/shared/ethereum'
import { getInjectedEthereum, normalizeInjectedAccount, parseInjectedChainId, readInjectedAccounts, switchInjectedChain, type InjectedEthereum } from '../injectedEthereum.js'
import { hasErrorCode, hasErrorMessage } from './errors.js'
import { sameChainId } from './chainId.js'
import { getNetworkSwitchTarget, MAINNET_NETWORK_PROFILE, type NetworkProfile } from './networkProfile.js'
import { resolveConfiguredRpcConfig, type ConfiguredRpcSource, type RejectedRpcOverride } from './rpcConfig.js'

export type ReadClient = ReturnType<typeof createPublicClient>
export type WriteClient = WalletClient<Transport, NetworkProfile['chain'], Account> &
	PublicActions<Transport, NetworkProfile['chain']> & {
		assertCanonicalRawTransactionCost?: (signer: Address, costAttoEth: bigint) => void
		installSimulationProxyDeployer?: (parameters: { address: Address; runtimeCode: Hex }) => Promise<void>
		onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined
		onTransactionSubmitted?: ((hash: Hash) => void) | undefined
		patchSimulationGenesisRepToken?: (parameters: { repAddress: Address; zoltarAddress: Address }) => Promise<void>
		recordCanonicalFunding?: (signer: Address, amountAttoEth: bigint) => void
		recordCanonicalRawTransaction?: (signer: Address, costAttoEth: bigint) => void
		requiresWalletConfirmation?: boolean | undefined
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
	contractLabel?: string | undefined
	data?: Hex | undefined
	dataLabel?: string | undefined
	functionName: string
	requiresWalletConfirmation?: boolean | undefined
	to?: Address | undefined
	toLabel?: string | undefined
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
	disconnectWallet?: () => Promise<void>
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
	requestAccountSelection?: () => Promise<readonly Address[]>
	setReadBackendBlock?: (block: { number: bigint | undefined; timestamp: bigint | undefined }) => void
	setReadTransportMode?: (mode: ReadTransportMode) => void
	subscribe: ((handler: () => void) => () => void) | undefined
	subscribeAccountsChanged(handler: () => void): () => void
	subscribeChainChanged(handler: () => void): () => void
	switchNetwork?: () => Promise<void>
	waitUntilReady?(): Promise<void>
}

function createReadClientForProfile(profile: NetworkProfile, transportMode: ReadTransportMode, rpcUrl: string, ethereum?: InjectedEthereum): ReadClient {
	return createPublicClient({
		chain: profile.chain,
		transport: transportMode === 'provider' && ethereum !== undefined ? custom(ethereum, { retryCount: 0 }) : http(rpcUrl, { batch: { wait: 100 } }),
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
		onTransactionSubmitted: callbacks.onTransactionSubmitted,
		sendRawTransaction,
		sendTransaction,
		writeContract,
	}
}

export function normalizeAccount(value: unknown): Address | undefined {
	return normalizeInjectedAccount(value)
}

function isProviderRequestError(error: unknown) {
	return hasErrorCode(error) || hasErrorMessage(error)
}

async function readProviderAccounts(ethereum: InjectedEthereum | undefined) {
	if (ethereum === undefined) return []
	try {
		return await readInjectedAccounts(ethereum)
	} catch (error) {
		if (!isProviderRequestError(error)) throw error
		return []
	}
}

async function readProviderChainId(ethereum: InjectedEthereum | undefined) {
	if (ethereum === undefined) throw new Error('Unable to verify wallet network because no injected wallet was found.')
	let result: unknown
	try {
		result = await ethereum.request({ method: 'eth_chainId', params: [] })
	} catch (error) {
		if (!isProviderRequestError(error)) throw error
		throw new Error('Unable to verify wallet network.')
	}
	return parseInjectedChainId(result)
}

export function createInjectedBackend({ profile = MAINNET_NETWORK_PROFILE, rpcUrl }: { profile?: NetworkProfile; rpcUrl?: string } = {}): ChainBackend {
	const getProvider = () => getInjectedEthereum()
	let readTransportMode: ReadTransportMode = 'provider'
	let readBackendBlockNumber: bigint | undefined
	let readBackendBlockTimestamp: bigint | undefined
	const fallbackRpcUrl = profile.chain.rpcUrls.default.http[0]
	if (fallbackRpcUrl === undefined) throw new Error(`No default RPC URL is configured for ${profile.displayName}`)
	const configuredRpc = resolveConfiguredRpcConfig(rpcUrl === undefined ? { fallbackRpcUrl, networkId: profile.id } : { fallbackRpcUrl, networkId: profile.id, overrideRpcUrl: rpcUrl })

	return {
		bootstrapError: undefined,
		bootstrapLabel: undefined,
		bootstrapProgress: undefined,
		createReadClient: () => createReadClientForProfile(profile, readTransportMode, configuredRpc.url, getProvider()),
		createWriteClient: (accountAddress, callbacks = {}) => {
			const ethereum = getProvider()
			if (ethereum === undefined) throw new Error('No injected wallet found')

			const baseClient = createWalletClient({
				account: accountAddress,
				chain: profile.chain,
				transport: custom(ethereum),
			}).extend(publicActions) as WriteClient

			return withTransactionCallbacks(baseClient, callbacks, async () => {
				const currentAccounts = await readProviderAccounts(ethereum)
				const currentAccount = currentAccounts[0]
				if (currentAccount === undefined) throw new Error('Wallet account is no longer connected. Reconnect your wallet and try again.')
				if (currentAccount.toLowerCase() !== accountAddress.toLowerCase()) throw new Error('Wallet account changed. Review the action with the connected account and try again.')
				const currentChainId = await readProviderChainId(ethereum)
				if (!sameChainId(currentChainId, profile.chainIdHex)) throw new Error(`Wallet network changed. Switch to ${getNetworkSwitchTarget(profile)} and try again.`)
			})
		},
		disconnectWallet: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			await ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] })
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
		profile,
		requestAccounts: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return []
			return await readInjectedAccounts(ethereum, 'eth_requestAccounts')
		},
		requestAccountSelection: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) return []
			await ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] })
			return await readProviderAccounts(ethereum)
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
		switchNetwork: async () => {
			const ethereum = getProvider()
			if (ethereum === undefined) throw new Error('No injected wallet found')
			await switchInjectedChain(ethereum, profile.chainIdHex)
		},
	}
}
