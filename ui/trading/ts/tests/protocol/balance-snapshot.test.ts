import { expect, test } from 'bun:test'
import { createPublicClient, custom, encodeAbiParameters } from '@zoltar/core-shared/evm/ethereum'
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
