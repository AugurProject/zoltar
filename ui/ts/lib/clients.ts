import { createPublicClient, createWalletClient, custom, http, publicActions, getAddress, type Address, type Hash } from 'viem'
import { mainnet } from 'viem/chains'
import { getInjectedEthereum, type InjectedEthereum } from '../injectedEthereum.js'

const DEFAULT_RPC_URL = 'https://ethereum.dark.florist'

export function createReadClient() {
	const ethereum = getInjectedEthereum()

	return createPublicClient({
		chain: mainnet,
		transport: ethereum === undefined ? http(DEFAULT_RPC_URL, { batch: { wait: 100 } }) : custom(ethereum),
	})
}

type CreateWriteClientCallbacks = {
	onTransactionSubmitted?: (hash: Hash) => void
}

export function createWriteClient(ethereum: InjectedEthereum, accountAddress: Address, callbacks: CreateWriteClientCallbacks = {}) {
	const baseClient = createWalletClient({
		account: accountAddress,
		chain: mainnet,
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

export function createWalletWriteClient(accountAddress: Address, callbacks: CreateWriteClientCallbacks = {}) {
	return createWriteClient(getRequiredInjectedEthereum(), accountAddress, callbacks)
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
