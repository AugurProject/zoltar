import { createPublicClient, createWalletClient, custom, EIP1193Provider, http, publicActions } from '@zoltar/shared/ethereum'
import type { Hash } from '@zoltar/shared/ethereum'
import { addressString } from './bigint'
import { mainnet } from '@zoltar/shared/ethereum'
import type { AnvilWindowEthereum } from '../AnvilWindowEthereum'

const DEFAULT_HTTP = 'https://ethereum.dark.florist'
const anvilWindowByClient = new WeakMap<object, AnvilWindowEthereum>()

const isAnvilWindowEthereum = (ethereum: EIP1193Provider | AnvilWindowEthereum): ethereum is AnvilWindowEthereum => 'addStateOverrides' in ethereum && typeof ethereum.addStateOverrides === 'function'

const createReadClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, cacheTime: number = 10_000) => {
	if (ethereum === undefined) return createPublicClient({ transport: http(DEFAULT_HTTP, { batch: { wait: 100 } }), cacheTime })
	return createWalletClient({ transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
}

export const createWriteClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, accountAddress: bigint, cacheTime: number = 10_000) => {
	if (ethereum === undefined) throw new Error('no window.ethereum injected')
	const client = createWalletClient({ account: addressString(accountAddress), transport: custom(ethereum), cacheTime, chain: mainnet }).extend(publicActions)
	if (isAnvilWindowEthereum(ethereum)) anvilWindowByClient.set(client, ethereum)
	return client
}

export const getClientAnvilWindow = (client: object) => anvilWindowByClient.get(client)

export type WriteClient = ReturnType<typeof createWriteClient>
export type ReadClient = ReturnType<typeof createReadClient> | ReturnType<typeof createWriteClient>

const replayRevertedTransaction = async (client: WriteClient, hash: Hash) => {
	const transaction = await client.getTransaction({ hash })
	await client.call({
		account: transaction.from,
		data: transaction.input,
		gas: transaction.gas,
		gasPrice: transaction.gasPrice,
		to: transaction.to ?? undefined,
		value: transaction.value,
	})
}

export const writeContractAndWait = async (client: WriteClient, execute: () => Promise<Hash>) => {
	const hash = await execute()
	const receipt = await client.waitForTransactionReceipt({ hash })
	if (receipt.status === 'reverted') {
		try {
			await replayRevertedTransaction(client, hash)
		} catch (error) {
			throw error
		}
		throw new Error(`Transaction reverted: ${hash}`)
	}
	return hash
}
