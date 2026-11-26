import { expect, test } from 'bun:test'
import { createPublicClient, custom, decodeFunctionData, encodeAbiParameters, encodeFunctionData, parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { lockedSourceBalance } from '../../protocol/liveMarket.js'
import { loadLiveBalances } from '../../protocol/live.js'
import { smallReserveMarketFixture } from '../support/liveMarketFixture.js'

test('wallet share and LP balances read one block across an LP withdrawal (#1769)', async () => {
	const selectors: unknown[] = []
	const client = createPublicClient({
		transport: custom({
			request: async ({ method, params }) => {
				if (method === 'eth_blockNumber') return '0x64'
				if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: `0x${'01'.repeat(32)}`, timestamp: '0x64', transactions: [] }
				if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected ${method}`)
				selectors.push(params[1])
				return encodeAbiParameters([{ type: 'uint256' }], [10n])
			},
		}),
	})
	const market = smallReserveMarketFixture()
	const result = await loadLiveBalances(client, market, '0x0000000000000000000000000000000000000001')
	expect(selectors).toEqual(['0x64', '0x64', '0x64', '0x64'])
	expect(result.yes).toBe(10n)
	expect(result.lp).toBe(10n)
})

test('#1662 shows a source lock before migration and ignores received-only recovery credits', () => {
	const balances = { invalid: 10n, yes: 20n, no: 30n, migrated: { invalid: 0n, yes: 0n, no: 0n }, sourceLocks: { invalid: false, yes: true, no: false } }
	expect(lockedSourceBalance(balances, 'YES')).toBe(20n)
	expect(lockedSourceBalance(balances, 'INVALID')).toBe(0n)
	expect(lockedSourceBalance(balances, 'NO')).toBe(0n)
})

for (const failLockRead of [false, true]) {
	test(`#1662 ${failLockRead ? 'rejects unavailable lock state' : 'reads source locks at the balance block without migration history'}`, async () => {
		const account = '0x0000000000000000000000000000000000000001'
		const market = { ...smallReserveMarketFixture(), universeForkTime: 1n }
		const abi = parseAbi(['function isSourceBalanceLocked(uint256 id,address holder) view returns (bool)'])
		const selector = encodeFunctionData({ abi, functionName: 'isSourceBalanceLocked', args: [0n, account] }).slice(0, 10)
		const calls: unknown[] = []
		const client = createPublicClient({
			transport: custom({
				request: async ({ method, params }) => {
					if (method === 'eth_blockNumber') return '0x64'
					if (method === 'eth_getBlockByNumber') return { number: '0x64', hash: `0x${'01'.repeat(32)}`, timestamp: '0x64', transactions: [] }
					if (method !== 'eth_call' || !Array.isArray(params)) throw new Error(`Unexpected ${method}`)
					const call = params[0]
					if (typeof call !== 'object' || call === null || !('data' in call) || typeof call.data !== 'string' || !call.data.startsWith('0x')) throw new Error('Missing call data')
					if (call.data.startsWith(selector)) {
						if (failLockRead) return '0x'
						calls.push(params[1])
						const decoded = decodeFunctionData({ abi, data: `0x${call.data.slice(2)}` })
						return encodeAbiParameters([{ type: 'bool' }], [decoded.args?.[0] === ((market.universeId << 8n) | 1n)])
					}
					if (call.data.startsWith('0x00fdd58e') || call.data.startsWith('0x70a08231')) {
						calls.push(params[1])
						return encodeAbiParameters([{ type: 'uint256' }], [10n])
					}
					return '0x'
				},
			}),
		})
		if (failLockRead) {
			await expect(loadLiveBalances(client, market, account)).rejects.toThrow()
			return
		}
		const result = await loadLiveBalances(client, market, account)
		expect(result.sourceLocks).toEqual({ invalid: false, yes: true, no: false })
		expect(result.migrated).toBeUndefined()
		expect(calls).toEqual(Array(7).fill('0x64'))
		expect(lockedSourceBalance(result, 'YES')).toBe(10n)
	})
}
