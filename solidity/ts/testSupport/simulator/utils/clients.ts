import { createPublicClient, createWalletClient, custom, EIP1193Provider, http, publicActions } from '@zoltar/core-shared/evm/ethereum'
import type { Chain, Hash } from '@zoltar/core-shared/evm/ethereum'
import { addressString } from './bigint'
import { mainnet } from '@zoltar/core-shared/evm/ethereum'
import type { AnvilWindowEthereum } from '../AnvilWindowEthereum'

const DEFAULT_HTTP = 'https://ethereum.dark.florist'

const createReadClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum) => {
	if (ethereum === undefined) return createPublicClient({ transport: http(DEFAULT_HTTP) })
	return createWalletClient({ transport: custom(ethereum), chain: mainnet }).extend(publicActions)
}

export const createWriteClient = (ethereum: EIP1193Provider | undefined | AnvilWindowEthereum, accountAddress: bigint, chain: Chain = mainnet) => {
	if (ethereum === undefined) throw new Error('no window.ethereum injected')
	return createWalletClient({ account: addressString(accountAddress), transport: custom(ethereum), chain }).extend(publicActions)
}

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
		await replayRevertedTransaction(client, hash)
		throw new Error(`Transaction reverted: ${hash}`)
	}
	return hash
}
