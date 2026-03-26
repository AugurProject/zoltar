import { createPublicClient, createWalletClient, custom, http, publicActions, getAddress, type Address } from 'viem'
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

export function createWriteClient(ethereum: InjectedEthereum, accountAddress: Address) {
	return createWalletClient({
		account: accountAddress,
		chain: mainnet,
		transport: custom(ethereum),
	}).extend(publicActions)
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
