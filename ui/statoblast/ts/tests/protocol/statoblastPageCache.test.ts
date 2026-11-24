import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblastPageCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'

installDomTestLifecycle()

const pool: Address = '0x1111111111111111111111111111111111111111'
const multicall: Address = '0x2222222222222222222222222222222222222222'
const owner: Address = '0x3333333333333333333333333333333333333333'
const hash = keccak256('0x01')
const block = { number: '0xa', hash, parentHash: hash, timestamp: '0xa', gasLimit: '0x100', gasUsed: '0x0', nonce: '0x0000000000000000', transactions: [] }
const abi = parseAbi(['function value() view returns (uint256)'])
const cacheIdentity = { pool, owner, universeId: 0n, page: 'capital' }

test('replays saved display data without RPC and batches verified warm reads at one pinned block', async () => {
	const methods: string[] = []
	let currentValue = 20n
	const word = (value: bigint) => encodeAbiParameters(parseAbiParameters('uint256'), [value])
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				methods.push(method)
				if (method === 'eth_getBlockByNumber') return block
				if (method === 'eth_getCode') return '0x6000'
				if (method === 'eth_call') {
					if (!Array.isArray(params)) throw new Error('Missing RPC args.')
					expect(params[1]).toBe('0xa')
					return params[0].to === multicall ? encodeAbiParameters(parseAbiParameters('(bool success,bytes returnData)[]'), [[{ success: true, returnData: word(currentValue) }]]) : word(currentValue)
				}
				throw new Error(`Unexpected RPC method ${method}`)
			},
		}),
	})
	const read = async (reader: ReadClient) => {
		const latest = await reader.getBlock()
		const [value, code] = await Promise.all([reader.readContract({ abi, address: pool, functionName: 'value', blockNumber: latest.number }), reader.getCode({ address: pool, blockNumber: latest.number })])
		return { value, code }
	}
	const session = statoblastPageCache(MAINNET_NETWORK_PROFILE, cacheIdentity)
	await expect(session.refresh(client, multicall, read)).resolves.toEqual({ value: 20n, code: '0x6000' })
	const mounted = statoblastPageCache(MAINNET_NETWORK_PROFILE, cacheIdentity)
	const initialMethods = methods.length
	await expect(mounted.loadCached(client, read)).resolves.toMatchObject({ value: { value: 20n, code: '0x6000' } })
	expect(methods).toHaveLength(initialMethods)
	methods.length = 0
	currentValue = 21n
	await expect(session.refresh(client, multicall, read)).resolves.toEqual({ value: 21n, code: '0x6000' })
	expect(methods).toEqual(['eth_getBlockByNumber', 'eth_call', 'eth_getBlockByNumber'])
})
