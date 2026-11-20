import { expect, test } from 'bun:test'
import { createPublicClient, decodeFunctionData, encodeAbiParameters, getAddress } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { networkConfiguration } from '#config/network'
import { lookupUniverseLineages } from '#monitoring/universe-lookup'

const registry = [
	{
		type: 'function',
		name: 'universes',
		stateMutability: 'view',
		inputs: [{ name: 'id', type: 'uint248' }],
		outputs: [
			{ name: 'forkTime', type: 'uint256' },
			{ name: 'forkQuestionId', type: 'uint256' },
			{ name: 'forkingOutcomeIndex', type: 'uint256' },
			{ name: 'reputationToken', type: 'address' },
			{ name: 'parentUniverseId', type: 'uint248' },
		],
	},
] as const
const network = networkConfiguration('sepolia')
const zoltar = getAddress('0x0000000000000000000000000000000000000001')
const hash = `0x${'ab'.repeat(32)}`
function reader(reorg = false) {
	const ids: bigint[] = []
	let blocks = 0
	const client = createPublicClient({
		chain: network.chain,
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_getBlockByNumber') {
					blocks++
					return { number: '0xa', hash: reorg && blocks > 1 ? `0x${'cd'.repeat(32)}` : hash, timestamp: '0x64', transactions: [] }
				}
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error('Unexpected RPC')
				const call = params[0]
				if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string') throw new Error('Missing call data')
				if (!/^0x[0-9a-fA-F]+$/.test(call.data)) throw new Error('Invalid call data')
				// Decode via the public client call shape without assuming any child-list RPC.
				const decoded = decodeFunctionData({ abi: registry, data: `0x${call.data.slice(2)}` })
				expect(params[1]).toBe('0xa')
				const id = decoded.args[0]
				ids.push(id)
				return encodeAbiParameters(registry[0].outputs, [0n, 0n, id, network.rep, 0n])
			},
		}),
	})
	return { client, ids }
}

test('#1480: on-demand lookup reads only the selected identity and ancestors', async () => {
	const primary = reader()
	const secondary = reader()
	const universes = await lookupUniverseLineages([primary.client, secondary.client], zoltar, [123n], 2)
	expect(universes.map(universe => universe.id)).toEqual([0n, 123n])
	expect(primary.ids).toEqual([0n, 123n])
	expect(secondary.ids).toEqual([0n, 123n])
})

test('on-demand lookup rejects a noncanonical reader snapshot', async () => {
	await expect(lookupUniverseLineages([reader(true).client], zoltar, [123n], 1)).rejects.toThrow('canonical block')
})
