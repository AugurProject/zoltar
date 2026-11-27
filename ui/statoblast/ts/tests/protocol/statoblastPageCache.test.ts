import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, type Address } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblastDisplayCache, statoblastPageCache } from '@zoltar/ui-statoblast-shared/protocol/statoblastPageCache.js'

installDomTestLifecycle()

const pool: Address = '0x1111111111111111111111111111111111111111'
const multicall: Address = '0x2222222222222222222222222222222222222222'
const owner: Address = '0x3333333333333333333333333333333333333333'
const hash = keccak256('0x01')
const block = { number: '0xa', hash, parentHash: hash, timestamp: '0xa', gasLimit: '0x100', gasUsed: '0x0', nonce: '0x0000000000000000', transactions: [] }
const abi = parseAbi(['function value() view returns (uint256)'])
const cacheIdentity = { pool, owner, universeId: 0n, page: 'capital' }

test.each(['session verification', 'aggregate failure', 'wrong RPC network'] as const)('Capital keeps saved display data and performs live %s safely', async scenario => {
	const methods: string[] = []
	let currentValue = 20n
	let currentCode = '0x6000'
	let chainIdHex = '0x1'
	let failAggregate = false
	const word = (value: bigint) => encodeAbiParameters(parseAbiParameters('uint256'), [value])
	const client = createPublicClient({
		transport: custom(
			{
				request: async ({ method, params }) => {
					methods.push(method)
					if (method === 'eth_getBlockByNumber') return block
					if (method === 'eth_getCode') return currentCode
					if (method === 'eth_chainId') return chainIdHex
					if (method === 'eth_call') {
						if (!Array.isArray(params)) throw new Error('Missing RPC args.')
						expect(params[1]).toBe('0xa')
						if (params[0].to === multicall && failAggregate) throw new Error('Aggregate stopped working.')
						return params[0].to === multicall ? encodeAbiParameters(parseAbiParameters('(bool success,bytes returnData)[]'), [[{ success: true, returnData: word(currentValue) }]]) : word(currentValue)
					}
					throw new Error(`Unexpected RPC method ${method}`)
				},
			},
			{ retryCount: 0 },
		),
	})
	const read = async (reader: ReadClient) => {
		const [latest, chainId] = await Promise.all([reader.getBlock(), reader.getChainId()])
		expect(chainId).toBe(1)
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
	expect(methods).toEqual(['eth_getBlockByNumber', 'eth_chainId', 'eth_call', 'eth_getBlockByNumber'])
	if (scenario === 'aggregate failure') {
		methods.length = 0
		failAggregate = true
		currentValue = 23n
		await expect(session.refresh(client, multicall, read)).resolves.toEqual({ value: 23n, code: '0x6000' })
		expect(methods).toEqual(['eth_getBlockByNumber', 'eth_chainId', 'eth_call', 'eth_call', 'eth_getCode', 'eth_getBlockByNumber'])
		return
	}
	methods.length = 0
	if (scenario === 'wrong RPC network') {
		chainIdHex = '0x2'
		await expect(mounted.refresh(client, multicall, read)).rejects.toThrow('another network')
		expect(methods).toEqual(['eth_getBlockByNumber', 'eth_chainId'])
		return
	}
	currentValue = 22n
	currentCode = '0x6001'
	await expect(mounted.refresh(client, multicall, read)).resolves.toEqual({ value: 22n, code: '0x6001' })
	expect(methods).toEqual(['eth_getBlockByNumber', 'eth_chainId', 'eth_call', 'eth_getCode', 'eth_getBlockByNumber'])
})

test('saved display data uses the matching wallet and universe and evicts the least recently used page', () => {
	const anchor = { number: 10n, timestamp: 20n }
	const display = (page: string, wallet = owner, universeId = 0n) => statoblastDisplayCache(MAINNET_NETWORK_PROFILE, { universeId, owner: wallet, page }, value => (typeof value === 'string' ? value : undefined))
	const first = display('first')
	const second = display('second')
	const large = 'a'.repeat(1_000_000)
	first.write(large, anchor)
	second.write(large, anchor)
	expect(display('first', pool).read()).toBeUndefined()
	expect(display('first', owner, 1n).read()).toBeUndefined()
	expect(first.read()).toMatchObject({ value: large, timestamp: 20n })
	display('third').write(large, anchor)
	expect(second.read()).toBeUndefined()
	expect(first.read()?.value).toBe(large)
	expect(display('third').read()?.value).toBe(large)
})
