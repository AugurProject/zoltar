import { expect, test } from 'bun:test'
import { createRpcRequestQueue } from '../../src/rpc-request-queue.ts'

test('sequential RPC operations can reuse the slot immediately after settlement', async () => {
	const queue = createRpcRequestQueue(1, 0)
	await queue.run(async () => 1)
	await expect(
		queue.run(async () => {
			throw new Error('RPC failed')
		}),
	).rejects.toThrow('RPC failed')
	expect(await queue.run(async () => 2)).toBe(2)
})
