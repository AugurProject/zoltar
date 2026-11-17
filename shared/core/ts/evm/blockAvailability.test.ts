import { expect, test } from 'bun:test'
import { createPublicClient, custom, mainnet, RpcError } from './ethereum.js'

test('a null confirmed-block response is a typed availability failure', async () => {
	const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => null }) })
	await expect(client.getBlock({ blockNumber: 10n })).rejects.toMatchObject({ code: -32000, message: 'RPC block not found' })
})

test('malformed block data remains a safety fault rather than an availability response', async () => {
	const client = createPublicClient({ chain: mainnet, transport: custom({ request: async () => 'malformed' }) })
	await expect(client.getBlock({ blockNumber: 10n })).rejects.not.toBeInstanceOf(RpcError)
	await expect(client.getBlock({ blockNumber: 10n })).rejects.toThrow('RPC returned an invalid block')
})
