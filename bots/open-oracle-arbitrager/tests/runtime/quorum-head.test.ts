import { networkConfiguration } from '#config/network'
import { expect, test } from 'bun:test'
import { createPublicClient, type Chain, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import { custom } from '@zoltar/bot-shared/ethereum/rpc-transport'
import { selectQuorumHead, selectQuorumChainClient } from '../../src/runtime/quorum-head.ts'

const network = networkConfiguration('sepolia')
const endpoints = ['https://primary.example', 'https://second.example', 'https://third.example']

/** Answers eth_chainId per endpoint with a chain id or a transport failure; the read is routed by the URL the operator passes. */
function chainRead(answers: readonly (number | Error)[]) {
	const requested: string[] = []
	const clients = new Map(
		endpoints.map((endpoint, index) => [
			endpoint,
			createPublicClient({
				chain: network.chain,
				transport: custom({
					request: async ({ method }) => {
						if (method !== 'eth_chainId') throw new Error(`Unexpected ${method} read`)
						const answer = answers[index]
						if (answer === undefined || answer instanceof Error) throw answer ?? new Error('Unknown endpoint')
						return `0x${answer.toString(16)}`
					},
				}),
			}),
		]),
	)
	const read = async <Value>(_method: string, request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>, rpcUrl: string) => {
		requested.push(rpcUrl)
		const client = clients.get(rpcUrl)
		if (client === undefined) throw new Error(`Unknown endpoint ${rpcUrl}`)
		return await request(client)
	}
	return { read, requested }
}

test('selects the first endpoint that answered once the quorum agrees on the configured chain', async () => {
	const clients = ['primary', 'second', 'third'] as const
	const agreed = chainRead([network.chain.id, network.chain.id, network.chain.id])
	expect(await selectQuorumChainClient(clients, endpoints, network, agreed.read, 1)).toEqual({ client: 'primary', rpcUrl: 'https://primary.example' })
	expect(agreed.requested).toEqual([...endpoints])
	// A rejected primary still yields a usable client from the next fulfilled endpoint.
	const primaryDown = chainRead([new Error('fetch failed'), network.chain.id, network.chain.id])
	expect(await selectQuorumChainClient(clients, endpoints, network, primaryDown.read, 1)).toEqual({ client: 'second', rpcUrl: 'https://second.example' })
})

test('rejects a quorum that agrees on a different chain or has no available endpoint', async () => {
	const clients = ['primary', 'second'] as const
	const wrongChain = chainRead([1, 1])
	await expect(selectQuorumChainClient(clients, endpoints.slice(0, 2), network, wrongChain.read, 1)).rejects.toThrow('Read RPC quorum https://primary.example, https://second.example returned chain 1 while calling eth_chainId; expected sepolia chain 11155111')
	const offline = chainRead([new Error('fetch failed'), new Error('fetch failed')])
	await expect(selectQuorumChainClient(clients, endpoints.slice(0, 2), network, offline.read, 1)).rejects.toThrow('configured chain id requires at least one available RPC endpoint')
})

test('a lagging third reader cannot pin a two-reader quorum to an old head', async () => {
	const heads = [100n, 100n, 40n]
	const reads: { endpoint: string; block: bigint }[] = []
	const clients = endpoints.map((endpoint, index) =>
		createPublicClient({
			chain: network.chain,
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_blockNumber') return `0x${(heads[index] ?? 0n).toString(16)}`
					if (method === 'eth_getBlockByNumber') {
						if (!Array.isArray(params) || typeof params[0] !== 'string') throw new Error('Missing block parameter')
						const block = BigInt(params[0])
						reads.push({ endpoint, block })
						return { number: `0x${block.toString(16)}`, hash: `0x${'11'.repeat(32)}`, timestamp: '0x1', transactions: [] }
					}
					throw new Error(`Unexpected ${method}`)
				},
			}),
		}),
	)
	const result = await selectQuorumHead(
		clients,
		endpoints,
		async (_method, request, url) => {
			const client = clients[endpoints.findIndex(endpoint => endpoint === url)]
			if (client === undefined) throw new Error('Missing client')
			return request(client)
		},
		2,
	)
	expect(result.block.number).toBe(100n)
	expect(reads).toEqual(endpoints.slice(0, 2).map(endpoint => ({ endpoint, block: 100n })))
})
