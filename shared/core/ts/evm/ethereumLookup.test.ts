import { expect, test } from 'bun:test'
import { createPublicClient, custom, mainnet, TransactionLookupNotFoundError, type Hash } from '@zoltar/core-shared/evm/ethereum'

const RECEIPT_HASH = `0x${'11'.repeat(32)}` satisfies Hash

test('reports typed missing transaction and receipt lookups for null and legacy RPC responses', async () => {
	const providerError = Object.assign(new Error('Transaction receipt could not be found by the provider'), { code: -32000 })
	const client = createPublicClient({
		chain: mainnet,
		transport: custom({
			request: async ({ method }) => {
				if (method === 'eth_getTransactionByHash') return null
				throw providerError
			},
		}),
	})
	await expect(client.getTransaction({ hash: RECEIPT_HASH })).rejects.toBeInstanceOf(TransactionLookupNotFoundError)
	await expect(client.getTransaction({ hash: RECEIPT_HASH })).rejects.toMatchObject({ kind: 'transaction', hash: RECEIPT_HASH })
	await expect(client.getTransactionReceipt({ hash: RECEIPT_HASH })).rejects.toMatchObject({ kind: 'receipt', hash: RECEIPT_HASH, code: providerError.code, message: providerError.message })
})
