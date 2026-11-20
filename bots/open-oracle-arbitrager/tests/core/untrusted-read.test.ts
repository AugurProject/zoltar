import { expect, test } from 'bun:test'
import { batchRead } from '#core/batch-read'
import { createPublicClient, encodeAbiParameters, getAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { networkConfiguration } from '#config/network'

const abi = [{ type: 'function', name: 'value', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] }] as const
const network = networkConfiguration('mainnet')
const bad = getAddress('0x0000000000000000000000000000000000000001')
const good = getAddress('0x0000000000000000000000000000000000000002')

for (const issue of [1441, 1446])
	test(`#${issue}: gas-burning untrusted reads cannot exhaust a healthy read`, async () => {
		const requests: unknown[] = []
		const client = createPublicClient({
			chain: network.chain,
			transport: custom({
				request: async ({ method, params }) => {
					expect(method).toBe('eth_call')
					requests.push(params)
					if (!Array.isArray(params)) throw new Error('Missing parameters')
					const transaction = params[0]
					if (typeof transaction !== 'object' || transaction === null || !('to' in transaction) || !('gas' in transaction)) throw new Error('Untrusted call must have its own gas budget')
					if (transaction.to === bad) throw Object.assign(new Error('out of gas'), { code: -32603 })
					expect(transaction.to).toBe(good)
					expect(transaction.gas).toBe('0x186a0')
					expect(params[1]).toBe('0xa')
					return encodeAbiParameters([{ type: 'uint256' }], [42n])
				},
			}),
		})
		const results = await batchRead(
			client,
			network.multicall3,
			[bad, good].map(address => ({ address, abi, functionName: 'value' })),
			10n,
			{ gas: 100_000n },
		)
		expect(results[0]?.status).toBe('failure')
		expect(results[1]).toEqual({ status: 'success', result: 42n })
		expect(requests).toHaveLength(2)
	})

test('untrusted-read isolation preserves connectivity failures', async () => {
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: async () => {
				throw new Error('fetch failed')
			},
		}),
	})
	await expect(batchRead(client, network.multicall3, [{ address: good, abi, functionName: 'value' }], 10n, { gas: 100_000n })).rejects.toThrow('fetch failed')
})
