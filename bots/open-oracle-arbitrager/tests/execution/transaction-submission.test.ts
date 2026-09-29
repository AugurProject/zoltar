import { afterEach, expect, test } from 'bun:test'
import { keccak256, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { submitConfiguredSignedBundle } from '#execution/transaction-submission'

// The shared relay, simulation and private-submission behaviour is covered by bots/shared/tests/transaction-submission.test.ts.
const servers: Bun.Server<unknown>[] = []
const address = '0x0000000000000000000000000000000000000001' as Address
const serializedTransaction = `0x${'34'.repeat(64)}` as Hex
const signature = `0x${'56'.repeat(65)}` as Hex

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function relay(handler: () => Response) {
	const server = Bun.serve({ fetch: handler, hostname: '127.0.0.1', port: 0 })
	servers.push(server)
	if (server.port === undefined) throw new Error('Test relay did not expose a port')
	return `http://127.0.0.1:${server.port.toString()}`
}

test('applies the configured simulation threshold to entry and lifecycle bundle submission', async () => {
	const bundleHash = keccak256(`0x${keccak256(serializedTransaction).slice(2)}`)
	const accepted = relay(() => Response.json({ id: 1, jsonrpc: '2.0', result: { bundleHash } }))
	const rejected = relay(() => Response.json({ error: { code: -32_000, message: 'submission rejected' }, id: 1, jsonrpc: '2.0' }))
	await expect(
		submitConfiguredSignedBundle(
			{ minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: [accepted, rejected] },
			{
				address,
				relayUrls: [accepted, rejected],
				signMessage: () => Promise.resolve(signature),
				targetBlockNumber: 100n,
				transactions: [serializedTransaction],
			},
		),
	).rejects.toThrow('required 2 accepting relays')
})
